import type { VmRecord } from '../core/types.ts';
import type { CreateSandboxOptions, Sandbox, SolariClient } from './client.ts';

export type SandboxLifecycle = VmRecord & {
  createMs: number;
  destroyMs: number;
};

export type SandboxRun<T> = {
  value: T;
  lifecycle: SandboxLifecycle;
};

/**
 * Runs work in a fresh sandbox and always tears it down, including on failure.
 * Teardown errors are reported but never mask the original failure, and the VM
 * is what holds the user's file, so this is also the deletion guarantee.
 *
 * The returned lifecycle is mutated during teardown, which happens after the
 * value is produced; callers therefore see the destruction timestamp.
 */
export async function withSandbox<T>(
  client: SolariClient,
  options: CreateSandboxOptions,
  work: (sandbox: Sandbox) => Promise<T>,
): Promise<SandboxRun<T>> {
  const createStarted = Date.now();
  const sandbox = await client.createSandbox(options);

  const lifecycle: SandboxLifecycle = {
    sandboxId: sandbox.sandboxId,
    createdAt: new Date(createStarted).toISOString(),
    destroyedAt: null,
    destroyed: false,
    createMs: Date.now() - createStarted,
    destroyMs: 0,
  };

  try {
    return { value: await work(sandbox), lifecycle };
  } finally {
    const destroyStarted = Date.now();
    try {
      await client.destroy(sandbox.sandboxId);
      lifecycle.destroyed = true;
      lifecycle.destroyedAt = new Date().toISOString();
    } catch (cause) {
      console.error(`[solari] failed to destroy ${sandbox.sandboxId}:`, cause);
    }
    lifecycle.destroyMs = Date.now() - destroyStarted;
  }
}
