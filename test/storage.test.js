import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeClock, memoryArea, makeTimer, captureConsole, T0, MIN,
} from '../testlib/fakes.js';
import { resetWarnOnce } from '../src/core/log.js';
import {
  createStorage, sanitizeTimer, STORAGE_KEY, STORAGE_VERSION, EXPIRE_AFTER_MS, BUFFER,
} from '../src/core/storage.js';

function fresh({ area = memoryArea(), clock = fakeClock(T0), target = null } = {}) {
  resetWarnOnce();
  return { area, clock, storage: createStorage({ area, target, clock }) };
}

function storageEvent(key) {
  return Object.assign(new Event('storage'), { key });
}

test('a new store has no timers and the default settings', () => {
  const { storage } = fresh();
  assert.deepEqual(storage.getTimers(), []);
  assert.equal(storage.getSetting('bufferMin'), 2);
  assert.equal(storage.getSetting('sound'), true);
  assert.equal(storage.getSetting('widgetPos'), null);
});

test('addTimer stores a clean copy, persists it and survives a reload', () => {
  const { area, clock, storage } = fresh();
  assert.deepEqual(storage.addTimer({ ...makeTimer(), extra: 'dropped' }), makeTimer());
  assert.deepEqual(storage.getTimers(), [makeTimer()]);
  const raw = JSON.parse(area.getItem(STORAGE_KEY));
  assert.equal(raw.version, STORAGE_VERSION);
  assert.deepEqual(raw.timers, [makeTimer()]);
  assert.deepEqual(createStorage({ area, target: null, clock }).getTimers(), [makeTimer()]);
});

test('a second timer for the same player replaces the first', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer());
  storage.addTimer(makeTimer({ destination: 'japan', minutes: 149, landingAt: T0 + 149 * MIN, ringAt: T0 + 147 * MIN }));
  const timers = storage.getTimers();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].destination, 'japan');
});

test('timers come back soonest ring first', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer({ id: 'a', ringAt: T0 + 50 * MIN, landingAt: T0 + 52 * MIN }));
  storage.addTimer(makeTimer({ id: 'b', ringAt: T0 + 10 * MIN, landingAt: T0 + 12 * MIN }));
  storage.addTimer(makeTimer({ id: 'c', ringAt: T0 + 30 * MIN, landingAt: T0 + 32 * MIN }));
  assert.deepEqual(storage.getTimers().map((t) => t.id), ['b', 'c', 'a']);
});

test('an unusable timer is refused and nothing is written', () => {
  const { storage, area } = fresh();
  const bad = [
    null, 'timer', makeTimer({ id: '' }), makeTimer({ id: 7 }), makeTimer({ destination: 'mars' }),
    makeTimer({ plane: 'rocket' }), makeTimer({ minutes: 0 }), makeTimer({ ringAt: 'soon' }),
    makeTimer({ landingAt: Number.NaN }), makeTimer({ startedAt: -1 }),
  ];
  for (const timer of bad) assert.equal(storage.addTimer(timer), null);
  assert.deepEqual(storage.getTimers(), []);
  assert.equal(area.getItem(STORAGE_KEY), null);
});

test('sanitizeTimer fills a missing name and drops a bad direction or rungAt', () => {
  assert.deepEqual(
    sanitizeTimer(makeTimer({ name: '  ', direction: 'sideways', rungAt: 'yes' })),
    makeTimer({ name: '#1234567', direction: null, rungAt: null }),
  );
});

test('removeTimer removes one timer and says whether it did', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer());
  storage.addTimer(makeTimer({ id: '42' }));
  assert.equal(storage.removeTimer('1234567'), true);
  assert.equal(storage.removeTimer('1234567'), false);
  assert.deepEqual(storage.getTimers().map((t) => t.id), ['42']);
});

test('markRung records the first ring only', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer());
  assert.equal(storage.markRung('1234567', T0 + 25 * MIN), true);
  assert.equal(storage.markRung('1234567', T0 + 26 * MIN), false);
  assert.equal(storage.getTimer('1234567').rungAt, T0 + 25 * MIN);
  assert.equal(storage.markRung('nobody', T0), false);
});

test('a timer expires an hour after its estimated landing', () => {
  const { storage, clock, area } = fresh();
  storage.addTimer(makeTimer());
  clock.tick(27 * MIN + EXPIRE_AFTER_MS - 1);
  assert.equal(storage.getTimers().length, 1);
  clock.tick(1);
  assert.deepEqual(storage.getTimers(), []);
  assert.equal(storage.getTimer('1234567'), null);
  assert.equal(JSON.parse(area.getItem(STORAGE_KEY)).timers.length, 1, 'still stored until pruned');
  assert.equal(storage.prune(), 1);
  assert.deepEqual(JSON.parse(area.getItem(STORAGE_KEY)).timers, []);
  assert.equal(storage.prune(), 0);
});

