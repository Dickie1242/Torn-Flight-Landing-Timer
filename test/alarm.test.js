import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeClock, fakeLocks, memoryArea, makeTimer, flush, T0, MIN,
} from '../testlib/fakes.js';
import { createStorage } from '../src/core/storage.js';
import { createAlarm, defaultCanPlay, LATE_LIMIT_MS } from '../src/core/alarm.js';

function fakeWin() {
  const win = new EventTarget();
  win.document = new EventTarget();
  return win;
}

function seed(area, clock, ...timers) {
  const storage = createStorage({ area, target: null, clock });
  for (const timer of timers) storage.addTimer(timer);
}

function tab({ area, clock, locks = null, canPlay = () => true, holdMs = 0 }) {
  const storage = createStorage({ area, target: null, clock });
  const plays = [];
  const win = fakeWin();
  const alarm = createAlarm({
    storage, win, clock, locks, canPlay, holdMs, play: () => plays.push(clock.now()),
  });
  alarm.start();
  return { storage, alarm, plays, win };
}

test('it chimes once, at the ring time', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks() });
  clock.tick(25 * MIN - 1);
  await flush();
  assert.deepEqual(t.plays, []);
  clock.tick(1);
  await flush();
  assert.deepEqual(t.plays, [T0 + 25 * MIN]);
  assert.equal(t.storage.getTimer('1234567').rungAt, T0 + 25 * MIN);
  clock.tick(10_000);
  await flush();
  assert.equal(t.plays.length, 1);
});

test('with the sound off it stays quiet but still marks the timer rung', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks() });
  t.storage.setSetting('sound', false);
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(t.storage.getTimer('1234567').rungAt, T0 + 25 * MIN);
});

test('more than two minutes late it marks the timer rung silently', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer({ startedAt: T0 - 30 * MIN, ringAt: T0 - LATE_LIMIT_MS - 1, landingAt: T0 }));
  const t = tab({ area, clock, locks: fakeLocks() });
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(t.storage.getTimer('1234567').rungAt, T0);
});

test('up to two minutes late it still chimes', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer({ startedAt: T0 - 30 * MIN, ringAt: T0 - LATE_LIMIT_MS, landingAt: T0 }));
  const t = tab({ area, clock, locks: fakeLocks() });
  await flush();
  assert.deepEqual(t.plays, [T0]);
});

test('a tab that may not play leaves the chime until it can', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  let allowed = false;
  const t = tab({ area, clock, locks: fakeLocks(), canPlay: () => allowed });
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(t.storage.getTimer('1234567').rungAt, null, 'left for a tab that can play');
  allowed = true;
  t.win.dispatchEvent(new Event('pointerdown'));
  clock.tick(0);
  await flush();
  assert.equal(t.plays.length, 1);
});

test('two tabs, one chime', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const locks = fakeLocks();
  seed(area, clock, makeTimer());
  const a = tab({ area, clock, locks });
  const b = tab({ area, clock, locks });
  clock.tick(25 * MIN);
  await flush();
  clock.tick(5000);
  await flush();
  assert.equal(a.plays.length + b.plays.length, 1);
});

test('while one tab holds the lock, the other skips, and stays quiet after', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const locks = fakeLocks();
  seed(area, clock, makeTimer());
  const a = tab({ area, clock, locks, holdMs: 5000 });
  const b = tab({ area, clock, locks, holdMs: 5000 });
  clock.tick(25 * MIN);
  await flush();
  assert.equal(a.plays.length + b.plays.length, 1);
  for (let second = 0; second < 8; second += 1) {
    clock.tick(1000);
    await flush();
  }
  assert.equal(a.plays.length + b.plays.length, 1);
});

test('a timer added after start is scheduled too', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const t = tab({ area, clock, locks: fakeLocks() });
  t.storage.addTimer(makeTimer());
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, [T0 + 25 * MIN]);
});

test('a removed timer never chimes', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const t = tab({ area, clock, locks: fakeLocks() });
  t.storage.addTimer(makeTimer());
  t.storage.removeTimer('1234567');
  clock.tick(30 * MIN);
  await flush();
  assert.deepEqual(t.plays, []);
});

test('without the Web Locks API it still chimes once', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: null });
  clock.tick(26 * MIN);
  await flush();
  assert.equal(t.plays.length, 1);
});

test('defaultCanPlay follows userActivation, and assumes yes without it', () => {
  assert.equal(defaultCanPlay({ userActivation: { hasBeenActive: false } }), false);
  assert.equal(defaultCanPlay({ userActivation: { hasBeenActive: true } }), true);
  assert.equal(defaultCanPlay({}), true);
  assert.equal(defaultCanPlay(null), true);
});

test('destroy cancels every timer', () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks() });
  t.alarm.destroy();
  assert.equal(clock.pending(), 0);
});
