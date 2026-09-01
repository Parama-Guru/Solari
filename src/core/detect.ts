import type { Confidence, Detection, FormatFamily } from './types.ts';

type Signature = {
  offset: number;
  /** A byte of -1 matches anything. */
  bytes: readonly number[];
  format: string;
  family: FormatFamily;
  container?: Detection['container'];
};

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const SIGNATURES: readonly Signature[] = [
  { offset: 0, bytes: ascii('%PDF-'), format: 'PDF', family: 'pdf' },
  {
    offset: 0,
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    format: 'OLE2 compound document',
    family: 'office',
    container: 'ole2',
  },
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04], format: 'ZIP container', family: 'unknown', container: 'zip' },
  { offset: 0, bytes: ascii('{\\rtf'), format: 'Rich Text Format', family: 'office' },
  { offset: 0, bytes: [0xff, 0x57, 0x50, 0x43], format: 'WordPerfect document', family: 'office' },
  { offset: 0, bytes: [0x1a, 0x00, 0x00, 0x04], format: 'Lotus 1-2-3 worksheet', family: 'office' },
  { offset: 0, bytes: ascii('8BPS'), format: 'Photoshop document', family: 'raster' },
  { offset: 0, bytes: ascii('%!PS'), format: 'PostScript or EPS', family: 'postscript' },
  { offset: 0, bytes: [0x41, 0x43, 0x31, 0x30], format: 'AutoCAD drawing', family: 'vector' },
  { offset: 0, bytes: [0xd7, 0xcd, 0xc6, 0x9a], format: 'Windows Metafile', family: 'vector' },
  { offset: 40, bytes: ascii(' EMF'), format: 'Enhanced Metafile', family: 'vector' },
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47], format: 'PNG image', family: 'raster' },
  { offset: 0, bytes: [0xff, 0xd8, 0xff], format: 'JPEG image', family: 'raster' },
  { offset: 0, bytes: ascii('GIF8'), format: 'GIF image', family: 'raster' },
  { offset: 0, bytes: ascii('BM'), format: 'Bitmap image', family: 'raster' },
  { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00], format: 'TIFF image', family: 'raster' },
  { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a], format: 'TIFF image', family: 'raster' },
];

/** OLE2 holds many different documents; the extension is the only cheap discriminator. */
const OLE2_BY_EXTENSION: Readonly<Record<string, string>> = {
  doc: 'Microsoft Word 97-2003 document',
  xls: 'Microsoft Excel 97-2003 workbook',
  ppt: 'Microsoft PowerPoint 97-2003 presentation',
  pub: 'Microsoft Publisher document',
  vsd: 'Microsoft Visio drawing',
  msg: 'Outlook message',
  wps: 'Microsoft Works document',
  mpp: 'Microsoft Project plan',
};

/**
 * Named streams inside an OLE2 container, which say what the document really is.
 * Ordered so the more specific marker wins.
 */
const OLE2_STREAM_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['PowerPoint Document', 'Microsoft PowerPoint 97-2003 presentation'],
  ['WordDocument', 'Microsoft Word 97-2003 document'],
  ['VisioDocument', 'Microsoft Visio drawing'],
  ['Quill', 'Microsoft Publisher document'],
  ['__substg1.0_', 'Outlook message'],
  ['Workbook', 'Microsoft Excel 97-2003 workbook'],
  ['Book', 'Microsoft Excel 5.0 workbook'],
];

const ODF_MIMETYPES: Readonly<Record<string, string>> = {
  'application/vnd.oasis.opendocument.text': 'OpenDocument Text',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument Spreadsheet',
  'application/vnd.oasis.opendocument.presentation': 'OpenDocument Presentation',
  'application/vnd.oasis.opendocument.graphics': 'OpenDocument Drawing',
  'application/vnd.oasis.opendocument.formula': 'OpenDocument Formula',
  'application/vnd.oasis.opendocument.chart': 'OpenDocument Chart',
  'application/vnd.oasis.opendocument.database': 'OpenDocument Database',
  'application/vnd.oasis.opendocument.image': 'OpenDocument Image',
  'application/vnd.oasis.opendocument.text-master': 'OpenDocument Master Document',
  // LibreOffice writes this when a document came in as HTML, and it is easy to hit.
  'application/vnd.oasis.opendocument.text-web': 'OpenDocument HTML Document',
  'application/vnd.oasis.opendocument.text-template': 'OpenDocument Text Template',
  'application/vnd.oasis.opendocument.spreadsheet-template': 'OpenDocument Spreadsheet Template',
  'application/vnd.oasis.opendocument.presentation-template': 'OpenDocument Presentation Template',
  'application/vnd.oasis.opendocument.graphics-template': 'OpenDocument Drawing Template',
  'application/epub+zip': 'EPUB book',
};

const OOXML_BY_EXTENSION: Readonly<Record<string, string>> = {
  docx: 'Word document',
  xlsx: 'Excel workbook',
  pptx: 'PowerPoint presentation',
};

function matchesAt(buf: Uint8Array, sig: Signature): boolean {
  if (buf.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    const expected = sig.bytes[i]!;
    if (expected === -1) continue;
    if (buf[sig.offset + i] !== expected) return false;
  }
  return true;
}

const u16 = (buf: Uint8Array, at: number): number => buf[at]! | (buf[at + 1]! << 8);
const u32 = (buf: Uint8Array, at: number): number =>
  (buf[at]! | (buf[at + 1]! << 8) | (buf[at + 2]! << 16) | (buf[at + 3]! << 24)) >>> 0;

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = code >> 8;
  }
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  const last = haystack.length - needle.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

type ZipEntry = { name: string; storedText: string | null };

