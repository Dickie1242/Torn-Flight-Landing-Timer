import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/core/audio.js';

/**
 * A window with a stand-in AudioContext. `resume` says what the browser does
 * when asked to start: 'start', 'late' (starts 20 ms later), 'reject' (WebKit
 * outside a gesture), or 'hang' (Chrome holding it back until a gesture).
 */
function fakeWin({ state = 'suspended', resume = 'start', activated = false } = {}) {
  const made = [];
  class FakeContext {
    constructor() {
      this.state = state;
      this.currentTime = 0;
      this.destination = {};
      this.oscillators = 0;
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
      return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
    }

    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  }
  const win = {
    AudioContext: FakeContext,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    navigator: { userActivation: { hasBeenActive: activated } },
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
  win.navigator.userActivation.hasBeenActive = true;
  audio.unlock();
  assert.equal(audio.isBlocked(), false);
  assert.equal(audio.likely(), true);
  assert.equal(made.length, 1);
});

test('likely() follows a running context, then whether the page has been clicked', async () => {
  const fresh = fakeWin({ activated: false });
  assert.equal(createAudio({ win: fresh.win }).likely(), false, 'never clicked, nothing started');
  const clicked = fakeWin({ activated: true });
  assert.equal(createAudio({ win: clicked.win }).likely(), true);
  const running = fakeWin({ state: 'running', activated: false });
  const audio = createAudio({ win: running.win, timeoutMs: 5 });
  await audio.ready();
  assert.equal(audio.likely(), true, 'the browser let it start without a click');
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
