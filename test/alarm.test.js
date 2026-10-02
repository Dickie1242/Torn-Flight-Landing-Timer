import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeClock, fakeLocks, memoryArea, laggyAreas, makeTimer, flush, captureConsole, T0, MIN,
} from '../testlib/fakes.js';
import { resetWarnOnce } from '../src/core/log.js';
import { createStorage } from '../src/core/storage.js';
import { createAlarm, isLate, LATE_LIMIT_MS, LOCK_NAME, RETRY_MS } from '../src/core/alarm.js';

function fakeWin() {
  const win = new EventTarget();
  win.document = new EventTarget();
  return win;
}

/** Sound as a tab sees it: `allowed` says whether the browser lets this tab play. */
function fakeAudio(clock, plays, { allowed = true } = {}) {
  const audio = {
    allowed,
    blocked: false,
    unlocks: 0,
    readies: 0,
    async ready() {
      audio.readies += 1;
      audio.blocked = !audio.allowed;
      return audio.allowed;
    },
    play() {
      plays.push(clock.now());
      return true;
    },
    unlock() {
      audio.unlocks += 1;
      audio.blocked = false;
    },
    isBlocked: () => audio.blocked,
    likely: () => !audio.blocked,
  };
  return audio;
}

function seed(area, clock, ...timers) {
  const storage = createStorage({ area, target: null, clock });
  for (const timer of timers) storage.addTimer(timer);
}

function tab({ area, clock, locks = null, allowed = true, holdMs = 0 }) {
  const storage = createStorage({ area, target: null, clock });
  const plays = [];
  const audio = fakeAudio(clock, plays, { allowed });
  const win = fakeWin();
  const alarm = createAlarm({ storage, win, clock, locks, audio, holdMs });
  alarm.start();
  return { storage, alarm, plays, audio, win };
}

/** Moves time on in steps, letting promises settle between them. */
async function run(clock, ms, step = 100) {
  for (let done = 0; done < ms; done += step) {
    clock.tick(Math.min(step, ms - done));
    await flush();
  }
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
  await run(clock, 10_000, 1000);
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

test('a mute made in another tab just before the ring is respected', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks() });
  createStorage({ area, target: null, clock }).setSetting('sound', false);
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, [], 'this tab had not heard of the mute, but the ring reads storage afresh');
  assert.notEqual(t.storage.getTimer('1234567').rungAt, null);
});

test('lateness is measured from the landing, not the ring', () => {
  const timer = makeTimer({ startedAt: T0 - 40 * MIN, ringAt: T0 - 13 * MIN, landingAt: T0 - 3 * MIN });
  assert.equal(isLate(timer, T0), true, 'landed three minutes ago');
  const bigBuffer = makeTimer({ startedAt: T0 - 20 * MIN, ringAt: T0 - 3 * MIN, landingAt: T0 + 7 * MIN });
  assert.equal(isLate(bigBuffer, T0), false, 'rang three minutes ago, but lands in seven');
});

test('more than two minutes after the landing it marks the timer rung silently', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const landingAt = T0 - LATE_LIMIT_MS - 1;
  seed(area, clock, makeTimer({ startedAt: landingAt - 27 * MIN, ringAt: landingAt - 2 * MIN, landingAt }));
  const t = tab({ area, clock, locks: fakeLocks() });
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(t.storage.getTimer('1234567').rungAt, T0);
});

test('up to two minutes after the landing it still chimes', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const landingAt = T0 - LATE_LIMIT_MS;
  seed(area, clock, makeTimer({ startedAt: landingAt - 27 * MIN, ringAt: landingAt - 2 * MIN, landingAt }));
  const t = tab({ area, clock, locks: fakeLocks() });
  await flush();
  assert.deepEqual(t.plays, [T0]);
});

test('a tab that cannot play leaves the ring unmarked, and rings it after a click', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks(), allowed: false });
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(t.storage.getTimer('1234567').rungAt, null, 'left for a tab that can play');
  assert.equal(t.audio.isBlocked(), true);
  t.audio.allowed = true;
  t.win.dispatchEvent(new Event('pointerdown'));
  assert.equal(t.audio.unlocks, 1);
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
  await run(clock, 25 * MIN + 10_000, 1000);
  assert.equal(a.plays.length + b.plays.length, 1);
});

test('with storage that is slow to reach other tabs, holding the lock is what keeps it to one chime', async () => {
  const chimes = [];
  for (const holdMs of [0, 5000]) {
    const clock = fakeClock(T0);
    const [areaA, areaB] = laggyAreas(clock, 1500, 2);
    seed(areaA, clock, makeTimer());
    clock.tick(1500); // the timer reaches tab B's copy
    const locks = fakeLocks();
    const a = tab({ area: areaA, clock, locks, holdMs });
    const b = tab({ area: areaB, clock, locks, holdMs });
    await run(clock, 25 * MIN + 10_000, 100);
    chimes.push(a.plays.length + b.plays.length);
  }
  assert.ok(chimes[0] >= 2, `without the hold the slow write lets a second tab chime (${chimes[0]})`);
  assert.equal(chimes[1], 1, 'with the hold, one chime');
});

