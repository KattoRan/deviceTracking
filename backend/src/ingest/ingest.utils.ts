import type { CellTowerDto } from './dto/submit-data.dto';

export type NormalizedCell = CellTowerDto & { isServing: boolean };

export function isValidCell(c: CellTowerDto): boolean {
  if (!c.mcc || !c.mnc || !c.lac || !c.cid) return false;
  if (c.cid <= 0) return false;
  // Signal is optional: a valid identity is enough to resolve the BTS. Some
  // modems report a cell (e.g. WCDMA) with no usable RSCP — we keep it but it
  // can't win the serving-cell pick by strength (see markServingCell).
  return true;
}

/**
 * Picks the serving cell.
 *
 * Source of truth is `isRegistered` reported by the modem (via
 * `CellInfo.isRegistered` on Android) — that's the cell the device is
 * actually attached to. Signal strength is only a heuristic and can
 * mislead: a neighbour cell may have higher RSRP than the serving one
 * during handover, and under LTE+NR NSA the anchor and secondary are
 * both registered at once with different signals.
 *
 * Policy:
 *   1. If any cell reports `isRegistered=true`, pick the strongest among
 *      them. This handles dual-registered NSA correctly — the anchor
 *      (LTE) and the NR leg are both registered, we surface the one the
 *      user is effectively experiencing.
 *   2. Otherwise (iOS, older builds, mock data without the flag),
 *      fall back to the strongest signal overall.
 */
export function markServingCell(cells: CellTowerDto[]): NormalizedCell[] {
  if (cells.length === 0) return [];

  const registered = cells.filter((c) => c.isRegistered === true);
  const pool = registered.length > 0 ? registered : cells;

  // Cells with no usable signal (null/undefined — e.g. WCDMA without RSCP)
  // rank as the weakest so a cell with a real reading always wins. When the
  // whole pool lacks a reading (3G-only device on such a modem), default to
  // the first pooled cell so a serving cell is still chosen.
  const sig = (c: CellTowerDto) =>
    typeof c.signalDbm === 'number' ? c.signalDbm : -Infinity;

  let bestIndex = cells.indexOf(pool[0]);
  let bestDbm = sig(pool[0]);
  pool.forEach((c) => {
    if (sig(c) > bestDbm) {
      bestDbm = sig(c);
      bestIndex = cells.indexOf(c);
    }
  });

  return cells.map((c, i) => ({ ...c, isServing: i === bestIndex }));
}

/**
 * FIFO queue with bounded concurrency — replaces p-queue so we stay
 * CJS-compatible and avoid an extra dep for a handful of lines of logic.
 */
export class ConcurrencyQueue {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            const next = this.waiting.shift();
            if (next) next();
          });
      };
      if (this.running < this.concurrency) run();
      else this.waiting.push(run);
    });
  }
}
