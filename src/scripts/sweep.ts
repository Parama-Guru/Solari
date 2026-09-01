import { loadConfig } from '../config.ts';
import { SolariClient, type SandboxRecord } from '../solari/client.ts';

const DEFAULT_MAX_AGE_MINUTES = 30;

const ageMinutes = (record: SandboxRecord): number => {
  if (!record.createdAt) return Number.POSITIVE_INFINITY;
  const created = Date.parse(record.createdAt);
  return Number.isNaN(created) ? Number.POSITIVE_INFINITY : (Date.now() - created) / 60_000;
};

/**
 * Teardown normally happens in a `finally`, but a crashed process or a failed delete can
 * still leave a VM running until its idle timeout. This is the safety net for that.
 */
async function main(): Promise<void> {
  const maxAge = Number(process.argv[2] ?? DEFAULT_MAX_AGE_MINUTES);
  const dryRun = process.argv.includes('--dry-run');

  const config = loadConfig();
  const client = new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  const ours = await client.listSandboxes({ metadata: { app: 'openable' } });
  const live = ours.filter((record) => record.state !== 'gone' && record.state !== 'releasing');

  console.log(`[sweep] ${live.length} live sandbox(es) tagged app=openable`);

  let destroyed = 0;
  for (const record of live) {
    const age = ageMinutes(record);
    const role = record.metadata?.['role'] ?? 'unknown';
    const label = `${record.sandboxId.slice(0, 28)}… role=${role} age=${age.toFixed(1)}m state=${record.state ?? '?'}`;

    if (age < maxAge) {
      console.log(`[sweep] keep    ${label}`);
      continue;
    }
    if (dryRun) {
      console.log(`[sweep] would destroy ${label}`);
      continue;
    }

    try {
      await client.destroy(record.sandboxId);
      destroyed++;
      console.log(`[sweep] destroyed ${label}`);
    } catch (error) {
      console.error(`[sweep] failed to destroy ${label}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`[sweep] done, ${destroyed} destroyed, threshold ${maxAge} min`);
}

main().catch((error: unknown) => {
  console.error('[sweep] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
