/**
 * The real clock. Modules that care about time take a `clock` with this
 * shape, so tests can hand them testlib/fakes.js's fakeClock and drive time
 * by hand.
 */
export const realClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle),
});
