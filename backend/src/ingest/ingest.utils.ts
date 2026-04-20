import type { CellTowerDto } from './dto/submit-data.dto';

export type NormalizedCell = CellTowerDto & { isServing: boolean };

export function isValidCell(c: CellTowerDto): boolean {
  if (!c.mcc || !c.mnc || !c.lac || !c.cid) return false;
  if (c.cid <= 0) return false;
  if (!c.signalDbm) return false;
  return true;
}

export function markServingCell(cells: CellTowerDto[]): NormalizedCell[] {
  let bestIndex = -1;
  let bestDbm = -Infinity;

  cells.forEach((c, i) => {
    if (c.signalDbm > bestDbm) {
      bestDbm = c.signalDbm;
      bestIndex = i;
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
