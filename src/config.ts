import { existsSync, readFileSync } from 'node:fs';

/** Minimal .env reader so the project keeps zero runtime dependencies. */
function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

export type AppConfig = {
  apiKey: string;
  baseUrl: string;
  /** Runtime template with the converters preinstalled, or `base` before provisioning. */
  template: string;
  maxConcurrency: number;
  port: number;
  /** Rescues allowed per caller per minute. */
  rateLimitPerMinute: number;
  /** Hard ceiling on VM seconds bought in any rolling day. 0 disables it. */
  maxVmSecondsPerDay: number;
  /** Only honour X-Forwarded-For when something trusted actually sets it. */
  trustProxy: boolean;
};

export function loadConfig(): AppConfig {
  loadDotEnv();
  const apiKey = process.env['SOLARI_API_KEY'] ?? '';
  if (!apiKey) {
    throw new Error('SOLARI_API_KEY is not set. Copy .env.example to .env and add the key, or export it.');
  }
  return {
    apiKey,
    baseUrl: process.env['SOLARI_BASE_URL'] ?? 'https://api.getsolari.com',
    template: process.env['SOLARI_TEMPLATE'] ?? 'base',
    maxConcurrency: Number(process.env['SOLARI_MAX_CONCURRENCY'] ?? '1'),
    port: Number(process.env['PORT'] ?? '3000'),
    rateLimitPerMinute: Number(process.env['OPENABLE_RATE_LIMIT_PER_MINUTE'] ?? '5'),
    maxVmSecondsPerDay: Number(process.env['OPENABLE_MAX_VM_SECONDS_PER_DAY'] ?? '0'),
    trustProxy: process.env['OPENABLE_TRUST_PROXY'] === 'true',
  };
}
