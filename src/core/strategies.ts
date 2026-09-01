import type { Command, Detection, Strategy } from './types.ts';

const MINUTE = 60_000;

/** Everything runs against fixed guest paths, never the user's filename. */
export const WORK_DIR = '/work';
export const OUT_DIR = '/work/out';
export const HOP_DIR = '/work/hop';
export const PDF_NAME = 'input.pdf';
export const OUT_PDF = `${OUT_DIR}/${PDF_NAME}`;

const SOFFICE_FLAGS = ['--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard'];

/**
 * User filenames never reach the guest. We keep only a conservative extension so
 * LibreOffice can pick an import filter, which also removes any shell risk.
 */
export function safeExtension(detection: Detection): string {
  const hint = detection.extensionHint ?? '';
  const cleaned = hint.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleaned.length >= 1 && cleaned.length <= 8) return cleaned;
  switch (detection.family) {
    case 'pdf':
      return 'pdf';
    case 'vector':
      return 'svg';
    case 'raster':
      return 'png';
    case 'text':
      return 'txt';
    default:
      return 'bin';
  }
}

export const guestInputPath = (detection: Detection): string => `${WORK_DIR}/input.${safeExtension(detection)}`;

const sofficeDirect = (id: string, label: string): Strategy => ({
  id,
  label,
  build: (input, outDir): Command => ({
    cmd: 'soffice',
    args: [...SOFFICE_FLAGS, '--convert-to', 'pdf', '--outdir', outDir, input],
    timeoutMs: 4 * MINUTE,
  }),
});

/**
 * Round-tripping through OpenDocument often rescues a file whose direct PDF
 * export aborts, because the import filter rebuilds the structure on the way.
 */
const sofficeTwoHop = (intermediate: string): Strategy => ({
  id: `soffice-via-${intermediate}`,
  label: `LibreOffice repair pass through ${intermediate.toUpperCase()}`,
  build: (input, outDir): Command => {
    const flags = SOFFICE_FLAGS.join(' ');
    const stem = input.slice(input.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
    return {
      cmd: 'sh',
      args: [
        '-c',
        `set -e; mkdir -p ${HOP_DIR}; soffice ${flags} --convert-to ${intermediate} --outdir ${HOP_DIR} ${input}; ` +
          `soffice ${flags} --convert-to pdf --outdir ${outDir} ${HOP_DIR}/${stem}.${intermediate}`,
      ],
      timeoutMs: 6 * MINUTE,
    };
  },
});

const inkscapeExport: Strategy = {
  id: 'inkscape-pdf',
  label: 'Inkscape vector export',
  build: (input, outDir): Command => ({
    cmd: 'inkscape',
    args: [input, '--export-type=pdf', `--export-filename=${outDir}/${PDF_NAME}`],
    timeoutMs: 3 * MINUTE,
  }),
};

const imagemagickExport: Strategy = {
  id: 'imagemagick-pdf',
  label: 'ImageMagick raster export',
  build: (input, outDir): Command => ({
    cmd: 'sh',
    args: ['-c', `magick ${input} ${outDir}/${PDF_NAME} || convert ${input} ${outDir}/${PDF_NAME}`],
    timeoutMs: 3 * MINUTE,
  }),
};

/** Last resort: pull whatever readable strings survive and typeset them. */
const salvageStrings: Strategy = {
  id: 'strings-salvage',
  label: 'Raw text salvage',
  build: (input, outDir): Command => ({
    cmd: 'sh',
    args: [
      '-c',
      `set -e; strings -n 6 ${input} > ${WORK_DIR}/salvage.txt; test -s ${WORK_DIR}/salvage.txt; ` +
        `soffice ${SOFFICE_FLAGS.join(' ')} --convert-to pdf --outdir ${outDir} ${WORK_DIR}/salvage.txt; ` +
        `mv ${outDir}/salvage.pdf ${outDir}/${PDF_NAME}`,
    ],
    timeoutMs: 4 * MINUTE,
  }),
};

/** The input is already a PDF, so copy it into place and let rendering verify it. */
const passthroughPdf: Strategy = {
  id: 'pdf-passthrough',
  label: 'Already a PDF, verifying it renders',
  build: (input, outDir): Command => ({
    cmd: 'sh',
    args: ['-c', `cp ${input} ${outDir}/${PDF_NAME}`],
    timeoutMs: 30_000,
  }),
};

/** Rebuilds a damaged PDF's cross-reference table. */
const repairPdf: Strategy = {
  id: 'pdf-repair',
  label: 'Ghostscript PDF repair',
  build: (input, outDir): Command => ({
    cmd: 'sh',
    args: ['-c', `gs -o ${outDir}/${PDF_NAME} -sDEVICE=pdfwrite -dPDFSTOPONERROR=false ${input}`],
    timeoutMs: 4 * MINUTE,
  }),
};

const OFFICE_CHAIN: readonly Strategy[] = [
  sofficeDirect('soffice-direct', 'LibreOffice direct export'),
  sofficeTwoHop('odt'),
  salvageStrings,
];

const SPREADSHEET_CHAIN: readonly Strategy[] = [
  sofficeDirect('soffice-direct', 'LibreOffice direct export'),
  sofficeTwoHop('ods'),
  salvageStrings,
];

const VECTOR_CHAIN: readonly Strategy[] = [
  inkscapeExport,
  sofficeDirect('soffice-draw', 'LibreOffice Draw import'),
  imagemagickExport,
];

const RASTER_CHAIN: readonly Strategy[] = [imagemagickExport, sofficeDirect('soffice-draw', 'LibreOffice Draw import')];

const PDF_CHAIN: readonly Strategy[] = [passthroughPdf, repairPdf];

const UNKNOWN_CHAIN: readonly Strategy[] = [
  sofficeDirect('soffice-guess', 'LibreOffice format guess'),
  imagemagickExport,
  salvageStrings,
];

const isSpreadsheet = (detection: Detection): boolean =>
  /spreadsheet|excel|worksheet|1-2-3|calc/i.test(detection.format);

/**
 * Orders the conversion attempts for a detected file, cheapest and most faithful first.
 */
export function planFor(detection: Detection): Strategy[] {
  switch (detection.family) {
    case 'pdf':
      return [...PDF_CHAIN];
    case 'vector':
      return [...VECTOR_CHAIN];
    case 'raster':
      return [...RASTER_CHAIN];
    case 'office':
      return isSpreadsheet(detection) ? [...SPREADSHEET_CHAIN] : [...OFFICE_CHAIN];
    case 'text':
      return [sofficeDirect('soffice-text', 'LibreOffice text import'), salvageStrings];
    case 'unknown':
      return [...UNKNOWN_CHAIN];
  }
}

/** Renders one PNG per page so the user can see the file really opened. */
export const renderPagesCommand = (pdfPath: string, outDir: string): Command => ({
  cmd: 'sh',
  args: ['-c', `pdftoppm -png -r 110 -scale-to-x 1000 -scale-to-y -1 ${pdfPath} ${outDir}/page`],
  timeoutMs: 3 * MINUTE,
});

export const extractTextCommand = (pdfPath: string, outPath: string): Command => ({
  cmd: 'sh',
  args: ['-c', `pdftotext -layout ${pdfPath} ${outPath} || true`],
  timeoutMs: 2 * MINUTE,
});
