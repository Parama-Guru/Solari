import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Detection } from './types.ts';
import { guestInputPath, planFor, safeExtension } from './strategies.ts';

const detection = (over: Partial<Detection>): Detection => ({
  family: 'office',
  format: 'Microsoft Word 97-2003 document',
  container: 'ole2',
  confidence: 'medium',
  evidence: 'test fixture',
  extensionHint: 'doc',
  ...over,
});

test('a PDF is verified rather than converted, with repair held in reserve', () => {
  const ids = planFor(detection({ family: 'pdf', format: 'PDF' })).map((s) => s.id);
  assert.deepEqual(ids, ['pdf-passthrough', 'pdf-repair']);
});

test('spreadsheets round-trip through ODS, documents through ODT', () => {
  const sheet = planFor(detection({ format: 'Microsoft Excel 97-2003 workbook' })).map((s) => s.id);
  const doc = planFor(detection({})).map((s) => s.id);
  assert.ok(sheet.includes('soffice-via-ods'));
  assert.ok(doc.includes('soffice-via-odt'));
});

test('every chain ends in a fallback rather than giving up', () => {
  for (const family of ['office', 'vector', 'raster', 'postscript', 'text', 'unknown'] as const) {
    const plan = planFor(detection({ family }));
    assert.ok(plan.length >= 2, `${family} needs a fallback`);
  }
});

test('PostScript renders with Ghostscript and never through LibreOffice', () => {
  const ids = planFor(detection({ family: 'postscript', format: 'PostScript or EPS', extensionHint: 'ps' }))
    .map((s) => s.id);

  assert.equal(ids[0], 'ps-ghostscript');
  // LibreOffice has no PostScript renderer; it typesets the source, which renders
  // pages of the wrong content and passes the "a page rendered" check.
  assert.ok(!ids.some((id) => id.startsWith('soffice')), `LibreOffice must not appear: ${ids.join(', ')}`);
});

test('shell metacharacters in a filename cannot reach a command', () => {
  const hostile = detection({ extensionHint: 'pdf; rm -rf / #' });
  const ext = safeExtension(hostile);
  assert.match(ext, /^[a-z0-9]{1,8}$/);
  assert.doesNotMatch(guestInputPath(hostile), /[;&|$`<>()\\'"\s]/);
});

test('a missing extension still yields a usable guest path', () => {
  const path = guestInputPath(detection({ extensionHint: null, family: 'unknown' }));
  assert.equal(path, '/work/input.bin');
});

test('built commands reference only fixed guest paths', () => {
  const d = detection({});
  const input = guestInputPath(d);
  for (const strategy of planFor(d)) {
    const command = strategy.build(input, '/work/out');
    const joined = [command.cmd, ...command.args].join(' ');
    assert.ok(joined.includes('/work'), `${strategy.id} should operate inside /work`);
    assert.ok(command.timeoutMs > 0);
  }
});
