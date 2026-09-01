import { loadConfig } from '../config.ts';
import { SolariClient } from '../solari/client.ts';
import { withSandbox } from '../solari/session.ts';

const MINUTE = 60_000;

const PACKAGES = [
  'libreoffice-writer',
  'libreoffice-calc',
  'libreoffice-impress',
  'libreoffice-draw',
  'poppler-utils',
  'imagemagick',
  'ghostscript',
  'inkscape',
  'fonts-liberation2',
  'fonts-dejavu-core',
];

type Step = { name: string; script: string; timeoutMs: number };

const STEPS: Step[] = [
  {
    name: 'refresh package index',
    script: 'apt-get update -qq',
    timeoutMs: 5 * MINUTE,
  },
  {
    name: 'install converters',
    script: `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ${PACKAGES.join(' ')}`,
    timeoutMs: 25 * MINUTE,
  },
  {
    // Debian ships ImageMagick with PDF writing disabled, which would silently break raster rescues.
    name: 'allow ImageMagick to write PDF',
    script:
      `sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-*/policy.xml 2>/dev/null; ` +
      `sed -i 's/rights="none" pattern="PS"/rights="read|write" pattern="PS"/' /etc/ImageMagick-*/policy.xml 2>/dev/null; true`,
    timeoutMs: MINUTE,
  },
  {
    name: 'create work directories',
    script: 'mkdir -p /work/out /work/hop',
    timeoutMs: MINUTE,
  },
  {
    // LibreOffice builds a user profile on first launch; baking it in saves that cost on every rescue.
    name: 'warm the LibreOffice profile',
    script:
      'printf "warmup" > /tmp/warm.txt && ' +
      'soffice --headless --norestore --nolockcheck --nodefault --convert-to pdf --outdir /tmp /tmp/warm.txt && ' +
      'test -f /tmp/warm.pdf && rm -f /tmp/warm.txt /tmp/warm.pdf',
    timeoutMs: 5 * MINUTE,
  },
  {
    name: 'verify the toolchain',
    script:
      'set -e; soffice --version; pdftoppm -v 2>&1 | head -1; ' +
      '(magick -version || convert -version) 2>&1 | head -1; inkscape --version 2>&1 | head -1; gs --version',
    timeoutMs: 3 * MINUTE,
  },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const started = Date.now();

  const templateId = await withSandbox(
    client,
    { template: 'base', kind: 'sandbox', timeoutMs: 45 * MINUTE, metadata: { app: 'openable', role: 'provision' } },
    async (sandbox) => {
      console.log(`[provision] sandbox ready`);

      for (const step of STEPS) {
        const stepStarted = Date.now();
        process.stdout.write(`[provision] ${step.name} ... `);
        const result = await client.exec(sandbox.sandboxId, 'sh', ['-c', step.script], step.timeoutMs);
        const seconds = ((Date.now() - stepStarted) / 1000).toFixed(1);

        if (result.exitCode !== 0) {
          console.log('failed');
          console.error(result.stderr.trim() || result.stdout.trim());
          throw new Error(`Provisioning step "${step.name}" exited ${result.exitCode}.`);
        }
        console.log(`ok (${seconds}s)`);
        if (step.name === 'verify the toolchain') console.log(result.stdout.trim());
      }

      const snapshotId = await client.snapshot(sandbox.sandboxId, 'openable-runtime');
      console.log(`[provision] snapshot ${snapshotId}`);
      return client.promote(snapshotId, `openable-runtime-${Date.now()}`);
    },
  );

  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(`\n[provision] done in ${minutes} min`);
  console.log(`\nAdd this to your .env:\n\n  SOLARI_TEMPLATE=${templateId}\n`);
}

main().catch((error: unknown) => {
  console.error('[provision] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
