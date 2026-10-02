import { warnOnce } from './log.js';
import { realClock } from './clock.js';
import { isDestination, isPlane } from './flights.js';

export const STORAGE_KEY = 'landingtimer.v1';
export const STORAGE_VERSION = 1;

/** A timer clears itself this long after its estimated landing. */
export const EXPIRE_AFTER_MS = 60 * 60 * 1000;

/** How many whole minutes before the estimated landing a timer rings. */
export const BUFFER = Object.freeze({ default: 2, min: 0, max: 30 });

export const DEFAULT_SETTINGS = Object.freeze({
  bufferMin: BUFFER.default,
  /** Chime when a timer comes due. Shared by every tab. */
  sound: true,
  /** Where the timer box was dragged to, or null for its default corner. */
  widgetPos: null,
});

/**
 * @typedef {{
 *   id: string, name: string, destination: string, plane: string,
 *   direction: 'to'|'from'|null, minutes: number,
 *   startedAt: number, landingAt: number, ringAt: number, rungAt: number|null,
 * }} Timer
 */

export function sanitizeBuffer(value) {
  if (!Number.isFinite(value)) return BUFFER.default;
  return Math.min(BUFFER.max, Math.max(BUFFER.min, Math.round(value)));
}

function sanitizePos(raw) {
  return raw && typeof raw === 'object' && Number.isFinite(raw.x) && Number.isFinite(raw.y)
    ? { x: Math.round(raw.x), y: Math.round(raw.y) }
    : null;
}

function sanitizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    bufferMin: sanitizeBuffer(source.bufferMin),
    sound: typeof source.sound === 'boolean' ? source.sound : DEFAULT_SETTINGS.sound,
    widgetPos: sanitizePos(source.widgetPos),
  };
}

const isTime = (value) => Number.isFinite(value) && value > 0;

/** @returns {Timer|null} a clean copy, or null when the record is unusable. */
export function sanitizeTimer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || !isDestination(raw.destination) || !isPlane(raw.plane)) return null;
  if (!(Number.isFinite(raw.minutes) && raw.minutes > 0)) return null;
  if (!isTime(raw.startedAt) || !isTime(raw.landingAt) || !isTime(raw.ringAt)) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `#${id}`;
  return {
    id,
    name,
    destination: raw.destination,
    plane: raw.plane,
    direction: raw.direction === 'to' || raw.direction === 'from' ? raw.direction : null,
    minutes: raw.minutes,
    startedAt: raw.startedAt,
    landingAt: raw.landingAt,
    ringAt: raw.ringAt,
    rungAt: isTime(raw.rungAt) ? raw.rungAt : null,
  };
}

function emptyState() {
  return { version: STORAGE_VERSION, timers: [], settings: sanitizeSettings(null) };
}

function parseState(text) {
  if (text == null) return emptyState();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    warnOnce('storage.read', 'stored timers are not valid JSON; starting fresh');
    return emptyState();
  }
  if (!data || typeof data !== 'object' || data.version !== STORAGE_VERSION) {
    warnOnce('storage.read', `stored timers have version ${data && data.version}, expected ${STORAGE_VERSION}; starting fresh`);
    return emptyState();
  }
  const byId = new Map();
  for (const raw of Array.isArray(data.timers) ? data.timers : []) {
    const timer = sanitizeTimer(raw);
    if (timer) byId.set(timer.id, timer);
  }
  return { version: STORAGE_VERSION, timers: [...byId.values()], settings: sanitizeSettings(data.settings) };
}

/**
 * Timers and settings in one localStorage key, shared live with the player's
 * other Torn tabs through the `storage` event.
 */
export function createStorage({ area = globalThis.localStorage, target = globalThis.window, clock = realClock } = {}) {
  let state = emptyState();
  const listeners = new Set();

  function read() {
    try {
      state = parseState(area ? area.getItem(STORAGE_KEY) : null);
    } catch (err) {
      warnOnce('storage.read', 'could not read stored timers; starting fresh:', err);
      state = emptyState();
    }
  }

  function write() {
    try {
      if (area) area.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // Quota errors repeat on every write; warn once and keep the in-memory state.
      warnOnce('storage.write', 'could not save timers:', err);
    }
  }

  function notify() {
    for (const listener of [...listeners]) {
      // A bad subscriber must never break the rest, and must not spam the console.
      try {
        listener();
      } catch (err) {
        warnOnce('storage.subscriber', 'a storage subscriber threw:', err);
      }
    }
  }

  function commit() {
    write();
    notify();
  }

  const live = (timer) => clock.now() - timer.landingAt < EXPIRE_AFTER_MS;

  /** Every timer that has not expired, soonest ring first. @returns {Timer[]} */
  function getTimers() {
    return state.timers.filter(live).sort((a, b) => a.ringAt - b.ringAt).map((t) => ({ ...t }));
  }

  /** @returns {Timer|null} */
  function getTimer(id) {
    const timer = state.timers.find((t) => t.id === id);
    return timer && live(timer) ? { ...timer } : null;
  }

  /** Stores a timer, replacing any timer for the same player. @returns {Timer|null} */
  function addTimer(raw) {
    const timer = sanitizeTimer(raw);
    if (!timer) return null;
    state.timers = state.timers.filter((t) => t.id !== timer.id).concat(timer);
    commit();
    return { ...timer };
  }

  /** @returns {boolean} whether a timer was removed. */
  function removeTimer(id) {
    const next = state.timers.filter((t) => t.id !== id);
    if (next.length === state.timers.length) return false;
    state.timers = next;
    commit();
    return true;
  }

  /** Records that a timer rang. @returns {boolean} false if it had already rung or is gone. */
  function markRung(id, at) {
    const timer = state.timers.find((t) => t.id === id);
    if (!timer || timer.rungAt != null) return false;
    timer.rungAt = at;
    commit();
    return true;
  }

  /** Drops expired timers from storage. @returns {number} how many went. */
  function prune() {
    const next = state.timers.filter(live);
    const gone = state.timers.length - next.length;
    if (gone) {
      state.timers = next;
      commit();
    }
    return gone;
  }

  /** @returns {*} the stored value, or undefined for a name that is not a setting. */
  function getSetting(name) {
    const value = state.settings[name];
    return value && typeof value === 'object' ? { ...value } : value;
  }

  /** Sanitises and stores `value`; unknown names are dropped. @returns the stored value. */
  function setSetting(name, value) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, name)) return undefined;
    const next = sanitizeSettings({ ...state.settings, [name]: value });
    if (JSON.stringify(next[name]) !== JSON.stringify(state.settings[name])) {
      state.settings = next;
      commit();
    }
    return getSetting(name);
  }

  /** Re-reads storage, for when another tab may have written a moment ago. */
  function reload() {
    read();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const onStorage = (event) => {
    const key = event && event.key;
    if (key != null && key !== STORAGE_KEY) return;
    read();
    notify();
  };

  function destroy() {
    if (target && typeof target.removeEventListener === 'function') {
      target.removeEventListener('storage', onStorage);
    }
    listeners.clear();
  }

  read();
  if (target && typeof target.addEventListener === 'function') {
    target.addEventListener('storage', onStorage);
  }

  return {
    getTimers, getTimer, addTimer, removeTimer, markRung, prune,
    getSetting, setSetting, reload, subscribe, destroy,
  };
}
