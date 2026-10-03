import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fakeClock, memoryArea, captureConsole, T0, MIN } from '../testlib/fakes.js';
import { resetWarnOnce } from '../src/core/log.js';
import { createStorage } from '../src/core/storage.js';
import { formatClock } from '../src/core/time.js';
import { createPanel, planTimer, describeStatus, panelPosition, PANEL_CLASS, VARIANCE_WARN_CLASS } from '../src/profile/panel.js';

const AIRSTRIP = {
  id: '1234567', name: 'SomeName', state: 'traveling', direction: 'to', destination: 'canada', plane: 'airstrip',
};

function setup(status = AIRSTRIP, { bufferMin } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="anchor">open</button><p id="away">x</p></body>', { pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  const clock = fakeClock(T0);
  const storage = createStorage({ area: memoryArea(), target: null, clock });
  if (bufferMin != null) storage.setSetting('bufferMin', bufferMin);
  const panel = createPanel({ doc, storage, clock });
  const anchor = doc.getElementById('anchor');
  panel.open(anchor, status);
  const root = panel.element;
  const q = (selector) => root.querySelector(selector);
  return {
    win, doc, clock, storage, panel, anchor, root, q,
    select: () => q('select[name="destination"]'),
    radio: (plane) => q(`input[type="radio"][value="${plane}"]`),
    checked: () => {
      const radio = q('input[type="radio"]:checked');
      return radio ? radio.value : null;
    },
    buffer: () => q('input[name="buffer"]'),
    minutes: (plane) => q(`[data-plane="${plane}"] .${PANEL_CLASS}__minutes`).textContent,
    tag: (plane) => q(`[data-plane="${plane}"] .${PANEL_CLASS}__tag`).textContent,
    start: () => q('[data-action="start"]'),
    cancel: () => q('[data-action="cancel"]'),
    summary: () => q(`.${PANEL_CLASS}__summary`).textContent,
    variance: () => q(`.${PANEL_CLASS}__variance`).textContent,
    status: () => q(`.${PANEL_CLASS}__status`).textContent,
  };
}

function choose(win, input, value) {
  if (input.type === 'radio') input.checked = true;
  else input.value = value;
  input.dispatchEvent(new win.Event(input.tagName === 'SELECT' || input.type === 'radio' ? 'change' : 'input', { bubbles: true }));
}

test('planTimer counts from now and rings the buffer early, never before now', () => {
  assert.deepEqual(planTimer({ destination: 'canada', plane: 'airstrip', bufferMin: 2, now: T0 }),
    { minutes: 27, startedAt: T0, landingAt: T0 + 27 * MIN, ringAt: T0 + 25 * MIN });
  assert.equal(planTimer({ destination: 'mexico', plane: 'business', bufferMin: 30, now: T0 }).ringAt, T0);
  assert.equal(planTimer({ destination: null, plane: 'airstrip', bufferMin: 2, now: T0 }), null);
  assert.equal(planTimer({ destination: 'canada', plane: null, bufferMin: 2, now: T0 }), null);
});

test('the status line reads the profile back', () => {
  assert.equal(describeStatus(AIRSTRIP), 'Torn → Canada · plane on profile: Airstrip');
  assert.equal(describeStatus({ ...AIRSTRIP, direction: 'from', destination: 'uk', plane: 'commercial' }),
    'United Kingdom → Torn · plane on profile: Commercial');
  assert.equal(describeStatus({ ...AIRSTRIP, plane: null }), 'Torn → Canada · plane on profile: not shown');
  assert.equal(describeStatus({ ...AIRSTRIP, direction: null }), 'Flying to or from Canada · plane on profile: Airstrip',
    'an unclear direction is not shown as outbound');
  assert.equal(describeStatus({ ...AIRSTRIP, direction: null, destination: null }),
    'Flying, destination unclear · plane on profile: Airstrip');
  assert.equal(describeStatus({ ...AIRSTRIP, state: 'hidden', direction: null, destination: null, plane: null }),
    'Travelling disguised: pick the destination and plane.');
  assert.equal(describeStatus({ ...AIRSTRIP, state: 'abroad', direction: null, destination: 'mexico', plane: null }),
    'In Mexico. Not flying yet: the timer starts when you press Start.');
  assert.equal(describeStatus({ ...AIRSTRIP, state: 'other', direction: null, destination: null, plane: null }),
    'Not flying right now: the timer starts when you press Start.');
});

