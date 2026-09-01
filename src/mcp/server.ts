#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { loadConfig } from '../config.ts';
import { detect } from '../core/detect.ts';
import { rescue } from '../pipeline/rescue.ts';
import { SolariClient } from '../solari/client.ts';

const PROTOCOL_VERSION = '2024-11-05';
const MAX_FILE_BYTES = 25 * 1024 * 1024;

type JsonRpcId = string | number | null;

type Request = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

type ToolResult = { content: ContentBlock[]; isError?: boolean };

const TOOLS = [
  {
    name: 'identify_file',
    description:
      'Identify what a file actually is from its bytes rather than its extension, without opening it. ' +
      'Instant and free: no virtual machine is started. Use this first to decide whether a file is worth recovering.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file on this machine.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_unopenable_file',
    description:
      'Read a file that cannot be parsed directly: legacy Office documents, CorelDRAW drawings, ' +
      'WordPerfect files, corrupt PDFs, or anything with an unknown format. The file is opened inside ' +
      'a disposable hardware-isolated virtual machine using real desktop applications, and the text and ' +
      'page images are returned. The machine is destroyed afterwards, so untrusted files never touch this host. ' +
      'Takes roughly 20 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file on this machine.' },
        include_page_image: {
          type: 'boolean',
          description: 'Also return the first page as an image, for visually inspecting layout. Defaults to false.',
        },
      },
      required: ['path'],
    },
  },
] as const;

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const ok = (id: JsonRpcId, result: unknown): void => send({ jsonrpc: '2.0', id, result });

const fail = (id: JsonRpcId, code: number, message: string): void =>
  send({ jsonrpc: '2.0', id, error: { code, message } });

const textResult = (text: string, isError = false): ToolResult =>
  isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };

function loadFile(path: unknown): { name: string; bytes: Uint8Array } {
  if (typeof path !== 'string' || !path.trim()) throw new Error('A "path" string is required.');
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`${path} is not a file.`);
  if (stats.size === 0) throw new Error(`${path} is empty.`);
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(`${path} is ${(stats.size / 1024 / 1024).toFixed(1)} MB, above the 25 MB limit.`);
  }
  return { name: basename(path), bytes: new Uint8Array(readFileSync(path)) };
}

function handleIdentify(args: Record<string, unknown>): ToolResult {
  const file = loadFile(args['path']);
  const detection = detect(file.bytes, file.name);
  return textResult(
    [
      `Format: ${detection.format}`,
      `Family: ${detection.family}`,
      `Confidence: ${detection.confidence}`,
      `Evidence: ${detection.evidence}`,
      detection.container ? `Container: ${detection.container}` : null,
      `Size: ${file.bytes.byteLength} bytes`,
      '',
      detection.family === 'unknown'
        ? 'No known signature matched. read_unopenable_file may still salvage readable text.'
        : 'Call read_unopenable_file to extract the contents.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  );
}

async function handleRead(args: Record<string, unknown>): Promise<ToolResult> {
  const file = loadFile(args['path']);
  const config = loadConfig();
  const client = new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  const { report, artifacts } = await rescue(client, { filename: file.name, bytes: file.bytes }, { template: config.template });

  if (!report.recovered) {
    const tried = report.attempts.map((a) => `  - ${a.label}: ${a.detail}`).join('\n');
    return textResult(
      `Could not open ${file.name} (identified as ${report.detection.format}).\n\n` +
        `Attempts:\n${tried}\n\n${report.nextStep ?? ''}`,
      true,
    );
  }

  const header = [
    `Recovered ${file.name} (identified as ${report.detection.format}).`,
    `Pages: ${report.outputs.pageImagePaths.length}. Took ${(report.totalMs / 1000).toFixed(1)}s.`,
    report.degraded
      ? 'Note: the document structure was too damaged to rebuild, so only raw readable text was salvaged. Layout is lost.'
      : `Opened with: ${report.attempts.find((a) => a.outcome === 'ok')?.label ?? 'unknown'}.`,
    '',
    '--- Extracted text ---',
    artifacts.text.trim() || '(no text layer; the document may be image-only)',
  ].join('\n');

  const content: ContentBlock[] = [{ type: 'text', text: header }];

  if (args['include_page_image'] === true && artifacts.pages[0]) {
    content.push({
      type: 'image',
      data: Buffer.from(artifacts.pages[0]).toString('base64'),
      mimeType: 'image/png',
    });
  }

  return { content };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'identify_file':
        return handleIdentify(args);
      case 'read_unopenable_file':
        return await handleRead(args);
      default:
        return textResult(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
}

async function dispatch(request: Request): Promise<void> {
  const id = request.id ?? null;

  switch (request.method) {
    case 'initialize':
      ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'openable', version: '0.1.0' },
      });
      return;

    // Notifications carry no id and must not be answered.
    case 'notifications/initialized':
      return;

    case 'tools/list':
      ok(id, { tools: TOOLS });
      return;

    case 'tools/call': {
      const params = request.params ?? {};
      const name = typeof params['name'] === 'string' ? params['name'] : '';
      const args = (params['arguments'] ?? {}) as Record<string, unknown>;
      ok(id, await callTool(name, args));
      return;
    }

    case 'ping':
      ok(id, {});
      return;

    default:
      if (request.id !== undefined) fail(id, -32601, `Method not found: ${request.method}`);
  }
}

let buffer = '';
let inFlight = 0;
let inputClosed = false;

const exitWhenDrained = (): void => {
  if (inputClosed && inFlight === 0) process.exit(0);
};

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');

  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf('\n');
    if (!line) continue;

    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      fail(null, -32700, 'Parse error');
      continue;
    }

    inFlight++;
    void dispatch(request)
      .catch((error: unknown) => {
        fail(request.id ?? null, -32603, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        inFlight--;
        exitWhenDrained();
      });
  }
});

// A piped client closes stdin immediately, so in-flight work must still finish.
process.stdin.on('end', () => {
  inputClosed = true;
  exitWhenDrained();
});
