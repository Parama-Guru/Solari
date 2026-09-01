import { loadConfig } from '../config.ts';
import { SolariClient } from '../solari/client.ts';
import { withSandbox } from '../solari/session.ts';

const MINUTE = 60_000;

/** Fails fast on auth, entitlement, or connectivity before any long job runs. */
async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  console.log(`[doctor] base url   ${config.baseUrl}`);
  console.log(`[doctor] template   ${config.template}`);

  const started = Date.now();
  await withSandbox(
    client,
    { template: 'base', kind: 'sandbox', timeoutMs: 5 * MINUTE, metadata: { app: 'openable', role: 'doctor' } },
    async (sandbox) => {
      console.log(`[doctor] sandbox booted in ${Date.now() - started}ms`);

      const probe = await client.exec(
        sandbox.sandboxId,
        'sh',
        ['-c', '. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"; id -un; which apt-get soffice pdftoppm 2>/dev/null; true'],
        MINUTE,
      );
      console.log(`[doctor] exit ${probe.exitCode}`);
      console.log(probe.stdout.trim() || '(no output)');
      if (probe.stderr.trim()) console.log(`[doctor] stderr: ${probe.stderr.trim()}`);

      const round = Date.now();
      await client.upload(sandbox.sandboxId, '/work/probe.txt', new TextEncoder().encode('openable'));
      const back = await client.download(sandbox.sandboxId, '/work/probe.txt');
      console.log(`[doctor] file round trip ${new TextDecoder().decode(back)} in ${Date.now() - round}ms`);
    },
  );

  console.log(`[doctor] ok, sandbox destroyed, total ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((error: unknown) => {
  console.error('[doctor] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
