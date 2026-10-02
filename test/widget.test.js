import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fakeClock, memoryArea, makeTimer, T0, MIN } from '../testlib/fakes.js';
import { createStorage, EXPIRE_AFTER_MS } from '../src/core/storage.js';
import { formatClock } from '../src/core/time.js';
import {
  createWidget, rowState, placeText, rowTitle,
  ROW_CLASS, ROW_DUE_CLASS, SOUND_ON, SOUND_OFF, SOUND_BLOCKED_TITLE, WIDGET_CLASS,
} from '../src/widget/widget.js';

function setup({ canPlay = () => true } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  const clock = fakeClock(T0);
  const storage = createStorage({ area: memoryArea(), target: null, clock });
  const widget = createWidget({ doc, storage, clock, canPlay });
  widget.start();
  const rows = () => [...doc.querySelectorAll(`.${ROW_CLASS}`)];
  const part = (row, name) => row.querySelector(`.${ROW_CLASS}__${name}`);
  return {
    doc, clock, storage, widget, root: widget.element, rows, part,
    times: () => rows().map((row) => part(row, 'time').textContent),
    sound: () => doc.querySelector(`.${WIDGET_CLASS}__sound`),
  };
}

test('a row counts down, then says LANDING, then LANDED', () => {
  const timer = makeTimer();
  assert.deepEqual(rowState(timer, T0), { due: false, text: '25:00' });
  assert.deepEqual(rowState(timer, T0 + 25 * MIN), { due: true, text: 'LANDING in 2:00' });
  assert.deepEqual(rowState(timer, T0 + 27 * MIN + 35_000), { due: true, text: 'LANDED +0:35' });
});

test('a return flight says so; the hover text gives the times', () => {
  assert.equal(placeText(makeTimer()), 'Canada');
  assert.equal(placeText(makeTimer({ direction: 'from', destination: 'uk' })), 'United Kingdom → Torn');
  assert.equal(rowTitle(makeTimer()),
    `Lands ~${formatClock(T0 + 27 * MIN)} · rings ${formatClock(T0 + 25 * MIN)} · Airstrip, 27 min`);
});

test('the box is hidden with no timers and shows a row per timer', () => {
  const w = setup();
  assert.equal(w.root.isConnected, true);
  assert.equal(w.root.hidden, true);
  w.storage.addTimer(makeTimer());
  assert.equal(w.root.hidden, false);
  const [row] = w.rows();
  assert.equal(w.part(row, 'name').textContent, 'SomeName');
  assert.equal(w.part(row, 'name').getAttribute('href'), '/profiles.php?XID=1234567');
  assert.equal(w.part(row, 'place').textContent, 'Canada');
  assert.equal(w.part(row, 'time').textContent, '25:00');
  assert.equal(row.title, rowTitle(makeTimer()));
});

test('rows are soonest first and re-sort when a sooner timer arrives', () => {
  const w = setup();
  w.storage.addTimer(makeTimer({ id: 'a', name: 'Later', ringAt: T0 + 50 * MIN, landingAt: T0 + 52 * MIN }));
  w.storage.addTimer(makeTimer({ id: 'b', name: 'Sooner', ringAt: T0 + 10 * MIN, landingAt: T0 + 12 * MIN }));
  assert.deepEqual(w.rows().map((r) => r.dataset.id), ['b', 'a']);
  const later = w.rows()[1];
  w.storage.addTimer(makeTimer({ id: 'c', ringAt: T0 + 5 * MIN, landingAt: T0 + 7 * MIN }));
  assert.deepEqual(w.rows().map((r) => r.dataset.id), ['c', 'b', 'a']);
  assert.equal(w.rows()[2], later, 'existing rows are reused, not rebuilt');
});

test('the countdown ticks every second', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  w.clock.tick(1000);
  assert.deepEqual(w.times(), ['24:59']);
});

test('a due row turns red and counts on past landing', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  w.clock.tick(25 * MIN);
  assert.deepEqual(w.times(), ['LANDING in 2:00']);
  assert.ok(w.rows()[0].classList.contains(ROW_DUE_CLASS));
  w.clock.tick(2 * MIN + 35_000);
  assert.deepEqual(w.times(), ['LANDED +0:35']);
});

test('the cross removes a timer', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  w.part(w.rows()[0], 'remove').click();
  assert.deepEqual(w.storage.getTimers(), []);
  assert.equal(w.rows().length, 0);
  assert.equal(w.root.hidden, true);
});

test('a timer keyed by name has no profile link', () => {
  const w = setup();
  w.storage.addTimer(makeTimer({ id: 'name:Ghost', name: 'Ghost' }));
  assert.equal(w.part(w.rows()[0], 'name').hasAttribute('href'), false);
});

test('an expired timer leaves the box', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  w.clock.tick(27 * MIN + EXPIRE_AFTER_MS);
  assert.equal(w.rows().length, 0);
  assert.equal(w.root.hidden, true);
});

test('the sound button switches the chime for every tab', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  assert.equal(w.sound().textContent, SOUND_ON);
  assert.equal(w.sound().getAttribute('aria-pressed'), 'true');
  w.sound().click();
  assert.equal(w.storage.getSetting('sound'), false);
  assert.equal(w.sound().textContent, SOUND_OFF);
  assert.equal(w.sound().getAttribute('aria-pressed'), 'false');
});

test('a tab that may not play sound says how to allow it', () => {
  const w = setup({ canPlay: () => false });
  w.storage.addTimer(makeTimer());
  assert.equal(w.sound().textContent, SOUND_OFF);
  assert.equal(w.sound().title, SOUND_BLOCKED_TITLE);
});

test('destroy removes the box and stops ticking', () => {
  const w = setup();
  w.widget.destroy();
  assert.equal(w.root.isConnected, false);
  assert.equal(w.clock.pending(), 0);
  w.storage.addTimer(makeTimer());
  assert.equal(w.rows().length, 0);
});
