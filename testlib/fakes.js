/**
 * Hand-driven stand-ins for what Landing Timer reads from the browser: time,
 * Web Locks and localStorage. None of them needs jsdom.
 */

export const MIN = 60 * 1000;

/** 2026-10-02 12:00:00 UTC: where every test clock starts. */
export const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

/**
 * A clock with the same shape as src/core/clock.js's realClock that only moves
 * when tick() is called. Timers fire in time order; intervals repeat.
 */
export function fakeClock(start = T0) {
  let current = start;
  let nextId = 1;
  /** @type {Map<number, {at: number, fn: Function, every: number|null}>} */
  const timers = new Map();

  function schedule(fn, ms, every) {
    const id = nextId;
    nextId += 1;
    timers.set(id, { at: current + Math.max(0, ms || 0), fn, every });
    return id;
  }

  return {
    now: () => current,
    setTimeout: (fn, ms) => schedule(fn, ms, null),
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => schedule(fn, ms, Math.max(1, ms || 0)),
    clearInterval: (id) => { timers.delete(id); },
    /** How many timers are waiting. */
    pending: () => timers.size,
    /** Moves time forward by `ms`, running every timer that falls due, earliest first. */
    tick(ms) {
      const end = current + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (due === null || timer.at < due.at)) {
            dueId = id;
            due = timer;
          }
        }
        if (due === null) break;
        current = due.at;
        if (due.every === null) timers.delete(dueId);
        else due.at += due.every;
        due.fn();
      }
      current = end;
    },
  };
}

/** An in-memory localStorage stand-in. Two stores given one area act like two tabs. */
export function memoryArea(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: (key) => { items.delete(key); },
  };
}

/**
 * The slice of the Web Locks API Landing Timer uses: request(name,
 * { ifAvailable: true }, callback). A held name hands `null` to anyone else.
 * Share one between two "tabs" to model the browser's cross-tab locks.
 */
export function fakeLocks() {
  const held = new Set();
  return {
    held,
    async request(name, options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

/** A timer for player 1234567 flying Torn → Canada by airstrip, started at T0 with a 2-minute buffer. */
export function makeTimer(overrides = {}) {
  return {
    id: '1234567',
    name: 'SomeName',
    destination: 'canada',
    plane: 'airstrip',
    direction: 'to',
    minutes: 27,
    startedAt: T0,
    landingAt: T0 + 27 * MIN,
    ringAt: T0 + 25 * MIN,
    rungAt: null,
    ...overrides,
  };
}

/** Lets every pending promise callback run. */
export function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

export function captureConsole(method) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => { calls.push(args); };
  return {
    calls,
    restore() { console[method] = original; },
  };
}