test('settings are clamped and sanitised', () => {
  const { storage } = fresh();
  assert.equal(storage.setSetting('bufferMin', 2.6), 3);
  assert.equal(storage.setSetting('bufferMin', 99), BUFFER.max);
  assert.equal(storage.setSetting('bufferMin', -4), BUFFER.min);
  assert.equal(storage.setSetting('bufferMin', 'lots'), BUFFER.default);
  assert.equal(storage.setSetting('sound', false), false);
  assert.equal(storage.setSetting('sound', 'loud'), true, 'junk falls back to the default');
  assert.deepEqual(storage.setSetting('widgetPos', { x: 10.4, y: 20.6 }), { x: 10, y: 21 });
  assert.equal(storage.setSetting('widgetPos', { x: 'left' }), null);
  assert.equal(storage.setSetting('nonsense', 1), undefined);
  assert.equal(storage.getSetting('nonsense'), undefined);
});

test('setSetting writes and notifies only when the value changes', () => {
  const inner = memoryArea();
  let writes = 0;
  const area = { getItem: (key) => inner.getItem(key), setItem: (key, value) => { writes += 1; inner.setItem(key, value); } };
  const storage = createStorage({ area, target: null, clock: fakeClock(T0) });
  let hits = 0;
  storage.subscribe(() => { hits += 1; });
  storage.setSetting('bufferMin', 5);
  storage.setSetting('bufferMin', 5);
  storage.setSetting('widgetPos', { x: 1, y: 2 });
  storage.setSetting('widgetPos', { x: 1, y: 2 });
  assert.equal(writes, 2);
  assert.equal(hits, 2);
});

test('corrupt JSON or a wrong version starts fresh with one warning', () => {
  for (const text of ['{not json', JSON.stringify({ version: 99, timers: [makeTimer()] })]) {
    resetWarnOnce();
    const area = memoryArea({ [STORAGE_KEY]: text });
    const warn = captureConsole('warn');
    let storage;
    try {
      storage = createStorage({ area, target: null, clock: fakeClock(T0) });
    } finally {
      warn.restore();
    }
    assert.deepEqual(storage.getTimers(), []);
    assert.equal(warn.calls.length, 1, text);
  }
});

test('stored junk is dropped while good timers and settings survive', () => {
  const area = memoryArea({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      timers: [makeTimer(), { id: 'bad' }, 'junk'],
      settings: { bufferMin: 4, sound: false, widgetPos: { x: 5, y: 6 } },
    }),
  });
  const storage = createStorage({ area, target: null, clock: fakeClock(T0) });
  assert.deepEqual(storage.getTimers(), [makeTimer()]);
  assert.equal(storage.getSetting('bufferMin'), 4);
  assert.equal(storage.getSetting('sound'), false);
  assert.deepEqual(storage.getSetting('widgetPos'), { x: 5, y: 6 });
});

test('a storage event for our key re-reads and notifies; other keys and destroy are ignored', () => {
  const area = memoryArea();
  const target = new EventTarget();
  const { storage } = fresh({ area, target });
  let hits = 0;
  storage.subscribe(() => { hits += 1; });
  area.setItem(STORAGE_KEY, JSON.stringify({ version: 1, timers: [makeTimer()], settings: {} }));
  target.dispatchEvent(storageEvent(STORAGE_KEY));
  assert.equal(hits, 1);
  assert.equal(storage.getTimers().length, 1);
  target.dispatchEvent(storageEvent('someone-elses-key'));
  assert.equal(hits, 1);
  storage.destroy();
  target.dispatchEvent(storageEvent(STORAGE_KEY));
  assert.equal(hits, 1);
});

test('reload picks up another tab\'s write without a storage event', () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const a = createStorage({ area, target: null, clock });
  const b = createStorage({ area, target: null, clock });
  a.addTimer(makeTimer());
  assert.deepEqual(b.getTimers(), []);
  b.reload();
  assert.equal(b.getTimers().length, 1);
});

test('a throwing subscriber does not stop the others', () => {
  const { storage } = fresh();
  const seen = [];
  storage.subscribe(() => { seen.push('first'); throw new Error('bad subscriber'); });
  storage.subscribe(() => { seen.push('second'); });
  const warn = captureConsole('warn');
  try {
    storage.addTimer(makeTimer());
  } finally {
    warn.restore();
  }
  assert.deepEqual(seen, ['first', 'second']);
  assert.equal(warn.calls.length, 1);
});

