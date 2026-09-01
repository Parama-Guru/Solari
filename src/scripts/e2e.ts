import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { rescue } from '../pipeline/rescue.ts';
import { SolariClient } from '../solari/client.ts';

const FIXTURE_DIR = join(process.cwd(), 'fixtures');
const OUT_DIR = join(process.cwd(), 'work', 'e2e');

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(FIXTURE_DIR).filter((name) => !name.startsWith('.')).sort();
  if (files.length === 0) throw new Error('No fixtures. Run `npm run fixtures` first.');

  const rows: string[] = [];
  let failures = 0;
  let undestroyed = 0;
  const total = { createMs: 0, uploadMs: 0, attemptsMs: 0, downloadMs: 0, destroyMs: 0, wallMs: 0 };

  for (const name of files) {
    const bytes = new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));
    process.stdout.write(`\n=== ${name} (${bytes.byteLength} bytes)\n`);

    const { report, artifacts } = await rescue(client, { filename: name, bytes }, { template: config.template });

    console.log(`    detected : ${report.detection.format} [${report.detection.confidence}]`);
    console.log(`    evidence : ${report.detection.evidence}`);
    for (const attempt of report.attempts) {
      const mark = attempt.outcome === 'ok' ? 'ok  ' : 'fail';
      console.log(`    ${mark} ${attempt.label} (${(attempt.durationMs / 1000).toFixed(1)}s)`);
      if (attempt.outcome !== 'ok') console.log(`         ${attempt.detail.split('\n')[0]?.slice(0, 120) ?? ''}`);
    }
    console.log(`    result   : ${report.recovered ? 'RECOVERED' : 'not recovered'}`);
    console.log(`    pages    : ${artifacts.pages.length}   text: ${artifacts.text.length} chars   ${(report.totalMs / 1000).toFixed(1)}s`);

    const t = report.timings;
    const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
    console.log(
      `    profile  : boot ${s(t.createMs)}  upload ${s(t.uploadMs)}  convert ${s(t.attemptsMs)}` +
        `  download ${s(t.downloadMs)}  destroy ${s(t.destroyMs)}`,
    );
    console.log(`    vm       : ${report.vm.sandboxId} ${report.vm.destroyed ? `destroyed ${report.vm.destroyedAt}` : 'NOT DESTROYED'}`);

    if (!report.vm.destroyed) undestroyed++;
    total.createMs += t.createMs;
    total.uploadMs += t.uploadMs;
    total.attemptsMs += t.attemptsMs;
    total.downloadMs += t.downloadMs;
    total.destroyMs += t.destroyMs;
    total.wallMs += report.totalMs;

    if (report.recovered && artifacts.pdf) {
      writeFileSync(join(OUT_DIR, `${name}.pdf`), artifacts.pdf);
      if (artifacts.pages[0]) writeFileSync(join(OUT_DIR, `${name}.page1.png`), artifacts.pages[0]);
    } else {
      failures++;
    }

    const winner = report.attempts.find((a) => a.outcome === 'ok');
    rows.push(
      `| ${name} | ${report.detection.format} | ${report.recovered ? 'yes' : 'no'} | ` +
        `${winner ? winner.label : '—'} | ${artifacts.pages.length} | ${(report.totalMs / 1000).toFixed(1)}s |`,
    );
  }

  console.log('\n\n| File | Detected as | Recovered | Strategy that worked | Pages | Time |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) console.log(row);
  console.log(`\nArtifacts written to ${OUT_DIR}`);
  console.log(`${files.length - failures}/${files.length} recovered.`);

  const n = files.length;
  const avg = (ms: number) => `${(ms / n / 1000).toFixed(1)}s`;
  const share = (ms: number) => `${((ms / total.wallMs) * 100).toFixed(0)}%`;
  console.log('\n| Stage | Mean per rescue | Share of wall clock |');
  console.log('| --- | --- | --- |');
  console.log(`| Boot the VM | ${avg(total.createMs)} | ${share(total.createMs)} |`);
  console.log(`| Upload the file | ${avg(total.uploadMs)} | ${share(total.uploadMs)} |`);
  console.log(`| Run converters | ${avg(total.attemptsMs)} | ${share(total.attemptsMs)} |`);
  console.log(`| Download results | ${avg(total.downloadMs)} | ${share(total.downloadMs)} |`);
  console.log(`| Destroy the VM | ${avg(total.destroyMs)} | ${share(total.destroyMs)} |`);
  console.log(`| **Total** | **${avg(total.wallMs)}** | |`);
  console.log(`\nVMs left alive: ${undestroyed}`);
}

main().catch((error: unknown) => {
  console.error('[e2e] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
