import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { SolariClient } from '../solari/client.ts';
import { withSandbox } from '../solari/session.ts';

const MINUTE = 60_000;
const FIXTURE_DIR = join(process.cwd(), 'fixtures');

const SOURCE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Quarterly Report</title></head>
<body>
<h1>Northwind Trading — Quarterly Report</h1>
<p>Prepared for the board, covering the three months to 31 March.</p>
<h2>Summary</h2>
<p>Revenue rose against a flat cost base. The Baltic route remains the largest single contributor.</p>
<table border="1" cellpadding="6">
<tr><th>Route</th><th>Revenue</th><th>Margin</th></tr>
<tr><td>Baltic</td><td>412,900</td><td>31%</td></tr>
<tr><td>North Sea</td><td>288,400</td><td>24%</td></tr>
<tr><td>Adriatic</td><td>96,250</td><td>18%</td></tr>
</table>
<h2>Outlook</h2>
<p>Two vessels come out of dry dock in May, which should lift Adriatic capacity.</p>
</body></html>`;

const SOURCE_CSV = `Route,Revenue,Margin
Baltic,412900,0.31
North Sea,288400,0.24
Adriatic,96250,0.18
Total,797550,0.27
`;

const LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <rect width="240" height="120" fill="#0f1115"/>
  <circle cx="60" cy="60" r="34" fill="#6ea8fe"/>
  <text x="110" y="68" font-family="serif" font-size="26" fill="#e7eaf0">Northwind</text>
</svg>`;

const BUILD_SCRIPT = `set -e
cd /work/fx
FLAGS="--headless --norestore --nolockcheck --nodefault"

# Writing legacy formats needs the filter named explicitly; only PDF is inferred.
soffice $FLAGS --convert-to 'doc:MS Word 97' --outdir . source.html
soffice $FLAGS --convert-to 'rtf:Rich Text Format' --outdir . source.html
soffice $FLAGS --convert-to pdf --outdir . source.html
soffice $FLAGS --convert-to 'xls:MS Excel 97' --outdir . source.csv

mv source.doc report.doc
mv source.rtf notes.rtf
mv source.pdf good.pdf
mv source.xls budget.xls

# A file cut short mid-write, which is what most "it won't open" files really are.
SIZE=$(stat -c%s report.doc)
head -c $((SIZE * 55 / 100)) report.doc > truncated.doc

# A PDF whose cross-reference table is gone.
PSIZE=$(stat -c%s good.pdf)
head -c $((PSIZE - 400)) good.pdf > broken.pdf

ls -l
`;

const WANTED = ['report.doc', 'budget.xls', 'notes.rtf', 'good.pdf', 'truncated.doc', 'broken.pdf'];

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  mkdirSync(FIXTURE_DIR, { recursive: true });

  await withSandbox(
    client,
    { template: config.template, kind: 'sandbox', timeoutMs: 15 * MINUTE, metadata: { app: 'openable', role: 'fixtures' } },
    async (sandbox) => {
      const id = sandbox.sandboxId;
      await client.exec(id, 'sh', ['-c', 'mkdir -p /work/fx'], MINUTE);

      const encoder = new TextEncoder();
      await client.upload(id, '/work/fx/source.html', encoder.encode(SOURCE_HTML));
      await client.upload(id, '/work/fx/source.csv', encoder.encode(SOURCE_CSV));
      await client.upload(id, '/work/fx/build.sh', encoder.encode(BUILD_SCRIPT));

      const build = await client.exec(id, 'sh', ['-c', 'sh /work/fx/build.sh'], 5 * MINUTE);
      if (build.exitCode !== 0) {
        console.error(build.stderr.trim() || build.stdout.trim());
        throw new Error(`Fixture build exited ${build.exitCode}.`);
      }
      console.log(build.stdout.trim());

      for (const name of WANTED) {
        const bytes = await client.download(id, `/work/fx/${name}`);
        writeFileSync(join(FIXTURE_DIR, name), bytes);
        console.log(`[fixtures] ${name} ${bytes.byteLength} bytes`);
      }

      writeFileSync(join(FIXTURE_DIR, 'logo.svg'), LOGO_SVG);
      console.log('[fixtures] logo.svg written locally');
    },
  );
}

main().catch((error: unknown) => {
  console.error('[fixtures] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
