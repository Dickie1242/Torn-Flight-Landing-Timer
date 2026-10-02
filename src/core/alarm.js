import { realClock } from './clock.js';
import { safe, warnOnce } from './log.js';

/** A timer found this long past its ring time (computer asleep, browser closed) rings silently. */
export const LATE_LIMIT_MS = 2 * 60 * 1000;

/**
 * The Web Lock every Torn tab claims a ring under. It is one lock for every
 * timer, so claims run one at a time: each storage write saves the whole store,
 * and two tabs marking different timers at the same moment could otherwise undo
 * each other's mark.
 */
export const LOCK_NAME = 'landingtimer:ring';

/**
 * How long the tab that rang keeps the lock. localStorage reaches other tabs a
 * moment after a write, so holding on makes sure they see `rungAt` before they
 * can claim the same ring.
 */
export const HOLD_MS = 5000;

const MAX_DELAY = 2 ** 31 - 1;

/** Can this tab play sound? Browsers allow it once the player has clicked in the tab. */
export function defaultCanPlay(nav = globalThis.navigator) {
  const activation = nav && nav.userActivation;
  return activation ? !!activation.hasBeenActive : true;
}

let audio = null;

/** Three short beeps, synthesised with Web Audio: no sound file, so no request. */
export function playChime(win = globalThis.window) {
  const AudioCtx = win && (win.AudioContext || win.webkitAudioContext);
  if (!AudioCtx) return false;
  if (!audio) audio = new AudioCtx();
  if (audio.state === 'suspended') audio.resume();
  const start = audio.currentTime + 0.05;
  for (let i = 0; i < 3; i += 1) {
    const at = start + i * 0.45;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.4);
  }
  return true;
}

/**
 * Rings each timer once, in exactly one tab, at its ring time.
 *
 * Every tab schedules one plain setTimeout per timer that has not rung. Single
 * timeouts escape Chrome's intensive throttling of chained timers in hidden
 * tabs. A 1 s check, focus, visibility changes and storage changes are the
 * safety net. The ring is claimed under a Web Lock and decided against a fresh
 * read of storage, so two tabs never both chime.
 */
export function createAlarm({
  storage,
  win = globalThis.window,
  clock = realClock,
  locks = globalThis.navigator ? globalThis.navigator.locks : undefined,
  canPlay = defaultCanPlay,
  play = playChime,
  holdMs = HOLD_MS,
}) {
  const doc = win ? win.document : null;
  const timeouts = new Set();
  const claiming = new Set();
  let interval = null;
  let unsubscribe = null;

  const safePlay = safe('alarm.play', () => play());

  async function ring(timer, audible) {
    storage.reload();
    const current = storage.getTimer(timer.id);
    if (!current || current.rungAt != null || current.ringAt !== timer.ringAt) return;
    if (!storage.markRung(timer.id, clock.now())) return;
    if (audible) safePlay();
    if (holdMs > 0) await new Promise((resolve) => clock.setTimeout(resolve, holdMs));
  }

  function claim(timer) {
    const late = clock.now() - timer.ringAt > LATE_LIMIT_MS;
    const audible = !!storage.getSetting('sound') && !late;
    // A tab that may not play sound leaves an audible ring to a tab that may.
    if (audible && !canPlay()) return;
    claiming.add(timer.id);
    const run = locks && typeof locks.request === 'function'
      ? locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? ring(timer, audible) : undefined))
      : ring(timer, audible);
    Promise.resolve(run)
      .catch((err) => warnOnce('alarm.ring', 'could not ring a timer:', err))
      .finally(() => claiming.delete(timer.id));
  }

  function check() {
    const now = clock.now();
    for (const timer of storage.getTimers()) {
      if (timer.rungAt == null && timer.ringAt <= now && !claiming.has(timer.id)) claim(timer);
    }
  }

  const tick = safe('alarm.check', check);
  // A click or key press may have just let this tab play sound; check right after it.
  const soon = () => clock.setTimeout(tick, 0);

  function reschedule() {
    for (const handle of timeouts) clock.clearTimeout(handle);
    timeouts.clear();
    const now = clock.now();
    for (const timer of storage.getTimers()) {
      if (timer.rungAt != null) continue;
      const delay = Math.min(MAX_DELAY, Math.max(0, timer.ringAt - now));
      const handle = clock.setTimeout(() => {
        timeouts.delete(handle);
        tick();
      }, delay);
      timeouts.add(handle);
    }
  }

  const onChange = safe('alarm.reschedule', () => {
    reschedule();
    tick();
  });

  function start() {
    if (interval !== null) return;
    unsubscribe = storage.subscribe(onChange);
    interval = clock.setInterval(tick, 1000);
    if (win) {
      win.addEventListener('focus', tick);
      win.addEventListener('pointerdown', soon);
      win.addEventListener('keydown', soon);
    }
    if (doc) doc.addEventListener('visibilitychange', tick);
    reschedule();
    tick();
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (interval !== null) clock.clearInterval(interval);
    interval = null;
    for (const handle of timeouts) clock.clearTimeout(handle);
    timeouts.clear();
    if (win) {
      win.removeEventListener('focus', tick);
      win.removeEventListener('pointerdown', soon);
      win.removeEventListener('keydown', soon);
    }
    if (doc) doc.removeEventListener('visibilitychange', tick);
  }

  return { start, destroy, check: tick };
}
