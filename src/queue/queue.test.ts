import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Queue, QueueFullError } from './queue.ts';

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('drained resolves immediately when nothing is running', async () => {
  await new Queue(1).drained();
});

test('drained waits for running and queued work, so shutdown cannot orphan a VM', async () => {
  const queue = new Queue(1);
  let finished = 0;

  const work = Array.from({ length: 3 }, () =>
    queue.run(async () => {
      await tick(10);
      finished++;
    }),
  );

  await queue.drained();
  assert.equal(finished, 3, 'every task completed before drained resolved');
  await Promise.all(work);
});

test('drained still resolves when a task throws', async () => {
  const queue = new Queue(1);
  const failing = queue.run(async () => {
    await tick(5);
    throw new Error('boom');
  });

  await assert.rejects(failing);
  await queue.drained();
});

test('never runs more tasks at once than the cap allows', async () => {
  const queue = new Queue(1);
  let concurrent = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 4 }, () =>
      queue.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await tick(5);
        concurrent--;
      }),
    ),
  );

  assert.equal(peak, 1);
  assert.deepEqual(queue.stats, { active: 0, waiting: 0 });
});

test('releases the slot even when a task throws', async () => {
  const queue = new Queue(1);
  await assert.rejects(queue.run(async () => { throw new Error('boom'); }));
  assert.equal(await queue.run(async () => 'recovered'), 'recovered');
  assert.deepEqual(queue.stats, { active: 0, waiting: 0 });
});

test('rejects new work once the waiting room is full', async () => {
  const queue = new Queue(1, 1);
  const held = queue.run(() => tick(30));
  const queued = queue.run(() => tick(1));

  await assert.rejects(queue.run(async () => 'third'), QueueFullError);
  await Promise.all([held, queued]);
});

test('runs two at a time when the plan allows it', async () => {  const queue = new Queue(2);
  let peak = 0;
  let concurrent = 0;

  await Promise.all(
    Array.from({ length: 5 }, () =>
      queue.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await tick(5);
        concurrent--;
      }),
    ),
  );

  assert.equal(peak, 2);
});
