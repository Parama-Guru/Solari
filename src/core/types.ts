/** Broad handling class for a file. Decides which converter chain we try. */
export type FormatFamily =
  | 'office'
  | 'vector'
  | 'raster'
  | 'pdf'
  | 'text'
  | 'unknown';

export type Confidence = 'high' | 'medium' | 'low';

export type Detection = {
  family: FormatFamily;
  /** Human-readable format label shown to the user. */
  format: string;
  /** Outer wrapper, when the real format lives inside one. */
  container: 'zip' | 'ole2' | 'riff' | null;
  confidence: Confidence;
  /** Why we concluded this, quoted back to the user as evidence. */
  evidence: string;
  /** Extension the user supplied. A hint only, never authoritative. */
  extensionHint: string | null;
};

export type Command = {
  cmd: string;
  args: string[];
  timeoutMs: number;
};

/**
 * One attempt at turning an unreadable input into a PDF. Strategies are ordered
 * from cheapest and most faithful to most aggressive.
 */
export type Strategy = {
  id: string;
  label: string;
  build(input: string, outDir: string): Command;
};

export type AttemptOutcome = 'ok' | 'failed' | 'skipped';

export type Attempt = {
  strategyId: string;
  label: string;
  outcome: AttemptOutcome;
  exitCode: number | null;
  detail: string;
  durationMs: number;
};

export type RescueOutputs = {
  /** Guest path of the recovered PDF, when one was produced. */
  pdfPath: string | null;
  /** Guest paths of one PNG per page, in order. */
  pageImagePaths: string[];
  /** Parallel to the page images: true where a page carries no visible content. */
  blankPages: boolean[];
  /** Text extracted from the recovered PDF. */
  text: string;
};

export type RescueReport = {
  originalName: string;
  sizeBytes: number;
  detection: Detection;
  attempts: Attempt[];
  outputs: RescueOutputs;
  recovered: boolean;
  /** True when only a lossy fallback succeeded, so the output is partial. */
  degraded: boolean;
  /** Set when nothing worked, explaining what a human would need to do next. */
  nextStep: string | null;
  totalMs: number;
};
