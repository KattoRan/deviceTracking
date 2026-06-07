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
 * Policy (theo thứ tự ưu tiên):
 *   1. Lọc pool = cells có `isRegistered=true`. Nếu modem không báo cell nào
 *      registered (iOS, older Android, mock) → pool = toàn bộ cells.
 *   2. Trong pool, nếu có cell `isPrimary=true` → chọn cell đó (single source
 *      of truth từ Android API 28+ `CONNECTION_PRIMARY_SERVING`, đáng tin
 *      hơn isRegistered vì chỉ một cell duy nhất là PRIMARY tại 1 thời điểm).
 *   3. Không có cell nào primary → chọn theo **tech rank** (NR > LTE > WCDMA
 *      > GSM > CDMA). Lý do: signalDbm khác thang giữa các tech (GSM RSSI ~
 *      -50…-110, LTE RSRP ~ -44…-140), so raw dBm thiên vị GSM dù LTE đang
 *      là tech chính. Trong CSFB / dual-registration cả 2 đều registered
 *      nhưng LTE mới là cell ta cần track.
 *   4. Cùng tech rank → signal mạnh nhất. Cells thiếu signal đếm là yếu nhất
 *      để cell có reading thật luôn thắng.
 */
const TECH_RANK: Record<string, number> = {
  NR: 4,
  LTE: 3,
  WCDMA: 2,
  UMTS: 2,
  GSM: 1,
  CDMA: 1,
};

function techRank(type: string | undefined | null): number {
  return TECH_RANK[(type || '').toUpperCase()] ?? 0;
}

export function markServingCell(cells: CellTowerDto[]): NormalizedCell[] {
  if (cells.length === 0) return [];

  const registered = cells.filter((c) => c.isRegistered === true);
  const pool = registered.length > 0 ? registered : cells;

  // Bước 2: ưu tiên cao nhất — PRIMARY_SERVING ground truth từ modem.
  const primary = pool.find((c) => c.isPrimary === true);
  let best: CellTowerDto;
  if (primary) {
    best = primary;
  } else {
    // Bước 3 + 4: tech rank trước, signal làm tiebreaker trong cùng tech.
    const sig = (c: CellTowerDto) =>
      typeof c.signalDbm === 'number' ? c.signalDbm : -Infinity;
    best = pool[0];
    let bestRank = techRank(best.type);
    let bestDbm = sig(best);
    for (const c of pool) {
      const rank = techRank(c.type);
      if (rank > bestRank || (rank === bestRank && sig(c) > bestDbm)) {
        best = c;
        bestRank = rank;
        bestDbm = sig(c);
      }
    }
  }

  const bestIndex = cells.indexOf(best);
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
