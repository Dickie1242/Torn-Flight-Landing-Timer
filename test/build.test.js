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
// network APIs and the usual DOM ways to start a request (an element given a
// URL to load); anything cleverer would still need a human reading src/.
test('rule safety: the bundle makes no network requests and asks for no permissions', () => {
  const forbidden = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /GM_xmlhttpRequest/, /GM\.xmlHttpRequest/,
    /sendBeacon/, /WebSocket/, /EventSource/, /\bimport\s*\(/,
    /\bnew\s+(?:Image|Audio)\b/,              // new Image() / new Audio(url) fetch their src
    /\.src\s*=/,                               // element.src = url
    /['"](?:src|srcset|ping)['"]/,             // setAttribute('src', url), <a ping>
    /['"](?:script|img|iframe|audio|video|source|embed|link)['"]/, // creating elements that load URLs
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
  assert.match(code, /\.landingtimer-panel \{[^}]*z-index: 2147483647/, 'the panel stacks above everything');
  assert.match(code, /div\.profile-status/);
  assert.match(code, /landingtimer\.v1/);
  // attachDrag relies on these two rules (see its JSDoc).
  assert.match(code, /\.landingtimer-widget \{[^}]*user-select: none/, 'dragging must not select text');
  assert.match(code, /\.landingtimer-widget__bar \{[^}]*touch-action: none/, 'a touch drag must not scroll the page');
});

/**
 * Runs the built userscript in a fresh jsdom page, the way Tampermonkey runs
 * it, and waits for the page to finish loading. Anything it logs as a warning
 * or error fails the test. (jsdom leaves a new page at readyState "loading"
 * and fires DOMContentLoaded a moment later, so the script waits for it, as it
 * would on Torn.)
 */
async function boot(url, body = '', title = 'TORN') {
  const problems = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('warn', (...args) => problems.push(['warn', ...args]));
  virtualConsole.on('error', (...args) => problems.push(['error', ...args]));
  virtualConsole.on('jsdomError', (err) => problems.push(['jsdomError', err]));
  const dom = new JSDOM(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole },
  );
  dom.window.eval(bundle());
  if (dom.window.document.readyState !== 'complete') {
    await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  }
  return { dom, doc: dom.window.document, problems };
}

test('smoke: on a travelling profile it shows the button, a pre-filled panel and a row after Start', async () => {
  const status = statusHtml({
    classes: 'profile-status m-top10 travelling to canada  ',
    label: 'Traveling from Torn to Canada  . Type of plane: Commercial',
    text: 'Torn to Canada ',
  });
  const { dom, doc, problems } = await boot(
    'https://www.torn.com/profiles.php?XID=1234567',
    `<h4 id="skip-to-content">SomeName's Profile</h4><div id="profileroot">${status}</div>`,
    'SomeName [1234567] | TORN',
  );
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
    assert.deepEqual(problems, []);
  } finally {
    dom.window.close();
  }
});

test('smoke: off a profile it shows only the hidden timer box', async () => {
  const { dom, doc, problems } = await boot('https://www.torn.com/index.php');
  try {
    assert.ok(doc.querySelector('.landingtimer-widget'));
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
