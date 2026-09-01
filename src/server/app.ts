import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { AppConfig } from '../config.ts';
import { rescue } from '../pipeline/rescue.ts';
import { Queue, QueueFullError } from '../queue/queue.ts';
import { SolariClient, SolariError } from '../solari/client.ts';
import { ResultStore } from './store.ts';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 20_000;

const INDEX_HTML = readFileSync(join(import.meta.dirname, 'public', 'index.html'), 'utf8');

class PayloadTooLargeError extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function sendBytes(res: ServerResponse, contentType: string, bytes: Uint8Array, filename?: string): void {
  const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': 'no-store' };
  if (filename) headers['Content-Disposition'] = `attachment; filename="${filename}"`;
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

  return createServer((req, res) => {
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
      });
      return;
    }

    if (req.method === 'PUT' && path === '/api/rescue') {
      await handleRescue(req, res, displayName(url.searchParams.get('name')));
      return;
    }

    const resultMatch = /^\/api\/result\/([0-9a-f-]{36})(\/pdf|\/text|\/page\/(\d+))?$/.exec(path);
    if (req.method === 'GET' && resultMatch) {
      handleResult(res, resultMatch[1]!, resultMatch[2], resultMatch[3]);
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  }

  async function handleRescue(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await readBody(req);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, { error: `Files are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` });
        return;
      }
      throw error;
    }

    if (bytes.byteLength === 0) {
      sendJson(res, 400, { error: 'The upload was empty.' });
      return;
    }

    try {
      const outcome = await queue.run(() =>
        rescue(client, { filename: name, bytes }, { template: config.template }),
      );
      const id = store.put(outcome);
      const { timings } = outcome.report;
      metrics.rescues += 1;
      if (outcome.report.recovered) metrics.recovered += 1;
      metrics.vmMs +=
        timings.createMs + timings.uploadMs + timings.attemptsMs + timings.downloadMs + timings.destroyMs;

      sendJson(res, 200, {
        id,
        report: { ...outcome.report, outputs: { ...outcome.report.outputs, text: '' } },
        pageCount: outcome.artifacts.pages.length,
        textPreview: outcome.artifacts.text.slice(0, TEXT_PREVIEW_LIMIT),
      });
    } catch (error) {
      if (error instanceof QueueFullError) {
        sendJson(res, 503, { error: error.message });
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
        sendJson(res, 503, { error: message });
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
