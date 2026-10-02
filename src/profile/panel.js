import { el } from '../core/dom.js';
import { realClock } from '../core/clock.js';
import {
  DESTINATIONS, PLANES, PROFILE_PLANES, destinationName, minutesFor, varianceMinutes,
} from '../core/flights.js';
import { BUFFER, sanitizeBuffer } from '../core/storage.js';
import { formatClock, formatMinutes } from '../core/time.js';

export const PANEL_CLASS = 'landingtimer-panel';

const MINUTE = 60 * 1000;

/**
 * The timer a Start press would create, or null until a destination and a
 * plane are chosen. It rings `bufferMin` minutes before the estimated landing,
 * but never before now.
 */
export function planTimer({ destination, plane, bufferMin, now }) {
  const minutes = minutesFor(destination, plane);
  if (minutes == null) return null;
  const landingAt = now + minutes * MINUTE;
  const ringAt = Math.max(now, landingAt - sanitizeBuffer(bufferMin) * MINUTE);
  return { minutes, startedAt: now, landingAt, ringAt };
}

/**
 * The route as the profile gave it. The reader leaves the direction blank when
 * the page is unclear, and the panel must not guess one back in; a flight takes
 * as long either way.
 */
function describeRoute(direction, place) {
  if (direction === 'to') return `Torn → ${place || '?'}`;
  if (direction === 'from') return `${place || '?'} → Torn`;
  return place ? `Flying to or from ${place}` : 'Flying, destination unclear';
}

/** The panel's one-line reading of the profile. */
export function describeStatus(status) {
  const place = destinationName(status.destination);
  if (status.state === 'hidden') return 'Travelling disguised: pick the destination and plane.';
  if (status.state === 'traveling') {
    const plane = status.plane ? PROFILE_PLANES[status.plane].label : 'not shown';
    return `${describeRoute(status.direction, place)} · plane on profile: ${plane}`;
  }
  if (status.state === 'abroad' && place) return `In ${place}. Not flying yet: the timer starts when you press Start.`;
  return 'Not flying right now: the timer starts when you press Start.';
}

/** The note beside a plane: which one the profile showed, and Business's look-alike. */
function planeTag(status, planeKey) {
  if (!status.plane) return '';
  if (planeKey === PROFILE_PLANES[status.plane].pick) return '← from profile';
  if (status.plane === 'commercial' && planeKey === 'business') return '← also Commercial';
  return '';
}

/**
 * The popover a profile's Landing timer button opens. open(anchor, status)
 * shows it under `anchor`, filled in from a ProfileStatus; Start stores the
 * timer and closes it.
 */
