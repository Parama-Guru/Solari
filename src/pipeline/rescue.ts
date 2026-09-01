import { detect } from '../core/detect.ts';
import {
  BLANK_PAGE_THRESHOLD,
  guestInputPath,
  HOP_DIR,
  LOSSY_STRATEGIES,
  OUT_DIR,
  OUT_PDF,
  planFor,
  verifyAndCollectCommand,
} from '../core/strategies.ts';
import type { Attempt, Detection, RescueReport } from '../core/types.ts';
import type { SolariClient } from '../solari/client.ts';
import { withSandbox } from '../solari/session.ts';

const MINUTE = 60_000;
const MAX_PAGES = 8;
const TEXT_PATH = `${OUT_DIR}/text.txt`;

export type RescueInput = {
  filename: string;
  bytes: Uint8Array;
};

export type RescueArtifacts = {
  pdf: Uint8Array | null;
  pages: Uint8Array[];
  text: string;
};

export type RescueOutcome = {
  report: RescueReport;
  artifacts: RescueArtifacts;
};

export type RescueOptions = {
  template: string;
};

type PageInfo = { path: string; deviation: number };
type Collected = { status: 'nopdf' | 'nopages' | 'ok'; pages: PageInfo[] };

/** Handed back by the guest phase; the report is assembled after teardown, so
 *  it can state when the machine was destroyed. */
type GuestWork = {
  artifacts: RescueArtifacts;
  pages: PageInfo[];
  winner: string | null;
  uploadMs: number;
  downloadMs: number;
};

function nextStepFor(detection: Detection): string {
  switch (detection.family) {
    case 'office':
      return 'Every import filter refused this file. It is likely truncated or encrypted; try an older copy or a backup.';
    case 'vector':
      return 'No vector importer could parse this drawing. It may use a proprietary version that needs the original application.';
    case 'raster':
      return 'The image data could not be decoded, which usually means the file is incomplete.';
    case 'pdf':
      return 'The PDF structure is damaged beyond what Ghostscript could rebuild.';
    default:
      return 'The bytes did not match any format we can open, and no readable text survived inside them.';
  }
}

const firstLine = (text: string): string => text.split('\n').find((line) => line.trim())?.trim() ?? '';

function parseCollected(stdout: string): Collected {
  const lines = stdout.split('\n').map((line) => line.trim());
  const statusLine = lines.find((line) => line.startsWith('STATUS='));
  const status = statusLine?.slice('STATUS='.length) as Collected['status'] | undefined;
  if (status !== 'ok') return { status: status ?? 'nopdf', pages: [] };

  const begin = lines.indexOf('PAGES_BEGIN');
  const end = lines.indexOf('PAGES_END');
  const pages: PageInfo[] = [];

  if (begin !== -1 && end > begin) {
    for (const line of lines.slice(begin + 1, end)) {
      const parts = line.split(/\s+/);
      if (parts.length !== 2 || !parts[0]) continue;
      pages.push({ path: parts[0], deviation: Number(parts[1]) });
    }
  }
  return { status: 'ok', pages };
}

export async function rescue(
  client: SolariClient,
  input: RescueInput,
  options: RescueOptions,
): Promise<RescueOutcome> {
  const started = Date.now();
  const detection = detect(input.bytes, input.filename);
  const inputPath = guestInputPath(detection);
  const attempts: Attempt[] = [];

  const { value, lifecycle } = await withSandbox<GuestWork>(
    client,
    {
      template: options.template,
      kind: 'sandbox',
      timeoutMs: 15 * MINUTE,
      metadata: { app: 'openable', role: 'rescue' },
    },
    async (sandbox): Promise<GuestWork> => {
      const id = sandbox.sandboxId;
      const sh = (script: string, timeoutMs: number) => client.exec(id, 'sh', ['-c', script], timeoutMs);

      const uploadStarted = Date.now();
      await client.upload(id, inputPath, input.bytes);
      const uploadMs = Date.now() - uploadStarted;

      let pages: PageInfo[] = [];
      let winner: string | null = null;

      for (const strategy of planFor(detection)) {
        const command = strategy.build(inputPath, OUT_DIR);
        const attemptStarted = Date.now();
        const record = (outcome: Attempt['outcome'], exitCode: number | null, detail: string): void => {
          attempts.push({
            strategyId: strategy.id,
            label: strategy.label,
            outcome,
            exitCode,
            detail,
            durationMs: Date.now() - attemptStarted,
          });
        };

        // A clean output directory means a surviving PDF can only be this attempt's work.
        await sh(`rm -rf ${OUT_DIR} ${HOP_DIR}; mkdir -p ${OUT_DIR} ${HOP_DIR}`, MINUTE);
        const run = await client.exec(id, command.cmd, command.args, command.timeoutMs);

        const collect = verifyAndCollectCommand(OUT_DIR, OUT_PDF, TEXT_PATH);
        const collected = parseCollected(
          (await client.exec(id, collect.cmd, collect.args, collect.timeoutMs)).stdout,
        );

        if (collected.status === 'nopdf') {
          record('failed', run.exitCode, firstLine(run.stderr) || firstLine(run.stdout) || 'No PDF was written.');
          continue;
        }
        if (collected.status === 'nopages') {
          record('failed', run.exitCode, 'Produced a PDF, but it renders no pages.');
          continue;
        }

        const count = collected.pages.length;
        record('ok', run.exitCode, `Produced a PDF that renders ${count} page${count === 1 ? '' : 's'}.`);
        pages = collected.pages;
        winner = strategy.id;
        break;
      }

      const artifacts: RescueArtifacts = { pdf: null, pages: [], text: '' };
      const downloadStarted = Date.now();

      if (winner) {
        artifacts.pdf = await client.download(id, OUT_PDF);
        for (const page of pages.slice(0, MAX_PAGES)) {
          artifacts.pages.push(await client.download(id, page.path));
        }
        try {
          artifacts.text = new TextDecoder().decode(await client.download(id, TEXT_PATH)).trim();
        } catch {
          artifacts.text = '';
        }
      }

      return { artifacts, pages, winner, uploadMs, downloadMs: Date.now() - downloadStarted };
    },
  );

  const { artifacts, pages, winner } = value;

  const report: RescueReport = {
    originalName: input.filename,
    sizeBytes: input.bytes.byteLength,
    detection,
    attempts,
    outputs: {
      pdfPath: winner ? OUT_PDF : null,
      pageImagePaths: pages.map((page) => page.path),
      blankPages: pages.map((page) => page.deviation < BLANK_PAGE_THRESHOLD),
      text: artifacts.text,
    },
    recovered: winner !== null,
    degraded: winner !== null && LOSSY_STRATEGIES.has(winner),
    nextStep: winner ? null : nextStepFor(detection),
    totalMs: Date.now() - started,
    timings: {
      createMs: lifecycle.createMs,
      uploadMs: value.uploadMs,
      attemptsMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
      downloadMs: value.downloadMs,
      destroyMs: lifecycle.destroyMs,
    },
    vm: {
      sandboxId: lifecycle.sandboxId,
      createdAt: lifecycle.createdAt,
      destroyedAt: lifecycle.destroyedAt,
      destroyed: lifecycle.destroyed,
    },
  };

  return { report, artifacts };
}