/**
 * Reads the first local file header of a ZIP. ODF writes an uncompressed
 * `mimetype` entry first, which names the real format exactly.
 */
export function readZipFirstEntry(buf: Uint8Array): ZipEntry | null {
  if (buf.length < 30) return null;
  const nameLen = u16(buf, 26);
  const extraLen = u16(buf, 28);
  const nameStart = 30;
  const nameEnd = nameStart + nameLen;
  if (nameEnd > buf.length) return null;

  const name = new TextDecoder().decode(buf.subarray(nameStart, nameEnd));
  const compression = u16(buf, 8);
  const compressedSize = u32(buf, 18);

  let storedText: string | null = null;
  if (compression === 0 && compressedSize > 0 && compressedSize < 256) {
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd <= buf.length) {
      storedText = new TextDecoder().decode(buf.subarray(dataStart, dataEnd)).trim();
    }
  }
  return { name, storedText };
}

function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

function looksLikeText(buf: Uint8Array): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  if (sample.length === 0) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable++;
  }
  return printable / sample.length > 0.9;
}

function refineZip(buf: Uint8Array, ext: string | null): Detection {
  const entry = readZipFirstEntry(buf);
  const base = { container: 'zip', extensionHint: ext } as const;

  if (entry?.name === 'mimetype' && entry.storedText) {
    const label = ODF_MIMETYPES[entry.storedText];
    if (label) {
      return {
        ...base,
        family: 'office',
        format: label,
        confidence: 'high',
        evidence: `ZIP whose first entry is an uncompressed mimetype of "${entry.storedText}".`,
      };
    }
  }

  if (entry && (entry.name === '[Content_Types].xml' || entry.name.startsWith('_rels/'))) {
    const label = ext ? OOXML_BY_EXTENSION[ext] : undefined;
    return {
      ...base,
      family: 'office',
      format: label ?? 'Office Open XML document',
      confidence: label ? 'high' : 'medium',
      evidence: `ZIP containing "${entry.name}", the Office Open XML marker.`,
    };
  }

  return {
    ...base,
    family: 'unknown',
    format: 'ZIP container',
    confidence: 'low',
    evidence: entry ? `ZIP whose first entry is "${entry.name}".` : 'ZIP header with an unreadable first entry.',
  };
}

function refineOle2(buf: Uint8Array, ext: string | null): Detection {
  const base = { container: 'ole2', extensionHint: ext, family: 'office' } as const;

  // Directory entry names are UTF-16LE, so the marker is searched in that encoding.
  for (const [stream, label] of OLE2_STREAM_MARKERS) {
    if (indexOfBytes(buf, utf16le(stream)) !== -1) {
      return {
        ...base,
        format: label,
        confidence: 'high',
        evidence: `OLE2 container holding a "${stream}" stream.`,
      };
    }
  }

  const label = ext ? OLE2_BY_EXTENSION[ext] : undefined;
  return {
    ...base,
    format: label ?? 'OLE2 compound document',
    confidence: label ? 'medium' : 'low',
    evidence: label
      ? `OLE2 compound header with no readable stream directory, narrowed to ${label} by the .${ext} extension.`
      : 'OLE2 compound header. The exact application is decided by the converter.',
  };
}

function refineRiff(buf: Uint8Array, ext: string | null): Detection | null {
  if (buf.length < 12) return null;
  const tag = new TextDecoder().decode(buf.subarray(8, 11));
  if (tag !== 'CDR') return null;
  return {
    container: 'riff',
    extensionHint: ext,
    family: 'vector',
    format: 'CorelDRAW drawing',
    confidence: 'high',
    evidence: 'RIFF container whose form type is CDR.',
  };
}

function refineText(buf: Uint8Array, ext: string | null): Detection {
  const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 1024))).toLowerCase();
  const shared = { container: null, extensionHint: ext } as const;

  if (head.includes('<svg')) {
    return { ...shared, family: 'vector', format: 'SVG image', confidence: 'high', evidence: 'Text containing an <svg element.' };
  }
  if (head.includes('<html') || head.includes('<!doctype html')) {
    return { ...shared, family: 'office', format: 'HTML document', confidence: 'high', evidence: 'Text containing an HTML root element.' };
  }
  if (head.startsWith('<?xml')) {
    return { ...shared, family: 'text', format: 'XML document', confidence: 'medium', evidence: 'Text beginning with an XML declaration.' };
  }
  return { ...shared, family: 'text', format: 'Plain text', confidence: 'low', evidence: 'Mostly printable characters and no known signature.' };
}

/**
 * Identifies a file from its bytes. The extension is only ever used to narrow a
 * match that the bytes already confirmed, so a mislabelled file still routes correctly.
 */
export function detect(buf: Uint8Array, filename: string): Detection {
  const ext = extensionOf(filename);

  const riff = refineRiff(buf, ext);
  if (riff) return riff;

  for (const sig of SIGNATURES) {
    if (!matchesAt(buf, sig)) continue;
    if (sig.container === 'zip') return refineZip(buf, ext);
    if (sig.container === 'ole2') return refineOle2(buf, ext);
    return {
      container: sig.container ?? null,
      extensionHint: ext,
      family: sig.family,
      format: sig.format,
      confidence: 'high' as Confidence,
      evidence: `Byte signature for ${sig.format} at offset ${sig.offset}.`,
    };
  }

  if (looksLikeText(buf)) return refineText(buf, ext);

  return {
    container: null,
    extensionHint: ext,
    family: 'unknown',
    format: 'Unrecognised binary',
    confidence: 'low',
    evidence: 'No known signature matched and the content is not text.',
  };
}
