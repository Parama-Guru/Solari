import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RescueOutcome } from '../pipeline/rescue.ts';
import { ResultStore } from './store.ts';

const outcomeOf = (pdfBytes: number): RescueOutcome =>
  ({
    report: {} as RescueOutcome['report'],
    artifacts: { pdf: new Uint8Array(pdfBytes), pages: [], text: '' },
  }) as RescueOutcome;

test('evicts by total bytes, not just by entry count', () => {
  const store = new ResultStore(60_000, 100, 1000);

  const first = store.put(outcomeOf(400));
  const second = store.put(outcomeOf(400));
  assert.ok(store.get(first), 'first still fits');
  assert.ok(store.get(second));

  // Third pushes past the byte ceiling well before the 100-entry cap.
  const third = store.put(outcomeOf(400));
  assert.equal(store.get(first), null, 'oldest was evicted to make room');
  assert.ok(store.get(third));
  assert.ok(store.stats.bytes <= 1000, `bytes ${store.stats.bytes} must stay within the cap`);
});

test('releases bytes when an entry is evicted, so the counter cannot drift', () => {
  const store = new ResultStore(60_000, 2, 10 * 1024 * 1024);
  store.put(outcomeOf(1000));
  store.put(outcomeOf(1000));
  store.put(outcomeOf(1000));

  assert.equal(store.stats.entries, 2, 'entry cap still applies');
  assert.equal(store.stats.bytes, 2000, 'byte total tracks the surviving entries only');
});

test('an expired entry stops counting against the budget', () => {
  const store = new ResultStore(-1, 100, 1000);
  const id = store.put(outcomeOf(400));

  assert.equal(store.get(id), null, 'already expired');
  assert.equal(store.stats.bytes, 0, 'expired bytes were released');
});

test('a single oversized result does not wedge the store', () => {
  const store = new ResultStore(60_000, 100, 1000);
  const huge = store.put(outcomeOf(5000));

  // It is kept, because evicting everything still would not make room, but the next
  // put must not spin trying to free space that cannot be freed.
  assert.ok(store.get(huge));
  const next = store.put(outcomeOf(100));
  assert.ok(store.get(next));
});
