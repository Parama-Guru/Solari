import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detect } from './detect.ts';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const fromAscii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function makeZip(entryName: string, content: string, stored: boolean): Uint8Array {
  const name = fromAscii(entryName);
  const data = fromAscii(content);
  const header = new Uint8Array(30 + name.length + data.length);
  header.set([0x50, 0x4b, 0x03, 0x04], 0);
  header[8] = stored ? 0 : 8;
  const size = data.length;
  header[18] = size & 0xff;
  header[19] = (size >> 8) & 0xff;
  header[26] = name.length & 0xff;
  header[27] = (name.length >> 8) & 0xff;
  header.set(name, 30);
  header.set(data, 30 + name.length);
  return header;
}

test('identifies a PDF from its signature', () => {
  const result = detect(Uint8Array.from(fromAscii('%PDF-1.7\n...')), 'invoice.pdf');
  assert.equal(result.format, 'PDF');
  assert.equal(result.family, 'pdf');
  assert.equal(result.confidence, 'high');
});

test('narrows an OLE2 document using the extension', () => {
  const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00);
  const result = detect(ole, 'newsletter.pub');
  assert.equal(result.format, 'Microsoft Publisher document');
  assert.equal(result.container, 'ole2');
  assert.equal(result.family, 'office');
});

test('still routes an OLE2 document with no usable extension', () => {
  const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00);
  const result = detect(ole, 'recovered_0001');
  assert.equal(result.format, 'OLE2 compound document');
  assert.equal(result.family, 'office');
  assert.equal(result.confidence, 'low');
});

function makeOle2(streamName: string): Uint8Array {
  const buf = new Uint8Array(768);
  buf.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  for (let i = 0; i < streamName.length; i++) {
    const code = streamName.charCodeAt(i);
    buf[512 + i * 2] = code & 0xff;
    buf[512 + i * 2 + 1] = code >> 8;
  }
  return buf;
}

test('names an OLE2 document from its internal stream, ignoring the extension', () => {
  const result = detect(makeOle2('WordDocument'), 'holiday-photos.xyz');
  assert.equal(result.format, 'Microsoft Word 97-2003 document');
  assert.equal(result.confidence, 'high');
  assert.match(result.evidence, /WordDocument/);
});

test('distinguishes Excel and Visio inside OLE2 without any extension', () => {
  assert.equal(detect(makeOle2('Workbook'), 'nameless').format, 'Microsoft Excel 97-2003 workbook');
  assert.equal(detect(makeOle2('VisioDocument'), 'nameless').format, 'Microsoft Visio drawing');
});

test('prefers the internal stream over a contradicting extension', () => {
  const result = detect(makeOle2('PowerPoint Document'), 'budget.xls');
  assert.equal(result.format, 'Microsoft PowerPoint 97-2003 presentation');
  assert.equal(result.extensionHint, 'xls');
});

test('reads the ODF mimetype out of the ZIP wrapper', () => {
  const zip = makeZip('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', true);
  const result = detect(zip, 'budget.ods');
  assert.equal(result.format, 'OpenDocument Spreadsheet');
  assert.equal(result.confidence, 'high');
});

test('recognises Office Open XML by its content types entry', () => {
  const zip = makeZip('[Content_Types].xml', '<Types/>', false);
  const result = detect(zip, 'report.docx');
  assert.equal(result.format, 'Word document');
  assert.equal(result.family, 'office');
});

test('recognises CorelDRAW inside a RIFF container', () => {
  const riff = new Uint8Array(16);
  riff.set(fromAscii('RIFF'), 0);
  riff.set(fromAscii('CDR'), 8);
  const result = detect(riff, 'logo.cdr');
  assert.equal(result.format, 'CorelDRAW drawing');
  assert.equal(result.family, 'vector');
});

test('recognises SVG from its markup', () => {
  const svg = Uint8Array.from(fromAscii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'));
  const result = detect(svg, 'icon.svg');
  assert.equal(result.format, 'SVG image');
  assert.equal(result.family, 'vector');
});

test('trusts the bytes over a misleading extension', () => {
  const result = detect(Uint8Array.from(fromAscii('%PDF-1.4 ')), 'actually-a-pdf.docx');
  assert.equal(result.format, 'PDF');
  assert.equal(result.extensionHint, 'docx');
});

test('reports an unrecognised binary rather than guessing', () => {
  const result = detect(bytes(0x00, 0x01, 0x02, 0xfe, 0xff, 0x7f, 0x80), 'mystery.bin');
  assert.equal(result.format, 'Unrecognised binary');
  assert.equal(result.family, 'unknown');
});
