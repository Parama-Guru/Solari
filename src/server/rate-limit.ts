/**
 * Per-caller rate limiting, so one client cannot occupy the whole queue.
 *
 * A token bucket rather than a fixed window: it allows a short burst, which is what a
 * person clicking twice looks like, while still holding the long-run rate down.
 */
export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Bucket = { tokens: number; updatedAt: number };

export class RateLimiter {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #buckets = new Map<string, Bucket>();
  readonly #maxKeys: number;

  constructor(capacity = 5, perMs = 60_000, maxKeys = 10_000) {
    this.#capacity = Math.max(1, capacity);
    this.#refillPerMs = this.#capacity / Math.max(1, perMs);
    this.#maxKeys = Math.max(1, maxKeys);
  }

  take(key: string, now = Date.now()): RateLimitDecision {
    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, updatedAt: now };

    bucket.tokens = Math.min(this.#capacity, bucket.tokens + (now - bucket.updatedAt) * this.#refillPerMs);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      this.#remember(key, bucket);
      const waitMs = (1 - bucket.tokens) / this.#refillPerMs;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    }

    bucket.tokens -= 1;
    this.#remember(key, bucket);
    return { allowed: true };
  }

  /** Bounded, so a flood of unique keys cannot grow this without limit. */
  #remember(key: string, bucket: Bucket): void {
    if (!this.#buckets.has(key) && this.#buckets.size >= this.#maxKeys) {
      const oldest = this.#buckets.keys().next();
      if (!oldest.done) this.#buckets.delete(oldest.value);
    }
    this.#buckets.set(key, bucket);
  }
}
