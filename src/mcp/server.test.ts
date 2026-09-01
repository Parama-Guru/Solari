import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./server.ts', import.meta.url));

let child: ChildProcessWithoutNullStreams;
let buffer = '';
const pending = new Map<number, (value: Record<string, unknown>) => void>();

function call(id: number, method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

before(() => {
  child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      const message = JSON.parse(line) as { id?: number };
      if (typeof message.id === 'number') pending.get(message.id)?.(message as Record<string, unknown>);
    }
  });
});

after(() => child.kill());

test('completes the MCP initialize handshake', async () => {
  const response = await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  const result = response['result'] as Record<string, unknown>;
  assert.equal(result['protocolVersion'], '2024-11-05');
  assert.equal((result['serverInfo'] as Record<string, unknown>)['name'], 'openable');
});

test('advertises both tools with schemas', async () => {
  const response = await call(2, 'tools/list');
  const tools = (response['result'] as { tools: { name: string; inputSchema: unknown }[] }).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ['identify_file', 'read_unopenable_file']);
  for (const tool of tools) assert.ok(tool.inputSchema, `${tool.name} needs an input schema`);
});

test('identifies a file locally without starting a machine', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openable-'));
  const path = join(dir, 'mislabelled.docx');
  writeFileSync(path, '%PDF-1.7\ntrailer\n');

  const response = await call(3, 'tools/call', { name: 'identify_file', arguments: { path } });
  const result = response['result'] as { content: { text: string }[]; isError?: boolean };
  assert.notEqual(result.isError, true);
  assert.match(result.content[0]!.text, /Format: PDF/);
});

test('reports a missing file as a tool error, not a crash', async () => {
  const response = await call(4, 'tools/call', {
    name: 'identify_file',
    arguments: { path: join(tmpdir(), 'definitely-not-here-91731.bin') },
  });
  const result = response['result'] as { content: { text: string }[]; isError?: boolean };
  assert.equal(result.isError, true);
});

test('rejects an unknown tool name', async () => {
  const response = await call(5, 'tools/call', { name: 'drop_database', arguments: {} });
  const result = response['result'] as { content: { text: string }[]; isError?: boolean };
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /Unknown tool/);
});

test('answers ping', async () => {
  const response = await call(6, 'ping');
  assert.deepEqual(response['result'], {});
});
