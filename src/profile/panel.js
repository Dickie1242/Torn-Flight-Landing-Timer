import { el } from '../core/dom.js';
import { realClock } from '../core/clock.js';
import { safe } from '../core/log.js';
import {
  DESTINATIONS, PLANES, PROFILE_PLANES, destinationName, minutesFor, varianceMinutes,
} from '../core/flights.js';
import { sanitizeBuffer, BUFFER } from '../core/storage.js';
import { formatClock, formatMinutes } from '../core/time.js';

export const PANEL_CLASS = 'landingtimer-panel';
/** On the variance line when a flight can be off by more than the buffer. */
export const VARIANCE_WARN_CLASS = `${PANEL_CLASS}__variance--warn`;

const MINUTE = 60 * 1000;
/** How often an open panel refreshes its "Rings in … (HH:MM)" line. */
const REFRESH_MS = 15 * 1000;
/** Space kept between the panel and the window's edge, px. */
const EDGE = 8;
/** Space between the panel and its button, px. */
const OFFSET = 6;

/** Writes text only when it changed, so a live region is not re-announced. */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

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

/** What the profile showed about the plane, or null for nothing or an unknown word. */
function seenPlane(status) {
  return status.plane && Object.hasOwn(PROFILE_PLANES, status.plane) ? PROFILE_PLANES[status.plane] : null;
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
    const seen = seenPlane(status);
    return `${describeRoute(status.direction, place)} · plane on profile: ${seen ? seen.label : 'not shown'}`;
  }
  if (status.state === 'abroad' && place) return `In ${place}. Not flying yet: the timer starts when you press Start.`;
  return 'Not flying right now: the timer starts when you press Start.';
}

/** The note beside a plane: which one the profile showed, and Business's look-alike. */
function planeTag(status, planeKey) {
  const seen = seenPlane(status);
  if (!seen) return '';
  if (planeKey === seen.pick) return '← from profile';
  if (status.plane === 'commercial' && planeKey === 'business') return '← also Commercial';
  return '';
}

/**
 * Where the panel goes: under its button, or above it when there is no room
 * below. It stays inside the window while its button is on screen, and
 * follows the button when the page scrolls it away.
 */
