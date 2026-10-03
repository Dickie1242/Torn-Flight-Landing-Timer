import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { statusHtml } from '../testlib/dom.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'dist', 'landingtimer.user.js');

let built = null;
/** Builds once per run; every test in this file reads the same bundle. */
function bundle() {
  if (built === null) {
    execFileSync(process.execPath, [path.join(root, 'build.mjs')], { cwd: root, stdio: 'pipe' });
    built = readFileSync(outFile, 'utf8');
  }
  return built;
}

/** The bundled code alone, without the ==UserScript== banner above it. */
function code() {
  const all = bundle();
  const marker = '// ==/UserScript==';
  return all.slice(all.indexOf(marker) + marker.length);
}

test('the bundle starts with the metadata block and is one IIFE', () => {
  const code = bundle();
  assert.ok(code.startsWith('// ==UserScript=='), 'bundle must start with // ==UserScript==');
  assert.match(code, /\/\/ @name\s+Landing Timer/);
  assert.match(code, /\/\/ @namespace\s+landingtimer\.torn/);
  assert.match(code, /\/\/ @match\s+https:\/\/www\.torn\.com\/\*/);
  assert.match(code, /\/\/ @run-at\s+document-idle/);
  assert.match(code, /\/\/ @noframes/, "not run inside Torn's frames");
  const raw = 'https://raw.githubusercontent.com/Dickie1242/Torn-Flight-Landing-Timer/main/dist/landingtimer.user.js';
  assert.match(code, new RegExp(`^// @downloadURL\\s+${raw.replace(/[.]/g, '\\.')}$`, 'm'), 'installs come from the built file on main');
  assert.match(code, new RegExp(`^// @updateURL\\s+${raw.replace(/[.]/g, '\\.')}$`, 'm'), 'updates come from the built file on main');
  assert.match(code, /\/\/ ==\/UserScript==/);
  assert.match(code, /^\(\(\) => \{/m, 'bundle body must be an IIFE');
  assert.ok(!/^\s*import\s/m.test(code), 'no import statements survive bundling');
  assert.ok(!/^\s*export\s/m.test(code), 'no export statements survive bundling');
});

test('the version from the metadata block is stamped onto the injected stylesheet', () => {
  const code = bundle();
  const declared = /^\/\/ @version\s+(\S+)/m.exec(readFileSync(path.join(root, 'src', 'header.txt'), 'utf8'));
  assert.ok(declared, 'src/header.txt must declare a @version');
  assert.match(code, /data-landingtimer-version/);
  assert.ok(code.includes(`"${declared[1]}"`), `the bundle must carry the declared version ${declared[1]}`);
});

// Torn's rules forbid extra non-API requests. Landing Timer makes none at all,
// and this test is the proof a reviewer can point at. It catches the named
// network APIs, the usual DOM and CSS ways to start a request (an element or a
// stylesheet given a URL to load), and code loaded or run from elsewhere;
// anything cleverer would still need a human reading src/.
test('rule safety: the bundle makes no network requests and asks for no permissions', () => {
  const forbidden = [
    /\bfetch\s*\(/, /fetchLater/, /XMLHttpRequest/, /GM_xmlhttpRequest/, /GM\.xmlHttpRequest/,
    /sendBeacon/, /WebSocket/, /WebTransport/, /RTCPeerConnection/, /EventSource/, /\bimport\s*\(/,
    /\bnew\s+(?:Image|Audio)\b/,              // new Image() / new Audio(url) fetch their src
    /\.src\s*=/,                               // element.src = url
    /['"](?:src|srcset|ping)['"]/,             // setAttribute('src', url), <a ping>
    /['"](?:script|img|iframe|audio|video|source|embed|link)['"]/, // creating elements that load URLs
    /url\(/, /@import/,                        // CSS that loads something (case-sensitive: new URL( is fine)
    /addModule/, /\bWorker\s*\(/, /importScripts/, /serviceWorker/, // code from elsewhere
    /\bwindow\.open\b/, /\beval\s*\(/, /new\s+Function/,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(code()), `the bundle must not contain ${pattern}`);
  }
  const grants = [...bundle().matchAll(/^\/\/ @grant\s+(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(grants, ['none'], 'the only grant is none');
  assert.ok(!/^\/\/ @(connect|require|resource)\b/m.test(bundle()), 'no @connect, @require or @resource');
});

test('the bundle inlines the stylesheet, the selectors and the storage key', () => {
  const code = bundle();
  assert.match(code, /landingtimer-widget/);
  assert.match(code, /landingtimer-panel/);
  assert.match(code, /\.landingtimer-panel:not\(#_\) \{[^}]*z-index: 2147483647/, 'the panel stacks above everything');
  assert.match(code, /div\.profile-status/);
  assert.match(code, /landingtimer\.v1/);
  // attachDrag relies on these two rules (see its JSDoc).
  assert.match(code, /\.landingtimer-widget:not\(#_\) \{[^}]*user-select: none/, 'dragging must not select text');
  assert.match(code, /\.landingtimer-widget__bar:not\(#_\) \{[^}]*touch-action: none/, 'a touch drag must not scroll the page');
});

/**
 * Runs the built userscript in a fresh jsdom page, the way Tampermonkey runs
 * it, and waits for the page to finish loading. Anything it logs as a warning
 * or error fails the test.
 *
 * jsdom leaves a new page at readyState "loading" and fires DOMContentLoaded a
 * moment later, so by default the script waits for it. `afterLoad` runs it once
 * the page has loaded instead, the path Tampermonkey's document-idle takes on
 * Torn. `before(win)` prepares the window first.
 */
async function boot(url, { body = '', title = 'TORN', before, afterLoad = false } = {}) {
  const problems = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('warn', (...args) => problems.push(['warn', ...args]));
  virtualConsole.on('error', (...args) => problems.push(['error', ...args]));
  virtualConsole.on('jsdomError', (err) => problems.push(['jsdomError', err]));
  const dom = new JSDOM(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole },
  );
  const loaded = () => (dom.window.document.readyState === 'complete'
    ? Promise.resolve()
    : new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true })));
  if (before) before(dom.window);
  if (afterLoad) await loaded();
  dom.window.eval(bundle());
  await loaded();
  return { dom, doc: dom.window.document, problems };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROFILE = {
  body: `<h4 id="skip-to-content">SomeName's Profile</h4><div id="profileroot">${statusHtml({
    classes: 'profile-status m-top10 travelling to canada  ',
    label: 'Traveling from Torn to Canada  . Type of plane: Commercial',
    text: 'Torn to Canada ',
  })}</div>`,
  title: 'SomeName [1234567] | TORN',
};

test('smoke: on a travelling profile it shows the button, a pre-filled panel and a row after Start', async () => {
  const { dom, doc, problems } = await boot('https://www.torn.com/profiles.php?XID=1234567', PROFILE);
  try {
    assert.ok(doc.getElementById('landingtimer-styles'), 'styles injected');
    const widget = doc.querySelector('.landingtimer-widget');
    assert.ok(widget, 'timer box present');
    assert.equal(widget.hidden, true, 'and hidden with no timers');
    const button = doc.querySelector('.landingtimer-button');
    assert.ok(button, 'button present');
    assert.ok(button.classList.contains('landingtimer-button--active'), 'accented: they are flying');
    button.click();
    const panel = doc.querySelector('.landingtimer-panel');
    assert.equal(panel.querySelector('select').value, 'canada');
    assert.equal(panel.querySelector('input[type="radio"]:checked').value, 'standard');
    panel.querySelector('[data-action="start"]').click();
    assert.equal(doc.querySelector('.landingtimer-panel'), null, 'Start closes the panel');
    assert.equal(widget.hidden, false);
    assert.match(doc.querySelector('.landingtimer-row').textContent, /SomeName.*Canada.*37:00/);
    await pause(1100); // let the box's tick and the alarm's 1 s check run, so their failures show too
    assert.deepEqual(problems, []);
  } finally {
    dom.window.close();
  }
});

test('smoke: it also boots when the page has already loaded, as on Torn', async () => {
  const { dom, doc, problems } = await boot('https://www.torn.com/profiles.php?XID=1234567', { ...PROFILE, afterLoad: true });
  try {
    assert.ok(doc.querySelector('.landingtimer-widget'));
    assert.ok(doc.querySelector('.landingtimer-button'));
    assert.deepEqual(problems, []);
  } finally {
    dom.window.close();
  }
});

test('smoke: off a profile it shows only the hidden timer box', async () => {
  const { dom, doc, problems } = await boot('https://www.torn.com/index.php');
  try {
    const widget = doc.querySelector('.landingtimer-widget');
    assert.ok(widget);
    assert.equal(widget.hidden, true);
    assert.equal(doc.querySelector('.landingtimer-button'), null);
    assert.deepEqual(problems, []);
  } finally {
    dom.window.close();
  }
});

test('smoke: a second installed copy on the same page stays idle', async () => {
  const { dom, doc, problems } = await boot('https://www.torn.com/index.php');
  try {
    dom.window.eval(bundle());
    assert.equal(doc.querySelectorAll('.landingtimer-widget').length, 1);
    assert.equal(doc.querySelectorAll('#landingtimer-styles').length, 1);
    assert.deepEqual(problems, []);
  } finally {
    dom.window.close();
  }
});

test('smoke: the chime is wired: a timer that is due chimes once and is marked rung', async () => {
  const now = Date.now();
  let oscillators = 0;
  const { dom, problems } = await boot('https://www.torn.com/index.php', {
    before(win) {
      win.localStorage.setItem('landingtimer.v1', JSON.stringify({
        version: 1,
        settings: { bufferMin: 2, sound: true, widgetPos: null },
        timers: [{
          id: '42', name: 'X', destination: 'canada', plane: 'standard', direction: 'to', minutes: 39,
          startedAt: now - 38 * 60000, landingAt: now + 60000, ringAt: now - 1000, rungAt: null,
        }],
      }));
      // A browser that lets this page play sound.
      win.AudioContext = class {
        constructor() {
          this.state = 'running';
          this.currentTime = 0;
          this.destination = {};
        }

        resume() { return Promise.resolve(); }

        createOscillator() {
          oscillators += 1;
          return { frequency: {}, connect() {}, start() {}, stop() {} };
        }

        createGain() {
          return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {} };
        }
      };
    },
  });
  try {
    await pause(300);
    assert.equal(oscillators, 3, 'one three-beep chime');
    assert.ok(JSON.parse(dom.window.localStorage.getItem('landingtimer.v1')).timers[0].rungAt, 'marked rung');
    assert.deepEqual(problems, []);
  } finally {
    dom.window.close();
  }
});
