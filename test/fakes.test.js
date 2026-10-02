import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeClock, fakeLocks, memoryArea, laggyAreas,
} from '../testlib/fakes.js';

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

test('fakeLocks refuses a request without ifAvailable, as a real browser would queue it', async () => {
  const locks = fakeLocks();
  await assert.rejects(locks.request('x', {}, () => {}), /ifAvailable/);
  await assert.rejects(locks.request('x', undefined, () => {}), /ifAvailable/);
});

test('fakeClock stops a timer that keeps rescheduling itself instead of hanging', () => {
  const clock = fakeClock(0);
  const again = () => clock.setTimeout(again, 0);
  again();
  assert.throws(() => clock.tick(10), /too many timers/);
});

test('memoryArea stores strings like localStorage', () => {
  const area = memoryArea({ a: '1' });
  assert.equal(area.getItem('a'), '1');
  assert.equal(area.getItem('b'), null);
  area.setItem('b', 2);
  assert.equal(area.getItem('b'), '2');
});

test('laggyAreas delivers a write to the other tabs only after the lag', () => {
  const clock = fakeClock(0);
  const [a, b] = laggyAreas(clock, 100, 2);
  a.setItem('k', 'v');
  assert.equal(a.getItem('k'), 'v');
  assert.equal(b.getItem('k'), null);
  clock.tick(100);
  assert.equal(b.getItem('k'), 'v');
});
