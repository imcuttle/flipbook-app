import test from 'node:test';
import assert from 'node:assert/strict';
import { PerCanvasQueue, Semaphore } from '../src/generation/queue.js';

test('PerCanvasQueue runs jobs sequentially', async () => {
  const q = new PerCanvasQueue();
  const order = [];
  const job = (i, ms) => async () => {
    order.push(`start-${i}`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`end-${i}`);
    return i;
  };
  const a = q.enqueue(job(1, 30));
  const b = q.enqueue(job(2, 5));
  const c = q.enqueue(job(3, 5));
  await Promise.all([a, b, c]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
});

test('PerCanvasQueue continues after a rejection', async () => {
  const q = new PerCanvasQueue();
  const ok1 = q.enqueue(async () => 'a');
  const failed = q.enqueue(async () => { throw new Error('boom'); }).catch((e) => e.message);
  const ok2 = q.enqueue(async () => 'b');
  assert.equal(await ok1, 'a');
  assert.equal(await failed, 'boom');
  assert.equal(await ok2, 'b');
});

test('Semaphore caps concurrency', async () => {
  const sem = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const work = async () => {
    await sem.acquire();
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    sem.release();
  };
  await Promise.all(Array.from({ length: 6 }, () => work()));
  assert.ok(peak <= 2, `peak=${peak} exceeded 2`);
});
