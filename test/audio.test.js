import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/core/audio.js';

/**
 * A window with a stand-in AudioContext. `resume` says what the browser does
 * when asked to start: 'start', 'late' (starts 20 ms later), 'reject' (WebKit
 * outside a gesture), or 'hang' (Chrome holding it back until a gesture).
 */
function fakeWin({ state = 'suspended', resume = 'start' } = {}) {
  const made = [];
  class FakeContext {
    constructor() {
      this.state = state;
      this.currentTime = 0;
      this.destination = {};
      this.oscillators = 0;
      this.notes = [];
      this.tails = 0;
      made.push(this);
    }

    resume() {
      if (resume === 'start') {
        this.state = 'running';
        return Promise.resolve();
      }
      if (resume === 'reject') return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
      if (resume === 'late') {
        return new Promise((resolve) => setTimeout(() => {
          this.state = 'running';
          resolve();
        }, 20));
      }
      return new Promise(() => {});
    }

    createOscillator() {
      this.oscillators += 1;
      const osc = { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
      this.notes.push(osc);
      return osc;
    }

    createGain() {
      const ctx = this;
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() { ctx.tails += 1; } }, connect() {} };
    }
  }
  const win = {
    AudioContext: FakeContext,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
  return { win, made };
}

test('ready() starts a context the browser allows, and play() then chimes three beeps on one context', async () => {
  const { win, made } = fakeWin({ resume: 'start' });
  const audio = createAudio({ win, timeoutMs: 5 });
  assert.equal(await audio.ready(), true);
  assert.equal(audio.play(), true);
  assert.equal(audio.play(), true);
  assert.equal(made.length, 1, 'one context, reused');
  assert.equal(made[0].oscillators, 6);
  assert.equal(audio.isBlocked(), false);
});

test('ready() gives up on a context the browser holds back, and play() then does nothing', async () => {
  const { win, made } = fakeWin({ resume: 'hang' });
  const audio = createAudio({ win, timeoutMs: 5 });
  assert.equal(await audio.ready(), false);
  assert.equal(audio.play(), false);
  assert.equal(made[0].oscillators, 0);
  assert.equal(audio.isBlocked(), true);
  assert.equal(audio.likely(), false);
});

test('a refused resume is caught, not left as an unhandled rejection', async () => {
  const { win } = fakeWin({ resume: 'reject' });
  const audio = createAudio({ win, timeoutMs: 5 });
  assert.equal(await audio.ready(), false);
  audio.unlock();
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('a click unblocks the tab and asks the context to start', async () => {
  const { win, made } = fakeWin({ resume: 'hang' });
  const audio = createAudio({ win, timeoutMs: 5 });
  await audio.ready();
  assert.equal(audio.isBlocked(), true);
  audio.unlock();
  assert.equal(audio.isBlocked(), false);
  assert.equal(audio.likely(), true);
  assert.equal(made.length, 1);
});

test('likely() is yes until a check finds the tab blocked, and yes again after a click', async () => {
  const { win } = fakeWin({ resume: 'hang' });
  const audio = createAudio({ win, timeoutMs: 5 });
  assert.equal(audio.likely(), true, 'nothing known against it: no false alarm after every page load');
  await audio.ready();
  assert.equal(audio.likely(), false);
  audio.unlock();
  assert.equal(audio.likely(), true);
  const running = fakeWin({ state: 'running' });
  const playing = createAudio({ win: running.win, timeoutMs: 5 });
  await playing.ready();
  assert.equal(playing.likely(), true, 'the browser let it start without a click');
});

test('with no Web Audio at all it is never ready, never plays and never throws', async () => {
  const audio = createAudio({ win: {}, timeoutMs: 5 });
  assert.equal(await audio.ready(), false);
  assert.equal(audio.play(), false);
  audio.unlock();
  assert.equal(audio.likely(), true, 'nothing to say about clicks either');
});

test('a context that starts after ready() stopped waiting is not left blocked', async () => {
  const { win } = fakeWin({ resume: 'late' });
  const audio = createAudio({ win, timeoutMs: 5 });
  assert.equal(await audio.ready(), false);
  assert.equal(audio.isBlocked(), true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(audio.isBlocked(), false);
  assert.equal(audio.likely(), true);
});

test('a click that starts the context while ready() waits is not undone', async () => {
  const { win, made } = fakeWin({ resume: 'hang' });
  const audio = createAudio({ win, timeoutMs: 5 });
  const pending = audio.ready();
  audio.unlock();
  assert.equal(await pending, false, 'still not running when ready() stopped waiting');
  made[0].state = 'running'; // the click's start took effect a moment later
  assert.equal(audio.isBlocked(), false);
  assert.equal(audio.likely(), true);
});

test('a closed context is replaced, not reused', async () => {
  const { win, made } = fakeWin({ state: 'running' });
  const audio = createAudio({ win, timeoutMs: 5 });
  assert.equal(await audio.ready(), true);
  made[0].state = 'closed';
  assert.equal(audio.play(), true);
  assert.equal(made.length, 2);
});

test('the landing chime is its own sound: four rising notes, not the three equal beeps', async () => {
  const { win, made } = fakeWin({ resume: 'start' });
  const audio = createAudio({ win, timeoutMs: 5 });
  await audio.ready();
  assert.equal(audio.play('ring'), true);
  const ring = made[0].notes.splice(0);
  assert.deepEqual(ring.map((o) => o.frequency.value), [880, 880, 880]);
  assert.equal(audio.play('land'), true);
  const land = made[0].notes;
  assert.equal(land.length, 4);
  const pitches = land.map((o) => o.frequency.value);
  assert.deepEqual([...pitches].sort((a, b) => a - b), pitches, 'rising');
  assert.ok(land.every((o) => o.type !== ring[0].type), 'a different voice too');
});

test('play() without a kind, or with an unknown one, plays the warning', async () => {
  const { win, made } = fakeWin({ resume: 'start' });
  const audio = createAudio({ win, timeoutMs: 5 });
  await audio.ready();
  audio.play();
  audio.play('constructor');
  assert.equal(made[0].notes.length, 6);
  assert.ok(made[0].notes.every((o) => o.frequency.value === 880));
});

test('the landing chime fades like a bell; the warning stops short', async () => {
  const { win, made } = fakeWin({ resume: 'start' });
  const audio = createAudio({ win, timeoutMs: 5 });
  await audio.ready();
  audio.play('ring');
  assert.equal(made[0].tails, 0);
  audio.play('land');
  assert.equal(made[0].tails, 4);
});
