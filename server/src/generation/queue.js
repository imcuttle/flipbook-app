// Per-canvas FIFO queue. Used for the canvas root creation to avoid tree.json races.
// For click expansions we use PerNodeSemaphore instead (allows N parallel per parent).
export class PerCanvasQueue {
  constructor() {
    this._chain = Promise.resolve();
    this._size = 0;
  }
  get size() { return this._size; }
  enqueue(jobFn) {
    this._size++;
    const next = this._chain.then(() => jobFn()).finally(() => { this._size--; });
    // Don't break the chain if a job rejects.
    this._chain = next.catch(() => {});
    return next;
  }
}

// Global semaphore for codebuddy subprocess concurrency across all canvases.
export class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max | 0);
    this.active = 0;
    this.waiters = [];
  }
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    const w = this.waiters.shift();
    if (w) w();
  }
  async run(fn) {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}

// Per-key concurrency limiter. Allows up to `max` concurrent jobs per key.
// Used to cap click expansions per parent node so a user clicking 10 spots
// rapidly only generates 4 at a time, with the rest queued in arrival order.
export class PerKeySemaphore {
  constructor(max) {
    this.max = Math.max(1, max | 0);
    this._buckets = new Map(); // key -> { active, waiters: [] }
  }

  _bucket(key) {
    let b = this._buckets.get(key);
    if (!b) { b = { active: 0, waiters: [] }; this._buckets.set(key, b); }
    return b;
  }

  /** Number of currently-active jobs for the key. */
  active(key) { return this._buckets.get(key)?.active ?? 0; }

  /** Number of waiters for the key (queued, not yet running). */
  pending(key) { return this._buckets.get(key)?.waiters.length ?? 0; }

  async acquire(key) {
    const b = this._bucket(key);
    if (b.active < this.max) {
      b.active++;
      return;
    }
    await new Promise((resolve) => b.waiters.push(resolve));
    b.active++;
  }

  release(key) {
    const b = this._buckets.get(key);
    if (!b) return;
    b.active--;
    const w = b.waiters.shift();
    if (w) w();
    if (b.active === 0 && b.waiters.length === 0) this._buckets.delete(key);
  }

  async run(key, fn) {
    await this.acquire(key);
    try { return await fn(); } finally { this.release(key); }
  }
}