export function createPanel({ doc = globalThis.document, storage, clock = realClock }) {
  const win = doc.defaultView;
  let root = null;
  let parts = null;
  let anchor = null;
  let status = null;
  let cleanup = [];

  function listen(target, type, listener, capture = false) {
    target.addEventListener(type, listener, capture);
    cleanup.push(() => target.removeEventListener(type, listener, capture));
  }

  function chosen() {
    const radio = parts.radios.find((r) => r.checked);
    const raw = parts.buffer.value.trim();
    return {
      destination: parts.select.value || null,
      plane: radio ? radio.value : null,
      bufferMin: raw === '' ? BUFFER.default : sanitizeBuffer(Number(raw)),
    };
  }

  function update() {
    if (!parts) return;
    const { destination, plane, bufferMin } = chosen();
    for (const p of PLANES) {
      const minutes = minutesFor(destination, p.key);
      parts.minutes[p.key].textContent = minutes == null ? '–' : formatMinutes(minutes);
    }
    const now = clock.now();
    const plan = planTimer({ destination, plane, bufferMin, now });
    parts.start.disabled = !plan;
    if (!plan) {
      parts.summary.textContent = 'Pick a destination and a plane.';
      parts.variance.textContent = '';
      return;
    }
    const wait = plan.ringAt - now;
    parts.summary.textContent = wait > 0
      ? `Rings in ${formatMinutes(wait / MINUTE)} (${formatClock(plan.ringAt)})`
      : `Rings now (${formatClock(plan.ringAt)})`;
    const spread = varianceMinutes(plan.minutes);
    parts.variance.textContent = `Flights vary up to ~3% (${spread < 1 ? 'under 1 min' : `about ${spread} min`} on this one)`;
  }

  function startTimer() {
    const { destination, plane, bufferMin } = chosen();
    const plan = planTimer({ destination, plane, bufferMin, now: clock.now() });
    if (!plan) return;
    storage.addTimer({
      // Storage refuses ids over 80 characters; Torn names are far shorter, but a misread one must not be.
      id: status.id || `name:${(status.name || 'unknown').slice(0, 64)}`,
      name: status.name || (status.id ? `#${status.id}` : 'Unknown player'),
      destination,
      plane,
      direction: status.direction,
      ...plan,
      rungAt: null,
    });
    storage.setSetting('bufferMin', bufferMin);
    close();
  }

  function build() {
    const pick = status.plane ? PROFILE_PLANES[status.plane].pick : null;
    const select = el(doc, 'select', { attrs: { name: 'destination' }, on: { change: update } }, [
      el(doc, 'option', { text: 'Pick a country', attrs: { value: '' } }),
      ...DESTINATIONS.map((d) => el(doc, 'option', { text: d.name, attrs: { value: d.key } })),
    ]);
    select.value = status.destination || '';

    const radios = [];
    const minutes = {};
    const planeRows = PLANES.map((plane) => {
      const radio = el(doc, 'input', {
        attrs: { type: 'radio', name: 'landingtimer-plane', value: plane.key },
        on: { change: update },
      });
      radio.checked = plane.key === pick;
      radios.push(radio);
      minutes[plane.key] = el(doc, 'span', { className: `${PANEL_CLASS}__minutes` });
      return el(doc, 'label', { className: `${PANEL_CLASS}__plane`, attrs: { 'data-plane': plane.key } }, [
        radio,
        el(doc, 'span', { className: `${PANEL_CLASS}__plane-name`, text: plane.label }),
        minutes[plane.key],
        el(doc, 'span', { className: `${PANEL_CLASS}__tag`, text: planeTag(status, plane.key) }),
      ]);
    });

    const buffer = el(doc, 'input', {
      attrs: { type: 'number', name: 'buffer', min: BUFFER.min, max: BUFFER.max, step: 1 },
      on: { input: update },
    });
    buffer.value = String(storage.getSetting('bufferMin'));

    const summary = el(doc, 'div', { className: `${PANEL_CLASS}__summary` });
    const variance = el(doc, 'div', { className: `${PANEL_CLASS}__variance` });
    const start = el(doc, 'button', { text: 'Start', attrs: { type: 'button', 'data-action': 'start' }, on: { click: startTimer } });
    const cancel = el(doc, 'button', { text: 'Cancel', attrs: { type: 'button', 'data-action': 'cancel' }, on: { click: () => close() } });

    parts = { select, radios, minutes, buffer, summary, variance, start };

    return el(doc, 'div', { className: PANEL_CLASS, attrs: { role: 'dialog', 'aria-label': 'Landing timer' } }, [
      el(doc, 'div', { className: `${PANEL_CLASS}__title` }, [
        'Landing timer: ',
        el(doc, 'b', { text: status.name || 'Unknown player' }),
        status.id ? ` [${status.id}]` : '',
      ]),
      el(doc, 'div', { className: `${PANEL_CLASS}__status`, text: describeStatus(status) }),
      el(doc, 'label', { className: `${PANEL_CLASS}__row` }, ['Destination ', select]),
      el(doc, 'div', { className: `${PANEL_CLASS}__planes` }, planeRows),
      el(doc, 'label', { className: `${PANEL_CLASS}__row` }, ['Ring ', buffer, ' min early']),
      summary,
      variance,
      el(doc, 'div', { className: `${PANEL_CLASS}__actions` }, [cancel, start]),
    ]);
  }

  /** Under the anchor, kept inside the window horizontally. */
  function position() {
    const rect = anchor.getBoundingClientRect();
    const width = root.offsetWidth || 320;
    const maxLeft = Math.max(8, (win ? win.innerWidth : 1024) - width - 8);
    root.style.left = `${Math.round(Math.min(Math.max(8, rect.left), maxLeft))}px`;
    root.style.top = `${Math.round(rect.bottom + 6)}px`;
  }

  function close() {
    for (const off of cleanup) off();
    cleanup = [];
    if (root) root.remove();
    root = null;
    parts = null;
    anchor = null;
    status = null;
  }

  function open(anchorElement, profileStatus) {
    close();
    anchor = anchorElement;
    status = profileStatus;
    root = build();
    doc.body.append(root);
    position();
    update();
    listen(doc, 'keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    listen(doc, 'pointerdown', (event) => {
      if (root && !root.contains(event.target) && !anchor.contains(event.target)) close();
    }, true);
  }

  return {
    open,
    close,
    isOpen: () => root !== null,
    get element() { return root; },
  };
}
