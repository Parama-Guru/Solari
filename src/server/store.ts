import type { RescueOutcome } from '../pipeline/rescue.ts';

type Entry = { outcome: RescueOutcome; expiresAt: number };

/**
 * Results live in memory only and expire on their own. Nothing a user uploads is
 * ever written to disk by this process, which is what makes the deletion promise true.
 */
export class ResultStore {
  readonly #items = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(ttlMs = 30 * 60_000, maxEntries = 200) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  put(outcome: RescueOutcome): string {
    this.#sweep();
    if (this.#items.size >= this.#maxEntries) {
      const oldest = this.#items.keys().next();
      if (!oldest.done) this.#items.delete(oldest.value);
    }
    const id = crypto.randomUUID();
    this.#items.set(id, { outcome, expiresAt: Date.now() + this.#ttlMs });
    return id;
  }

  get(id: string): RescueOutcome | null {
    const entry = this.#items.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.#items.delete(id);
      return null;
    }
    return entry.outcome;
  }

  #sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.#items) {
      if (entry.expiresAt <= now) this.#items.delete(id);
    }
  }
}
