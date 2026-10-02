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
  let writes = 0;
  const area = { getItem: () => null, setItem: () => { writes += 1; } };
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
