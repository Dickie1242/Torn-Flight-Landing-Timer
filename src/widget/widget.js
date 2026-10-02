import { el } from '../core/dom.js';
import { safe } from '../core/log.js';
import { realClock } from '../core/clock.js';
import { destinationName, planeLabel } from '../core/flights.js';
import { formatClock, formatCountdown, formatElapsed, formatMinutes } from '../core/time.js';
import { attachDrag } from './drag.js';

export const WIDGET_CLASS = 'landingtimer-widget';
export const ROW_CLASS = 'landingtimer-row';
export const ROW_DUE_CLASS = 'landingtimer-row--due';
export const SOUND_ON = '🔊';
export const SOUND_OFF = '🔇';
export const SOUND_BLOCKED_TITLE = 'Click anywhere on this page to allow the chime';

/** What a row says at `now`: a countdown to the ring, then LANDING, then LANDED. */
export function rowState(timer, now) {
  if (now < timer.ringAt) return { due: false, text: formatCountdown(timer.ringAt - now) };
  if (now < timer.landingAt) return { due: true, text: `LANDING in ${formatCountdown(timer.landingAt - now)}` };
  return { due: true, text: `LANDED +${formatElapsed(now - timer.landingAt)}` };
}

export function placeText(timer) {
  const place = destinationName(timer.destination) || timer.destination;
  return timer.direction === 'from' ? `${place} → Torn` : place;
}

export function rowTitle(timer) {
  return `Lands ~${formatClock(timer.landingAt)} · rings ${formatClock(timer.ringAt)}`
    + ` · ${planeLabel(timer.plane)}, ${formatMinutes(timer.minutes)}`;
}

/**
 * The floating box of running timers, on every Torn page. It re-renders every
 * second and whenever storage changes (in this tab or another).
 */
export function createWidget({ doc = globalThis.document, storage, clock = realClock, canPlay = () => true }) {
  const win = doc.defaultView;
  /** @type {Map<string, {row: Element, name: Element, place: Element, time: Element}>} */
  const rows = new Map();
  let interval = null;
  let unsubscribe = null;
  let drag = null;

  const sound = el(doc, 'button', {
    className: `${WIDGET_CLASS}__sound`,
    attrs: { type: 'button' },
    on: { click: () => storage.setSetting('sound', !storage.getSetting('sound')) },
  });
  const bar = el(doc, 'div', { className: `${WIDGET_CLASS}__bar` }, [
    el(doc, 'span', { className: `${WIDGET_CLASS}__title`, text: '✈ Landing timers' }),
    sound,
  ]);
  const list = el(doc, 'div', { className: `${WIDGET_CLASS}__list` });
  const root = el(doc, 'div', { className: WIDGET_CLASS, attrs: { hidden: true } }, [bar, list]);

  function buildRow(id) {
    const name = el(doc, 'a', { className: `${ROW_CLASS}__name` });
    const place = el(doc, 'span', { className: `${ROW_CLASS}__place` });
    const time = el(doc, 'span', { className: `${ROW_CLASS}__time` });
    const remove = el(doc, 'button', {
      className: `${ROW_CLASS}__remove`,
      text: '✕',
      attrs: { type: 'button', title: 'Remove timer', 'aria-label': 'Remove timer' },
      on: { click: () => storage.removeTimer(id) },
    });
    const row = el(doc, 'div', { className: ROW_CLASS, attrs: { 'data-id': id } }, [name, place, time, remove]);
    return { row, name, place, time };
  }

  function renderSound() {
    const on = !!storage.getSetting('sound');
    const blocked = on && !canPlay();
    sound.textContent = on && !blocked ? SOUND_ON : SOUND_OFF;
    if (blocked) sound.title = SOUND_BLOCKED_TITLE;
    else sound.title = on ? 'Chime on: click to mute' : 'Chime off: click to turn it on';
    sound.setAttribute('aria-pressed', String(on));
  }

  function renderRow(parts, timer, now) {
    const state = rowState(timer, now);
    parts.name.textContent = timer.name;
    if (/^\d+$/.test(timer.id)) parts.name.setAttribute('href', `/profiles.php?XID=${timer.id}`);
    else parts.name.removeAttribute('href');
    parts.place.textContent = placeText(timer);
    parts.time.textContent = state.text;
    parts.row.title = rowTitle(timer);
    parts.row.classList.toggle(ROW_DUE_CLASS, state.due);
  }

  function render() {
    storage.prune();
    const now = clock.now();
    const timers = storage.getTimers();
    root.hidden = timers.length === 0;
    renderSound();
    const live = new Set(timers.map((t) => t.id));
    for (const [id, parts] of rows) {
      if (!live.has(id)) {
        parts.row.remove();
        rows.delete(id);
      }
    }
    timers.forEach((timer, index) => {
      let parts = rows.get(timer.id);
      if (!parts) {
        parts = buildRow(timer.id);
        rows.set(timer.id, parts);
      }
      renderRow(parts, timer, now);
      // Move a row only when it is out of place, so a hovered row keeps its tooltip.
      if (list.children[index] !== parts.row) list.insertBefore(parts.row, list.children[index] || null);
    });
    if (drag) drag.apply();
  }

  const tick = safe('widget.render', render);

  function start() {
    if (root.isConnected) return;
    doc.body.append(root);
    drag = attachDrag({
      handle: bar,
      element: root,
      win,
      getPos: () => storage.getSetting('widgetPos'),
      setPos: (pos) => storage.setSetting('widgetPos', pos),
    });
    unsubscribe = storage.subscribe(tick);
    interval = clock.setInterval(tick, 1000);
    tick();
  }

  function destroy() {
    if (interval !== null) clock.clearInterval(interval);
    interval = null;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (drag) drag.destroy();
    drag = null;
    root.remove();
  }

  return { start, destroy, render: tick, element: root };
}
