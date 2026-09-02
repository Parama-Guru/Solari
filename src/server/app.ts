import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { AppConfig } from '../config.ts';
import { rescue, type RescueOptions } from '../pipeline/rescue.ts';
import { Queue, QueueFullError } from '../queue/queue.ts';
import { SolariClient, SolariError } from '../solari/client.ts';
import { RateLimiter } from './rate-limit.ts';
import { ResultStore } from './store.ts';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 20_000;

// Offered by the playground so a visitor without a broken file can still try it.
const SAMPLE_FILES: ReadonlySet<string> = new Set(['broken.pdf', 'truncated.doc', 'logo.wmf']);

// No-retention replies carry the artifacts in the body, so they need a ceiling of their own.
const INLINE_LIMIT_BYTES = 12 * 1024 * 1024;

const INDEX_HTML = readFileSync(join(import.meta.dirname, 'public', 'index.html'), 'utf8');

class PayloadTooLargeError extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function sendBytes(res: ServerResponse, contentType: string, bytes: Uint8Array, filename?: string): void {
  const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': 'no-store' };
  if (filename) {
    // RFC 6266: a quoted string cannot carry backslashes or quotes raw, and anything
    // non-ASCII needs the filename* form, so both are sent and the client picks.
    const quoted = filename.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const ascii = quoted.replace(/[^\x20-\x7e]/g, '_');
    headers['Content-Disposition'] =
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
  res.writeHead(200, headers);
  res.end(bytes);
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_UPLOAD_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Only used for display and for naming the download; never for a guest path. */
function displayName(raw: string | null): string {
  const candidate = (raw ?? 'file').split(/[\\/]/).pop() ?? 'file';
  const cleaned = candidate.replace(/[\r\n"]/g, '').trim();
  return cleaned.slice(0, 120) || 'file';
}

export type AppDependencies = {
  config: AppConfig;
  client: SolariClient;
  queue: Queue;
  store: ResultStore;
};

export function createApp(deps: AppDependencies): Server {
  const { config, client, queue, store } = deps;

  // VM time is the billable unit, so it is counted rather than estimated.
  const metrics = { rescues: 0, recovered: 0, vmMs: 0 };
  const limiter = new RateLimiter(config.rateLimitPerMinute, 60_000);

  // Rolling day of VM spend, so a runaway client cannot quietly empty an account.
  const spend: Array<{ at: number; ms: number }> = [];
  const DAY_MS = 24 * 60 * 60_000;

  function vmMsToday(now = Date.now()): number {
    while (spend.length > 0 && now - spend[0]!.at > DAY_MS) spend.shift();
    return spend.reduce((sum, s) => sum + s.ms, 0);
  }

  function callerOf(req: IncomingMessage): string {
    if (config.trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  return createServer((req, res) => {
    // A rescue legitimately takes tens of seconds, but a socket that goes quiet for two
    // minutes is either gone or holding the connection open on purpose.
    req.socket.setTimeout(120_000, () => {
      req.socket.destroy();
    });

    void handle(req, res).catch((error: unknown) => {
      console.error('[server] unhandled:', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something broke on our side.' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(INDEX_HTML);
      return;
    }

    if (req.method === 'GET' && path === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        queue: queue.stats,
        template: config.template,
        rescues: metrics.rescues,
        recovered: metrics.recovered,
        vmSeconds: Math.round(metrics.vmMs / 1000),
        vmSecondsPerRescue: metrics.rescues
          ? Number((metrics.vmMs / metrics.rescues / 1000).toFixed(1))
          : 0,
        vmSecondsToday: Math.round(vmMsToday() / 1000),
        vmSecondsBudget: config.maxVmSecondsPerDay || null,
        store: store.stats,
      });
      return;
    }

    if (req.method === 'PUT' && path === '/api/rescue') {
      const budget = config.maxVmSecondsPerDay;
      if (budget > 0 && vmMsToday() / 1000 >= budget) {
        sendJson(res, 429, {
          error: 'This server has reached its daily machine-time budget. Try again tomorrow.',
        });
        return;
      }

      const decision = limiter.take(callerOf(req));
      if (!decision.allowed) {
        res.setHeader('Retry-After', String(decision.retryAfterSeconds));
        sendJson(res, 429, {
          error: `Too many rescues from your address. Try again in ${decision.retryAfterSeconds}s.`,
        });
        return;
      }

      const pagesParam = Number(url.searchParams.get('pages'));
      await handleRescue(
        req,
        res,
        displayName(url.searchParams.get('name')),
        url.searchParams.get('retain') !== 'none',
        Number.isFinite(pagesParam) && pagesParam > 0 ? pagesParam : undefined,
        url.searchParams.get('stream') === '1',
      );
      return;
    }

    const resultMatch = /^\/api\/result\/([0-9a-f-]{36})(\/pdf|\/text|\/page\/(\d+))?$/.exec(path);
    if (req.method === 'GET' && resultMatch) {
      handleResult(res, resultMatch[1]!, resultMatch[2], resultMatch[3]);
      return;
    }

    if (req.method === 'GET' && path.startsWith('/api/sample/')) {
      handleSample(res, decodeURIComponent(path.slice('/api/sample/'.length)));
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  }

  // An allow-list, not a path join, so no request can reach outside the sample directories.
  function handleSample(res: ServerResponse, name: string): void {
    if (!SAMPLE_FILES.has(name)) {
      sendJson(res, 404, { error: 'Unknown sample.' });
      return;
    }
    // `samples/` ships with the repo; `fixtures/` is generated and gitignored.
    for (const dir of ['samples', 'fixtures']) {
      try {
        const bytes = readFileSync(join(process.cwd(), dir, name));
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(bytes);
        return;
      } catch {
        continue;
      }
    }
    sendJson(res, 404, { error: 'Samples are not available on this server.' });
  }

  async function handleRescue(
    req: IncomingMessage,
    res: ServerResponse,
    name: string,
    retain: boolean,
    maxPages?: number,
    stream = false,
  ): Promise<void> {
    // Once a stream has started the status line is already sent, so later failures have to
    // travel as a line in the body rather than as an HTTP status.
    let streaming = false;
    const line = (payload: unknown): void => {
      res.write(`${JSON.stringify(payload)}\n`);
    };
    const fail = (status: number, message: string): void => {
      if (streaming) {
        line({ error: message });
        res.end();
      } else {
        sendJson(res, status, { error: message });
      }
    };

    let bytes: Uint8Array;
    try {
      bytes = await readBody(req);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        fail(413, `Files are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
        return;
      }
      throw error;
    }

    if (bytes.byteLength === 0) {
      fail(400, 'The upload was empty.');
      return;
    }

    if (stream) {
      streaming = true;
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
    }

    try {
      const options: RescueOptions = { template: config.template };
      if (maxPages !== undefined) options.maxPages = maxPages;
      if (streaming) options.onProgress = (progress) => line({ progress });

      const outcome = await queue.run(() => rescue(client, { filename: name, bytes }, options));
      const { timings } = outcome.report;
      metrics.rescues += 1;
      if (outcome.report.recovered) metrics.recovered += 1;
      const vmMs =
        timings.createMs + timings.uploadMs + timings.attemptsMs + timings.downloadMs + timings.destroyMs;
      metrics.vmMs += vmMs;
      spend.push({ at: Date.now(), ms: vmMs });

      const summary = {
        report: { ...outcome.report, outputs: { ...outcome.report.outputs, text: '' } },
        pageCount: outcome.artifacts.pages.length,
        textPreview: outcome.artifacts.text.slice(0, TEXT_PREVIEW_LIMIT),
      };

      if (!retain) {
        const { pdf, pages } = outcome.artifacts;
        const inlineBytes = (pdf?.byteLength ?? 0) + pages.reduce((sum, page) => sum + page.byteLength, 0);

        if (inlineBytes > INLINE_LIMIT_BYTES) {
          fail(
            413,
            'The recovery is too large to return without storing it. Retry without no-retention mode, ' +
              'and the result will be held for 30 minutes instead.',
          );
          return;
        }

        const body = {
          ...summary,
          id: null,
          retained: false,
          pdfBase64: pdf ? Buffer.from(pdf).toString('base64') : null,
          pagesBase64: pages.map((page) => Buffer.from(page).toString('base64')),
        };
        if (streaming) {
          line({ result: body });
          res.end();
        } else {
          sendJson(res, 200, body);
        }
        return;
      }

      const body = { ...summary, id: store.put(outcome), retained: true };
      if (streaming) {
        line({ result: body });
        res.end();
      } else {
        sendJson(res, 200, body);
      }
    } catch (error) {
      if (error instanceof QueueFullError) {
        fail(503, error.message);
        return;
      }
      if (error instanceof SolariError) {
        console.error('[solari]', error.status, error.code, error.message);
        const message =
          error.status === 429
            ? 'All rescue machines are busy right now. Try again in a minute.'
            : error.status === 402 || error.status === 403
              ? 'The rescue service is not currently provisioned. This is our problem, not your file.'
              : 'The rescue machine failed to start. Please try again.';
        fail(503, message);
        return;
      }
      throw error;
    }
  }

  function handleResult(res: ServerResponse, id: string, kind?: string, pageIndex?: string): void {
    const outcome = store.get(id);
    if (!outcome) {
      sendJson(res, 404, { error: 'That result has expired. Files are deleted automatically.' });
      return;
    }

    if (kind === '/pdf') {
      if (!outcome.artifacts.pdf) {
        sendJson(res, 404, { error: 'No PDF was recovered for this file.' });
        return;
      }
      const base = outcome.report.originalName.replace(/\.[^.]*$/, '') || 'recovered';
      sendBytes(res, 'application/pdf', outcome.artifacts.pdf, `${base}.pdf`);
      return;
    }

    if (kind === '/text') {
      sendBytes(res, 'text/plain; charset=utf-8', new TextEncoder().encode(outcome.artifacts.text));
      return;
    }

    if (pageIndex !== undefined) {
      const page = outcome.artifacts.pages[Number(pageIndex)];
      if (!page) {
        sendJson(res, 404, { error: 'No such page.' });
        return;
      }
      sendBytes(res, 'image/png', page);
      return;
    }

    sendJson(res, 200, { report: outcome.report, pageCount: outcome.artifacts.pages.length });
  }
}