test('an airstrip flight opens pre-filled with every time listed', () => {
  const p = setup();
  assert.match(p.q(`.${PANEL_CLASS}__title`).textContent, /^Landing timer: SomeName \[1234567\]$/);
  assert.equal(p.status(), 'Torn → Canada · plane on profile: Airstrip');
  assert.equal(p.select().value, 'canada');
  assert.equal(p.checked(), 'airstrip');
  assert.equal(p.tag('airstrip'), '← from profile');
  assert.equal(p.tag('standard'), '');
  assert.deepEqual(['standard', 'airstrip', 'private', 'business'].map(p.minutes), ['39 min', '27 min', '19 min', '12 min']);
  assert.equal(p.buffer().value, '2');
  assert.equal(p.start().disabled, false);
  assert.equal(p.summary(), `Rings in 25 min (${formatClock(T0 + 25 * MIN)})`);
  assert.equal(p.variance(), 'Flights vary up to ~3% (about 1 min on this one)');
});

test('Commercial picks Standard and points at Business', () => {
  const p = setup({ ...AIRSTRIP, direction: 'from', destination: 'uk', plane: 'commercial' });
  assert.equal(p.checked(), 'standard');
  assert.equal(p.tag('standard'), '← from profile');
  assert.equal(p.tag('business'), '← also Commercial');
  assert.equal(p.minutes('standard'), '2h 31min');
});

test('disguised travel opens blank, and Start waits for both choices', () => {
  const p = setup({ ...AIRSTRIP, state: 'hidden', direction: null, destination: null, plane: null });
  assert.equal(p.select().value, '');
  assert.equal(p.checked(), null);
  assert.equal(p.minutes('standard'), '–');
  assert.equal(p.start().disabled, true);
  assert.equal(p.summary(), 'Pick a destination and a plane.');
  assert.equal(p.variance(), '');
  choose(p.win, p.select(), 'japan');
  assert.equal(p.minutes('standard'), '3h 33min');
  assert.equal(p.start().disabled, true);
  choose(p.win, p.radio('airstrip'), 'airstrip');
  assert.equal(p.start().disabled, false);
  assert.equal(p.summary(), `Rings in 2h 27min (${formatClock(T0 + 147 * MIN)})`);
});

test('the buffer moves the ring time, and one past the flight rings now', () => {
  const p = setup();
  choose(p.win, p.buffer(), '5');
  assert.equal(p.summary(), `Rings in 22 min (${formatClock(T0 + 22 * MIN)})`);
  choose(p.win, p.buffer(), '30');
  assert.equal(p.summary(), `Rings now (${formatClock(T0)})`);
  choose(p.win, p.buffer(), '');
  assert.equal(p.summary(), `Rings in 25 min (${formatClock(T0 + 25 * MIN)})`, 'an empty box means the last value used (2 here)');
});

test('the variance line scales with the flight and warns when it outgrows the buffer', () => {
  const short = setup({ ...AIRSTRIP, destination: 'mexico', plane: null });
  choose(short.win, short.radio('business'), 'business');
  assert.equal(short.variance(), 'Flights vary up to ~3% (under 1 min on this one)');
  assert.equal(short.q(`.${PANEL_CLASS}__variance`).classList.contains(VARIANCE_WARN_CLASS), false);
  const long = setup({ ...AIRSTRIP, destination: 'southafrica', plane: 'commercial' });
  assert.equal(long.variance(), 'Flights vary up to ~3% (about 8 min on this one): more than your buffer');
  assert.equal(long.q(`.${PANEL_CLASS}__variance`).classList.contains(VARIANCE_WARN_CLASS), true);
  choose(long.win, long.buffer(), '8');
  assert.equal(long.variance(), 'Flights vary up to ~3% (about 8 min on this one)');
  assert.equal(long.q(`.${PANEL_CLASS}__variance`).classList.contains(VARIANCE_WARN_CLASS), false);
});

test('Start saves the timer and the buffer, then closes', () => {
  const p = setup();
  choose(p.win, p.buffer(), '3');
  p.start().click();
  assert.deepEqual(p.storage.getTimers(), [{
    id: '1234567', name: 'SomeName', destination: 'canada', plane: 'airstrip', direction: 'to',
    minutes: 27, startedAt: T0, landingAt: T0 + 27 * MIN, ringAt: T0 + 24 * MIN, rungAt: null, landRungAt: null,
  }]);
  assert.equal(p.storage.getSetting('bufferMin'), 3);
  assert.equal(p.panel.isOpen(), false);
  assert.equal(p.root.isConnected, false);
});