export function panelPosition(anchorRect, size, view) {
  const left = Math.min(Math.max(EDGE, anchorRect.left), Math.max(EDGE, view.width - size.width - EDGE));
  let top = anchorRect.bottom + OFFSET;
  if (top + size.height > view.height - EDGE) top = Math.max(EDGE, anchorRect.top - OFFSET - size.height);
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * The popover a profile's Landing timer button opens. open(anchor, status)
 * shows it by `anchor`, filled in from a ProfileStatus; Start stores the timer
 * and closes it.
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

  function readBuffer() {
    const raw = parts.buffer.value.trim();
    // An empty box means "as before": the last value used, not the default.
    return raw === '' ? storage.getSetting('bufferMin') : sanitizeBuffer(Number(raw));
  }

  function chosen() {
    const radio = parts.radios.find((r) => r.checked);
    return {
      destination: parts.select.value || null,
      plane: radio ? radio.value : null,
      bufferMin: readBuffer(),
    };
  }

  function update() {
    if (!parts) return;
    const { destination, plane, bufferMin } = chosen();
    for (const p of PLANES) {
      const minutes = minutesFor(destination, p.key);
      setText(parts.minutes[p.key], minutes == null ? '–' : formatMinutes(minutes));
    }
    const now = clock.now();
    const plan = planTimer({ destination, plane, bufferMin, now });
    parts.start.disabled = !plan;
    if (!plan) {
      setText(parts.summary, 'Pick a destination and a plane.');
      setText(parts.variance, '');
      parts.variance.classList.remove(VARIANCE_WARN_CLASS);
      position();
      return;
    }
    const wait = plan.ringAt - now;
    setText(parts.summary, wait > 0
      ? `Rings in ${formatMinutes(wait / MINUTE)} (${formatClock(plan.ringAt)})`
      : `Rings now (${formatClock(plan.ringAt)})`);
    const spread = varianceMinutes(plan.minutes);
    const beyondBuffer = spread > bufferMin;
    setText(parts.variance, `Flights vary up to ~3% (${spread < 1 ? 'under 1 min' : `about ${spread} min`} on this one)`
      + (beyondBuffer ? ': more than your buffer' : ''));
    parts.variance.classList.toggle(VARIANCE_WARN_CLASS, beyondBuffer);
    position();
  }

  /** The player changed something: an old save error no longer applies. */
  function edited() {
    if (!parts) return;
    parts.error.textContent = '';
    update();
  }

  /** Once the player leaves the box, show the buffer that is actually used. */
  function tidyBuffer() {
    if (!parts) return;
    parts.buffer.value = String(readBuffer());
    update();
  }

  function startTimer() {
    if (!parts) return;
    const { destination, plane, bufferMin } = chosen();
    const plan = planTimer({ destination, plane, bufferMin, now: clock.now() });
    if (!plan) return;
    const timer = storage.addTimer({
      // Storage refuses ids over 80 characters; Torn names are far shorter, but a misread one must not be.
      id: status.id || `name:${(status.name || 'unknown').slice(0, 64)}`,
      name: status.name || (status.id ? `#${status.id}` : 'Unknown player'),
      destination,
      plane,
      // From abroad the only flight there is goes home.
      direction: status.direction || (status.state === 'abroad' ? 'from' : null),
      ...plan,
      rungAt: null,
    });
    // Never lose a timer quietly: stay open so the player knows.
    if (!timer) {
      parts.error.textContent = 'Could not save this timer.';
      return;
    }
    storage.setSetting('bufferMin', bufferMin);
    if (!storage.saved()) {
      parts.error.textContent = 'Running on this page only: the browser would not save it '
        + '(its storage for torn.com may be full), so it will not survive leaving or reloading the page.';
      return;
    }
    close();
  }

  function build() {
    const seen = seenPlane(status);
    const pick = seen ? seen.pick : null;
    const select = el(doc, 'select', { attrs: { name: 'destination' }, on: { change: edited } }, [
      el(doc, 'option', { text: 'Pick a country', attrs: { value: '' } }),
      ...DESTINATIONS.map((d) => el(doc, 'option', { text: d.name, attrs: { value: d.key } })),
    ]);
    select.value = status.destination || '';

    const radios = [];
    const minutes = {};
    const planeRows = PLANES.map((plane) => {
      const radio = el(doc, 'input', {
        attrs: { type: 'radio', name: 'landingtimer-plane', value: plane.key },
        on: { change: edited },
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
      on: { input: edited, change: tidyBuffer },
    });
    buffer.value = String(storage.getSetting('bufferMin'));

    const summary = el(doc, 'div', { className: `${PANEL_CLASS}__summary`, attrs: { 'aria-live': 'polite' } });
    const error = el(doc, 'div', { className: `${PANEL_CLASS}__error`, attrs: { role: 'alert' } });
    const variance = el(doc, 'div', { className: `${PANEL_CLASS}__variance` });
    const start = el(doc, 'button', { text: 'Start', attrs: { type: 'button', 'data-action': 'start' }, on: { click: startTimer } });
    const cancel = el(doc, 'button', { text: 'Cancel', attrs: { type: 'button', 'data-action': 'cancel' }, on: { click: () => close() } });

    parts = { select, radios, minutes, buffer, summary, error, variance, start };

    return el(doc, 'div', { className: PANEL_CLASS, attrs: { role: 'dialog', 'aria-label': 'Landing timer' } }, [
      el(doc, 'div', { className: `${PANEL_CLASS}__title` }, [
        'Landing timer: ',
        el(doc, 'b', { text: status.name || 'Unknown player' }),
        status.id ? ` [${status.id}]` : '',
      ]),
      el(doc, 'div', { className: `${PANEL_CLASS}__status`, text: describeStatus(status) }),
      el(doc, 'label', { className: `${PANEL_CLASS}__row` }, ['Destination ', select]),
      el(doc, 'div', { className: `${PANEL_CLASS}__planes`, attrs: { role: 'radiogroup', 'aria-label': 'Plane' } }, planeRows),
      el(doc, 'label', { className: `${PANEL_CLASS}__row` }, ['Ring ', buffer, ' min early']),
      summary,
      error,
      variance,
      el(doc, 'div', { className: `${PANEL_CLASS}__actions` }, [cancel, start]),
    ]);
  }

  function viewport() {
    const html = doc.documentElement;
    // clientWidth leaves out the page's scrollbar; innerWidth does not.
    return {
      width: (html && html.clientWidth) || win.innerWidth,
      height: (html && html.clientHeight) || win.innerHeight,
    };
  }

  function position() {
    if (!root || !anchor.isConnected) return;
    const size = { width: root.offsetWidth || 320, height: root.offsetHeight || 0 };
    const { left, top } = panelPosition(anchor.getBoundingClientRect(), size, viewport());
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  /** Puts the keyboard on the first thing the player still has to do. */
  function focusFirst() {
    if (!parts.select.value) parts.select.focus();
    else if (!parts.radios.some((r) => r.checked)) parts.radios[0].focus();
    else parts.start.focus();
  }

  /**
   * Closes the panel. The keyboard goes back to the button when it was in the
   * panel, unless the player pressed somewhere else: they are moving on.
   */
  function close({ restoreFocus = true } = {}) {
    const returnFocus = restoreFocus && root && anchor && root.contains(doc.activeElement) ? anchor : null;
    for (const off of cleanup) off();
    cleanup = [];
    if (root) root.remove();
    root = null;
    parts = null;
    anchor = null;
    status = null;
    if (returnFocus) returnFocus.focus({ preventScroll: true });
  }

  function open(anchorElement, profileStatus) {
    close();
    anchor = anchorElement;
    status = profileStatus;
    root = build();
    doc.body.append(root);
    update();
    focusFirst();
    listen(doc, 'keydown', (event) => {
      if (event.key === 'Escape') close();
    }, true);
    listen(doc, 'pointerdown', (event) => {
      if (root && !root.contains(event.target) && !anchor.contains(event.target)) close({ restoreFocus: false });
    }, true);
    listen(win, 'resize', position);
    listen(doc, 'scroll', position, true);
    // Keep "Rings in … (HH:MM)" true while the panel sits open.
    const refresh = clock.setInterval(safe('panel.refresh', update), REFRESH_MS);
    cleanup.push(() => clock.clearInterval(refresh));
  }

  return {
    open,
    close,
    isOpen: () => root !== null,
    get element() { return root; },
  };
}
