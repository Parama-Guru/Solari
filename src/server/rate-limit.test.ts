import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimiter } from './rate-limit.ts';

test('allows a burst up to capacity, then refuses', () => {
  const limiter = new RateLimiter(3, 60_000);
  const now = 1_000_000;

  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.take('1.2.3.4', now).allowed, true, `request ${i + 1} should pass`);
  }

  const fourth = limiter.take('1.2.3.4', now);
  assert.equal(fourth.allowed, false);
  if (!fourth.allowed) assert.ok(fourth.retryAfterSeconds >= 1);
});

test('refills over time rather than blocking until a window rolls over', () => {
  const limiter = new RateLimiter(3, 60_000);
  const now = 1_000_000;

  for (let i = 0; i < 3; i++) limiter.take('a', now);
  assert.equal(limiter.take('a', now).allowed, false);

  // One third of the window restores exactly one token.
  assert.equal(limiter.take('a', now + 20_000).allowed, true);
  assert.equal(limiter.take('a', now + 20_000).allowed, false);
});

test('one caller cannot spend another caller_s budget', () => {
  const limiter = new RateLimiter(2, 60_000);
  const now = 1_000_000;

  limiter.take('noisy', now);
  limiter.take('noisy', now);
  assert.equal(limiter.take('noisy', now).allowed, false);

  assert.equal(limiter.take('quiet', now).allowed, true, 'a different caller is unaffected');
});

test('never exceeds capacity however long the caller idles', () => {
  const limiter = new RateLimiter(2, 60_000);
  const now = 1_000_000;

  limiter.take('idle', now);
  // A week later the bucket must be full, not overflowing.
  assert.equal(limiter.take('idle', now + 7 * 24 * 3600_000).allowed, true);
  assert.equal(limiter.take('idle', now + 7 * 24 * 3600_000).allowed, true);
  assert.equal(limiter.take('idle', now + 7 * 24 * 3600_000).allowed, false);
});

test('bounds how many callers it remembers', () => {
  const limiter = new RateLimiter(1, 60_000, 3);
  for (let i = 0; i < 50; i++) limiter.take(`ip-${i}`);
  // The oldest keys are dropped, so a flood of unique addresses cannot grow memory.
  assert.equal(limiter.take('ip-0').allowed, true, 'evicted keys start fresh rather than accumulating');
});