test('the buffer opens at the last value used', () => {
  assert.equal(setup(AIRSTRIP, { bufferMin: 4 }).buffer().value, '4');
});

test('a player with no id is keyed by name, and one with neither still works', () => {
  const named = setup({ ...AIRSTRIP, id: null, name: 'Ghost' });
  named.start().click();
  assert.equal(named.storage.getTimers()[0].id, 'name:Ghost');
  const nobody = setup({ ...AIRSTRIP, id: null, name: null });
  nobody.start().click();
  assert.deepEqual(nobody.storage.getTimers().map((t) => [t.id, t.name]), [['name:unknown', 'Unknown player']]);
});

test('Escape, Cancel and a press outside close it; a press inside does not', () => {
  const p = setup();
  p.select().dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(p.panel.isOpen(), true);
  p.anchor.dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(p.panel.isOpen(), true, 'the button that opened it is not "outside"');
  p.doc.getElementById('away').dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(p.panel.isOpen(), false);

  const q = setup();
  q.doc.dispatchEvent(new q.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(q.panel.isOpen(), false);

  const r = setup();
  r.cancel().click();
  assert.equal(r.panel.isOpen(), false);
  assert.deepEqual(r.storage.getTimers(), []);
});

test('reopening replaces the old panel instead of stacking a second', () => {
  const p = setup();
  p.panel.open(p.anchor, AIRSTRIP);
  assert.equal(p.doc.querySelectorAll(`.${PANEL_CLASS}`).length, 1);
});

test('a name is shown as text, never as markup', () => {
  const p = setup({ ...AIRSTRIP, name: '<img src=x onerror=alert(1)>' });
  assert.equal(p.root.querySelector('img'), null);
  assert.match(p.q(`.${PANEL_CLASS}__title`).textContent, /<img src=x onerror=alert\(1\)>/);
});

test('the timer starts when Start is pressed, not when the panel opened', () => {
  const p = setup();
  p.clock.tick(10 * MIN);
  p.start().click();
  const [timer] = p.storage.getTimers();
  assert.equal(timer.startedAt, T0 + 10 * MIN);
  assert.equal(timer.ringAt, T0 + 35 * MIN);
});

test('an open panel keeps its ring time current', () => {
  const p = setup();
  p.clock.tick(60 * 1000);
  assert.equal(p.summary(), `Rings in 25 min (${formatClock(T0 + 26 * MIN)})`);
});

test('the buffer box shows the value actually used once the player leaves it', () => {
  const p = setup(AIRSTRIP, { bufferMin: 7 });
  for (const [typed, shown] of [['-3', '0'], ['2.6', '3'], ['31', '30'], ['', '7']]) {
    p.buffer().value = typed;
    p.buffer().dispatchEvent(new p.win.Event('change', { bubbles: true }));
    assert.equal(p.buffer().value, shown, `typed ${JSON.stringify(typed)}`);
  }
});

test('clearing the buffer box keeps the remembered buffer', () => {
  const p = setup(AIRSTRIP, { bufferMin: 7 });
  choose(p.win, p.buffer(), '');
  p.start().click();
  assert.equal(p.storage.getSetting('bufferMin'), 7);
  assert.equal(p.storage.getTimers()[0].ringAt, T0 + 20 * MIN);
});

test('the panel opens under its button, above it when there is no room below, and inside the window', () => {
  const view = { width: 1024, height: 768 };
  const size = { width: 320, height: 300 };
  assert.deepEqual(panelPosition({ left: 100, top: 200, bottom: 230 }, size, view), { left: 100, top: 236 });
  assert.deepEqual(panelPosition({ left: 100, top: 700, bottom: 730 }, size, view), { left: 100, top: 394 }, 'flipped above');
  assert.deepEqual(panelPosition({ left: 900, top: 200, bottom: 230 }, size, view), { left: 696, top: 236 }, 'kept off the right edge');
  assert.deepEqual(panelPosition({ left: 100, top: 50, bottom: 80 }, { width: 320, height: 900 }, view), { left: 100, top: 8 },
    'taller than the window: pinned to the top');
});

test('the keyboard starts on the first thing left to do and returns to the button on close', () => {
  const p = setup();
  assert.equal(p.doc.activeElement, p.start(), 'everything pre-filled: Start');
  p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.doc.activeElement, p.anchor);
  const blank = setup({ ...AIRSTRIP, state: 'hidden', direction: null, destination: null, plane: null });
  assert.equal(blank.doc.activeElement, blank.select(), 'nothing known: the destination');
  const noPlane = setup({ ...AIRSTRIP, plane: null });
  assert.equal(noPlane.doc.activeElement, noPlane.radio('standard'), 'country known: the planes');
});

