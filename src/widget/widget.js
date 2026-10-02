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

/**
 * How often the box checks the clock while the page is visible. Four times a
 * second keeps a countdown from skipping or repeating a second however the
 * checks fall against it; nothing is written unless a text actually changed.
 */
export const TICK_MS = 250;

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
 * Writes a text node only when its text changed. That is a characterData
 * record, which the childList observers on Torn's page (ours included) ignore.
 */
function setData(node, text) {
  if (node.data !== text) node.data = text;
}

/** Sets an attribute only when its value changed. */
function setAttr(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/**
 * The floating box of running timers, on every Torn page. It re-checks the
 * clock every TICK_MS while the page is visible, re-renders whenever storage
 * changes (in this tab or another), and catches up when the page is shown
 * again. With no timers it is hidden and touches nothing.
 */
export function createWidget({ doc = globalThis.document, storage, clock = realClock, canPlay = () => true }) {
  const win = doc.defaultView;
  /** @type {Map<string, {row: Element, name: Element, remove: Element, nameText: Text, whereText: Text, timeText: Text}>} */
  const rows = new Map();
  let interval = null;
  let unsubscribe = null;
  let drag = null;
  let rendering = false;
  /** The 🔇 on show is the "click to allow" hint, not the setting. */
  let shownBlocked = false;
  /** The rows and their phases when the box was last placed. */
  let lastShape = '';

  const soundText = doc.createTextNode('');
  const sound = el(doc, 'button', {
    className: `${WIDGET_CLASS}__sound`,
    attrs: { type: 'button', 'aria-label': 'Chime' },
    on: { click: onSoundClick },
  }, [soundText]);
  const bar = el(doc, 'div', { className: `${WIDGET_CLASS}__bar` }, [
    el(doc, 'span', { className: `${WIDGET_CLASS}__title` }, [
      el(doc, 'span', { text: '✈', attrs: { 'aria-hidden': 'true' } }),
      ' Landing timers',
    ]),
    sound,
  ]);
  const list = el(doc, 'div', { className: `${WIDGET_CLASS}__list` });
  const root = el(doc, 'div', { className: WIDGET_CLASS, attrs: { hidden: true } }, [bar, list]);

  function onSoundClick() {
    // The press that came with this click is what lets the tab play sound:
    // a click on the "click to allow" hint is that permission, not a mute.
    if (shownBlocked) {
      forced();
      return;
    }
    storage.setSetting('sound', !storage.getSetting('sound'));
  }

  function buildRow(id) {
    const nameText = doc.createTextNode('');
    const whereText = doc.createTextNode('');
    const timeText = doc.createTextNode('');
    const name = el(doc, 'a', { className: `${ROW_CLASS}__name` }, [nameText]);
    const place = el(doc, 'span', { className: `${ROW_CLASS}__place` }, [whereText]);
    const time = el(doc, 'span', { className: `${ROW_CLASS}__time` }, [timeText]);
    const remove = el(doc, 'button', {
      className: `${ROW_CLASS}__remove`,
      text: '✕',
      attrs: { type: 'button', title: 'Remove timer' },
      on: {
        click: (event) => {
          // A double-click's second click would land on the row that just slid up here.
          if (event.detail > 1) return;
          storage.removeTimer(id);
        },
      },
    });
    const row = el(doc, 'div', { className: ROW_CLASS, attrs: { 'data-id': id } }, [name, place, time, remove]);
    return { row, name, remove, nameText, whereText, timeText };
  }

  function renderSound() {
    const on = !!storage.getSetting('sound');
    const blocked = on && !canPlay();
    shownBlocked = blocked;
    setData(soundText, on && !blocked ? SOUND_ON : SOUND_OFF);
    let title = on ? 'Chime on: click to mute' : 'Chime off: click to turn it on';
    if (blocked) title = SOUND_BLOCKED_TITLE;
    setAttr(sound, 'title', title);
    setAttr(sound, 'aria-pressed', String(on));
  }

  function renderRow(parts, timer, state) {
    setData(parts.nameText, timer.name);
    if (/^\d+$/.test(timer.id)) setAttr(parts.name, 'href', `/profiles.php?XID=${timer.id}`);
    else if (parts.name.hasAttribute('href')) parts.name.removeAttribute('href');
    setData(parts.whereText, placeText(timer));
    setData(parts.timeText, state.text);
    setAttr(parts.row, 'title', rowTitle(timer));
    setAttr(parts.remove, 'aria-label', `Remove timer for ${timer.name}`);
    parts.row.classList.toggle(ROW_DUE_CLASS, state.due);
  }

  /** `force`: place the box even if its rows look the same (storage changed). */
  function render(force) {
    // prune() below notifies subscribers, us included; this render already
    // reads the pruned state.
    if (rendering) return;
    rendering = true;
    try {
      storage.prune();
      const timers = storage.getTimers();
      // The usual case on most pages: nothing to show and nothing shown.
      if (timers.length === 0 && root.hidden && rows.size === 0) return;
      const now = clock.now();
      const hide = timers.length === 0;
      if (root.hidden !== hide) root.hidden = hide;
      renderSound();
      const live = new Set(timers.map((t) => t.id));
      for (const [id, parts] of rows) {
        if (!live.has(id)) {
          parts.row.remove();
          rows.delete(id);
        }
      }
      const shape = [];
      timers.forEach((timer, index) => {
        let parts = rows.get(timer.id);
        if (!parts) {
          parts = buildRow(timer.id);
          rows.set(timer.id, parts);
        }
        renderRow(parts, timer, rowState(timer, now));
        let phase = 2;
        if (now < timer.ringAt) phase = 0;
        else if (now < timer.landingAt) phase = 1;
        shape.push(`${timer.id}:${phase}`);
        // Move a row only when it is out of place, so a hovered row keeps its tooltip.
        if (list.children[index] !== parts.row) list.insertBefore(parts.row, list.children[index] || null);
      });
      const key = `${hide}|${shape.join(',')}`;
      // Placing the box measures it, which forces a layout: only when it changed shape.
      if (drag && (force || key !== lastShape)) drag.apply();
      lastShape = key;
    } finally {
      rendering = false;
    }
  }

  const forced = safe('widget.render', () => render(true));
  const ticked = safe('widget.tick', () => {
    if (!doc.hidden) render(false);
  });

  function start() {
    if (interval !== null) return;
    doc.body.append(root);
    drag = attachDrag({
      handle: bar,
      element: root,
      win,
      getPos: () => storage.getSetting('widgetPos'),
      setPos: (pos) => storage.setSetting('widgetPos', pos),
    });
    unsubscribe = storage.subscribe(forced);
    interval = clock.setInterval(ticked, TICK_MS);
    doc.addEventListener('visibilitychange', forced);
    forced();
  }

  function destroy() {
    if (interval !== null) clock.clearInterval(interval);
    interval = null;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    doc.removeEventListener('visibilitychange', forced);
    if (drag) drag.destroy();
    drag = null;
    root.remove();
  }

  return { start, destroy, render: forced, element: root };
}