test('a write from a tab with a stale copy keeps the other tab\'s change', () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const a = createStorage({ area, target: null, clock });
  const b = createStorage({ area, target: null, clock });
  a.addTimer(makeTimer({ id: '1' }));
  b.addTimer(makeTimer({ id: '2' }));
  b.setSetting('sound', false);
  const after = createStorage({ area, target: null, clock });
  assert.deepEqual(after.getTimers().map((t) => t.id).sort(), ['1', '2']);
  assert.equal(after.getSetting('sound'), false);
});

test('a ring claimed in one tab is not undone by another tab\'s write, nor claimed again', () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const a = createStorage({ area, target: null, clock });
  const b = createStorage({ area, target: null, clock });
  a.addTimer(makeTimer());
  b.reload();
  assert.equal(a.markRung('1234567', T0 + 25 * MIN), true);
  b.setSetting('widgetPos', { x: 1, y: 2 });
  b.reload();
  assert.equal(b.getTimer('1234567').rungAt, T0 + 25 * MIN);
  assert.equal(b.markRung('1234567', T0 + 26 * MIN), false);
});

test('markRung refuses a time that is not a time', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer());
  assert.equal(storage.markRung('1234567', Number.NaN), false);
  assert.equal(storage.getTimer('1234567').rungAt, null);
});

test('a page restored from the back/forward cache re-reads storage', () => {
  const area = memoryArea();
  const target = new EventTarget();
  const clock = fakeClock(T0);
  const storage = createStorage({ area, target, clock });
  let hits = 0;
  storage.subscribe(() => { hits += 1; });
  createStorage({ area, target: null, clock }).addTimer(makeTimer());
  target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
  assert.equal(hits, 0, 'an ordinary page load is not a restore');
  target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  assert.equal(hits, 1);
  assert.equal(storage.getTimers().length, 1);
  storage.destroy();
  target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  assert.equal(hits, 1, 'destroy removes the listener');
});

test('nonsense times and over-long ids are refused; long names are trimmed', () => {
  assert.equal(sanitizeTimer(makeTimer({ ringAt: T0 + 28 * MIN })), null, 'rings after landing');
  assert.equal(sanitizeTimer(makeTimer({ startedAt: T0 + 26 * MIN })), null, 'starts after it rings');
  assert.equal(sanitizeTimer(makeTimer({ landingAt: T0 + 25 * 60 * MIN })), null, 'a 25-hour flight');
  assert.equal(sanitizeTimer(makeTimer({ id: 'x'.repeat(81) })), null);
  assert.equal(sanitizeTimer(makeTimer({ id: 'name:Ghost' })).id, 'name:Ghost');
  assert.equal(sanitizeTimer(makeTimer({ name: 'n'.repeat(100) })).name.length, 64);
});

test('when saving fails, the tab keeps its own changes instead of re-reading them away', () => {
  resetWarnOnce();
  const area = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const storage = createStorage({ area, target: null, clock: fakeClock(T0) });
  const warn = captureConsole('warn');
  try {
    storage.addTimer(makeTimer());
    storage.setSetting('bufferMin', 3);
  } finally {
    warn.restore();
  }
  assert.equal(storage.getTimers().length, 1, 'the timer just started is still here');
  assert.equal(storage.getSetting('bufferMin'), 3);
  assert.equal(warn.calls.length, 1, 'one warning, not one per write');
});

test('reload keeps a tab\'s own changes while saving fails', () => {
  resetWarnOnce();
  const area = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const storage = createStorage({ area, target: null, clock: fakeClock(T0) });
  const warn = captureConsole('warn');
  try {
    storage.addTimer(makeTimer());
    storage.reload();
  } finally {
    warn.restore();
  }
  assert.equal(storage.getTimers().length, 1);
});

test('markLanded records the landing chime once, apart from the warning', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer());
  assert.equal(storage.getTimer('1234567').landRungAt, null);
  assert.equal(storage.markLanded('1234567', T0 + 27 * MIN), true);
  assert.equal(storage.markLanded('1234567', T0 + 28 * MIN), false);
  assert.equal(storage.markLanded('1234567', Number.NaN), false);
  assert.equal(storage.markLanded('nobody', T0), false);
  const timer = storage.getTimer('1234567');
  assert.equal(timer.landRungAt, T0 + 27 * MIN);
  assert.equal(timer.rungAt, null, 'the warning keeps its own mark');
});

test('a timer saved before the landing chime existed reads back with landRungAt null', () => {
  const old = makeTimer();
  delete old.landRungAt;
  assert.equal(sanitizeTimer(old).landRungAt, null);
  assert.equal(sanitizeTimer(makeTimer({ landRungAt: 'soon' })).landRungAt, null);
});
