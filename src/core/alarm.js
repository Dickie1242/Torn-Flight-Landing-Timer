import { realClock } from './clock.js';
import { info, safe, warnOnce } from './log.js';
import { createAudio } from './audio.js';

/**
 * A chime found this long after the estimated landing (computer asleep,
 * browser closed) is marked rung silently: it would no longer be any use.
 */
export const LATE_LIMIT_MS = 2 * 60 * 1000;

/**
 * The Web Lock every Torn tab claims chimes under. It is one lock for every
 * timer, so claims run one at a time: each storage write saves the whole store,
 * and two tabs marking different timers at the same moment could otherwise undo
 * each other's mark.
 */
export const LOCK_NAME = 'landingtimer:ring';

/**
 * How long the tab that chimed keeps the lock. localStorage reaches other tabs
 * a moment after a write, so holding on makes sure they see the mark before
 * they can claim the same chime.
 */
export const HOLD_MS = 5000;

/** How soon a tab that found the lock busy looks again. */
export const RETRY_MS = 500;

const MAX_DELAY = 2 ** 31 - 1;

/** Inputs that count as a user gesture: the moment a browser lets a page start sound. */
const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend'];

/**
 * The two chimes every timer has: the warning, `ringAt` (the buffer before the
 * estimated landing), and the landing itself, `landingAt`. Each has its own
 * mark in storage and its own sound (see audio.js's CHIMES).
 */
const EVENTS = [
  { kind: 'ring', at: (t) => t.ringAt, done: (t) => t.rungAt != null, mark: (s, id, at) => s.markRung(id, at) },
  { kind: 'land', at: (t) => t.landingAt, done: (t) => t.landRungAt != null, mark: (s, id, at) => s.markLanded(id, at) },
];

/** Is it too late for this timer's chimes to be any use? */
export function isLate(timer, now) {
  return now - timer.landingAt > LATE_LIMIT_MS;
}

/** Every chime still to play, as { timer, event }, or only those due by `now`. */
function pendingChimes(timers, now = Infinity) {
  const chimes = [];
  for (const timer of timers) {
    for (const event of EVENTS) {
      if (!event.done(timer) && event.at(timer) <= now) chimes.push({ timer, event });
    }
  }
  return chimes;
}

