import { loadConfig } from '../config.ts';
import { Queue } from '../queue/queue.ts';
import { SolariClient } from '../solari/client.ts';
import { createApp } from './app.ts';
import { ResultStore } from './store.ts';

const SHUTDOWN_GRACE_MS = 45_000;

const config = loadConfig();

// `base` has no converters, so every rescue would boot a machine and then fail. Refusing
// to start is cheaper and clearer than failing one request at a time.
if (config.template === 'base') {
  console.error('SOLARI_TEMPLATE is "base", which has no converters installed.');
  console.error('Every rescue would pay for a machine and then fail.');
  console.error('');
  console.error('Build one once, which takes about 1.6 minutes:');
  console.error('  npm run provision      # prints SOLARI_TEMPLATE=tpl_...');
  console.error('Then put that id in .env and start again.');
  process.exit(1);
}

const queue = new Queue(config.maxConcurrency);

const app = createApp({
  config,
  client: new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl }),
  queue,
  store: new ResultStore(),
});

app.listen(config.port, () => {
  console.log(`openable listening on http://localhost:${config.port}`);
  console.log(`template=${config.template} maxConcurrency=${config.maxConcurrency}`);
});

/**
 * A rescue owns a running VM, and the user is billed for it. Dying mid-rescue orphans that
 * machine, so shutdown stops accepting work and waits for what is already running.
 *
 * Windows does not deliver SIGTERM: `kill()` calls TerminateProcess and this never runs.
 * On Windows, and on any hard kill, `npm run sweep` is the backstop.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const { active, waiting } = queue.stats;
  console.log(`\n[shutdown] ${signal} received. In flight: ${active} running, ${waiting} queued.`);

  app.close(() => console.log('[shutdown] stopped accepting connections'));

  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), SHUTDOWN_GRACE_MS).unref(),
  );

  const result = await Promise.race([queue.drained().then(() => 'drained' as const), timeout]);

  if (result === 'timeout') {
    console.error(`[shutdown] gave up after ${SHUTDOWN_GRACE_MS / 1000}s; a machine may be orphaned.`);
    console.error('[shutdown] run `npm run sweep 0` to destroy anything left behind.');
    process.exit(1);
  }

  console.log('[shutdown] all rescues finished and their machines were destroyed');
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}
