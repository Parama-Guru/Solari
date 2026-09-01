import { detect } from '../core/detect.ts';
import {
  extractTextCommand,
  guestInputPath,
  HOP_DIR,
  OUT_DIR,
  OUT_PDF,
  planFor,
  renderPagesCommand,
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

export async function rescue(
  client: SolariClient,
  input: RescueInput,
  options: RescueOptions,
): Promise<RescueOutcome> {
  const started = Date.now();
  const detection = detect(input.bytes, input.filename);
  const inputPath = guestInputPath(detection);
  const attempts: Attempt[] = [];

  return withSandbox(
    client,
    {
      template: options.template,
      kind: 'sandbox',
      timeoutMs: 15 * MINUTE,
      metadata: { app: 'openable', role: 'rescue' },
    },
    async (sandbox): Promise<RescueOutcome> => {
      const id = sandbox.sandboxId;
      const sh = (script: string, timeoutMs: number) => client.exec(id, 'sh', ['-c', script], timeoutMs);

      await sh(`mkdir -p ${OUT_DIR} ${HOP_DIR}`, MINUTE);
      await client.upload(id, inputPath, input.bytes);

      let recovered = false;

      for (const strategy of planFor(detection)) {
        const command = strategy.build(inputPath, OUT_DIR);
        const attemptStarted = Date.now();

        // A clean output directory means a surviving PDF can only be this attempt's work.
        await sh(`rm -rf ${OUT_DIR} ${HOP_DIR}; mkdir -p ${OUT_DIR} ${HOP_DIR}`, MINUTE);

        const run = await client.exec(id, command.cmd, command.args, command.timeoutMs);
        const produced = await sh(`test -s ${OUT_PDF}`, 30_000);
        const ok = produced.exitCode === 0;

        attempts.push({
          strategyId: strategy.id,
          label: strategy.label,
          outcome: ok ? 'ok' : 'failed',
          exitCode: run.exitCode,
          detail: ok
            ? 'Produced a non-empty PDF.'
            : (run.stderr.trim() || run.stdout.trim() || 'No PDF was written.').slice(0, 400),
          durationMs: Date.now() - attemptStarted,
        });

        if (ok) {
          recovered = true;
          break;
        }
      }

      const artifacts: RescueArtifacts = { pdf: null, pages: [], text: '' };
      let pageImagePaths: string[] = [];

      if (recovered) {
        const render = renderPagesCommand(OUT_PDF, OUT_DIR);
        await client.exec(id, render.cmd, render.args, render.timeoutMs);

        const extract = extractTextCommand(OUT_PDF, TEXT_PATH);
        await client.exec(id, extract.cmd, extract.args, extract.timeoutMs);

        const listed = await sh(`ls -1 ${OUT_DIR}/page*.png 2>/dev/null | sort`, MINUTE);
        pageImagePaths = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean);

        artifacts.pdf = await client.download(id, OUT_PDF);
        for (const path of pageImagePaths.slice(0, MAX_PAGES)) {
          artifacts.pages.push(await client.download(id, path));
        }

        const hasText = await sh(`test -s ${TEXT_PATH}`, 30_000);
        if (hasText.exitCode === 0) {
          artifacts.text = new TextDecoder().decode(await client.download(id, TEXT_PATH));
        }
      }

      const report: RescueReport = {
        originalName: input.filename,
        sizeBytes: input.bytes.byteLength,
        detection,
        attempts,
        outputs: {
          pdfPath: recovered ? OUT_PDF : null,
          pageImagePaths,
          text: artifacts.text,
        },
        recovered,
        nextStep: recovered ? null : nextStepFor(detection),
        totalMs: Date.now() - started,
      };

      return { report, artifacts };
    },
  );
}
