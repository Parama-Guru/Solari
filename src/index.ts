/**
 * Public API.
 *
 * Everything here is stable and meant to be imported by other projects. Anything
 * not re-exported from this file is an internal detail and may change.
 */

export { detect } from './core/detect.ts';
export { LOSSY_STRATEGIES, planFor, safeExtension } from './core/strategies.ts';

export type {
  Attempt,
  AttemptOutcome,
  Command,
  Confidence,
  Detection,
  FormatFamily,
  RescueOutputs,
  RescueReport,
  Strategy,
  Timings,
  VmRecord,
} from './core/types.ts';

export { rescue, rescueBatch } from './pipeline/rescue.ts';
export type {
  BatchItem,
  BatchOutcome,
  RescueArtifacts,
  RescueInput,
  RescueOptions,
  RescueOutcome,
} from './pipeline/rescue.ts';

export { SolariClient, SolariError } from './solari/client.ts';
export type {
  CreateSandboxOptions,
  ExecResult,
  Sandbox,
  SandboxRecord,
  SolariConfig,
} from './solari/client.ts';

export { withSandbox } from './solari/session.ts';
export type { SandboxLifecycle, SandboxRun } from './solari/session.ts';

export { Queue, QueueFullError } from './queue/queue.ts';

export { loadConfig } from './config.ts';
export type { AppConfig } from './config.ts';
