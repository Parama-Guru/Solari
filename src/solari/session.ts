import type { CreateSandboxOptions, Sandbox, SolariClient } from './client.ts';

/**
 * Runs work in a fresh sandbox and always tears it down, including on failure.
 * Teardown errors are reported but never mask the original failure, and the VM
 * is what holds the user's file, so this is also the deletion guarantee.
 */
export async function withSandbox<T>(
  client: SolariClient,
  options: CreateSandboxOptions,
  work: (sandbox: Sandbox) => Promise<T>,
): Promise<T> {
  const sandbox = await client.createSandbox(options);
  try {
    return await work(sandbox);
  } finally {
    try {
      await client.destroy(sandbox.sandboxId);
    } catch (cause) {
      console.error(`[solari] failed to destroy ${sandbox.sandboxId}:`, cause);
    }
  }
}
