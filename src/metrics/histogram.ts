export const HISTOGRAM_BOUNDS_MS = [10, 25, 50, 100, 200, 400, 800, 1500, 3000, 6000, 10000];

export interface HistogramSnapshot {
  boundsMs: number[];
  counts: number[];
  total: number;
}

export class Histogram {
  private readonly bounds: number[];

  private readonly counts: number[];

  private totalCount = 0;

  constructor(bounds: number[] = HISTOGRAM_BOUNDS_MS) {
    this.bounds = [...bounds];
    this.counts = new Array(bounds.length + 1).fill(0);
  }

  record(valueMs: number): void {
    const idx = this.bounds.findIndex((bound) => valueMs <= bound);
    if (idx === -1) {
      this.counts[this.counts.length - 1] += 1;
    } else {
      this.counts[idx] += 1;
    }
    this.totalCount += 1;
  }

  percentile(p: number): number {
    if (this.totalCount === 0) {
      return 0;
    }
    const target = Math.ceil((p / 100) * this.totalCount);
    let cumulative = 0;
    for (let i = 0; i < this.counts.length; i += 1) {
      cumulative += this.counts[i] ?? 0;
      if (cumulative >= target) {
        if (i >= this.bounds.length) {
          return this.bounds[this.bounds.length - 1] ?? 0;
        }
        return this.bounds[i] ?? 0;
      }
    }
    return this.bounds[this.bounds.length - 1] ?? 0;
  }

  snapshot(): HistogramSnapshot {
    return {
      boundsMs: [...this.bounds],
      counts: [...this.counts],
      total: this.totalCount
    };
  }
}
