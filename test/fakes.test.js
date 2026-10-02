import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, fakeLocks, memoryArea } from '../testlib/fakes.js';

test('fakeClock runs timers in time order and repeats intervals', () => {
  const clock = fakeClock(1000);
  const seen = [];
  clock.setTimeout(() => seen.push(`b@${clock.now()}`), 20);
  clock.setTimeout(() => seen.push(`a@${clock.now()}`), 10);
  const every = clock.setInterval(() => seen.push(`i@${clock.now()}`), 15);
  clock.tick(31);
  assert.deepEqual(seen, ['a@1010', 'i@1015', 'b@1020', 'i@1030']);
  assert.equal(clock.now(), 1031);
  clock.clearInterval(every);
  assert.equal(clock.pending(), 0);
});

test('fakeLocks hands a held lock to nobody else', async () => {
  const locks = fakeLocks();
  let release;
  const first = locks.request('x', { ifAvailable: true }, (lock) => {
    assert.ok(lock);
    return new Promise((resolve) => { release = resolve; });
  });
  assert.equal(await locks.request('x', { ifAvailable: true }, (lock) => lock), null);
  release();
  await first;
  assert.equal(await locks.request('x', { ifAvailable: true }, (lock) => lock && lock.name), 'x');
});

test('memoryArea stores strings like localStorage', () => {
  const area = memoryArea({ a: '1' });
  assert.equal(area.getItem('a'), '1');
  assert.equal(area.getItem('b'), null);
  area.setItem('b', 2);
  assert.equal(area.getItem('b'), '2');
});