test('timers due together ring with one chime', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer({ id: '1' }), makeTimer({ id: '2' }), makeTimer({ id: '3' }));
  const t = tab({ area, clock, locks: fakeLocks(), holdMs: 5000 });
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, [T0 + 25 * MIN]);
  assert.ok(t.storage.getTimers().every((timer) => timer.rungAt === T0 + 25 * MIN));
});

test('a tab that finds the lock busy looks again soon, not at its next 1 s check', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const locks = fakeLocks();
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks });
  locks.held.add(LOCK_NAME); // another tab is ringing
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, []);
  locks.held.delete(LOCK_NAME);
  clock.tick(RETRY_MS);
  await flush();
  assert.deepEqual(t.plays, [T0 + 25 * MIN + RETRY_MS]);
});

test('a lock API that refuses outright falls back to ringing directly', async () => {
  resetWarnOnce();
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const locks = { request: () => Promise.reject(Object.assign(new Error('denied'), { name: 'SecurityError' })) };
  const warn = captureConsole('warn');
  try {
    const t = tab({ area, clock, locks });
    clock.tick(25 * MIN);
    await flush();
    clock.tick(0);
    await flush();
    assert.equal(t.plays.length, 1);
  } finally {
    warn.restore();
  }
  assert.equal(warn.calls.length, 1);
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
  await run(clock, 26 * MIN, 1000);
  assert.equal(t.plays.length, 1);
});

test('with nothing waiting there is no timer, no interval, and gestures do nothing', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const t = tab({ area, clock, locks: fakeLocks() });
  assert.equal(clock.pending(), 0);
  t.win.dispatchEvent(new Event('keydown'));
  assert.equal(t.audio.unlocks, 0);
  assert.equal(clock.pending(), 0);
  t.storage.addTimer(makeTimer());
  assert.equal(clock.pending(), 2, 'the ring timeout and the 1 s check');
  clock.tick(25 * MIN);
  await flush();
  assert.equal(clock.pending(), 0, 'all rung: back to nothing');
});

test('destroy cancels every timer, and a check already queued does nothing', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer({ startedAt: T0 - 30 * MIN, ringAt: T0 + 1000, landingAt: T0 + 2 * MIN }));
  const t = tab({ area, clock, locks: fakeLocks() });
  t.win.dispatchEvent(new Event('pointerdown'));
  t.alarm.destroy();
  clock.tick(5000);
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(clock.pending(), 0);
});

test('a timer that comes due while this tab is busy ringing rings right after, not at the next check', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock,
    makeTimer({ id: 'x' }),
    makeTimer({ id: 'y', ringAt: T0 + 25 * MIN + 2000, landingAt: T0 + 27 * MIN + 2000 }));
  const t = tab({ area, clock, locks: fakeLocks(), holdMs: 5000 });
  await run(clock, 25 * MIN + 10_000, 100);
  assert.equal(t.plays.length, 2);
  assert.ok(t.plays[1] - (T0 + 25 * MIN) < 6000, `the second chime came ${t.plays[1] - (T0 + 25 * MIN)} ms after the first`);
});

test('the click on Start lets sound start, even though the timer did not exist when the press began', () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const t = tab({ area, clock, locks: fakeLocks() });
  t.win.dispatchEvent(new Event('pointerdown'));
  assert.equal(t.audio.unlocks, 0, 'no timer yet');
  t.storage.addTimer(makeTimer()); // what the Start button's own click handler does
  t.win.dispatchEvent(new Event('click'));
  assert.equal(t.audio.unlocks, 1);
});

test('a ring that keeps failing retries once a second, not in a tight loop', async () => {
  resetWarnOnce();
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  let requests = 0;
  const locks = {
    request: () => {
      requests += 1;
      return Promise.reject(new Error('broken'));
    },
  };
  const warn = captureConsole('warn');
  try {
    tab({ area, clock, locks });
    clock.tick(25 * MIN);
    await flush();
    requests = 0;
    await run(clock, 3000, 100);
  } finally {
    warn.restore();
  }
  assert.ok(requests <= 4, `${requests} attempts in 3 s`);
});

test('with a timer waiting, the tab checks once whether it may play, so the hint shows before the ring', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const t = tab({ area, clock, locks: fakeLocks(), allowed: false });
  await flush();
  assert.equal(t.audio.readies, 0, 'nothing waiting: nothing checked');
  t.storage.addTimer(makeTimer());
  await flush();
  assert.equal(t.audio.readies, 1);
  assert.equal(t.audio.likely(), false, 'the box can say "click to allow" 25 minutes before the ring');
  t.storage.addTimer(makeTimer({ id: '42' }));
  await flush();
  assert.equal(t.audio.readies, 1, 'once per page');
});

test('a click clears a blocked tab even once nothing is waiting any more', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks(), allowed: false });
  await flush();
  assert.equal(t.audio.isBlocked(), true, 'the check at load found the tab blocked');
  t.storage.markRung('1234567', T0); // another tab rang it
  t.win.dispatchEvent(new Event('pointerdown'));
  assert.equal(t.audio.isBlocked(), false, 'so the hint goes, and a click on it cannot mute');
});
