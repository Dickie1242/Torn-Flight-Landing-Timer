/**
 * The two chimes, synthesised with Web Audio, so there is no sound file and no
 * request. Browsers only let a page start sound after the player has
 * interacted with it, so this also knows whether sound works in this tab, and
 * starts it on a real click.
 */

/** How long ready() waits for a held-back context to start. */
export const READY_TIMEOUT_MS = 300;

/**
 * The two chimes. The warning, a few minutes before landing, is three equal
 * beeps. The landing itself is a rising four-note airport chime in a different
 * voice, a little louder since landing is the moment to act, whose notes ring
 * on into each other like a bell, so the two can't be mistaken for each other.
 * - `step`: seconds between notes; `length`: how long each note sounds.
 * - `peak`: each note's loudness (0–1). Even overlapping, the landing chime
 *   stays near 0.5, well clear of clipping.
 * - `tail`: when set, a note fades like a bell, with this time constant in
 *   seconds, instead of stopping short.
 */
export const CHIMES = Object.freeze({
  ring: Object.freeze({ wave: 'sine', notes: Object.freeze([880, 880, 880]), step: 0.45, length: 0.35, peak: 0.3 }),
  land: Object.freeze({
    wave: 'triangle', notes: Object.freeze([523.25, 659.25, 783.99, 1046.5]), step: 0.28, length: 1.2, peak: 0.35, tail: 0.25,
  }),
});

export function createAudio({ win = globalThis.window, timeoutMs = READY_TIMEOUT_MS } = {}) {
  let context = null;
  /** A ready() found this tab unable to play, and no gesture has come since. */
  let blocked = false;

  /** Running beats every other signal: the browser has said yes. */
  const running = () => !!context && context.state === 'running';

  function getContext() {
    // A closed context can never run again; make a new one.
    if (context && context.state !== 'closed') return context;
    const AudioCtx = win && (win.AudioContext || win.webkitAudioContext);
    if (!AudioCtx) return null;
    try {
      context = new AudioCtx();
    } catch {
      context = null;
    }
    return context;
  }

  /** Asks the context to start. Never rejects: a refusal just leaves it suspended. */
  function resume(ctx) {
    try {
      const result = ctx.resume();
      return result && typeof result.then === 'function' ? result.catch(() => {}) : Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  }

  /** Call from inside a real user gesture: that is when browsers let audio start. */
  function unlock() {
    // A click is the permission, whether or not there is a context to start yet.
    blocked = false;
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state !== 'running') resume(ctx);
  }

  /**
   * Can this tab make sound right now? Starts the context if the browser
   * allows it, waiting at most `timeoutMs` for the answer.
   * @returns {Promise<boolean>}
   */
  async function ready() {
    const ctx = getContext();
    if (!ctx) {
      blocked = true;
      return false;
    }
    if (ctx.state !== 'running') {
      const starting = resume(ctx);
      await Promise.race([starting, new Promise((resolve) => win.setTimeout(resolve, timeoutMs))]);
      // A context that starts after we stopped waiting is still good news.
      if (ctx.state !== 'running') {
        starting.then(() => {
          if (running()) blocked = false;
        });
      }
    }
    blocked = ctx.state !== 'running';
    return !blocked;
  }

  /** Plays a chime: 'ring' (the warning, the default) or 'land'. @returns {boolean} whether it could. */
  function play(kind = 'ring') {
    const ctx = getContext();
    if (!ctx || ctx.state !== 'running') return false;
    const chime = Object.hasOwn(CHIMES, kind) ? CHIMES[kind] : CHIMES.ring;
    const start = ctx.currentTime + 0.05;
    chime.notes.forEach((frequency, i) => {
      const at = start + i * chime.step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = chime.wave;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(chime.peak, at + 0.02);
      if (chime.tail) gain.gain.setTargetAtTime(0.0001, at + 0.02, chime.tail);
      else gain.gain.exponentialRampToValueAtTime(0.0001, at + chime.length);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + chime.length + 0.05);
    });
    return true;
  }

  /** A ring found this tab unable to play, and no click has come since. */
  function isBlocked() {
    return blocked && !running();
  }

  /**
   * Is sound likely to work here? For the "click to allow" hint: yes, unless a
   * check found this tab blocked and no click has come since. Not "has this
   * page been clicked": Chrome carries that permission across Torn's page
   * loads, so asking would raise a false alarm on every page.
   */
  function likely() {
    return running() || !blocked;
  }

  return { unlock, ready, play, isBlocked, likely };
}
