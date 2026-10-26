import type { SequenceSource } from '../content/media';

const enum State {
  Idle = 0,
  Loading = 1,
  Ready = 2,
  Failed = 3,
}

/** Coarse-to-fine passes: every 16th frame first, so scrubbing works early and sharpens as more arrive. */
const STRIDES = [16, 8, 4, 2, 1];

/**
 * Loads an image sequence progressively around the frame the visitor is looking at.
 * Only frames listed by the build-time inventory are ever requested.
 */
export class FrameLoader {
  readonly count: number;
  private readonly images: (HTMLImageElement | null)[];
  private readonly state: Uint8Array;
  private queue: number[] = [];
  private active = 0;
  private center = 0;
  private lastQueuedCenter = -999;
  private running = false;

  constructor(
    readonly source: SequenceSource,
    private readonly concurrency: number,
    private readonly onReady: (index: number) => void,
  ) {
    this.count = source.frames;
    this.images = new Array(this.count).fill(null);
    this.state = new Uint8Array(this.count);
  }

  /** Begin (or re-centre) loading around `frame`. Cheap to call on every scroll update. */
  focus(frame: number): void {
    this.center = Math.max(0, Math.min(this.count - 1, Math.round(frame)));
    this.running = true;
    if (Math.abs(this.center - this.lastQueuedCenter) >= 6) this.rebuildQueue();
    this.pump();
  }

  /** Free memory once the visitor is far away from this sequence. */
  release(): void {
    this.running = false;
    this.queue = [];
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === State.Ready) {
        this.images[i] = null;
        this.state[i] = State.Idle;
      }
    }
    this.lastQueuedCenter = -999;
  }

  get readyCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.state[i] === State.Ready) n++;
    return n;
  }

  /** Video export: resolves once exactly the frame nearest to `frame` has loaded (or failed). */
  whenReady(frame: number): Promise<void> {
    const target = Math.max(0, Math.min(this.count - 1, Math.round(frame)));
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.state[target] === State.Ready || this.state[target] === State.Failed) {
          resolve();
          return;
        }
        this.focus(target);
        setTimeout(check, 16);
      };
      check();
    });
  }

  /** The loaded frame closest to `frame`, or null while nothing is ready. */
  nearest(frame: number): { image: HTMLImageElement; index: number } | null {
    const target = Math.max(0, Math.min(this.count - 1, Math.round(frame)));
    for (let d = 0; d < this.count; d++) {
      const a = target - d;
      const b = target + d;
      if (a >= 0 && this.state[a] === State.Ready) return { image: this.images[a]!, index: a };
      if (b < this.count && this.state[b] === State.Ready) return { image: this.images[b]!, index: b };
    }
    return null;
  }

  private rebuildQueue(): void {
    this.lastQueuedCenter = this.center;
    const seen = new Uint8Array(this.count);
    const order: number[] = [];
    // The frame on screen and its immediate neighbours come first.
    for (let d = 0; d <= 2; d++) {
      for (const i of [this.center - d, this.center + d]) {
        if (i >= 0 && i < this.count && !seen[i]) {
          seen[i] = 1;
          order.push(i);
        }
      }
    }
    for (const stride of STRIDES) {
      const level: number[] = [];
      for (let i = 0; i < this.count; i += stride) if (!seen[i]) level.push(i);
      if (stride === 1 || stride === 2) {
        // fine passes only near the visitor; far frames follow later passes
        level.sort((a, b) => Math.abs(a - this.center) - Math.abs(b - this.center));
      }
      for (const i of level) {
        seen[i] = 1;
        order.push(i);
      }
    }
    if (!seen[this.count - 1]) order.push(this.count - 1);
    this.queue = order.filter((i) => this.state[i] === State.Idle);
  }

  private pump(): void {
    while (this.running && this.active < this.concurrency && this.queue.length) {
      const index = this.queue.shift()!;
      if (this.state[index] !== State.Idle) continue;
      this.load(index);
    }
  }

  private load(index: number): void {
    this.state[index] = State.Loading;
    this.active++;
    const img = new Image();
    img.decoding = 'async';
    if (Math.abs(index - this.center) <= 2) img.fetchPriority = 'high';
    img.src = this.source.url(index);
    img
      .decode()
      .then(() => {
        if (!this.running) {
          this.state[index] = State.Idle;
          return;
        }
        this.images[index] = img;
        this.state[index] = State.Ready;
        this.onReady(index);
      })
      .catch(() => {
        this.state[index] = State.Failed;
      })
      .finally(() => {
        this.active--;
        this.pump();
      });
  }
}
