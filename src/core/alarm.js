import { realClock } from './clock.js';
import { safe, warnOnce } from './log.js';
import { createAudio } from './audio.js';

/**
 * A ring found this long after the estimated landing (computer asleep, browser
 * closed) is marked rung silently: the chime would no longer be any use.
 */
export const LATE_LIMIT_MS = 2 * 60 * 1000;

/**
 * The Web Lock every Torn tab claims rings under. It is one lock for every
 * timer, so claims run one at a time: each storage write saves the whole store,
 * and two tabs marking different timers at the same moment could otherwise undo
 * each other's mark.
 */
export const LOCK_NAME = 'landingtimer:ring';

/**
 * How long the tab that chimed keeps the lock. localStorage reaches other tabs
 * a moment after a write, so holding on makes sure they see `rungAt` before
 * they can claim the same ring.
 */
export const HOLD_MS = 5000;

/** How soon a tab that found the lock busy looks again. */
export const RETRY_MS = 500;

const MAX_DELAY = 2 ** 31 - 1;

/** Inputs that count as a user gesture: the moment a browser lets a page start sound. */
const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend'];

/** Is it too late for this timer's chime to be any use? */
export function isLate(timer, now) {
  return now - timer.landingAt > LATE_LIMIT_MS;
}

/**
 * Rings every timer once, in exactly one tab, at its ring time.
 *
 * - **Scheduling.** Every tab aims one plain setTimeout at each timer that has
 *   not rung, and re-aims only timers that changed. Single timeouts escape
 *   Chrome's intensive throttling of chained timers in hidden tabs. While a
 *   timer is waiting, a 1 s check, focus, visibility changes and storage
 *   changes are the safety net.
 * - **Claiming.** Rings are claimed under one Web Lock and decided against a
 *   fresh read of storage. Every timer that is due rings together, with one
 *   chime.
 * - **Sound.** A timer is only marked rung once this tab has made sound, so a
 *   tab the browser won't let play leaves the ring to a tab that can, or to
 *   the player's next click here.
 */
