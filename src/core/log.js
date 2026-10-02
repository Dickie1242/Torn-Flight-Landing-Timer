export const PREFIX = '[Landing Timer]';

const warned = new Set();

export function info(...args) {
  console.info(PREFIX, ...args);
}

/**
 * Warn about `key` at most once per page load.
 * @returns {boolean} true if this call actually logged.
 */
export function warnOnce(key, ...args) {
  if (warned.has(key)) return false;
  warned.add(key);
  console.warn(PREFIX, ...args);
  return true;
}

/** Test seam: forget every warnOnce key. */
export function resetWarnOnce() {
  warned.clear();
}

/**
 * Wrap a callback so it can never throw out of an observer, timer or event
 * handler. Failures are reported once per label.
 */
export function safe(label, fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      warnOnce(label, `${label} failed:`, err);
      return undefined;
    }
  };
}
