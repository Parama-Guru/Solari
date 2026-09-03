#!/usr/bin/env node
import { loadConfig } from '../config.ts';
import { SolariClient } from '../solari/client.ts';
import { withSandbox } from '../solari/session.ts';

const MINUTE = 60_000;
const POLL_MS = 10_000;

const CORE_PACKAGES = [
  'libreoffice-writer',
  'libreoffice-calc',
  'libreoffice-impress',
  'libreoffice-draw',
  'poppler-utils',
  'imagemagick',
  'ghostscript',
  'fonts-liberation2',
  'fonts-dejavu-core',
];

type Stage = {
  name: string;
  script: string;
  timeoutMs: number;
  /** A failed optional stage weakens the converter chain but still yields a usable template. */
  optional?: boolean;
};

const LONG_STAGES: Stage[] = [
  {
    name: 'core',
    script:
      'set -e\n' +
      'export DEBIAN_FRONTEND=noninteractive\n' +
      'apt-get update -qq\n' +
      `apt-get install -y -qq --no-install-recommends ${CORE_PACKAGES.join(' ')}\n`,
    timeoutMs: 20 * MINUTE,
  },
  {
    name: 'inkscape',
    script:
      'set -e\n' +
      'export DEBIAN_FRONTEND=noninteractive\n' +
      'apt-get install -y -qq --no-install-recommends inkscape\n',
    timeoutMs: 15 * MINUTE,
    optional: true,
  },
  {
    // Scanned documents render pages but carry no text layer; OCR is the only way to read them.
    name: 'ocr',
    script:
      'set -e\n' +
      'export DEBIAN_FRONTEND=noninteractive\n' +
      'apt-get install -y -qq --no-install-recommends tesseract-ocr tesseract-ocr-eng\n',
    timeoutMs: 15 * MINUTE,
    optional: true,
  },
];

const SHORT_STAGES: Stage[] = [
  {
    name: 'configure',
    // Debian ships ImageMagick with PDF and PostScript writing disabled.
    script:
      `sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-*/policy.xml 2>/dev/null; ` +
      `sed -i 's/rights="none" pattern="PS"/rights="read|write" pattern="PS"/' /etc/ImageMagick-*/policy.xml 2>/dev/null; ` +
      'mkdir -p /work/out /work/hop; true',
    timeoutMs: MINUTE,
  },
  {
    // LibreOffice builds a user profile on first launch; baking it in saves that cost per rescue.
    name: 'warm',
    script:
      'set -e; printf "warmup" > /tmp/warm.txt; ' +
      'soffice --headless --norestore --nolockcheck --nodefault --convert-to pdf --outdir /tmp /tmp/warm.txt; ' +
      'test -s /tmp/warm.pdf; rm -f /tmp/warm.txt /tmp/warm.pdf',
    timeoutMs: 5 * MINUTE,
  },
  {
    name: 'verify',
    script:
      'soffice --version; pdftoppm -v 2>&1 | head -1; ' +
      '(magick -version || convert -version) 2>&1 | head -1; gs --version; ' +
      '(inkscape --version 2>&1 | head -1) || echo "inkscape: not installed"; ' +
      '(tesseract --version 2>&1 | head -1) || echo "tesseract: not installed"',
    timeoutMs: 3 * MINUTE,
  },
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a long job detached and polls for its exit code. The one-shot exec route is a
 * latency fast path and will not hold a connection open for a package install.
 */
async function runDetached(client: SolariClient, id: string, stage: Stage): Promise<number> {
  const scriptPath = `/work/steps/${stage.name}.sh`;
  const logPath = `/work/logs/${stage.name}.log`;
  const exitPath = `/work/flags/${stage.name}.exit`;

  await client.exec(id, 'sh', ['-c', 'mkdir -p /work/steps /work/logs /work/flags'], MINUTE);
  await client.upload(id, scriptPath, new TextEncoder().encode(stage.script));

  await client.exec(
    id,
    'sh',
    [
      '-c',
      `rm -f ${exitPath}; nohup sh -c 'sh ${scriptPath} > ${logPath} 2>&1; echo $? > ${exitPath}' >/dev/null 2>&1 & echo started`,
    ],
    MINUTE,
  );

  const deadline = Date.now() + stage.timeoutMs;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const status = await client.exec(id, 'sh', ['-c', `cat ${exitPath} 2>/dev/null || echo pending`], MINUTE);
    const value = status.stdout.trim();
    if (value && value !== 'pending') return Number(value);
    process.stdout.write('.');
  }

  throw new Error(`Stage "${stage.name}" did not finish within ${stage.timeoutMs / MINUTE} minutes.`);
}

async function showLog(client: SolariClient, id: string, name: string): Promise<void> {
  const log = await client.exec(id, 'sh', ['-c', `tail -20 /work/logs/${name}.log 2>/dev/null`], MINUTE);
  if (log.stdout.trim()) console.error(log.stdout.trim());
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const started = Date.now();

  const { value: templateId } = await withSandbox(
    client,
    { template: 'base', kind: 'sandbox', timeoutMs: 60 * MINUTE, metadata: { app: 'openable', role: 'provision' } },
    async (sandbox) => {
      const id = sandbox.sandboxId;
      console.log('[provision] sandbox ready');

      for (const stage of LONG_STAGES) {
        const stageStarted = Date.now();
        process.stdout.write(`[provision] ${stage.name} `);
        const code = await runDetached(client, id, stage);
        const seconds = ((Date.now() - stageStarted) / 1000).toFixed(0);

        if (code !== 0) {
          console.log(` exit ${code} (${seconds}s)`);
          await showLog(client, id, stage.name);
          if (!stage.optional) throw new Error(`Required stage "${stage.name}" failed.`);
          console.warn(`[provision] continuing without ${stage.name}`);
          continue;
        }
        console.log(` ok (${seconds}s)`);
      }

      for (const stage of SHORT_STAGES) {
        process.stdout.write(`[provision] ${stage.name} ... `);
        const result = await client.exec(id, 'sh', ['-c', stage.script], stage.timeoutMs);
        if (result.exitCode !== 0) {
          console.log('failed');
          console.error(result.stderr.trim() || result.stdout.trim());
          throw new Error(`Stage "${stage.name}" exited ${result.exitCode}.`);
        }
        console.log('ok');
        if (stage.name === 'verify') console.log(result.stdout.trim());
      }

      const snapshotId = await client.snapshot(id, 'openable-runtime');
      console.log(`[provision] snapshot ${snapshotId}`);
      return client.promote(snapshotId, `openable-runtime-${Date.now()}`);
    },
  );

  console.log(`\n[provision] done in ${((Date.now() - started) / MINUTE).toFixed(1)} min`);
  console.log(`\nSet this in .env:\n\n  SOLARI_TEMPLATE=${templateId}\n`);
}

main().catch((error: unknown) => {
  console.error('\n[provision] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