/**
 * Plays each timer's two chimes once, in exactly one tab, at their times.
 *
 * - **Scheduling.** Every tab aims one plain setTimeout at each chime still to
 *   play, and re-aims only chimes that changed. Single timeouts escape Chrome's
 *   intensive throttling of chained timers in hidden tabs. While a chime is
 *   waiting, a 1 s check, focus, visibility changes and storage changes are the
 *   safety net.
 * - **Claiming.** Chimes are claimed under one Web Lock and decided against a
 *   fresh read of storage. Everything due plays together, as one chime: the
 *   landing chime if anyone is landing, else the warning.
 * - **Sound.** A chime is only marked once this tab has made sound, so a tab the
 *   browser won't let play leaves it to a tab that can, or to the player's next
 *   click here.
 * - **Console.** Each decision is noted once in the console, so a missed chime
 *   can be explained afterwards.
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
  /** Timeouts aimed at each waiting chime: `${id}:${kind}` → { at, handle }. */
  const scheduled = new Map();
  let interval = null;
  let unsubscribe = null;
  let started = false;
  let claiming = false;
  let retryPending = false;
  let locksBroken = false;
  /** Whether this page has checked yet if it may play sound. */
  let probed = false;
  /** Console notes already made on this page, so each is said once. */
  const told = new Set();

  function tellOnce(key, message) {
    if (told.has(key)) return;
    told.add(key);
    info(message);
  }

  const names = (chimes) => [...new Set(chimes.map((c) => c.timer.name))].join(', ');

  const safePlay = safe('alarm.play', (kind) => audio.play(kind));

  function pending(now) {
    return pendingChimes(storage.getTimers(), now);
  }

  /** Inside the lock: plays every chime that is due, as one sound. */
  async function ringDue() {
    storage.reload();
    const now = clock.now();
    const due = pending(now);
    if (due.length === 0) return;
    // Decided on what is stored now: a mute in another tab a moment ago counts.
    const sound = !!storage.getSetting('sound');
    const audible = [];
    const silent = [];
    for (const chime of due) {
      if (sound && !isLate(chime.timer, now)) audible.push(chime);
      else if (chime.event.mark(storage, chime.timer.id, now)) silent.push(chime);
    }
    if (silent.length > 0) {
      info(`marked without a sound (${sound ? 'too long after landing' : 'chime is off'}): ${names(silent)}`);
    }
    let rung = [];
    if (audible.length > 0) {
      if (await audio.ready()) {
        rung = audible.filter((chime) => chime.event.mark(storage, chime.timer.id, clock.now()));
        if (rung.length > 0) {
          const landing = rung.some((chime) => chime.event.kind === 'land');
          safePlay(landing ? 'land' : 'ring');
          info(`chimed (${landing ? 'landing' : 'landing soon'}): ${names(rung)}`);
        }
      } else {
        // A tab that cannot make sound leaves the chime for one that can.
        tellOnce('blocked', 'a chime is due, but the browser has not let this page play sound yet: click anywhere on this page');
      }
    }
    // Hold the lock while what this tab marked, silent or not, reaches the others.
    if (silent.length + rung.length > 0 && holdMs > 0) {
      await new Promise((resolve) => clock.setTimeout(resolve, holdMs));
    }
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
        // Another tab is chiming, and holds the lock while its write spreads: look again soon.
        retrySoon();
        return undefined;
      });
    }
    return ringDue();
  }

  function check() {
    if (!started || claiming) return;
    const now = clock.now();
    const due = pending(now);
    if (due.length === 0) return;
    const sound = !!storage.getSetting('sound');
    const anySilent = due.some((chime) => !sound || isLate(chime.timer, now));
    // Only audible chimes, and this tab has found it cannot play: wait for a click.
    if (!anySilent && audio.isBlocked()) {
      tellOnce('blocked', 'a chime is due, but the browser has not let this page play sound yet: click anywhere on this page');
      return;
    }
    claiming = true;
    let failed = false;
    let attempt;
    try {
      attempt = Promise.resolve(claim());
    } catch (err) {
      attempt = Promise.reject(err);
    }
    attempt
      .catch((err) => {
        failed = true;
        warnOnce('alarm.ring', 'could not ring a timer:', err);
        // A lock API that refuses outright (a sandboxed frame, say): ring without it.
        if (err && (err.name === 'SecurityError' || err.name === 'NotSupportedError')) {
          locksBroken = true;
          clock.setTimeout(tick, 0);
        }
      })
      .finally(() => {
        claiming = false;
        // A chime that came due while this tab was busy chiming: look again now,
        // rather than at the next 1 s check, which a hidden tab may run late.
        // Not after a failure, though: that would retry in a tight loop.
        if (!failed && started && !retryPending && pending(clock.now()).length > 0) {
          clock.setTimeout(tick, 0);
        }
      });
  }

  const tick = safe('alarm.check', check);

  function reschedule(chimes) {
    const now = clock.now();
    const wanted = new Map(chimes.map((c) => [`${c.timer.id}:${c.event.kind}`, c.event.at(c.timer)]));
    for (const [key, entry] of scheduled) {
      if (wanted.get(key) === entry.at) continue;
      clock.clearTimeout(entry.handle);
      scheduled.delete(key);
    }
    for (const [key, at] of wanted) {
      if (scheduled.has(key)) continue;
      const handle = clock.setTimeout(() => {
        scheduled.delete(key);
        tick();
      }, Math.min(MAX_DELAY, Math.max(0, at - now)));
      scheduled.set(key, { at, handle });
    }
  }

  /** The 1 s safety net runs only while some chime is still to play. */
  function syncInterval(active) {
    if (active && interval === null) {
      interval = clock.setInterval(tick, 1000);
    } else if (!active && interval !== null) {
      clock.clearInterval(interval);
      interval = null;
    }
  }

  const onChange = safe('alarm.reschedule', () => {
    const chimes = pending();
    reschedule(chimes);
    syncInterval(chimes.length > 0);
    // With a chime waiting, find out once whether this tab can play, so the
    // "click to allow" hint shows long before the chime rather than at it.
    if (chimes.length > 0 && !probed && storage.getSetting('sound')) {
      probed = true;
      Promise.resolve(audio.ready()).catch(() => {});
    }
    tick();
  });

  // A real click or key press is when a browser lets a page start sound.
  const onGesture = safe('alarm.gesture', () => {
    // With the chime off there is no sound to start.
    if (!storage.getSetting('sound')) return;
    if (audio.isBlocked()) told.delete('blocked');
    if (pending().length === 0) {
      // Nothing to play, but a tab found blocked earlier must not keep its
      // "click to allow" hint: the click is the permission, chime or not.
      if (audio.isBlocked()) audio.unlock();
      return;
    }
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