export function createAlarm({
  storage,
  win = globalThis.window,
  clock = realClock,
  locks = win && win.navigator ? win.navigator.locks : undefined,
  audio = createAudio({ win }),
  holdMs = HOLD_MS,
}) {
  const doc = win ? win.document : null;
  /** Timeouts aimed at each waiting timer's ring: id → { ringAt, handle }. */
  const scheduled = new Map();
  let interval = null;
  let unsubscribe = null;
  let started = false;
  let claiming = false;
  let retryPending = false;
  let locksBroken = false;

  const safePlay = safe('alarm.play', () => audio.play());

  /** Timers that have not rung yet. */
  function waiting() {
    return storage.getTimers().filter((t) => t.rungAt == null);
  }

  /** Inside the lock: rings every timer that is due, with one chime for all of them. */
  async function ringDue() {
    storage.reload();
    const now = clock.now();
    const due = waiting().filter((t) => t.ringAt <= now);
    if (due.length === 0) return;
    // Decided on what is stored now: a mute in another tab a moment ago counts.
    const sound = !!storage.getSetting('sound');
    const audible = [];
    let marked = 0;
    for (const timer of due) {
      if (sound && !isLate(timer, now)) audible.push(timer);
      else if (storage.markRung(timer.id, now)) marked += 1;
    }
    // A tab that cannot make sound leaves an audible ring for one that can.
    if (audible.length > 0 && (await audio.ready())) {
      const rung = audible.filter((timer) => storage.markRung(timer.id, clock.now()));
      if (rung.length > 0) safePlay();
      marked += rung.length;
    }
    // Hold the lock while what this tab marked, silent or not, reaches the others.
    if (marked > 0 && holdMs > 0) await new Promise((resolve) => clock.setTimeout(resolve, holdMs));
  }

  function retrySoon() {
    if (retryPending) return;
    retryPending = true;
    clock.setTimeout(() => {
      retryPending = false;
      tick();
    }, RETRY_MS);
  }

  function claim() {
    if (locks && !locksBroken && typeof locks.request === 'function') {
      return locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (lock) return ringDue();
        // Another tab is ringing, and holds the lock while its write spreads: look again soon.
        retrySoon();
        return undefined;
      });
    }
    return ringDue();
  }

  function check() {
    if (!started || claiming) return;
    const now = clock.now();
    const due = waiting().filter((t) => t.ringAt <= now);
    if (due.length === 0) return;
    const sound = !!storage.getSetting('sound');
    const anySilent = due.some((t) => !sound || isLate(t, now));
    // Only audible rings, and this tab has found it cannot play: wait for a click.
    if (!anySilent && audio.isBlocked()) return;
    claiming = true;
    let attempt;
    try {
      attempt = Promise.resolve(claim());
    } catch (err) {
      attempt = Promise.reject(err);
    }
    attempt
      .catch((err) => {
        warnOnce('alarm.ring', 'could not ring a timer:', err);
        // A lock API that refuses outright (a sandboxed frame, say): ring without it.
        if (err && (err.name === 'SecurityError' || err.name === 'NotSupportedError')) {
          locksBroken = true;
          clock.setTimeout(tick, 0);
        }
      })
      .finally(() => {
        claiming = false;
        // A timer that came due while this tab was busy ringing: look again now,
        // rather than at the next 1 s check, which a hidden tab may run late.
        if (started && !retryPending && waiting().some((t) => t.ringAt <= clock.now())) clock.setTimeout(tick, 0);
      });
  }

  const tick = safe('alarm.check', check);

  function reschedule(timers) {
    const now = clock.now();
    const wanted = new Map(timers.map((t) => [t.id, t.ringAt]));
    for (const [id, entry] of scheduled) {
      if (wanted.get(id) === entry.ringAt) continue;
      clock.clearTimeout(entry.handle);
      scheduled.delete(id);
    }
    for (const [id, ringAt] of wanted) {
      if (scheduled.has(id)) continue;
      const handle = clock.setTimeout(() => {
        scheduled.delete(id);
        tick();
      }, Math.min(MAX_DELAY, Math.max(0, ringAt - now)));
      scheduled.set(id, { ringAt, handle });
    }
  }

  /** The 1 s safety net runs only while some timer is still to ring. */
  function syncInterval(active) {
    if (active && interval === null) {
      interval = clock.setInterval(tick, 1000);
    } else if (!active && interval !== null) {
      clock.clearInterval(interval);
      interval = null;
    }
  }

  const onChange = safe('alarm.reschedule', () => {
    const timers = waiting();
    reschedule(timers);
    syncInterval(timers.length > 0);
    tick();
  });

  // A real click or key press is when a browser lets a page start sound.
  const onGesture = safe('alarm.gesture', () => {
    if (waiting().length === 0) return;
    audio.unlock();
    clock.setTimeout(tick, 0);
  });

  function start() {
    if (started) return;
    started = true;
    unsubscribe = storage.subscribe(onChange);
    if (win) {
      win.addEventListener('focus', tick);
      for (const type of GESTURES) win.addEventListener(type, onGesture, true);
      // Bubbling, so it runs after the click's own handler: a Start click has just added its timer.
      win.addEventListener('click', onGesture);
    }
    if (doc) doc.addEventListener('visibilitychange', tick);
    onChange();
  }

  function destroy() {
    started = false;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    syncInterval(false);
    for (const { handle } of scheduled.values()) clock.clearTimeout(handle);
    scheduled.clear();
    if (win) {
      win.removeEventListener('focus', tick);
      for (const type of GESTURES) win.removeEventListener(type, onGesture, true);
      win.removeEventListener('click', onGesture);
    }
    if (doc) doc.removeEventListener('visibilitychange', tick);
  }

  return { start, destroy, check: tick };
}
