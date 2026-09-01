export type SolariConfig = {
  apiKey: string;
  baseUrl: string;
};

export type CreateSandboxOptions = {
  template?: string;
  fromSnapshot?: string;
  kind?: 'sandbox' | 'desktop';
  cpu?: number;
  memMb?: number;
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

export type Sandbox = {
  sandboxId: string;
  expiresAt: string;
};

export type SandboxRecord = {
  sandboxId: string;
  kind?: string;
  state?: string;
  template?: string;
  createdAt?: string;
  expiresAt?: string;
  metadata?: Record<string, string>;
};

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export class SolariError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(status: number, code: string | null, message: string, retryable: boolean) {
    super(message);
    this.name = 'SolariError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 5;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const encodeId = (id: string): string => encodeURIComponent(id);

/** Backoff with jitter, capped, matching the documented client behaviour. */
const backoffMs = (attempt: number): number => Math.min(150 * 2 ** attempt, 8_000) * (0.5 + Math.random() / 2);

export class SolariClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;

  constructor(config: SolariConfig) {
    if (!config.apiKey) throw new Error('SOLARI_API_KEY is required.');
    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  async #request<T>(path: string, init: RequestInit, retry: boolean, requestTimeoutMs = 300_000): Promise<T> {
    let lastError: SolariError | null = null;

    for (let attempt = 0; attempt < (retry ? MAX_ATTEMPTS : 1); attempt++) {
      if (attempt > 0) await sleep(backoffMs(attempt));

      let response: Response;
      try {
        response = await fetch(`${this.#baseUrl}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${this.#apiKey}`, ...init.headers },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (cause) {
        lastError = new SolariError(0, null, `Network failure calling ${path}: ${String(cause)}`, true);
        if (!retry) throw lastError;
        continue;
      }

      const text = await response.text();
      const body: unknown = text ? safeJson(text) : {};

      if (response.ok) return body as T;

      const record = (body ?? {}) as Record<string, unknown>;
      const code = typeof record['code'] === 'string' ? record['code'] : null;
      const message = typeof record['error'] === 'string' ? record['error'] : text.slice(0, 200) || response.statusText;
      // 429 means the org is at its cap; only pausing or killing a session frees it.
      const retryable = response.status !== 429 && (RETRYABLE_STATUS.has(response.status) || record['retryable'] === true);

      lastError = new SolariError(response.status, code, message, retryable);
      if (!retryable || !retry) throw lastError;
    }

    throw lastError ?? new SolariError(0, null, `Request to ${path} failed.`, false);
  }

  async createSandbox(options: CreateSandboxOptions = {}): Promise<Sandbox> {
    const body: Record<string, unknown> = { kind: options.kind ?? 'sandbox' };
    if (options.template) body['template'] = options.template;
    if (options.fromSnapshot) body['fromSnapshot'] = options.fromSnapshot;
    if (options.cpu !== undefined) body['cpu'] = options.cpu;
    if (options.memMb !== undefined) body['memMb'] = options.memMb;
    if (options.timeoutMs !== undefined) body['timeoutMs'] = options.timeoutMs;
    if (options.metadata) body['metadata'] = options.metadata;

    return this.#request<Sandbox>(
      '/sandboxes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      },
      true,
    );
  }

  async exec(id: string, cmd: string, args: string[], timeoutMs: number, cwd?: string): Promise<ExecResult> {
    const body: Record<string, unknown> = { cmd, args, timeoutMs };
    if (cwd) body['cwd'] = cwd;
    return this.#request<ExecResult>(
      `/sandboxes/${encodeId(id)}/exec`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      false,
      timeoutMs + 30_000,
    );
  }

  async upload(id: string, guestPath: string, bytes: Uint8Array): Promise<void> {
    const { url } = await this.#request<{ url: string }>(
      `/sandboxes/${encodeId(id)}/files/upload-url?path=${encodeURIComponent(guestPath)}`,
      { method: 'GET' },
      true,
    );
    // The signed token is the credential here, so no Authorization header.
    const response = await fetch(url, {
      method: 'PUT',
      body: bytes,
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      throw new SolariError(response.status, null, `Upload of ${guestPath} failed: ${await response.text()}`, false);
    }
  }

  async download(id: string, guestPath: string): Promise<Uint8Array> {
    const { url } = await this.#request<{ url: string }>(
      `/sandboxes/${encodeId(id)}/files/download-url?path=${encodeURIComponent(guestPath)}`,
      { method: 'GET' },
      true,
    );
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) {
      throw new SolariError(response.status, null, `Download of ${guestPath} failed.`, false);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async snapshot(id: string, name: string): Promise<string> {
    const result = await this.#request<{ snapshotId: string }>(
      `/sandboxes/${encodeId(id)}/snapshots`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
      true,
    );
    return result.snapshotId;
  }

  /** Promotion is what makes a snapshot survive a gateway restart. */
  async promote(snapshotId: string, name: string): Promise<string> {
    const result = await this.#request<{ templateId: string }>(
      `/snapshots/${encodeId(snapshotId)}/promote`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
      true,
    );
    return result.templateId;
  }

  async destroy(id: string): Promise<void> {
    await this.#request(`/sandboxes/${encodeId(id)}`, { method: 'DELETE' }, true);
  }

  /** Lists this org's sandboxes, following cursors so nothing is missed. */
  async listSandboxes(filter: { state?: string; metadata?: Record<string, string> } = {}): Promise<SandboxRecord[]> {
    const found: SandboxRecord[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams();
      if (filter.state) params.set('state', filter.state);
      for (const [key, value] of Object.entries(filter.metadata ?? {})) params.set(`metadata.${key}`, value);
      if (cursor) params.set('cursor', cursor);

      const page = await this.#request<{ sandboxes?: SandboxRecord[]; nextCursor?: string }>(
        `/sandboxes?${params.toString()}`,
        { method: 'GET' },
        true,
      );
      found.push(...(page.sandboxes ?? []));
      cursor = page.nextCursor;
    } while (cursor);

    return found;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