test('a timer storage refuses keeps the panel open and says so until the player changes something', () => {
  const p = setup();
  p.storage.addTimer = () => null;
  p.start().click();
  const error = () => p.q(`.${PANEL_CLASS}__error`).textContent;
  assert.equal(p.panel.isOpen(), true);
  assert.equal(error(), 'Could not save this timer.');
  assert.equal(p.q(`.${PANEL_CLASS}__error`).getAttribute('role'), 'alert');
  p.clock.tick(15 * 1000);
  assert.equal(error(), 'Could not save this timer.', 'the refresh leaves it alone');
  assert.equal(p.storage.getSetting('bufferMin'), 2, 'nothing is saved either');
  choose(p.win, p.buffer(), '3');
  assert.equal(error(), '', 'gone once the player changes something');
});

test('an unknown plane word is treated as no plane, not a crash', () => {
  const p = setup({ ...AIRSTRIP, plane: 'personal' });
  assert.equal(p.checked(), null);
  assert.equal(p.status(), 'Torn → Canada · plane on profile: not shown');
  assert.equal(setup({ ...AIRSTRIP, plane: 'constructor' }).checked(), null);
});

test('closing removes every listener and timer the panel added', () => {
  const dom = new JSDOM('<!doctype html><body><button id="anchor">open</button></body>', { pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  let live = 0;
  for (const target of [doc, win]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (...args) => { live += 1; return add(...args); };
    target.removeEventListener = (...args) => { live -= 1; return remove(...args); };
  }
  const clock = fakeClock(T0);
  const panel = createPanel({ doc, storage: createStorage({ area: memoryArea(), target: null, clock }), clock });
  const anchor = doc.getElementById('anchor');
  panel.open(anchor, AIRSTRIP);
  panel.open(anchor, AIRSTRIP);
  assert.ok(live > 0);
  panel.close();
  assert.equal(live, 0);
  assert.equal(clock.pending(), 0, 'the refresh interval is cleared too');
});

test('a press outside closes the panel without pulling the keyboard back to the button', () => {
  const p = setup();
  assert.equal(p.doc.activeElement, p.start());
  p.doc.getElementById('away').dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(p.panel.isOpen(), false);
  assert.notEqual(p.doc.activeElement, p.anchor);
});

test('the panel stays where it is while its button is detached', () => {
  const p = setup();
  const before = p.root.style.top;
  p.anchor.remove();
  p.doc.dispatchEvent(new p.win.Event('scroll'));
  assert.equal(p.root.style.top, before);
});

test('the summary is rewritten only when its text changes', () => {
  const p = setup();
  const node = p.q(`.${PANEL_CLASS}__summary`).firstChild;
  p.clock.tick(15 * 1000);
  assert.equal(p.q(`.${PANEL_CLASS}__summary`).firstChild, node, 'same text, same text node: nothing re-announced');
});

test('a timer the browser will not save keeps the panel open and says so', () => {
  resetWarnOnce();
  const dom = new JSDOM('<!doctype html><body><button id="anchor">open</button></body>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  const clock = fakeClock(T0);
  const area = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const storage = createStorage({ area, target: null, clock });
  const panel = createPanel({ doc, storage, clock });
  panel.open(doc.getElementById('anchor'), AIRSTRIP);
  const warn = captureConsole('warn');
  try {
    panel.element.querySelector('[data-action="start"]').click();
  } finally {
    warn.restore();
  }
  assert.equal(panel.isOpen(), true);
  assert.match(panel.element.querySelector(`.${PANEL_CLASS}__error`).textContent, /this page only/);
  assert.equal(storage.getTimers().length, 1, 'it still runs on this page');
});

test('a timer started on someone abroad counts as their flight home', () => {
  const p = setup({ ...AIRSTRIP, state: 'abroad', direction: null, destination: 'mexico', plane: null });
  p.radio('standard').checked = true;
  p.radio('standard').dispatchEvent(new p.win.Event('change', { bubbles: true }));
  p.start().click();
  assert.equal(p.storage.getTimers()[0].direction, 'from');
});
