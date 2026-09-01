export class QueueFullError extends Error {
  constructor(waiting: number) {
    super(`Too many rescues are already waiting (${waiting}). Try again shortly.`);
    this.name = 'QueueFullError';
  }
}

/**
 * Serialises work against the plan's concurrent-VM cap. Solari returns a
 * non-retryable 429 once the cap is hit, so we queue here instead of failing.
 */
export class Queue {
  readonly #max: number;
  readonly #maxWaiting: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(max: number, maxWaiting = 20) {
    this.#max = Math.max(1, max);
    this.#maxWaiting = Math.max(1, maxWaiting);
  }

  get stats(): { active: number; waiting: number } {
    return { active: this.#active, waiting: this.#waiting.length };
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#waiting.length >= this.#maxWaiting) throw new QueueFullError(this.#waiting.length);
    await this.#acquire();
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  #acquire(): Promise<void> {
    if (this.#active < this.#max) {
      this.#active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.#waiting.push(() => {
        this.#active++;
        resolve();
      });
    });
  }

  #release(): void {
    this.#active--;
    this.#waiting.shift()?.();
  }
}
