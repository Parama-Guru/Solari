import type { RescueOutcome } from '../pipeline/rescue.ts';

type Entry = { outcome: RescueOutcome; expiresAt: number; bytes: number };

const MB = 1024 * 1024;

function weigh(outcome: RescueOutcome): number {
  const { pdf, pages, text } = outcome.artifacts;
  let total = pdf?.byteLength ?? 0;
  for (const page of pages) total += page.byteLength;
  return total + text.length * 2;
}

/**
 * Results live in memory only and expire on their own. Nothing a user uploads is
 * ever written to disk by this process, which is what makes the deletion promise true.
 *
 * Capped by bytes as well as by count: a 25 MB PDF plus eight page images is a large
 * entry, and counting entries alone let the process grow to gigabytes before evicting.
 */
export class ResultStore {
  readonly #items = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  #bytes = 0;

  constructor(ttlMs = 30 * 60_000, maxEntries = 200, maxBytes = 256 * MB) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#maxBytes = maxBytes;
  }

  get stats(): { entries: number; bytes: number; maxBytes: number } {
    return { entries: this.#items.size, bytes: this.#bytes, maxBytes: this.#maxBytes };
  }

  put(outcome: RescueOutcome): string {
    this.#sweep();

    const bytes = weigh(outcome);
    // Map preserves insertion order, so the first key is always the oldest.
    while (this.#items.size >= this.#maxEntries || (this.#bytes + bytes > this.#maxBytes && this.#items.size > 0)) {
      const oldest = this.#items.keys().next();
      if (oldest.done) break;
      this.#drop(oldest.value);
    }

    const id = crypto.randomUUID();
    this.#items.set(id, { outcome, expiresAt: Date.now() + this.#ttlMs, bytes });
    this.#bytes += bytes;
    return id;
  }

  get(id: string): RescueOutcome | null {
    const entry = this.#items.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.#drop(id);
      return null;
    }
    return entry.outcome;
  }

  #drop(id: string): void {
    const entry = this.#items.get(id);
    if (!entry) return;
    this.#bytes -= entry.bytes;
    this.#items.delete(id);
  }

  #sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.#items) {
      if (entry.expiresAt <= now) this.#drop(id);
    }
  }
}
