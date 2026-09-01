import { loadConfig } from '../config.ts';
import { Queue } from '../queue/queue.ts';
import { SolariClient } from '../solari/client.ts';
import { createApp } from './app.ts';
import { ResultStore } from './store.ts';

const config = loadConfig();

const app = createApp({
  config,
  client: new SolariClient({ apiKey: config.apiKey, baseUrl: config.baseUrl }),
  queue: new Queue(config.maxConcurrency),
  store: new ResultStore(),
});

app.listen(config.port, () => {
  console.log(`openable listening on http://localhost:${config.port}`);
  console.log(`template=${config.template} maxConcurrency=${config.maxConcurrency}`);
  if (config.template === 'base') {
    console.warn('Warning: SOLARI_TEMPLATE is still "base". Run `npm run provision` first.');
  }
});
