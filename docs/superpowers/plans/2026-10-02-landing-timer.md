# Landing Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tampermonkey userscript for Torn City. It puts a **⏱ Landing timer** button on player profiles. The button opens a panel pre-filled with the target's destination and plane, plus every flight time. Start creates a countdown that follows the player around Torn and chimes once, in one tab, a chosen number of minutes before the estimated landing.

**Architecture:** The pieces are small ES modules bundled by esbuild into one IIFE userscript, the same layout as the sibling Chat+ project (`D:\dev\Torn City Scripts\ChatPlus`):

- **Pure logic, no DOM:** flight table, formatting, storage, alarm. Time, Web Locks and localStorage are injected, so tests drive them by hand.
- **DOM pieces:** profile reader, button, panel, floating widget, drag. Each takes the `document` it works on, and the tests give it a jsdom one.
- **No network:** the script makes no requests of any kind, and a build test enforces that.

**Tech Stack:** Node 20+ (24 installed), esbuild 0.28, jsdom 29, `node --test`, plain ES modules, Web Audio, the Web Locks API.

**Spec:** `docs/superpowers/specs/2026-10-02-landing-timer-design.md`. Read sections 2 (rule safety), 4 (reading the profile) and 5 (behaviour) before starting.

---

## Conventions (read once)

- **Project root:** `D:\dev\Torn City Scripts\LandingTimer`. The git repo already exists (branch `main`). It has a local anonymous identity, "Torn Landing Timer" `<torn-landing-timer@noreply.invalid>`. Never change it, and never pass `--author`.
- **Commits:** every commit message ends with the trailer, passed as a second `-m`:
  `-m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`
- **Running tests:** `npm test` runs everything; `node --test test/<name>.test.js` runs one file. Run commands from the project root.
- **Torn's page:** every lookup into Torn's page lives in `src/core/selectors.js`. No other file may contain a Torn selector.
- **Page text is text:** anything read from the page (player names) is put into the DOM with `textContent` (via `el()`), never `innerHTML`.
- **Names fixed by this plan.** Use these exactly; later tasks import them.

| Module | Exports |
|---|---|
| `src/core/flights.js` | `DESTINATIONS`, `PLANES`, `PROFILE_PLANES`, `VARIANCE`, `minutesFor`, `destinationName`, `planeLabel`, `isDestination`, `isPlane`, `varianceMinutes` |
| `src/core/time.js` | `formatCountdown`, `formatElapsed`, `formatClock`, `formatMinutes` |
| `src/core/clock.js` | `realClock` |
| `src/core/log.js` | `PREFIX`, `info`, `warnOnce`, `resetWarnOnce`, `safe` |
| `src/core/dom.js` | `el` |
| `src/core/storage.js` | `STORAGE_KEY`, `STORAGE_VERSION`, `EXPIRE_AFTER_MS`, `BUFFER`, `DEFAULT_SETTINGS`, `sanitizeBuffer`, `sanitizeTimer`, `createStorage` |
| `src/core/selectors.js` | `PROFILE_PATH`, `STATUS_BOX_SELECTOR`, `STATUS_TEXT_SELECTOR`, `STATUS_DESC_SELECTOR`, `PLANE_LABEL_SELECTOR`, `PROFILE_HEADING_SELECTOR`, `isProfilePage`, `statusBox`, `statusClasses`, `statusText`, `planeAriaLabel`, `profileIdFromUrl`, `profileIdentity` |
| `src/profile/readStatus.js` | `countryFromName`, `parseClasses`, `parsePlaneLabel`, `parseStatusText`, `readStatus` |
| `src/profile/panel.js` | `PANEL_CLASS`, `planTimer`, `describeStatus`, `createPanel` |
| `src/profile/button.js` | `BUTTON_CLASS`, `BUTTON_ACTIVE_CLASS`, `BUTTON_LABEL`, `mountProfileButton` |
| `src/widget/drag.js` | `DEFAULT_POS`, `clampPosition`, `attachDrag` |
| `src/widget/widget.js` | `WIDGET_CLASS`, `ROW_CLASS`, `ROW_DUE_CLASS`, `SOUND_ON`, `SOUND_OFF`, `SOUND_BLOCKED_TITLE`, `rowState`, `placeText`, `rowTitle`, `createWidget` |
| `src/core/alarm.js` | `LATE_LIMIT_MS`, `LOCK_NAME`, `HOLD_MS`, `defaultCanPlay`, `playChime`, `createAlarm` |
| `testlib/fakes.js` | `MIN`, `T0`, `fakeClock`, `memoryArea`, `fakeLocks`, `makeTimer`, `flush`, `captureConsole` |
| `testlib/dom.js` | `PROFILE_URL`, `statusHtml`, `profileDoc`, `settle`, `stubRect`, `firePointer` |

**Shared shapes:**

- **Timer**, as stored:
  ```js
  { id, name, destination, plane, direction, minutes, startedAt, landingAt, ringAt, rungAt }
  ```
  - `id` is the player id (digits). For a player whose id couldn't be read, it is `name:<name>` instead.
  - `destination` and `plane` are keys from `flights.js`.
  - `direction` is `'to'`, `'from'` or `null`.
  - The times are epoch milliseconds; `rungAt` is `null` until the timer rings.
- **ProfileStatus**, from `readStatus`:
  ```js
  { id, name, state, direction, destination, plane }
  ```
  - `state` is `'traveling' | 'hidden' | 'abroad' | 'other'`.
  - `plane` is the profile's own word: `'commercial' | 'airstrip' | 'private' | null`.

---

### Task 1: Scaffold, build and the rule-safety guard

**Files:**
- Create: `package.json`, `build.mjs`, `src/header.txt`, `src/main.js`, `src/styles.css`, `src/core/log.js`, `src/core/version.js`, `src/core/styles.js`, `test/build.test.js`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "landingtimer",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Landing Timer - a landing countdown on Torn City profiles (Tampermonkey userscript)",
  "license": "MIT",
  "scripts": {
    "build": "node build.mjs",
    "watch": "node build.mjs --watch",
    "test": "node --test"
  },
  "devDependencies": {
    "esbuild": "^0.28.2",
    "jsdom": "^29.1.1"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `added N packages`, a `package-lock.json` and `node_modules/` appear. (`node_modules/` is already in `.gitignore`.)

- [ ] **Step 3: Write `build.mjs`**

```js
import { build, context } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const header = (await readFile(path.join(root, 'src', 'header.txt'), 'utf8')).trimEnd();

// The metadata block is the single source of truth for the version; the bundle
// stamps it onto the injected <style> so a console check can tell which build
// is actually running on the page.
const versionMatch = /^\/\/ @version\s+(\S+)/m.exec(header);
const version = versionMatch ? versionMatch[1] : 'dev';

const options = {
  absWorkingDir: root,
  entryPoints: ['src/main.js'],
  outfile: 'dist/landingtimer.user.js',
  bundle: true,
  format: 'iife',
  target: ['chrome100', 'firefox100'],
  loader: { '.css': 'text' },
  define: { __LANDINGTIMER_VERSION__: JSON.stringify(version) },
  banner: { js: header },
  legalComments: 'none',
  logLevel: 'warning',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[Landing Timer] watching src/ ...');
} else {
  await build(options);
  console.log('[Landing Timer] built dist/landingtimer.user.js');
}
```

- [ ] **Step 4: Write `src/header.txt`**

```
// ==UserScript==
// @name         Landing Timer
// @namespace    landingtimer.torn
// @version      1.0.0
// @description  A landing countdown on Torn profiles: reads the destination and plane from the profile you are viewing, shows every flight time, and chimes a few minutes before they land. Makes no network requests.
// @license      MIT
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
```

- [ ] **Step 5: Write `src/core/log.js`**

```js
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
```

- [ ] **Step 6: Write `src/core/version.js`**

```js
/**
 * The userscript version, lifted from src/header.txt at build time by
 * build.mjs so the two can never drift apart. It is stamped onto the injected
 * <style> tag: the ==UserScript== block is not readable from the page.
 */
/* global __LANDINGTIMER_VERSION__ */
export const VERSION = typeof __LANDINGTIMER_VERSION__ === 'string' ? __LANDINGTIMER_VERSION__ : 'dev';

export const VERSION_ATTR = 'data-landingtimer-version';
```

- [ ] **Step 7: Write `src/core/styles.js`**

```js
import cssText from '../styles.css';
import { VERSION, VERSION_ATTR } from './version.js';

/**
 * Landing Timer has one stylesheet (src/styles.css, inlined as text by
 * esbuild), injected once at boot.
 */
export const STYLE_ELEMENT_ID = 'landingtimer-styles';

export function injectStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.setAttribute(VERSION_ATTR, VERSION);
  style.textContent = cssText;
  (doc.head || doc.documentElement).appendChild(style);
}
```

- [ ] **Step 8: Write `src/styles.css`** (Task 12 replaces it with the full sheet)

```css
/* Landing Timer: the whole stylesheet, injected once at boot. */

.landingtimer-widget[hidden] {
  display: none !important;
}
```

- [ ] **Step 9: Write `src/main.js`** (Task 12 wires the features in)

```js
import { info, safe } from './core/log.js';
import { injectStyles } from './core/styles.js';

function boot() {
  injectStyles(document);
  info('ready');
}

// Nothing above us catches a throw here, and a half-booted userscript must
// never take Torn's own page down with it.
const safeBoot = safe('main.boot', boot);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeBoot, { once: true });
} else {
  safeBoot();
}
```

- [ ] **Step 10: Write the failing build test `test/build.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('the bundle starts with the metadata block and is one IIFE', () => {
  const code = bundle();
  assert.ok(code.startsWith('// ==UserScript=='), 'bundle must start with // ==UserScript==');
  assert.match(code, /\/\/ @name\s+Landing Timer/);
  assert.match(code, /\/\/ @namespace\s+landingtimer\.torn/);
  assert.match(code, /\/\/ @match\s+https:\/\/www\.torn\.com\/\*/);
  assert.match(code, /\/\/ @run-at\s+document-idle/);
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
// and this test is the proof a reviewer can point at.
test('rule safety: the bundle makes no network requests and asks for no permissions', () => {
  const code = bundle();
  const forbidden = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /GM_xmlhttpRequest/, /GM\.xmlHttpRequest/,
    /sendBeacon/, /WebSocket/, /EventSource/, /\bimport\s*\(/,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(code), `the bundle must not contain ${pattern}`);
  }
  const grants = [...code.matchAll(/^\/\/ @grant\s+(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(grants, ['none'], 'the only grant is none');
  assert.ok(!/^\/\/ @(connect|require|resource)\b/m.test(code), 'no @connect, @require or @resource');
});
```

- [ ] **Step 11: Run the tests**

Run: `npm test`
Expected: 3 passing tests, and `dist/landingtimer.user.js` exists. (The build test builds as it runs, so it passes as soon as the scaffold is complete. A failure here means a scaffold file has a typo.)

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json build.mjs src test dist
git commit -m "chore: scaffold Landing Timer build with the rule-safety test" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Test helpers

**Files:**
- Create: `testlib/fakes.js`, `testlib/dom.js`, `test/fakes.test.js`

- [ ] **Step 1: Write `testlib/fakes.js`**

```js
/**
 * Hand-driven stand-ins for what Landing Timer reads from the browser: time,
 * Web Locks and localStorage. None of them needs jsdom.
 */

export const MIN = 60 * 1000;

/** 2026-10-02 12:00:00 UTC: where every test clock starts. */
export const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

/**
 * A clock with the same shape as src/core/clock.js's realClock that only moves
 * when tick() is called. Timers fire in time order; intervals repeat.
 */
export function fakeClock(start = T0) {
  let current = start;
  let nextId = 1;
  /** @type {Map<number, {at: number, fn: Function, every: number|null}>} */
  const timers = new Map();

  function schedule(fn, ms, every) {
    const id = nextId;
    nextId += 1;
    timers.set(id, { at: current + Math.max(0, ms || 0), fn, every });
    return id;
  }

  return {
    now: () => current,
    setTimeout: (fn, ms) => schedule(fn, ms, null),
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => schedule(fn, ms, Math.max(1, ms || 0)),
    clearInterval: (id) => { timers.delete(id); },
    /** How many timers are waiting. */
    pending: () => timers.size,
    /** Moves time forward by `ms`, running every timer that falls due, earliest first. */
    tick(ms) {
      const end = current + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (due === null || timer.at < due.at)) {
            dueId = id;
            due = timer;
          }
        }
        if (due === null) break;
        current = due.at;
        if (due.every === null) timers.delete(dueId);
        else due.at += due.every;
        due.fn();
      }
      current = end;
    },
  };
}

/** An in-memory localStorage stand-in. Two stores given one area act like two tabs. */
export function memoryArea(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: (key) => { items.delete(key); },
  };
}

/**
 * The slice of the Web Locks API Landing Timer uses: request(name,
 * { ifAvailable: true }, callback). A held name hands `null` to anyone else.
 * Share one between two "tabs" to model the browser's cross-tab locks.
 */
export function fakeLocks() {
  const held = new Set();
  return {
    held,
    async request(name, options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

/** A timer for player 1234567 flying Torn → Canada by airstrip, started at T0 with a 2-minute buffer. */
export function makeTimer(overrides = {}) {
  return {
    id: '1234567',
    name: 'SomeName',
    destination: 'canada',
    plane: 'airstrip',
    direction: 'to',
    minutes: 27,
    startedAt: T0,
    landingAt: T0 + 27 * MIN,
    ringAt: T0 + 25 * MIN,
    rungAt: null,
    ...overrides,
  };
}

/** Lets every pending promise callback run. */
export function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

export function captureConsole(method) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => { calls.push(args); };
  return {
    calls,
    restore() { console[method] = original; },
  };
}
```

- [ ] **Step 2: Write `testlib/dom.js`**

```js
import { JSDOM } from 'jsdom';

export const PROFILE_URL = 'https://www.torn.com/profiles.php?XID=1234567';

/**
 * A Torn profile status box, shaped like the real one the player captured on
 * 2026-10-02 (test/fixtures/outbound-commercial.html):
 *   div.profile-status.<classes> > div > div.cont > div.profile-container
 *     > div.icon-wrapper + div.description > div.desc-wrap
 *       > span.main-desc[aria-label] > span[aria-hidden] "<text>"
 * Leave `label` or `text` null to build a box without them.
 */
export function statusHtml({ classes = 'profile-status m-top10', label = null, text = null } = {}) {
  const labelAttr = label == null ? '' : ` aria-label="${label}"`;
  const visible = text == null ? '' : `<span aria-hidden="true">${text}</span>`;
  return `<div class="${classes}"><div><div class="cont bottom-round border-round">`
    + '<div class="profile-container"><div class="icon-wrapper"></div>'
    + '<div class="description"><div class="desc-wrap">'
    + `<span class="main-desc"${labelAttr}>${visible}</span><span class="sub-desc"></span>`
    + '</div></div></div></div></div></div>';
}

/** A profile page with a heading, a title and whatever `status` markup is given. */
export function profileDoc({
  status = '',
  heading = "SomeName's Profile",
  title = 'SomeName [1234567] | TORN',
  url = PROFILE_URL,
} = {}) {
  return new JSDOM(
    `<!doctype html><html><head><title>${title}</title></head><body>`
      + `<h4 id="skip-to-content">${heading}</h4><div id="profileroot">${status}</div></body></html>`,
    { url, pretendToBeVisual: true },
  );
}

/** Wait for MutationObserver callbacks and other queued work to run. */
export function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** jsdom has no layout engine, so getBoundingClientRect must be stubbed. */
export function stubRect(el, { left = 0, top = 0, width = 200, height = 120 } = {}) {
  el.getBoundingClientRect = () => ({
    left, top, width, height,
    right: left + width, bottom: top + height,
    x: left, y: top,
    toJSON() { return { left, top, width, height }; },
  });
}

/**
 * jsdom has no PointerEvent, but a MouseEvent dispatched with a pointer type
 * name reaches pointerdown/pointermove/pointerup listeners just fine.
 */
export function firePointer(target, type, { clientX = 0, clientY = 0, button = 0 } = {}) {
  const doc = target.ownerDocument || target;
  const event = new doc.defaultView.MouseEvent(type, {
    bubbles: true, cancelable: true, clientX, clientY, button,
  });
  target.dispatchEvent(event);
  return event;
}
```

- [ ] **Step 3: Write `test/fakes.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, fakeLocks, memoryArea } from '../testlib/fakes.js';

test('fakeClock runs timers in time order and repeats intervals', () => {
  const clock = fakeClock(1000);
  const seen = [];
  clock.setTimeout(() => seen.push(`b@${clock.now()}`), 20);
  clock.setTimeout(() => seen.push(`a@${clock.now()}`), 10);
  const every = clock.setInterval(() => seen.push(`i@${clock.now()}`), 15);
  clock.tick(31);
  assert.deepEqual(seen, ['a@1010', 'i@1015', 'b@1020', 'i@1030']);
  assert.equal(clock.now(), 1031);
  clock.clearInterval(every);
  assert.equal(clock.pending(), 0);
});

test('fakeLocks hands a held lock to nobody else', async () => {
  const locks = fakeLocks();
  let release;
  const first = locks.request('x', { ifAvailable: true }, (lock) => {
    assert.ok(lock);
    return new Promise((resolve) => { release = resolve; });
  });
  assert.equal(await locks.request('x', { ifAvailable: true }, (lock) => lock), null);
  release();
  await first;
  assert.equal(await locks.request('x', { ifAvailable: true }, (lock) => lock && lock.name), 'x');
});

test('memoryArea stores strings like localStorage', () => {
  const area = memoryArea({ a: '1' });
  assert.equal(area.getItem('a'), '1');
  assert.equal(area.getItem('b'), null);
  area.setItem('b', 2);
  assert.equal(area.getItem('b'), '2');
});
```

- [ ] **Step 4: Run them**

Run: `node --test test/fakes.test.js`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add testlib test/fakes.test.js
git commit -m "test: fake clock, locks and storage; jsdom profile helpers" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The flight table

**Files:**
- Create: `src/core/flights.js`
- Test: `test/flights.test.js`

- [ ] **Step 1: Write the failing test `test/flights.test.js`**

The expected values are typed exactly as they appear in the Torn wiki table the player sent (2026-10-02, after the 23 June 2026 patch). The test converts them, so a typing slip in `flights.js` cannot hide behind the same slip here.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESTINATIONS, PLANES, PROFILE_PLANES, VARIANCE,
  minutesFor, destinationName, planeLabel, isDestination, isPlane, varianceMinutes,
} from '../src/core/flights.js';

// Standard, Airstrip, WLT benefit, Business Class: the wiki's columns.
const WIKI = {
  mexico: ['24min', '17min', '12min', '7min'],
  cayman: ['33min', '23min', '17min', '10min'],
  canada: ['39min', '27min', '19min', '12min'],
  hawaii: ['2h 7min', '1h 29min', '1h 3min', '38min'],
  uk: ['2h 31min', '1h 46min', '1h 15min', '45min'],
  argentina: ['2h 38min', '1h 51min', '1h 19min', '47min'],
  switzerland: ['2h 46min', '1h 56min', '1h 23min', '50min'],
  japan: ['3h 33min', '2h 29min', '1h 47min', '1h 4min'],
  china: ['3h 49min', '2h 40min', '1h 54min', '1h 9min'],
  uae: ['4h 17min', '3h 00min', '2h 8min', '1h 17min'],
  southafrica: ['4h 42min', '3h 17min', '2h 21min', '1h 25min'],
};

function toMinutes(text) {
  const match = /^(?:(\d+)h\s*)?(?:(\d+)min)?$/.exec(text);
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

test('every flight time matches the Torn wiki table', () => {
  assert.deepEqual(DESTINATIONS.map((d) => d.key), Object.keys(WIKI));
  assert.deepEqual(PLANES.map((p) => p.key), ['standard', 'airstrip', 'private', 'business']);
  for (const [destination, cells] of Object.entries(WIKI)) {
    PLANES.forEach((plane, index) => {
      assert.equal(minutesFor(destination, plane.key), toMinutes(cells[index]), `${destination} ${plane.key}`);
    });
  }
});

test('unknown keys give null, including names that live on Object.prototype', () => {
  assert.equal(minutesFor('mars', 'standard'), null);
  assert.equal(minutesFor('canada', 'rocket'), null);
  assert.equal(minutesFor(null, null), null);
  assert.equal(minutesFor('constructor', 'standard'), null);
  assert.equal(isDestination('toString'), false);
  assert.equal(isPlane('constructor'), false);
});

test('names and labels read the way the player sees them', () => {
  assert.equal(destinationName('uk'), 'United Kingdom');
  assert.equal(destinationName('southafrica'), 'South Africa');
  assert.equal(destinationName('cayman'), 'Cayman Islands');
  assert.equal(destinationName('mars'), null);
  assert.equal(planeLabel('private'), 'WLT private');
  assert.equal(planeLabel('airstrip'), 'Airstrip');
  assert.equal(planeLabel('rocket'), null);
  assert.ok(isDestination('uae'));
  assert.ok(isPlane('business'));
});

test('Commercial on a profile picks Standard; the others pick themselves', () => {
  assert.equal(PROFILE_PLANES.commercial.pick, 'standard');
  assert.equal(PROFILE_PLANES.airstrip.pick, 'airstrip');
  assert.equal(PROFILE_PLANES.private.pick, 'private');
  assert.equal(PROFILE_PLANES.commercial.label, 'Commercial');
});

test('variance is 3% of the flight, in whole minutes', () => {
  assert.equal(VARIANCE, 0.03);
  assert.equal(varianceMinutes(27), 1);
  assert.equal(varianceMinutes(7), 0);
  assert.equal(varianceMinutes(282), 8);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/flights.test.js`
Expected: FAIL, `Cannot find module ... src/core/flights.js`.

- [ ] **Step 3: Write `src/core/flights.js`**

```js
/**
 * Torn flight times: one way from Torn, in whole minutes, without the
 * "Mailing Yourself Abroad" book. These are the times after the 23 June 2026
 * travel patch, checked on 2026-10-02 against the Torn wiki's table. A return
 * flight takes the same time by the same method.
 */

export const DESTINATIONS = Object.freeze([
  Object.freeze({ key: 'mexico', name: 'Mexico' }),
  Object.freeze({ key: 'cayman', name: 'Cayman Islands' }),
  Object.freeze({ key: 'canada', name: 'Canada' }),
  Object.freeze({ key: 'hawaii', name: 'Hawaii' }),
  Object.freeze({ key: 'uk', name: 'United Kingdom' }),
  Object.freeze({ key: 'argentina', name: 'Argentina' }),
  Object.freeze({ key: 'switzerland', name: 'Switzerland' }),
  Object.freeze({ key: 'japan', name: 'Japan' }),
  Object.freeze({ key: 'china', name: 'China' }),
  Object.freeze({ key: 'uae', name: 'UAE' }),
  Object.freeze({ key: 'southafrica', name: 'South Africa' }),
]);

export const PLANES = Object.freeze([
  Object.freeze({ key: 'standard', label: 'Standard' }),
  Object.freeze({ key: 'airstrip', label: 'Airstrip' }),
  Object.freeze({ key: 'private', label: 'WLT private' }),
  Object.freeze({ key: 'business', label: 'Business' }),
]);

/** Minutes per destination, in PLANES order: standard, airstrip, private, business. */
const MINUTES = new Map([
  ['mexico', [24, 17, 12, 7]],
  ['cayman', [33, 23, 17, 10]],
  ['canada', [39, 27, 19, 12]],
  ['hawaii', [127, 89, 63, 38]],
  ['uk', [151, 106, 75, 45]],
  ['argentina', [158, 111, 79, 47]],
  ['switzerland', [166, 116, 83, 50]],
  ['japan', [213, 149, 107, 64]],
  ['china', [229, 160, 114, 69]],
  ['uae', [257, 180, 128, 77]],
  ['southafrica', [282, 197, 141, 85]],
]);

/** Flights vary by up to 3% (Torn wiki, since Patch #26). */
export const VARIANCE = 0.03;

/**
 * What a profile can say about the plane, and the plane the panel picks for
 * it. Business class looks exactly like Commercial on a profile, so Commercial
 * picks Standard.
 */
export const PROFILE_PLANES = Object.freeze({
  commercial: Object.freeze({ label: 'Commercial', pick: 'standard' }),
  airstrip: Object.freeze({ label: 'Airstrip', pick: 'airstrip' }),
  private: Object.freeze({ label: 'Private (WLT)', pick: 'private' }),
});

export function isDestination(key) {
  return DESTINATIONS.some((d) => d.key === key);
}

export function isPlane(key) {
  return PLANES.some((p) => p.key === key);
}

/** @returns {number|null} one-way minutes, or null for an unknown destination or plane. */
export function minutesFor(destination, plane) {
  const row = MINUTES.get(destination);
  const index = PLANES.findIndex((p) => p.key === plane);
  return row && index >= 0 ? row[index] : null;
}

/** @returns {string|null} */
export function destinationName(key) {
  const destination = DESTINATIONS.find((d) => d.key === key);
  return destination ? destination.name : null;
}

/** @returns {string|null} */
export function planeLabel(key) {
  const plane = PLANES.find((p) => p.key === key);
  return plane ? plane.label : null;
}

/** How many whole minutes a flight of `minutes` can be off by. */
export function varianceMinutes(minutes) {
  return Math.round(minutes * VARIANCE);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test test/flights.test.js`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/core/flights.js test/flights.test.js
git commit -m "feat: flight table from the Torn wiki (post 23 June 2026 patch)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Time formatting and the clock

**Files:**
- Create: `src/core/time.js`, `src/core/clock.js`
- Test: `test/time.test.js`

- [ ] **Step 1: Write the failing test `test/time.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, formatElapsed, formatClock, formatMinutes } from '../src/core/time.js';
import { realClock } from '../src/core/clock.js';

test('a countdown is m:ss under an hour and h:mm:ss from an hour, rounded up', () => {
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(formatCountdown(1), '0:01', 'a part second still to go shows as a second');
  assert.equal(formatCountdown(999), '0:01');
  assert.equal(formatCountdown(61_000), '1:01');
  assert.equal(formatCountdown(25 * 60_000), '25:00');
  assert.equal(formatCountdown(3_600_000), '1:00:00');
  assert.equal(formatCountdown(2 * 3_600_000 + 3 * 60_000 + 10_000), '2:03:10');
  assert.equal(formatCountdown(-5_000), '0:00', 'past due counts as zero');
});

test('elapsed time is rounded down', () => {
  assert.equal(formatElapsed(35_400), '0:35');
  assert.equal(formatElapsed(999), '0:00');
  assert.equal(formatElapsed(3_725_000), '1:02:05');
  assert.equal(formatElapsed(-1), '0:00');
});

test('a clock time is local HH:MM', () => {
  assert.equal(formatClock(new Date(2026, 9, 2, 14, 37).getTime()), '14:37');
  assert.equal(formatClock(new Date(2026, 9, 2, 9, 5).getTime()), '09:05');
});

test('minutes read the way the Torn wiki writes them', () => {
  assert.equal(formatMinutes(27), '27 min');
  assert.equal(formatMinutes(0), '0 min');
  assert.equal(formatMinutes(127), '2h 7min');
  assert.equal(formatMinutes(180), '3h');
  assert.equal(formatMinutes(24.6), '25 min');
});

test('the real clock tells the real time', () => {
  const before = Date.now();
  const now = realClock.now();
  assert.ok(now >= before && now <= Date.now());
  const handle = realClock.setTimeout(() => {}, 1000);
  realClock.clearTimeout(handle);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/time.test.js`
Expected: FAIL, cannot find `src/core/time.js`.

- [ ] **Step 3: Write `src/core/time.js`**

```js
const pad = (n) => String(n).padStart(2, '0');

function hms(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Time left: `m:ss` under an hour, `h:mm:ss` from an hour. Rounded up, so it
 * reads 0:00 only once the moment has come. Negative counts as zero.
 */
export function formatCountdown(ms) {
  return hms(Math.max(0, Math.ceil(ms / 1000)));
}

/** Time gone by, in the same shape, rounded down. */
export function formatElapsed(ms) {
  return hms(Math.max(0, Math.floor(ms / 1000)));
}

/** A local wall-clock time, `HH:MM` (24-hour). */
export function formatClock(epochMs) {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Whole minutes the way Torn's wiki writes them: `27 min`, `2h 7min`, `3h`. */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}
```

- [ ] **Step 4: Write `src/core/clock.js`**

```js
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
```

- [ ] **Step 5: Run it to see it pass**

Run: `node --test test/time.test.js`
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/core/time.js src/core/clock.js test/time.test.js
git commit -m "feat: countdown, clock and minute formatting; injectable clock" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Storage

**Files:**
- Create: `src/core/storage.js`
- Test: `test/storage.test.js`

- [ ] **Step 1: Write the failing test `test/storage.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeClock, memoryArea, makeTimer, captureConsole, T0, MIN,
} from '../testlib/fakes.js';
import { resetWarnOnce } from '../src/core/log.js';
import {
  createStorage, sanitizeTimer, STORAGE_KEY, STORAGE_VERSION, EXPIRE_AFTER_MS, BUFFER,
} from '../src/core/storage.js';

function fresh({ area = memoryArea(), clock = fakeClock(T0), target = null } = {}) {
  resetWarnOnce();
  return { area, clock, storage: createStorage({ area, target, clock }) };
}

function storageEvent(key) {
  return Object.assign(new Event('storage'), { key });
}

test('a new store has no timers and the default settings', () => {
  const { storage } = fresh();
  assert.deepEqual(storage.getTimers(), []);
  assert.equal(storage.getSetting('bufferMin'), 2);
  assert.equal(storage.getSetting('sound'), true);
  assert.equal(storage.getSetting('widgetPos'), null);
});

test('addTimer stores a clean copy, persists it and survives a reload', () => {
  const { area, clock, storage } = fresh();
  assert.deepEqual(storage.addTimer({ ...makeTimer(), extra: 'dropped' }), makeTimer());
  assert.deepEqual(storage.getTimers(), [makeTimer()]);
  const raw = JSON.parse(area.getItem(STORAGE_KEY));
  assert.equal(raw.version, STORAGE_VERSION);
  assert.deepEqual(raw.timers, [makeTimer()]);
  assert.deepEqual(createStorage({ area, target: null, clock }).getTimers(), [makeTimer()]);
});

test('a second timer for the same player replaces the first', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer());
  storage.addTimer(makeTimer({ destination: 'japan', minutes: 149, landingAt: T0 + 149 * MIN, ringAt: T0 + 147 * MIN }));
  const timers = storage.getTimers();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].destination, 'japan');
});

test('timers come back soonest ring first', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer({ id: 'a', ringAt: T0 + 50 * MIN, landingAt: T0 + 52 * MIN }));
  storage.addTimer(makeTimer({ id: 'b', ringAt: T0 + 10 * MIN, landingAt: T0 + 12 * MIN }));
  storage.addTimer(makeTimer({ id: 'c', ringAt: T0 + 30 * MIN, landingAt: T0 + 32 * MIN }));
  assert.deepEqual(storage.getTimers().map((t) => t.id), ['b', 'c', 'a']);
});

test('an unusable timer is refused and nothing is written', () => {
  const { storage, area } = fresh();
  const bad = [
    null, 'timer', makeTimer({ id: '' }), makeTimer({ id: 7 }), makeTimer({ destination: 'mars' }),
    makeTimer({ plane: 'rocket' }), makeTimer({ minutes: 0 }), makeTimer({ ringAt: 'soon' }),
    makeTimer({ landingAt: Number.NaN }), makeTimer({ startedAt: -1 }),
  ];
  for (const timer of bad) assert.equal(storage.addTimer(timer), null);
  assert.deepEqual(storage.getTimers(), []);
  assert.equal(area.getItem(STORAGE_KEY), null);
});

test('sanitizeTimer fills a missing name and drops a bad direction or rungAt', () => {
  assert.deepEqual(
    sanitizeTimer(makeTimer({ name: '  ', direction: 'sideways', rungAt: 'yes' })),
    makeTimer({ name: '#1234567', direction: null, rungAt: null }),
  );
});

test('removeTimer removes one timer and says whether it did', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer());
  storage.addTimer(makeTimer({ id: '42' }));
  assert.equal(storage.removeTimer('1234567'), true);
  assert.equal(storage.removeTimer('1234567'), false);
  assert.deepEqual(storage.getTimers().map((t) => t.id), ['42']);
});

test('markRung records the first ring only', () => {
  const { storage } = fresh();
  storage.addTimer(makeTimer());
  assert.equal(storage.markRung('1234567', T0 + 25 * MIN), true);
  assert.equal(storage.markRung('1234567', T0 + 26 * MIN), false);
  assert.equal(storage.getTimer('1234567').rungAt, T0 + 25 * MIN);
  assert.equal(storage.markRung('nobody', T0), false);
});

test('a timer expires an hour after its estimated landing', () => {
  const { storage, clock, area } = fresh();
  storage.addTimer(makeTimer());
  clock.tick(27 * MIN + EXPIRE_AFTER_MS - 1);
  assert.equal(storage.getTimers().length, 1);
  clock.tick(1);
  assert.deepEqual(storage.getTimers(), []);
  assert.equal(storage.getTimer('1234567'), null);
  assert.equal(JSON.parse(area.getItem(STORAGE_KEY)).timers.length, 1, 'still stored until pruned');
  assert.equal(storage.prune(), 1);
  assert.deepEqual(JSON.parse(area.getItem(STORAGE_KEY)).timers, []);
  assert.equal(storage.prune(), 0);
});

test('settings are clamped and sanitised', () => {
  const { storage } = fresh();
  assert.equal(storage.setSetting('bufferMin', 2.6), 3);
  assert.equal(storage.setSetting('bufferMin', 99), BUFFER.max);
  assert.equal(storage.setSetting('bufferMin', -4), BUFFER.min);
  assert.equal(storage.setSetting('bufferMin', 'lots'), BUFFER.default);
  assert.equal(storage.setSetting('sound', false), false);
  assert.equal(storage.setSetting('sound', 'loud'), true, 'junk falls back to the default');
  assert.deepEqual(storage.setSetting('widgetPos', { x: 10.4, y: 20.6 }), { x: 10, y: 21 });
  assert.equal(storage.setSetting('widgetPos', { x: 'left' }), null);
  assert.equal(storage.setSetting('nonsense', 1), undefined);
  assert.equal(storage.getSetting('nonsense'), undefined);
});

test('setSetting writes and notifies only when the value changes', () => {
  let writes = 0;
  const area = { getItem: () => null, setItem: () => { writes += 1; } };
  const storage = createStorage({ area, target: null, clock: fakeClock(T0) });
  let hits = 0;
  storage.subscribe(() => { hits += 1; });
  storage.setSetting('bufferMin', 5);
  storage.setSetting('bufferMin', 5);
  storage.setSetting('widgetPos', { x: 1, y: 2 });
  storage.setSetting('widgetPos', { x: 1, y: 2 });
  assert.equal(writes, 2);
  assert.equal(hits, 2);
});

test('corrupt JSON or a wrong version starts fresh with one warning', () => {
  for (const text of ['{not json', JSON.stringify({ version: 99, timers: [makeTimer()] })]) {
    resetWarnOnce();
    const area = memoryArea({ [STORAGE_KEY]: text });
    const warn = captureConsole('warn');
    let storage;
    try {
      storage = createStorage({ area, target: null, clock: fakeClock(T0) });
    } finally {
      warn.restore();
    }
    assert.deepEqual(storage.getTimers(), []);
    assert.equal(warn.calls.length, 1, text);
  }
});

test('stored junk is dropped while good timers and settings survive', () => {
  const area = memoryArea({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      timers: [makeTimer(), { id: 'bad' }, 'junk'],
      settings: { bufferMin: 4, sound: false, widgetPos: { x: 5, y: 6 } },
    }),
  });
  const storage = createStorage({ area, target: null, clock: fakeClock(T0) });
  assert.deepEqual(storage.getTimers(), [makeTimer()]);
  assert.equal(storage.getSetting('bufferMin'), 4);
  assert.equal(storage.getSetting('sound'), false);
  assert.deepEqual(storage.getSetting('widgetPos'), { x: 5, y: 6 });
});

test('a storage event for our key re-reads and notifies; other keys and destroy are ignored', () => {
  const area = memoryArea();
  const target = new EventTarget();
  const { storage } = fresh({ area, target });
  let hits = 0;
  storage.subscribe(() => { hits += 1; });
  area.setItem(STORAGE_KEY, JSON.stringify({ version: 1, timers: [makeTimer()], settings: {} }));
  target.dispatchEvent(storageEvent(STORAGE_KEY));
  assert.equal(hits, 1);
  assert.equal(storage.getTimers().length, 1);
  target.dispatchEvent(storageEvent('someone-elses-key'));
  assert.equal(hits, 1);
  storage.destroy();
  target.dispatchEvent(storageEvent(STORAGE_KEY));
  assert.equal(hits, 1);
});

test('reload picks up another tab\'s write without a storage event', () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const a = createStorage({ area, target: null, clock });
  const b = createStorage({ area, target: null, clock });
  a.addTimer(makeTimer());
  assert.deepEqual(b.getTimers(), []);
  b.reload();
  assert.equal(b.getTimers().length, 1);
});

test('a throwing subscriber does not stop the others', () => {
  const { storage } = fresh();
  const seen = [];
  storage.subscribe(() => { seen.push('first'); throw new Error('bad subscriber'); });
  storage.subscribe(() => { seen.push('second'); });
  const warn = captureConsole('warn');
  try {
    storage.addTimer(makeTimer());
  } finally {
    warn.restore();
  }
  assert.deepEqual(seen, ['first', 'second']);
  assert.equal(warn.calls.length, 1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/storage.test.js`
Expected: FAIL, cannot find `src/core/storage.js`.

- [ ] **Step 3: Write `src/core/storage.js`**

```js
import { warnOnce } from './log.js';
import { realClock } from './clock.js';
import { isDestination, isPlane } from './flights.js';

export const STORAGE_KEY = 'landingtimer.v1';
export const STORAGE_VERSION = 1;

/** A timer clears itself this long after its estimated landing. */
export const EXPIRE_AFTER_MS = 60 * 60 * 1000;

/** How many whole minutes before the estimated landing a timer rings. */
export const BUFFER = Object.freeze({ default: 2, min: 0, max: 30 });

export const DEFAULT_SETTINGS = Object.freeze({
  bufferMin: BUFFER.default,
  /** Chime when a timer comes due. Shared by every tab. */
  sound: true,
  /** Where the timer box was dragged to, or null for its default corner. */
  widgetPos: null,
});

/**
 * @typedef {{
 *   id: string, name: string, destination: string, plane: string,
 *   direction: 'to'|'from'|null, minutes: number,
 *   startedAt: number, landingAt: number, ringAt: number, rungAt: number|null,
 * }} Timer
 */

export function sanitizeBuffer(value) {
  if (!Number.isFinite(value)) return BUFFER.default;
  return Math.min(BUFFER.max, Math.max(BUFFER.min, Math.round(value)));
}

function sanitizePos(raw) {
  return raw && typeof raw === 'object' && Number.isFinite(raw.x) && Number.isFinite(raw.y)
    ? { x: Math.round(raw.x), y: Math.round(raw.y) }
    : null;
}

function sanitizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    bufferMin: sanitizeBuffer(source.bufferMin),
    sound: typeof source.sound === 'boolean' ? source.sound : DEFAULT_SETTINGS.sound,
    widgetPos: sanitizePos(source.widgetPos),
  };
}

const isTime = (value) => Number.isFinite(value) && value > 0;

/** @returns {Timer|null} a clean copy, or null when the record is unusable. */
export function sanitizeTimer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || !isDestination(raw.destination) || !isPlane(raw.plane)) return null;
  if (!(Number.isFinite(raw.minutes) && raw.minutes > 0)) return null;
  if (!isTime(raw.startedAt) || !isTime(raw.landingAt) || !isTime(raw.ringAt)) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `#${id}`;
  return {
    id,
    name,
    destination: raw.destination,
    plane: raw.plane,
    direction: raw.direction === 'to' || raw.direction === 'from' ? raw.direction : null,
    minutes: raw.minutes,
    startedAt: raw.startedAt,
    landingAt: raw.landingAt,
    ringAt: raw.ringAt,
    rungAt: isTime(raw.rungAt) ? raw.rungAt : null,
  };
}

function emptyState() {
  return { version: STORAGE_VERSION, timers: [], settings: sanitizeSettings(null) };
}

function parseState(text) {
  if (text == null) return emptyState();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    warnOnce('storage.read', 'stored timers are not valid JSON; starting fresh');
    return emptyState();
  }
  if (!data || typeof data !== 'object' || data.version !== STORAGE_VERSION) {
    warnOnce('storage.read', `stored timers have version ${data && data.version}, expected ${STORAGE_VERSION}; starting fresh`);
    return emptyState();
  }
  const byId = new Map();
  for (const raw of Array.isArray(data.timers) ? data.timers : []) {
    const timer = sanitizeTimer(raw);
    if (timer) byId.set(timer.id, timer);
  }
  return { version: STORAGE_VERSION, timers: [...byId.values()], settings: sanitizeSettings(data.settings) };
}

/**
 * Timers and settings in one localStorage key, shared live with the player's
 * other Torn tabs through the `storage` event.
 */
export function createStorage({ area = globalThis.localStorage, target = globalThis.window, clock = realClock } = {}) {
  let state = emptyState();
  const listeners = new Set();

  function read() {
    try {
      state = parseState(area ? area.getItem(STORAGE_KEY) : null);
    } catch (err) {
      warnOnce('storage.read', 'could not read stored timers; starting fresh:', err);
      state = emptyState();
    }
  }

  function write() {
    try {
      if (area) area.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // Quota errors repeat on every write; warn once and keep the in-memory state.
      warnOnce('storage.write', 'could not save timers:', err);
    }
  }

  function notify() {
    for (const listener of [...listeners]) {
      // A bad subscriber must never break the rest, and must not spam the console.
      try {
        listener();
      } catch (err) {
        warnOnce('storage.subscriber', 'a storage subscriber threw:', err);
      }
    }
  }

  function commit() {
    write();
    notify();
  }

  const live = (timer) => clock.now() - timer.landingAt < EXPIRE_AFTER_MS;

  /** Every timer that has not expired, soonest ring first. @returns {Timer[]} */
  function getTimers() {
    return state.timers.filter(live).sort((a, b) => a.ringAt - b.ringAt).map((t) => ({ ...t }));
  }

  /** @returns {Timer|null} */
  function getTimer(id) {
    const timer = state.timers.find((t) => t.id === id);
    return timer && live(timer) ? { ...timer } : null;
  }

  /** Stores a timer, replacing any timer for the same player. @returns {Timer|null} */
  function addTimer(raw) {
    const timer = sanitizeTimer(raw);
    if (!timer) return null;
    state.timers = state.timers.filter((t) => t.id !== timer.id).concat(timer);
    commit();
    return { ...timer };
  }

  /** @returns {boolean} whether a timer was removed. */
  function removeTimer(id) {
    const next = state.timers.filter((t) => t.id !== id);
    if (next.length === state.timers.length) return false;
    state.timers = next;
    commit();
    return true;
  }

  /** Records that a timer rang. @returns {boolean} false if it had already rung or is gone. */
  function markRung(id, at) {
    const timer = state.timers.find((t) => t.id === id);
    if (!timer || timer.rungAt != null) return false;
    timer.rungAt = at;
    commit();
    return true;
  }

  /** Drops expired timers from storage. @returns {number} how many went. */
  function prune() {
    const next = state.timers.filter(live);
    const gone = state.timers.length - next.length;
    if (gone) {
      state.timers = next;
      commit();
    }
    return gone;
  }

  /** @returns {*} the stored value, or undefined for a name that is not a setting. */
  function getSetting(name) {
    const value = state.settings[name];
    return value && typeof value === 'object' ? { ...value } : value;
  }

  /** Sanitises and stores `value`; unknown names are dropped. @returns the stored value. */
  function setSetting(name, value) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, name)) return undefined;
    const next = sanitizeSettings({ ...state.settings, [name]: value });
    if (JSON.stringify(next[name]) !== JSON.stringify(state.settings[name])) {
      state.settings = next;
      commit();
    }
    return getSetting(name);
  }

  /** Re-reads storage, for when another tab may have written a moment ago. */
  function reload() {
    read();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const onStorage = (event) => {
    const key = event && event.key;
    if (key != null && key !== STORAGE_KEY) return;
    read();
    notify();
  };

  function destroy() {
    if (target && typeof target.removeEventListener === 'function') {
      target.removeEventListener('storage', onStorage);
    }
    listeners.clear();
  }

  read();
  if (target && typeof target.addEventListener === 'function') {
    target.addEventListener('storage', onStorage);
  }

  return {
    getTimers, getTimer, addTimer, removeTimer, markRung, prune,
    getSetting, setSetting, reload, subscribe, destroy,
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test test/storage.test.js`
Expected: 16 passing.

- [ ] **Step 5: Commit**

```bash
git add src/core/storage.js test/storage.test.js
git commit -m "feat: timer and settings storage, shared across tabs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Reading the profile

**Files:**
- Create: `src/core/selectors.js`, `src/profile/readStatus.js`, `test/fixtures/outbound-commercial.html`
- Test: `test/readStatus.test.js`, `test/realMarkup.test.js`

**Background:** the player sent a DevTools screenshot of a real travelling profile on 2026-10-02. The fixture in Step 1 is transcribed from it. Two things to know about the real markup:
- On a Commercial flight the status box classes carry **no** plane word (`travelling to canada  `), so the plane comes from the `aria-label`.
- The `aria-label` has spaces before its full stop.

`ff-flight-element` and `interactionLog___lLO31` come from another userscript and from Torn's hashed CSS. They stay in the fixture as they appeared, but no selector may use them.

- [ ] **Step 1: Write the real fixture `test/fixtures/outbound-commercial.html`**

```html
<!-- Real Torn markup, transcribed from a DevTools screenshot the player sent on
     2026-10-02: a profile of someone flying Torn to Canada, Commercial.
     Nodes that were collapsed in the screenshot are left empty.
     ff-flight-element comes from another userscript; interactionLog___lLO31
     is a hashed Torn class. Neither may ever be used as a selector. -->
<div class="profile-right-wrapper right">
  <div class="profile-buttons profile-action"></div>
  <div class="m-top10 border-round interactionLog___lLO31"></div>
  <div class="profile-status m-top10 travelling to canada  ">
    <div>
      <div class="cont bottom-round border-round">
        <div class="profile-container">
          <div class="icon-wrapper"></div>
          <div class="description">
            <div class="desc-wrap">
              <span class="main-desc" aria-label="Traveling from Torn to Canada  . Type of plane: Commercial"><span aria-hidden="true">Torn to Canada </span></span>
              <span class="sub-desc"></span>
            </div>
            <div class="ff-flight-element"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="clear"></div>
</div>
```

- [ ] **Step 2: Write the failing test `test/readStatus.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { statusHtml, profileDoc, PROFILE_URL } from '../testlib/dom.js';
import {
  readStatus, parseClasses, parsePlaneLabel, parseStatusText, countryFromName,
} from '../src/profile/readStatus.js';

function read(status, docOptions = {}) {
  const dom = profileDoc({ status: statusHtml(status), ...docOptions });
  return readStatus(dom.window.document, docOptions.url || PROFILE_URL);
}

const PLAYER = { id: '1234567', name: 'SomeName' };

test('an outbound airstrip flight is read from the status box', () => {
  assert.deepEqual(read({
    classes: 'profile-status m-top10 travelling to canada airstrip',
    label: 'Traveling from Torn to Canada. Type of plane: Personal',
    text: 'Torn to Canada',
  }), { ...PLAYER, state: 'traveling', direction: 'to', destination: 'canada', plane: 'airstrip' });
});

test('a commercial flight home from the UK', () => {
  assert.deepEqual(read({
    classes: 'profile-status m-top10 travelling from united kingdom  ',
    label: 'Traveling from United Kingdom to Torn  . Type of plane: Commercial',
    text: 'United Kingdom to Torn',
  }), { ...PLAYER, state: 'traveling', direction: 'from', destination: 'uk', plane: 'commercial' });
});

test('the classes alone are enough', () => {
  assert.deepEqual(read({ classes: 'profile-status m-top10 travelling to south africa private' }),
    { ...PLAYER, state: 'traveling', direction: 'to', destination: 'southafrica', plane: 'private' });
});

test('every country is recognised from its class words', () => {
  const cases = {
    mexico: 'mexico', 'cayman islands': 'cayman', canada: 'canada', hawaii: 'hawaii',
    'united kingdom': 'uk', argentina: 'argentina', switzerland: 'switzerland', japan: 'japan',
    china: 'china', uae: 'uae', 'south africa': 'southafrica',
  };
  for (const [words, key] of Object.entries(cases)) {
    assert.equal(parseClasses(['travelling', 'to', ...words.split(' ')]).destination, key, words);
  }
});

test('classes with no route claim nothing', () => {
  assert.deepEqual(parseClasses(['profile-status', 'm-top10']), {});
  assert.deepEqual(parseClasses(['profile-status', 'travelling']), {});
  assert.deepEqual(parseClasses(['travelling', 'to', 'constructor']).destination, null);
});

test('the plane label alone gives direction, destination and plane', () => {
  assert.deepEqual(parsePlaneLabel('Traveling from Japan to Torn. Type of plane: Private'),
    { state: 'traveling', direction: 'from', destination: 'japan', plane: 'private' });
  assert.equal(parsePlaneLabel('Traveling from Torn to Mexico. Type of plane: Personal').plane, 'airstrip');
  assert.equal(parsePlaneLabel('Traveling from Torn to Canada  . Type of plane: Commercial').destination, 'canada');
  assert.deepEqual(parsePlaneLabel('Okay'), {});
  assert.deepEqual(parsePlaneLabel(null), {});
});

test('every status wording is read from the text', () => {
  const travel = (direction, destination) => ({ state: 'traveling', direction, destination });
  const cases = [
    ['Torn to Mexico', travel('to', 'mexico')],
    ['Mexico to Torn', travel('from', 'mexico')],
    ['Traveling from Torn to UAE', travel('to', 'uae')],
    ['Traveling from UAE to Torn', travel('from', 'uae')],
    ['Traveling to Japan', travel('to', 'japan')],
    ['Returning to Torn from United Arab Emirates', travel('from', 'uae')],
    ['  Torn   to\n Cayman Islands ', travel('to', 'cayman')],
    ['In Hawaii', { state: 'abroad', destination: 'hawaii' }],
    ['Hiding out in South Africa', { state: 'abroad', destination: 'southafrica' }],
    ['Traveling', { state: 'hidden' }],
    ['Okay', {}],
    ['In a Swiss hospital for 2 hrs', {}],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseStatusText(text), expected, text);
  assert.deepEqual(parseStatusText(null), {});
});

test('country names match however Torn writes them', () => {
  assert.equal(countryFromName('UAE'), 'uae');
  assert.equal(countryFromName('United Arab Emirates'), 'uae');
  assert.equal(countryFromName('the UK'), 'uk');
  assert.equal(countryFromName('South Africa.'), 'southafrica');
  assert.equal(countryFromName('Mars'), null);
  assert.equal(countryFromName('constructor'), null);
});

test('disguised travel gives no destination or plane', () => {
  assert.deepEqual(read({ text: 'Traveling' }),
    { ...PLAYER, state: 'hidden', direction: null, destination: null, plane: null });
});

test('abroad keeps the country but no direction or plane', () => {
  assert.deepEqual(read({ text: 'In Mexico' }),
    { ...PLAYER, state: 'abroad', direction: null, destination: 'mexico', plane: null });
});

test('a player at home, or a page with no status box, reads as other', () => {
  const nobody = { ...PLAYER, state: 'other', direction: null, destination: null, plane: null };
  assert.deepEqual(read({ text: 'Okay' }), nobody);
  const dom = profileDoc({ status: '' });
  assert.deepEqual(readStatus(dom.window.document, PROFILE_URL), nobody);
});

test('the id comes from the address first, then the title', () => {
  const dom = profileDoc({ title: 'OtherName [7654321] | TORN' });
  const doc = dom.window.document;
  assert.equal(readStatus(doc, 'https://www.torn.com/profiles.php?XID=1234567').id, '1234567');
  assert.equal(readStatus(doc, 'https://www.torn.com/profiles.php?NID=OtherName').id, '7654321');
  assert.equal(readStatus(doc, 'not a url').id, '7654321');
});

test('the name comes from the heading first, then the title', () => {
  assert.equal(read({}, { heading: "SomeName's Profile" }).name, 'SomeName');
  assert.equal(read({}, { heading: 'Profile', title: 'OtherName [7654321] | TORN' }).name, 'OtherName');
  assert.equal(read({}, { heading: 'Profile', title: 'TORN' }).name, null);
});
```

- [ ] **Step 3: Write the failing test `test/realMarkup.test.js`**

Task 14 appends rows to `CASES` as the player sends more captures.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { PROFILE_URL } from '../testlib/dom.js';
import * as selectors from '../src/core/selectors.js';
import { readStatus, parseClasses, parsePlaneLabel, parseStatusText } from '../src/profile/readStatus.js';

/**
 * Real Torn markup the player captured, and what they saw on the page at the
 * time. Every fixture must read back exactly what the player saw.
 */
const CASES = [
  {
    file: 'outbound-commercial.html',
    seen: 'flying Torn to Canada, Commercial (2026-10-02)',
    expect: { state: 'traveling', direction: 'to', destination: 'canada', plane: 'commercial' },
  },
];

function load(file) {
  const html = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
  return new JSDOM(`<!doctype html><body>${html}</body>`, { url: PROFILE_URL }).window.document;
}

for (const { file, seen, expect } of CASES) {
  test(`real markup: ${seen}`, () => {
    const status = readStatus(load(file), PROFILE_URL);
    for (const [field, value] of Object.entries(expect)) assert.equal(status[field], value, field);
  });
}

test('real markup: each source reads what it carries on a Commercial flight', () => {
  const box = selectors.statusBox(load('outbound-commercial.html'));
  assert.ok(box, 'the status box is found');
  assert.deepEqual(parseClasses(selectors.statusClasses(box)),
    { state: 'traveling', direction: 'to', destination: 'canada', plane: null },
    'Commercial puts no plane word in the classes');
  assert.equal(parsePlaneLabel(selectors.planeAriaLabel(box)).plane, 'commercial');
  assert.equal(selectors.statusText(box), 'Torn to Canada');
  assert.equal(parseStatusText(selectors.statusText(box)).destination, 'canada');
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `node --test test/readStatus.test.js test/realMarkup.test.js`
Expected: FAIL, cannot find `src/profile/readStatus.js`.

- [ ] **Step 5: Write `src/core/selectors.js`**

```js
/**
 * The ONLY module that knows the shape of Torn's profile page.
 * If Torn changes its markup, this is the one file to edit.
 *
 * Hashed CSS-module class names (e.g. interactionLog___lLO31) must never
 * appear here: they change between Torn builds. Neither may anything another
 * userscript adds (e.g. ff-flight-element).
 *
 * Worked out from Torn's profile stylesheet and app code and confirmed against
 * real markup the player captured (test/fixtures/).
 */

export const PROFILE_PATH = '/profiles.php';

/** The status box. Its classes say `travelling to|from <country words> [airstrip|private]`. */
export const STATUS_BOX_SELECTOR = 'div.profile-status';
/** The status a sighted player reads: "Torn to Canada", "In Mexico", "Traveling". */
export const STATUS_TEXT_SELECTOR = '.main-desc > span[aria-hidden]';
/** Fallback if the inner span goes: the whole description. */
export const STATUS_DESC_SELECTOR = '.main-desc';
/** span.main-desc's aria-label: "Traveling from Torn to Canada  . Type of plane: Commercial". */
export const PLANE_LABEL_SELECTOR = '[aria-label*="Type of plane"]';
/** The page heading, "<name>'s Profile". To be confirmed against a real capture. */
export const PROFILE_HEADING_SELECTOR = '#skip-to-content';

const squash = (text) => text.replace(/\s+/g, ' ').trim();

export function isProfilePage(loc) {
  return !!loc && loc.pathname === PROFILE_PATH;
}

/** @returns {Element|null} */
export function statusBox(doc) {
  return doc ? doc.querySelector(STATUS_BOX_SELECTOR) : null;
}

/** @returns {string[]} the status box's class names, lower-cased. */
export function statusClasses(box) {
  return box ? [...box.classList].map((name) => name.toLowerCase()) : [];
}

/** @returns {string|null} the status sentence, whitespace squashed. */
export function statusText(box) {
  if (!box) return null;
  const node = box.querySelector(STATUS_TEXT_SELECTOR) || box.querySelector(STATUS_DESC_SELECTOR);
  const text = node ? squash(node.textContent) : '';
  return text || null;
}

/** @returns {string|null} the aria-label that names the plane, on the box or inside it. */
export function planeAriaLabel(box) {
  if (!box) return null;
  const node = box.matches(PLANE_LABEL_SELECTOR) ? box : box.querySelector(PLANE_LABEL_SELECTOR);
  return node ? node.getAttribute('aria-label') : null;
}

/** @returns {string|null} the player id from a profiles.php?XID=… address. */
export function profileIdFromUrl(href) {
  try {
    const id = new URL(href).searchParams.get('XID');
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** @returns {{ name: string|null, id: string|null }} whose profile the page says this is. */
export function profileIdentity(doc) {
  const heading = doc ? doc.querySelector(PROFILE_HEADING_SELECTOR) : null;
  const fromHeading = heading ? /^(.+?)['’]s Profile$/i.exec(squash(heading.textContent)) : null;
  const fromTitle = doc && typeof doc.title === 'string' ? /^\s*(.+?)\s*\[(\d+)\]/.exec(doc.title) : null;
  return {
    name: fromHeading ? fromHeading[1] : (fromTitle ? fromTitle[1] : null),
    id: fromTitle ? fromTitle[2] : null,
  };
}
```

- [ ] **Step 6: Write `src/profile/readStatus.js`**

```js
import * as selectors from '../core/selectors.js';

/**
 * @typedef {{
 *   id: string|null, name: string|null,
 *   state: 'traveling'|'hidden'|'abroad'|'other',
 *   direction: 'to'|'from'|null,
 *   destination: string|null,
 *   plane: 'commercial'|'airstrip'|'private'|null,
 * }} ProfileStatus
 */

/** The class-name word Torn's stylesheet keys each country on. */
const COUNTRY_CLASS = new Map([
  ['mexico', 'mexico'], ['cayman', 'cayman'], ['canada', 'canada'], ['hawaii', 'hawaii'],
  ['kingdom', 'uk'], ['argentina', 'argentina'], ['switzerland', 'switzerland'],
  ['japan', 'japan'], ['china', 'china'], ['uae', 'uae'], ['africa', 'southafrica'],
]);

/** Country names as Torn writes them in status text, lower-cased. */
const COUNTRY_NAME = new Map([
  ['mexico', 'mexico'], ['cayman islands', 'cayman'], ['canada', 'canada'], ['hawaii', 'hawaii'],
  ['united kingdom', 'uk'], ['uk', 'uk'], ['argentina', 'argentina'], ['switzerland', 'switzerland'],
  ['japan', 'japan'], ['china', 'china'], ['uae', 'uae'], ['united arab emirates', 'uae'],
  ['south africa', 'southafrica'],
]);

/** Plane words in the status classes. Commercial has none (seen live 2026-10-02). */
const PLANE_CLASS = new Set(['commercial', 'airstrip', 'private']);

/** "Type of plane: <word>" → the profile's plane. Torn calls the airstrip plane "Personal". */
const PLANE_WORD = new Map([
  ['commercial', 'commercial'], ['personal', 'airstrip'], ['airstrip', 'airstrip'], ['private', 'private'],
]);

/** @returns {string|null} a destination key for a country name as Torn writes it. */
export function countryFromName(text) {
  if (typeof text !== 'string') return null;
  const key = text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').replace(/^the /, '');
  return COUNTRY_NAME.get(key) || null;
}

/** Reads the status box's classes. Claims nothing unless they name a route. */
export function parseClasses(classes) {
  if (!classes.includes('travelling') && !classes.includes('traveling')) return {};
  const direction = classes.includes('to') ? 'to' : (classes.includes('from') ? 'from' : null);
  const country = classes.find((name) => COUNTRY_CLASS.has(name));
  const destination = country ? COUNTRY_CLASS.get(country) : null;
  if (!direction && !destination) return {};
  return {
    state: 'traveling',
    direction,
    destination,
    plane: classes.find((name) => PLANE_CLASS.has(name)) || null,
  };
}

function travel(direction, place) {
  return { state: 'traveling', direction, destination: countryFromName(place) };
}

/** Status wordings, newest first. The old ones survive in Torn's hospital and jail variants. */
const TEXT_RULES = [
  [/^traveling$/i, () => ({ state: 'hidden' })],
  [/^(?:traveling from )?torn to (.+)$/i, (m) => travel('to', m[1])],
  [/^(?:traveling from )?(.+) to torn$/i, (m) => travel('from', m[1])],
  [/^traveling to (.+)$/i, (m) => travel('to', m[1])],
  [/^returning to torn from (.+)$/i, (m) => travel('from', m[1])],
  [/^(?:hiding out )?in (.+)$/i, (m) => {
    const destination = countryFromName(m[1]);
    return destination ? { state: 'abroad', destination } : {};
  }],
];

/** Reads a status sentence: "Torn to Mexico", "In Mexico", "Traveling", … */
export function parseStatusText(text) {
  if (typeof text !== 'string') return {};
  const clean = text.replace(/\s+/g, ' ').trim();
  for (const [pattern, make] of TEXT_RULES) {
    const match = pattern.exec(clean);
    if (match) return make(match);
  }
  return {};
}

/** Reads "Traveling from <route>. Type of plane: <word>". */
export function parsePlaneLabel(label) {
  if (typeof label !== 'string') return {};
  const match = /^(.*?)\.?\s*Type of plane:\s*(\w+)/i.exec(label);
  if (!match) return {};
  return { ...parseStatusText(match[1]), plane: PLANE_WORD.get(match[2].toLowerCase()) || null };
}

/**
 * Everything the open profile says about where its player is going. The
 * classes are trusted first, then the plane label, then the visible text; a
 * field nothing could read is null. Never throws on a strange page.
 * @returns {ProfileStatus}
 */
export function readStatus(doc, href) {
  const box = selectors.statusBox(doc);
  const sources = [
    parseClasses(selectors.statusClasses(box)),
    parsePlaneLabel(selectors.planeAriaLabel(box)),
    parseStatusText(selectors.statusText(box)),
  ];
  const pick = (field) => {
    for (const source of sources) if (source[field] != null) return source[field];
    return null;
  };
  const identity = selectors.profileIdentity(doc);
  const state = pick('state') || 'other';
  const travelling = state === 'traveling';
  return {
    id: selectors.profileIdFromUrl(href) || identity.id,
    name: identity.name,
    state,
    direction: travelling ? pick('direction') : null,
    destination: travelling || state === 'abroad' ? pick('destination') : null,
    plane: travelling ? pick('plane') : null,
  };
}
```

- [ ] **Step 7: Run them to see them pass**

Run: `node --test test/readStatus.test.js test/realMarkup.test.js`
Expected: 13 + 2 passing.

- [ ] **Step 8: Commit**

```bash
git add src/core/selectors.js src/profile/readStatus.js test/readStatus.test.js test/realMarkup.test.js test/fixtures
git commit -m "feat: read destination, direction and plane from the profile status" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The element builder and the panel

**Files:**
- Create: `src/core/dom.js`, `src/profile/panel.js`
- Test: `test/panel.test.js`

- [ ] **Step 1: Write `src/core/dom.js`**

```js
/**
 * Builds an element. `className`, `text` (set as textContent), `attrs`
 * (true → empty attribute, null/false → left off) and `on` listeners are all
 * optional; children are nodes or strings. Text from the page always goes in
 * as text, never as HTML.
 */
export function el(doc, tag, { className, text, attrs, on } = {}, children = []) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (on) {
    for (const [type, listener] of Object.entries(on)) node.addEventListener(type, listener);
  }
  for (const child of children) {
    if (child != null && child !== '') node.append(child);
  }
  return node;
}
```

- [ ] **Step 2: Write the failing test `test/panel.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fakeClock, memoryArea, T0, MIN } from '../testlib/fakes.js';
import { createStorage } from '../src/core/storage.js';
import { formatClock } from '../src/core/time.js';
import { createPanel, planTimer, describeStatus, PANEL_CLASS } from '../src/profile/panel.js';

const AIRSTRIP = {
  id: '1234567', name: 'SomeName', state: 'traveling', direction: 'to', destination: 'canada', plane: 'airstrip',
};

function setup(status = AIRSTRIP, { bufferMin } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="anchor">open</button><p id="away">x</p></body>', { pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  const clock = fakeClock(T0);
  const storage = createStorage({ area: memoryArea(), target: null, clock });
  if (bufferMin != null) storage.setSetting('bufferMin', bufferMin);
  const panel = createPanel({ doc, storage, clock });
  const anchor = doc.getElementById('anchor');
  panel.open(anchor, status);
  const root = panel.element;
  const q = (selector) => root.querySelector(selector);
  return {
    win, doc, clock, storage, panel, anchor, root, q,
    select: () => q('select[name="destination"]'),
    radio: (plane) => q(`input[type="radio"][value="${plane}"]`),
    checked: () => {
      const radio = q('input[type="radio"]:checked');
      return radio ? radio.value : null;
    },
    buffer: () => q('input[name="buffer"]'),
    minutes: (plane) => q(`[data-plane="${plane}"] .${PANEL_CLASS}__minutes`).textContent,
    tag: (plane) => q(`[data-plane="${plane}"] .${PANEL_CLASS}__tag`).textContent,
    start: () => q('[data-action="start"]'),
    cancel: () => q('[data-action="cancel"]'),
    summary: () => q(`.${PANEL_CLASS}__summary`).textContent,
    variance: () => q(`.${PANEL_CLASS}__variance`).textContent,
    status: () => q(`.${PANEL_CLASS}__status`).textContent,
  };
}

function choose(win, input, value) {
  if (input.type === 'radio') input.checked = true;
  else input.value = value;
  input.dispatchEvent(new win.Event(input.tagName === 'SELECT' || input.type === 'radio' ? 'change' : 'input', { bubbles: true }));
}

test('planTimer counts from now and rings the buffer early, never before now', () => {
  assert.deepEqual(planTimer({ destination: 'canada', plane: 'airstrip', bufferMin: 2, now: T0 }),
    { minutes: 27, startedAt: T0, landingAt: T0 + 27 * MIN, ringAt: T0 + 25 * MIN });
  assert.equal(planTimer({ destination: 'mexico', plane: 'business', bufferMin: 30, now: T0 }).ringAt, T0);
  assert.equal(planTimer({ destination: null, plane: 'airstrip', bufferMin: 2, now: T0 }), null);
  assert.equal(planTimer({ destination: 'canada', plane: null, bufferMin: 2, now: T0 }), null);
});

test('the status line reads the profile back', () => {
  assert.equal(describeStatus(AIRSTRIP), 'Torn → Canada · plane on profile: Airstrip');
  assert.equal(describeStatus({ ...AIRSTRIP, direction: 'from', destination: 'uk', plane: 'commercial' }),
    'United Kingdom → Torn · plane on profile: Commercial');
  assert.equal(describeStatus({ ...AIRSTRIP, plane: null }), 'Torn → Canada · plane on profile: not shown');
  assert.equal(describeStatus({ ...AIRSTRIP, state: 'hidden', direction: null, destination: null, plane: null }),
    'Travelling disguised: pick the destination and plane.');
  assert.equal(describeStatus({ ...AIRSTRIP, state: 'abroad', direction: null, destination: 'mexico', plane: null }),
    'In Mexico. Not flying yet: the timer starts when you press Start.');
  assert.equal(describeStatus({ ...AIRSTRIP, state: 'other', direction: null, destination: null, plane: null }),
    'Not flying right now: the timer starts when you press Start.');
});

test('an airstrip flight opens pre-filled with every time listed', () => {
  const p = setup();
  assert.match(p.q(`.${PANEL_CLASS}__title`).textContent, /^Landing timer: SomeName \[1234567\]$/);
  assert.equal(p.status(), 'Torn → Canada · plane on profile: Airstrip');
  assert.equal(p.select().value, 'canada');
  assert.equal(p.checked(), 'airstrip');
  assert.equal(p.tag('airstrip'), '← from profile');
  assert.equal(p.tag('standard'), '');
  assert.deepEqual(['standard', 'airstrip', 'private', 'business'].map(p.minutes), ['39 min', '27 min', '19 min', '12 min']);
  assert.equal(p.buffer().value, '2');
  assert.equal(p.start().disabled, false);
  assert.equal(p.summary(), `Rings in 25 min (${formatClock(T0 + 25 * MIN)})`);
  assert.equal(p.variance(), 'Flights vary up to ~3% (about 1 min on this one)');
});

test('Commercial picks Standard and points at Business', () => {
  const p = setup({ ...AIRSTRIP, direction: 'from', destination: 'uk', plane: 'commercial' });
  assert.equal(p.checked(), 'standard');
  assert.equal(p.tag('standard'), '← from profile');
  assert.equal(p.tag('business'), '← also Commercial');
  assert.equal(p.minutes('standard'), '2h 31min');
});

test('disguised travel opens blank, and Start waits for both choices', () => {
  const p = setup({ ...AIRSTRIP, state: 'hidden', direction: null, destination: null, plane: null });
  assert.equal(p.select().value, '');
  assert.equal(p.checked(), null);
  assert.equal(p.minutes('standard'), '–');
  assert.equal(p.start().disabled, true);
  assert.equal(p.summary(), 'Pick a destination and a plane.');
  assert.equal(p.variance(), '');
  choose(p.win, p.select(), 'japan');
  assert.equal(p.minutes('standard'), '3h 33min');
  assert.equal(p.start().disabled, true);
  choose(p.win, p.radio('airstrip'), 'airstrip');
  assert.equal(p.start().disabled, false);
  assert.equal(p.summary(), `Rings in 2h 27min (${formatClock(T0 + 147 * MIN)})`);
});

test('the buffer moves the ring time, and one past the flight rings now', () => {
  const p = setup();
  choose(p.win, p.buffer(), '5');
  assert.equal(p.summary(), `Rings in 22 min (${formatClock(T0 + 22 * MIN)})`);
  choose(p.win, p.buffer(), '30');
  assert.equal(p.summary(), `Rings now (${formatClock(T0)})`);
  choose(p.win, p.buffer(), '');
  assert.equal(p.summary(), `Rings in 25 min (${formatClock(T0 + 25 * MIN)})`, 'an empty box means the default 2');
});

test('the variance line scales with the flight', () => {
  const short = setup({ ...AIRSTRIP, destination: 'mexico', plane: null });
  choose(short.win, short.radio('business'), 'business');
  assert.equal(short.variance(), 'Flights vary up to ~3% (under 1 min on this one)');
  const long = setup({ ...AIRSTRIP, destination: 'southafrica', plane: 'commercial' });
  assert.equal(long.variance(), 'Flights vary up to ~3% (about 8 min on this one)');
});

test('Start saves the timer and the buffer, then closes', () => {
  const p = setup();
  choose(p.win, p.buffer(), '3');
  p.start().click();
  assert.deepEqual(p.storage.getTimers(), [{
    id: '1234567', name: 'SomeName', destination: 'canada', plane: 'airstrip', direction: 'to',
    minutes: 27, startedAt: T0, landingAt: T0 + 27 * MIN, ringAt: T0 + 24 * MIN, rungAt: null,
  }]);
  assert.equal(p.storage.getSetting('bufferMin'), 3);
  assert.equal(p.panel.isOpen(), false);
  assert.equal(p.root.isConnected, false);
});

test('the buffer opens at the last value used', () => {
  assert.equal(setup(AIRSTRIP, { bufferMin: 4 }).buffer().value, '4');
});

test('a player with no id is keyed by name, and one with neither still works', () => {
  const named = setup({ ...AIRSTRIP, id: null, name: 'Ghost' });
  named.start().click();
  assert.equal(named.storage.getTimers()[0].id, 'name:Ghost');
  const nobody = setup({ ...AIRSTRIP, id: null, name: null });
  nobody.start().click();
  assert.deepEqual(nobody.storage.getTimers().map((t) => [t.id, t.name]), [['name:unknown', 'Unknown player']]);
});

test('Escape, Cancel and a press outside close it; a press inside does not', () => {
  const p = setup();
  p.select().dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(p.panel.isOpen(), true);
  p.anchor.dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(p.panel.isOpen(), true, 'the button that opened it is not "outside"');
  p.doc.getElementById('away').dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(p.panel.isOpen(), false);

  const q = setup();
  q.doc.dispatchEvent(new q.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(q.panel.isOpen(), false);

  const r = setup();
  r.cancel().click();
  assert.equal(r.panel.isOpen(), false);
  assert.deepEqual(r.storage.getTimers(), []);
});

test('reopening replaces the old panel instead of stacking a second', () => {
  const p = setup();
  p.panel.open(p.anchor, AIRSTRIP);
  assert.equal(p.doc.querySelectorAll(`.${PANEL_CLASS}`).length, 1);
});

test('a name is shown as text, never as markup', () => {
  const p = setup({ ...AIRSTRIP, name: '<img src=x onerror=alert(1)>' });
  assert.equal(p.root.querySelector('img'), null);
  assert.match(p.q(`.${PANEL_CLASS}__title`).textContent, /<img src=x onerror=alert\(1\)>/);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test test/panel.test.js`
Expected: FAIL, cannot find `src/profile/panel.js`.

- [ ] **Step 4: Write `src/profile/panel.js`**

```js
import { el } from '../core/dom.js';
import { realClock } from '../core/clock.js';
import {
  DESTINATIONS, PLANES, PROFILE_PLANES, destinationName, minutesFor, varianceMinutes,
} from '../core/flights.js';
import { BUFFER, sanitizeBuffer } from '../core/storage.js';
import { formatClock, formatMinutes } from '../core/time.js';

export const PANEL_CLASS = 'landingtimer-panel';

const MINUTE = 60 * 1000;

/**
 * The timer a Start press would create, or null until a destination and a
 * plane are chosen. It rings `bufferMin` minutes before the estimated landing,
 * but never before now.
 */
export function planTimer({ destination, plane, bufferMin, now }) {
  const minutes = minutesFor(destination, plane);
  if (minutes == null) return null;
  const landingAt = now + minutes * MINUTE;
  const ringAt = Math.max(now, landingAt - sanitizeBuffer(bufferMin) * MINUTE);
  return { minutes, startedAt: now, landingAt, ringAt };
}

/** The panel's one-line reading of the profile. */
export function describeStatus(status) {
  const place = destinationName(status.destination);
  if (status.state === 'hidden') return 'Travelling disguised: pick the destination and plane.';
  if (status.state === 'traveling') {
    const route = status.direction === 'from' ? `${place || '?'} → Torn` : `Torn → ${place || '?'}`;
    const plane = status.plane ? PROFILE_PLANES[status.plane].label : 'not shown';
    return `${route} · plane on profile: ${plane}`;
  }
  if (status.state === 'abroad' && place) return `In ${place}. Not flying yet: the timer starts when you press Start.`;
  return 'Not flying right now: the timer starts when you press Start.';
}

/** The note beside a plane: which one the profile showed, and Business's look-alike. */
function planeTag(status, planeKey) {
  if (!status.plane) return '';
  if (planeKey === PROFILE_PLANES[status.plane].pick) return '← from profile';
  if (status.plane === 'commercial' && planeKey === 'business') return '← also Commercial';
  return '';
}

/**
 * The popover a profile's Landing timer button opens. open(anchor, status)
 * shows it under `anchor`, filled in from a ProfileStatus; Start stores the
 * timer and closes it.
 */
export function createPanel({ doc = globalThis.document, storage, clock = realClock }) {
  const win = doc.defaultView;
  let root = null;
  let parts = null;
  let anchor = null;
  let status = null;
  let cleanup = [];

  function listen(target, type, listener, capture = false) {
    target.addEventListener(type, listener, capture);
    cleanup.push(() => target.removeEventListener(type, listener, capture));
  }

  function chosen() {
    const radio = parts.radios.find((r) => r.checked);
    const raw = parts.buffer.value.trim();
    return {
      destination: parts.select.value || null,
      plane: radio ? radio.value : null,
      bufferMin: raw === '' ? BUFFER.default : sanitizeBuffer(Number(raw)),
    };
  }

  function update() {
    if (!parts) return;
    const { destination, plane, bufferMin } = chosen();
    for (const p of PLANES) {
      const minutes = minutesFor(destination, p.key);
      parts.minutes[p.key].textContent = minutes == null ? '–' : formatMinutes(minutes);
    }
    const now = clock.now();
    const plan = planTimer({ destination, plane, bufferMin, now });
    parts.start.disabled = !plan;
    if (!plan) {
      parts.summary.textContent = 'Pick a destination and a plane.';
      parts.variance.textContent = '';
      return;
    }
    const wait = plan.ringAt - now;
    parts.summary.textContent = wait > 0
      ? `Rings in ${formatMinutes(wait / MINUTE)} (${formatClock(plan.ringAt)})`
      : `Rings now (${formatClock(plan.ringAt)})`;
    const spread = varianceMinutes(plan.minutes);
    parts.variance.textContent = `Flights vary up to ~3% (${spread < 1 ? 'under 1 min' : `about ${spread} min`} on this one)`;
  }

  function startTimer() {
    const { destination, plane, bufferMin } = chosen();
    const plan = planTimer({ destination, plane, bufferMin, now: clock.now() });
    if (!plan) return;
    storage.addTimer({
      id: status.id || `name:${status.name || 'unknown'}`,
      name: status.name || (status.id ? `#${status.id}` : 'Unknown player'),
      destination,
      plane,
      direction: status.direction,
      ...plan,
      rungAt: null,
    });
    storage.setSetting('bufferMin', bufferMin);
    close();
  }

  function build() {
    const pick = status.plane ? PROFILE_PLANES[status.plane].pick : null;
    const select = el(doc, 'select', { attrs: { name: 'destination' }, on: { change: update } }, [
      el(doc, 'option', { text: 'Pick a country', attrs: { value: '' } }),
      ...DESTINATIONS.map((d) => el(doc, 'option', { text: d.name, attrs: { value: d.key } })),
    ]);
    select.value = status.destination || '';

    const radios = [];
    const minutes = {};
    const planeRows = PLANES.map((plane) => {
      const radio = el(doc, 'input', {
        attrs: { type: 'radio', name: 'landingtimer-plane', value: plane.key },
        on: { change: update },
      });
      radio.checked = plane.key === pick;
      radios.push(radio);
      minutes[plane.key] = el(doc, 'span', { className: `${PANEL_CLASS}__minutes` });
      return el(doc, 'label', { className: `${PANEL_CLASS}__plane`, attrs: { 'data-plane': plane.key } }, [
        radio,
        el(doc, 'span', { className: `${PANEL_CLASS}__plane-name`, text: plane.label }),
        minutes[plane.key],
        el(doc, 'span', { className: `${PANEL_CLASS}__tag`, text: planeTag(status, plane.key) }),
      ]);
    });

    const buffer = el(doc, 'input', {
      attrs: { type: 'number', name: 'buffer', min: BUFFER.min, max: BUFFER.max, step: 1 },
      on: { input: update },
    });
    buffer.value = String(storage.getSetting('bufferMin'));

    const summary = el(doc, 'div', { className: `${PANEL_CLASS}__summary` });
    const variance = el(doc, 'div', { className: `${PANEL_CLASS}__variance` });
    const start = el(doc, 'button', { text: 'Start', attrs: { type: 'button', 'data-action': 'start' }, on: { click: startTimer } });
    const cancel = el(doc, 'button', { text: 'Cancel', attrs: { type: 'button', 'data-action': 'cancel' }, on: { click: () => close() } });

    parts = { select, radios, minutes, buffer, summary, variance, start };

    return el(doc, 'div', { className: PANEL_CLASS, attrs: { role: 'dialog', 'aria-label': 'Landing timer' } }, [
      el(doc, 'div', { className: `${PANEL_CLASS}__title` }, [
        'Landing timer: ',
        el(doc, 'b', { text: status.name || 'Unknown player' }),
        status.id ? ` [${status.id}]` : '',
      ]),
      el(doc, 'div', { className: `${PANEL_CLASS}__status`, text: describeStatus(status) }),
      el(doc, 'label', { className: `${PANEL_CLASS}__row` }, ['Destination ', select]),
      el(doc, 'div', { className: `${PANEL_CLASS}__planes` }, planeRows),
      el(doc, 'label', { className: `${PANEL_CLASS}__row` }, ['Ring ', buffer, ' min early']),
      summary,
      variance,
      el(doc, 'div', { className: `${PANEL_CLASS}__actions` }, [cancel, start]),
    ]);
  }

  /** Under the anchor, kept inside the window horizontally. */
  function position() {
    const rect = anchor.getBoundingClientRect();
    const width = root.offsetWidth || 320;
    const maxLeft = Math.max(8, (win ? win.innerWidth : 1024) - width - 8);
    root.style.left = `${Math.round(Math.min(Math.max(8, rect.left), maxLeft))}px`;
    root.style.top = `${Math.round(rect.bottom + 6)}px`;
  }

  function close() {
    for (const off of cleanup) off();
    cleanup = [];
    if (root) root.remove();
    root = null;
    parts = null;
    anchor = null;
    status = null;
  }

  function open(anchorElement, profileStatus) {
    close();
    anchor = anchorElement;
    status = profileStatus;
    root = build();
    doc.body.append(root);
    position();
    update();
    listen(doc, 'keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    listen(doc, 'pointerdown', (event) => {
      if (root && !root.contains(event.target) && !anchor.contains(event.target)) close();
    }, true);
  }

  return {
    open,
    close,
    isOpen: () => root !== null,
    get element() { return root; },
  };
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `node --test test/panel.test.js`
Expected: 13 passing.

- [ ] **Step 6: Commit**

```bash
git add src/core/dom.js src/profile/panel.js test/panel.test.js
git commit -m "feat: landing timer panel with every flight time and the buffer" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The profile button

**Files:**
- Create: `src/profile/button.js`
- Test: `test/button.test.js`

- [ ] **Step 1: Write the failing test `test/button.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { statusHtml, settle } from '../testlib/dom.js';
import {
  mountProfileButton, BUTTON_CLASS, BUTTON_ACTIVE_CLASS, BUTTON_LABEL,
} from '../src/profile/button.js';

const FLYING = statusHtml({ classes: 'profile-status m-top10 travelling to canada  ', text: 'Torn to Canada' });

function page(body) {
  return new JSDOM(`<!doctype html><body><div id="profile">${body}</div></body>`, { pretendToBeVisual: true }).window.document;
}

const buttons = (doc) => doc.querySelectorAll(`.${BUTTON_CLASS}`);

test('one button goes straight after the status box', () => {
  const doc = page(FLYING);
  const mount = mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  assert.equal(buttons(doc).length, 1);
  assert.equal(doc.querySelector('div.profile-status').nextElementSibling, mount.element);
  assert.equal(mount.element.textContent, BUTTON_LABEL);
  assert.equal(mount.element.type, 'button');
  mount.destroy();
});

test('the button waits for a status box that arrives later', async () => {
  const doc = page('');
  mountProfileButton({ doc, isFlying: () => false, onOpen: () => {} });
  assert.equal(buttons(doc).length, 0);
  doc.getElementById('profile').insertAdjacentHTML('beforeend', FLYING);
  await settle();
  assert.equal(buttons(doc).length, 1);
});

test('a redrawn status box gets the button back, still only one', async () => {
  const doc = page(FLYING);
  mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  doc.getElementById('profile').innerHTML = FLYING;
  await settle();
  assert.equal(buttons(doc).length, 1);
  assert.ok(doc.querySelector('div.profile-status').nextElementSibling.classList.contains(BUTTON_CLASS));
});

test('the button leaves with the status box', async () => {
  const doc = page(FLYING);
  mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  doc.querySelector('div.profile-status').remove();
  await settle();
  assert.equal(buttons(doc).length, 0);
});

test('the accent follows isFlying whenever the page changes', async () => {
  let flying = false;
  const doc = page(FLYING);
  const mount = mountProfileButton({ doc, isFlying: () => flying, onOpen: () => {} });
  assert.equal(mount.element.classList.contains(BUTTON_ACTIVE_CLASS), false);
  flying = true;
  doc.body.append(doc.createElement('div'));
  await settle();
  assert.equal(mount.element.classList.contains(BUTTON_ACTIVE_CLASS), true);
});

test('a click opens the panel with the button as its anchor', () => {
  const doc = page(FLYING);
  let opened = null;
  const mount = mountProfileButton({ doc, isFlying: () => true, onOpen: (anchor) => { opened = anchor; } });
  mount.element.click();
  assert.equal(opened, mount.element);
});

test('destroy removes the button and stops watching', async () => {
  const doc = page(FLYING);
  const mount = mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  mount.destroy();
  doc.getElementById('profile').innerHTML = FLYING;
  await settle();
  assert.equal(buttons(doc).length, 0);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/button.test.js`
Expected: FAIL, cannot find `src/profile/button.js`.

- [ ] **Step 3: Write `src/profile/button.js`**

```js
import { el } from '../core/dom.js';
import { safe } from '../core/log.js';
import * as selectors from '../core/selectors.js';

export const BUTTON_CLASS = 'landingtimer-button';
export const BUTTON_ACTIVE_CLASS = 'landingtimer-button--active';
export const BUTTON_LABEL = '⏱ Landing timer';

/**
 * Keeps one Landing timer button directly after the profile's status box.
 * Torn's page is React-rendered and redraws that box, so a MutationObserver
 * puts the button back whenever it goes missing. `isFlying()` decides the
 * accent; `onOpen(button)` runs on click.
 */
export function mountProfileButton({ doc = globalThis.document, isFlying, onOpen }) {
  const button = el(doc, 'button', {
    className: BUTTON_CLASS,
    text: BUTTON_LABEL,
    attrs: { type: 'button', title: 'Set a timer for when this player lands' },
    on: {
      click: (event) => {
        event.preventDefault();
        onOpen(button);
      },
    },
  });

  function ensure() {
    const box = selectors.statusBox(doc);
    if (!box) {
      button.remove();
      return;
    }
    if (box.nextElementSibling !== button) box.after(button);
    button.classList.toggle(BUTTON_ACTIVE_CLASS, !!isFlying());
  }

  const run = safe('button.ensure', ensure);
  const observer = new doc.defaultView.MutationObserver(run);
  observer.observe(doc.body, { childList: true, subtree: true });
  run();

  return {
    element: button,
    destroy() {
      observer.disconnect();
      button.remove();
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test test/button.test.js`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/profile/button.js test/button.test.js
git commit -m "feat: Landing timer button after the profile status, kept through redraws" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Dragging the timer box

**Files:**
- Create: `src/widget/drag.js`
- Test: `test/drag.test.js`

- [ ] **Step 1: Write the failing test `test/drag.test.js`**

jsdom's window is 1024 × 768. The box is stubbed at left 700, top 120, 260 × 80, so it can go as far as x 764, y 688.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { stubRect, firePointer } from '../testlib/dom.js';
import { attachDrag, clampPosition, DEFAULT_POS } from '../src/widget/drag.js';

function setup(saved = null) {
  const dom = new JSDOM(
    '<!doctype html><body><div id="box"><div id="bar"><span id="title">title</span><button id="mute">x</button></div></div></body>',
    { pretendToBeVisual: true },
  );
  const win = dom.window;
  const doc = win.document;
  const element = doc.getElementById('box');
  const handle = doc.getElementById('bar');
  stubRect(element, { left: 700, top: 120, width: 260, height: 80 });
  let pos = saved;
  const saves = [];
  const drag = attachDrag({ handle, element, win, getPos: () => pos, setPos: (p) => { pos = p; saves.push(p); } });
  return { win, doc, element, handle, drag, saves };
}

test('clampPosition keeps the whole box on screen', () => {
  const size = { width: 260, height: 80 };
  const view = { width: 1024, height: 768 };
  assert.deepEqual(clampPosition({ x: 100, y: 200 }, size, view), { x: 100, y: 200 });
  assert.deepEqual(clampPosition({ x: -50, y: -9 }, size, view), { x: 0, y: 0 });
  assert.deepEqual(clampPosition({ x: 2000, y: 2000 }, size, view), { x: 764, y: 688 });
  assert.deepEqual(clampPosition({ x: 10, y: 10 }, { width: 2000, height: 2000 }, view), { x: 0, y: 0 });
});

test('with nothing saved the box sits in its default corner', () => {
  const { element } = setup();
  assert.equal(element.style.right, `${DEFAULT_POS.right}px`);
  assert.equal(element.style.top, `${DEFAULT_POS.top}px`);
  assert.equal(element.style.left, '');
});

test('a saved position is used, pulled back on screen if needed', () => {
  assert.equal(setup({ x: 40, y: 50 }).element.style.left, '40px');
  const far = setup({ x: 2000, y: 50 });
  assert.equal(far.element.style.left, '764px');
  assert.equal(far.element.style.right, 'auto');
  assert.equal(far.element.style.top, '50px');
});

test('dragging the title bar moves the box and saves where it is let go', () => {
  const { doc, element, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  assert.equal(element.style.left, '100px');
  assert.equal(element.style.top, '200px');
  assert.deepEqual(saves, [], 'nothing is saved mid-drag');
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210 });
  assert.deepEqual(saves, [{ x: 100, y: 200 }]);
});

test('a press without a move saves nothing', () => {
  const { doc, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointerup', { clientX: 710, clientY: 130 });
  assert.deepEqual(saves, []);
});

test('presses on a button in the bar, or with another mouse button, do not drag', () => {
  const { doc, element, saves } = setup();
  firePointer(doc.getElementById('mute'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130, button: 2 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210 });
  assert.equal(element.style.left, '');
  assert.deepEqual(saves, []);
});

test('a smaller window pulls the box back without saving', () => {
  const { win, element, saves } = setup({ x: 760, y: 100 });
  Object.defineProperty(win, 'innerWidth', { value: 800, configurable: true });
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(element.style.left, '540px');
  assert.deepEqual(saves, []);
});

test('destroy stops dragging', () => {
  const { doc, element, drag, saves } = setup();
  drag.destroy();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210 });
  assert.equal(element.style.left, '');
  assert.deepEqual(saves, []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/drag.test.js`
Expected: FAIL, cannot find `src/widget/drag.js`.

- [ ] **Step 3: Write `src/widget/drag.js`**

```js
/** Where the timer box sits until the player drags it: px from the right and top. */
export const DEFAULT_POS = Object.freeze({ right: 16, top: 120 });

/** The nearest position that keeps a box of `size` wholly inside `view`. */
export function clampPosition(pos, size, view) {
  const maxX = Math.max(0, view.width - size.width);
  const maxY = Math.max(0, view.height - size.height);
  return {
    x: Math.round(Math.min(Math.max(0, pos.x), maxX)),
    y: Math.round(Math.min(Math.max(0, pos.y), maxY)),
  };
}

/**
 * Lets the player drag `element` by `handle`. getPos() gives the saved
 * position ({x, y} from the top-left, or null for the default corner) and
 * setPos(pos) saves a new one when a drag ends. Presses on buttons and links in
 * the handle are left to them. apply() re-places the box from getPos().
 */
export function attachDrag({ handle, element, win, getPos, setPos }) {
  let drag = null;

  const view = () => ({ width: win.innerWidth, height: win.innerHeight });

  function size() {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function place(pos) {
    if (!pos) {
      element.style.left = '';
      element.style.right = `${DEFAULT_POS.right}px`;
      element.style.top = `${DEFAULT_POS.top}px`;
      return;
    }
    const { x, y } = clampPosition(pos, size(), view());
    element.style.right = 'auto';
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  function apply() {
    if (!drag) place(getPos());
  }

  function onMove(event) {
    if (!drag) return;
    drag.moved = true;
    drag.pos = clampPosition({ x: event.clientX - drag.dx, y: event.clientY - drag.dy }, size(), view());
    place(drag.pos);
  }

  function stopListening() {
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
    win.removeEventListener('pointercancel', onUp);
  }

  function onUp() {
    if (!drag) return;
    const { moved, pos } = drag;
    drag = null;
    stopListening();
    if (moved) {
      setPos(pos);
      place(pos);
    }
  }

  function onDown(event) {
    if (event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest('button, a')) return;
    const rect = element.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, pos: null, moved: false };
    event.preventDefault();
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    win.addEventListener('pointercancel', onUp);
  }

  handle.addEventListener('pointerdown', onDown);
  win.addEventListener('resize', apply);
  apply();

  return {
    apply,
    destroy() {
      handle.removeEventListener('pointerdown', onDown);
      win.removeEventListener('resize', apply);
      stopListening();
      drag = null;
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test test/drag.test.js`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/widget/drag.js test/drag.test.js
git commit -m "feat: drag the timer box by its title bar, kept on screen" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The floating timer box

**Files:**
- Create: `src/widget/widget.js`
- Test: `test/widget.test.js`

- [ ] **Step 1: Write the failing test `test/widget.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fakeClock, memoryArea, makeTimer, T0, MIN } from '../testlib/fakes.js';
import { createStorage, EXPIRE_AFTER_MS } from '../src/core/storage.js';
import { formatClock } from '../src/core/time.js';
import {
  createWidget, rowState, placeText, rowTitle,
  ROW_CLASS, ROW_DUE_CLASS, SOUND_ON, SOUND_OFF, SOUND_BLOCKED_TITLE, WIDGET_CLASS,
} from '../src/widget/widget.js';

function setup({ canPlay = () => true } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  const clock = fakeClock(T0);
  const storage = createStorage({ area: memoryArea(), target: null, clock });
  const widget = createWidget({ doc, storage, clock, canPlay });
  widget.start();
  const rows = () => [...doc.querySelectorAll(`.${ROW_CLASS}`)];
  const part = (row, name) => row.querySelector(`.${ROW_CLASS}__${name}`);
  return {
    doc, clock, storage, widget, root: widget.element, rows, part,
    times: () => rows().map((row) => part(row, 'time').textContent),
    sound: () => doc.querySelector(`.${WIDGET_CLASS}__sound`),
  };
}

test('a row counts down, then says LANDING, then LANDED', () => {
  const timer = makeTimer();
  assert.deepEqual(rowState(timer, T0), { due: false, text: '25:00' });
  assert.deepEqual(rowState(timer, T0 + 25 * MIN), { due: true, text: 'LANDING in 2:00' });
  assert.deepEqual(rowState(timer, T0 + 27 * MIN + 35_000), { due: true, text: 'LANDED +0:35' });
});

test('a return flight says so; the hover text gives the times', () => {
  assert.equal(placeText(makeTimer()), 'Canada');
  assert.equal(placeText(makeTimer({ direction: 'from', destination: 'uk' })), 'United Kingdom → Torn');
  assert.equal(rowTitle(makeTimer()),
    `Lands ~${formatClock(T0 + 27 * MIN)} · rings ${formatClock(T0 + 25 * MIN)} · Airstrip, 27 min`);
});

test('the box is hidden with no timers and shows a row per timer', () => {
  const w = setup();
  assert.equal(w.root.isConnected, true);
  assert.equal(w.root.hidden, true);
  w.storage.addTimer(makeTimer());
  assert.equal(w.root.hidden, false);
  const [row] = w.rows();
  assert.equal(w.part(row, 'name').textContent, 'SomeName');
  assert.equal(w.part(row, 'name').getAttribute('href'), '/profiles.php?XID=1234567');
  assert.equal(w.part(row, 'place').textContent, 'Canada');
  assert.equal(w.part(row, 'time').textContent, '25:00');
  assert.equal(row.title, rowTitle(makeTimer()));
});

test('rows are soonest first and re-sort when a sooner timer arrives', () => {
  const w = setup();
  w.storage.addTimer(makeTimer({ id: 'a', name: 'Later', ringAt: T0 + 50 * MIN, landingAt: T0 + 52 * MIN }));
  w.storage.addTimer(makeTimer({ id: 'b', name: 'Sooner', ringAt: T0 + 10 * MIN, landingAt: T0 + 12 * MIN }));
  assert.deepEqual(w.rows().map((r) => r.dataset.id), ['b', 'a']);
  const later = w.rows()[1];
  w.storage.addTimer(makeTimer({ id: 'c', ringAt: T0 + 5 * MIN, landingAt: T0 + 7 * MIN }));
  assert.deepEqual(w.rows().map((r) => r.dataset.id), ['c', 'b', 'a']);
  assert.equal(w.rows()[2], later, 'existing rows are reused, not rebuilt');
});

test('the countdown ticks every second', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  w.clock.tick(1000);
  assert.deepEqual(w.times(), ['24:59']);
});

test('a due row turns red and counts on past landing', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  w.clock.tick(25 * MIN);
  assert.deepEqual(w.times(), ['LANDING in 2:00']);
  assert.ok(w.rows()[0].classList.contains(ROW_DUE_CLASS));
  w.clock.tick(2 * MIN + 35_000);
  assert.deepEqual(w.times(), ['LANDED +0:35']);
});

test('the cross removes a timer', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  w.part(w.rows()[0], 'remove').click();
  assert.deepEqual(w.storage.getTimers(), []);
  assert.equal(w.rows().length, 0);
  assert.equal(w.root.hidden, true);
});

test('a timer keyed by name has no profile link', () => {
  const w = setup();
  w.storage.addTimer(makeTimer({ id: 'name:Ghost', name: 'Ghost' }));
  assert.equal(w.part(w.rows()[0], 'name').hasAttribute('href'), false);
});

test('an expired timer leaves the box', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  w.clock.tick(27 * MIN + EXPIRE_AFTER_MS);
  assert.equal(w.rows().length, 0);
  assert.equal(w.root.hidden, true);
});

test('the sound button switches the chime for every tab', () => {
  const w = setup();
  w.storage.addTimer(makeTimer());
  assert.equal(w.sound().textContent, SOUND_ON);
  assert.equal(w.sound().getAttribute('aria-pressed'), 'true');
  w.sound().click();
  assert.equal(w.storage.getSetting('sound'), false);
  assert.equal(w.sound().textContent, SOUND_OFF);
  assert.equal(w.sound().getAttribute('aria-pressed'), 'false');
});

test('a tab that may not play sound says how to allow it', () => {
  const w = setup({ canPlay: () => false });
  w.storage.addTimer(makeTimer());
  assert.equal(w.sound().textContent, SOUND_OFF);
  assert.equal(w.sound().title, SOUND_BLOCKED_TITLE);
});

test('destroy removes the box and stops ticking', () => {
  const w = setup();
  w.widget.destroy();
  assert.equal(w.root.isConnected, false);
  assert.equal(w.clock.pending(), 0);
  w.storage.addTimer(makeTimer());
  assert.equal(w.rows().length, 0);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/widget.test.js`
Expected: FAIL, cannot find `src/widget/widget.js`.

- [ ] **Step 3: Write `src/widget/widget.js`**

```js
import { el } from '../core/dom.js';
import { safe } from '../core/log.js';
import { realClock } from '../core/clock.js';
import { destinationName, planeLabel } from '../core/flights.js';
import { formatClock, formatCountdown, formatElapsed, formatMinutes } from '../core/time.js';
import { attachDrag } from './drag.js';

export const WIDGET_CLASS = 'landingtimer-widget';
export const ROW_CLASS = 'landingtimer-row';
export const ROW_DUE_CLASS = 'landingtimer-row--due';
export const SOUND_ON = '🔊';
export const SOUND_OFF = '🔇';
export const SOUND_BLOCKED_TITLE = 'Click anywhere on this page to allow the chime';

/** What a row says at `now`: a countdown to the ring, then LANDING, then LANDED. */
export function rowState(timer, now) {
  if (now < timer.ringAt) return { due: false, text: formatCountdown(timer.ringAt - now) };
  if (now < timer.landingAt) return { due: true, text: `LANDING in ${formatCountdown(timer.landingAt - now)}` };
  return { due: true, text: `LANDED +${formatElapsed(now - timer.landingAt)}` };
}

export function placeText(timer) {
  const place = destinationName(timer.destination) || timer.destination;
  return timer.direction === 'from' ? `${place} → Torn` : place;
}

export function rowTitle(timer) {
  return `Lands ~${formatClock(timer.landingAt)} · rings ${formatClock(timer.ringAt)}`
    + ` · ${planeLabel(timer.plane)}, ${formatMinutes(timer.minutes)}`;
}

/**
 * The floating box of running timers, on every Torn page. It re-renders every
 * second and whenever storage changes (in this tab or another).
 */
export function createWidget({ doc = globalThis.document, storage, clock = realClock, canPlay = () => true }) {
  const win = doc.defaultView;
  /** @type {Map<string, {row: Element, name: Element, place: Element, time: Element}>} */
  const rows = new Map();
  let interval = null;
  let unsubscribe = null;
  let drag = null;

  const sound = el(doc, 'button', {
    className: `${WIDGET_CLASS}__sound`,
    attrs: { type: 'button' },
    on: { click: () => storage.setSetting('sound', !storage.getSetting('sound')) },
  });
  const bar = el(doc, 'div', { className: `${WIDGET_CLASS}__bar` }, [
    el(doc, 'span', { className: `${WIDGET_CLASS}__title`, text: '✈ Landing timers' }),
    sound,
  ]);
  const list = el(doc, 'div', { className: `${WIDGET_CLASS}__list` });
  const root = el(doc, 'div', { className: WIDGET_CLASS, attrs: { hidden: true } }, [bar, list]);

  function buildRow(id) {
    const name = el(doc, 'a', { className: `${ROW_CLASS}__name` });
    const place = el(doc, 'span', { className: `${ROW_CLASS}__place` });
    const time = el(doc, 'span', { className: `${ROW_CLASS}__time` });
    const remove = el(doc, 'button', {
      className: `${ROW_CLASS}__remove`,
      text: '✕',
      attrs: { type: 'button', title: 'Remove timer', 'aria-label': 'Remove timer' },
      on: { click: () => storage.removeTimer(id) },
    });
    const row = el(doc, 'div', { className: ROW_CLASS, attrs: { 'data-id': id } }, [name, place, time, remove]);
    return { row, name, place, time };
  }

  function renderSound() {
    const on = !!storage.getSetting('sound');
    const blocked = on && !canPlay();
    sound.textContent = on && !blocked ? SOUND_ON : SOUND_OFF;
    if (blocked) sound.title = SOUND_BLOCKED_TITLE;
    else sound.title = on ? 'Chime on: click to mute' : 'Chime off: click to turn it on';
    sound.setAttribute('aria-pressed', String(on));
  }

  function renderRow(parts, timer, now) {
    const state = rowState(timer, now);
    parts.name.textContent = timer.name;
    if (/^\d+$/.test(timer.id)) parts.name.setAttribute('href', `/profiles.php?XID=${timer.id}`);
    else parts.name.removeAttribute('href');
    parts.place.textContent = placeText(timer);
    parts.time.textContent = state.text;
    parts.row.title = rowTitle(timer);
    parts.row.classList.toggle(ROW_DUE_CLASS, state.due);
  }

  function render() {
    storage.prune();
    const now = clock.now();
    const timers = storage.getTimers();
    root.hidden = timers.length === 0;
    renderSound();
    const live = new Set(timers.map((t) => t.id));
    for (const [id, parts] of rows) {
      if (!live.has(id)) {
        parts.row.remove();
        rows.delete(id);
      }
    }
    timers.forEach((timer, index) => {
      let parts = rows.get(timer.id);
      if (!parts) {
        parts = buildRow(timer.id);
        rows.set(timer.id, parts);
      }
      renderRow(parts, timer, now);
      // Move a row only when it is out of place, so a hovered row keeps its tooltip.
      if (list.children[index] !== parts.row) list.insertBefore(parts.row, list.children[index] || null);
    });
    if (drag) drag.apply();
  }

  const tick = safe('widget.render', render);

  function start() {
    if (root.isConnected) return;
    doc.body.append(root);
    drag = attachDrag({
      handle: bar,
      element: root,
      win,
      getPos: () => storage.getSetting('widgetPos'),
      setPos: (pos) => storage.setSetting('widgetPos', pos),
    });
    unsubscribe = storage.subscribe(tick);
    interval = clock.setInterval(tick, 1000);
    tick();
  }

  function destroy() {
    if (interval !== null) clock.clearInterval(interval);
    interval = null;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (drag) drag.destroy();
    drag = null;
    root.remove();
  }

  return { start, destroy, render: tick, element: root };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test test/widget.test.js`
Expected: 12 passing.

- [ ] **Step 5: Commit**

```bash
git add src/widget/widget.js test/widget.test.js
git commit -m "feat: floating timer box with countdown, landing states and mute" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The chime

**Files:**
- Create: `src/core/alarm.js`
- Test: `test/alarm.test.js`

- [ ] **Step 1: Write the failing test `test/alarm.test.js`**

Each "tab" gets its own storage over one shared area, its own alarm and a list of when it played. Tabs in one test share the clock and the locks, the way real tabs share the wall clock and the browser's Web Locks. These fake tabs get no storage events, so a stale tab only learns of another tab's ring through the `reload()` inside the lock. That is the worst case.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeClock, fakeLocks, memoryArea, makeTimer, flush, T0, MIN,
} from '../testlib/fakes.js';
import { createStorage } from '../src/core/storage.js';
import { createAlarm, defaultCanPlay, LATE_LIMIT_MS } from '../src/core/alarm.js';

function fakeWin() {
  const win = new EventTarget();
  win.document = new EventTarget();
  return win;
}

function seed(area, clock, ...timers) {
  const storage = createStorage({ area, target: null, clock });
  for (const timer of timers) storage.addTimer(timer);
}

function tab({ area, clock, locks = null, canPlay = () => true, holdMs = 0 }) {
  const storage = createStorage({ area, target: null, clock });
  const plays = [];
  const win = fakeWin();
  const alarm = createAlarm({
    storage, win, clock, locks, canPlay, holdMs, play: () => plays.push(clock.now()),
  });
  alarm.start();
  return { storage, alarm, plays, win };
}

test('it chimes once, at the ring time', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks() });
  clock.tick(25 * MIN - 1);
  await flush();
  assert.deepEqual(t.plays, []);
  clock.tick(1);
  await flush();
  assert.deepEqual(t.plays, [T0 + 25 * MIN]);
  assert.equal(t.storage.getTimer('1234567').rungAt, T0 + 25 * MIN);
  clock.tick(10_000);
  await flush();
  assert.equal(t.plays.length, 1);
});

test('with the sound off it stays quiet but still marks the timer rung', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks() });
  t.storage.setSetting('sound', false);
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(t.storage.getTimer('1234567').rungAt, T0 + 25 * MIN);
});

test('more than two minutes late it marks the timer rung silently', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer({ startedAt: T0 - 30 * MIN, ringAt: T0 - LATE_LIMIT_MS - 1, landingAt: T0 }));
  const t = tab({ area, clock, locks: fakeLocks() });
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(t.storage.getTimer('1234567').rungAt, T0);
});

test('up to two minutes late it still chimes', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer({ startedAt: T0 - 30 * MIN, ringAt: T0 - LATE_LIMIT_MS, landingAt: T0 }));
  const t = tab({ area, clock, locks: fakeLocks() });
  await flush();
  assert.deepEqual(t.plays, [T0]);
});

test('a tab that may not play leaves the chime until it can', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  let allowed = false;
  const t = tab({ area, clock, locks: fakeLocks(), canPlay: () => allowed });
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, []);
  assert.equal(t.storage.getTimer('1234567').rungAt, null, 'left for a tab that can play');
  allowed = true;
  t.win.dispatchEvent(new Event('pointerdown'));
  clock.tick(0);
  await flush();
  assert.equal(t.plays.length, 1);
});

test('two tabs, one chime', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const locks = fakeLocks();
  seed(area, clock, makeTimer());
  const a = tab({ area, clock, locks });
  const b = tab({ area, clock, locks });
  clock.tick(25 * MIN);
  await flush();
  clock.tick(5000);
  await flush();
  assert.equal(a.plays.length + b.plays.length, 1);
});

test('while one tab holds the lock, the other skips, and stays quiet after', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const locks = fakeLocks();
  seed(area, clock, makeTimer());
  const a = tab({ area, clock, locks, holdMs: 5000 });
  const b = tab({ area, clock, locks, holdMs: 5000 });
  clock.tick(25 * MIN);
  await flush();
  assert.equal(a.plays.length + b.plays.length, 1);
  for (let second = 0; second < 8; second += 1) {
    clock.tick(1000);
    await flush();
  }
  assert.equal(a.plays.length + b.plays.length, 1);
});

test('a timer added after start is scheduled too', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const t = tab({ area, clock, locks: fakeLocks() });
  t.storage.addTimer(makeTimer());
  clock.tick(25 * MIN);
  await flush();
  assert.deepEqual(t.plays, [T0 + 25 * MIN]);
});

test('a removed timer never chimes', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  const t = tab({ area, clock, locks: fakeLocks() });
  t.storage.addTimer(makeTimer());
  t.storage.removeTimer('1234567');
  clock.tick(30 * MIN);
  await flush();
  assert.deepEqual(t.plays, []);
});

test('without the Web Locks API it still chimes once', async () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: null });
  clock.tick(26 * MIN);
  await flush();
  assert.equal(t.plays.length, 1);
});

test('defaultCanPlay follows userActivation, and assumes yes without it', () => {
  assert.equal(defaultCanPlay({ userActivation: { hasBeenActive: false } }), false);
  assert.equal(defaultCanPlay({ userActivation: { hasBeenActive: true } }), true);
  assert.equal(defaultCanPlay({}), true);
  assert.equal(defaultCanPlay(null), true);
});

test('destroy cancels every timer', () => {
  const area = memoryArea();
  const clock = fakeClock(T0);
  seed(area, clock, makeTimer());
  const t = tab({ area, clock, locks: fakeLocks() });
  t.alarm.destroy();
  assert.equal(clock.pending(), 0);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/alarm.test.js`
Expected: FAIL, cannot find `src/core/alarm.js`.

- [ ] **Step 3: Write `src/core/alarm.js`**

```js
import { realClock } from './clock.js';
import { safe, warnOnce } from './log.js';

/** A timer found this long past its ring time (computer asleep, browser closed) rings silently. */
export const LATE_LIMIT_MS = 2 * 60 * 1000;

/** Web Locks name prefix; one lock per timer, shared by every Torn tab. */
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
    storage.markRung(timer.id, clock.now());
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
      ? locks.request(`${LOCK_NAME}:${timer.id}`, { ifAvailable: true }, (lock) => (lock ? ring(timer, audible) : undefined))
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
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test test/alarm.test.js`
Expected: 12 passing.

- [ ] **Step 5: Commit**

```bash
git add src/core/alarm.js test/alarm.test.js
git commit -m "feat: chime once per timer in exactly one tab" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Stylesheet, wiring and the smoke test

**Files:**
- Modify: `src/styles.css` (replace whole file), `src/main.js` (replace whole file), `test/build.test.js` (append tests)

- [ ] **Step 1: Append the failing tests to `test/build.test.js`**

Add `import { JSDOM, VirtualConsole } from 'jsdom';` and `import { statusHtml } from '../testlib/dom.js';` to the imports at the top. Then append:

```js
test('the bundle inlines the stylesheet, the selectors and the storage key', () => {
  const code = bundle();
  assert.match(code, /landingtimer-widget/);
  assert.match(code, /landingtimer-panel/);
  assert.match(code, /\.landingtimer-panel \{[^}]*z-index: 2147483647/, 'the panel stacks above everything');
  assert.match(code, /div\.profile-status/);
  assert.match(code, /landingtimer\.v1/);
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
```

(37:00 is Canada's 39-minute Standard flight less the default 2-minute buffer.)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/build.test.js`
Expected: the stylesheet test FAILS (no `landingtimer-panel` in the bundle) and both smoke tests FAIL (no button and no timer box are created yet).

- [ ] **Step 3: Replace `src/styles.css`**

```css
/* Landing Timer: the whole stylesheet, injected once at boot. */

/* The profile button, right after Torn's status box. */
.landingtimer-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 6px 0;
  padding: 4px 10px;
  font: 600 12px/1.4 Arial, sans-serif;
  color: #ddd;
  background: #333;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
}
.landingtimer-button:hover { background: #3d3d3d; }
.landingtimer-button--active { color: #fff; background: #2f6f3e; border-color: #4caf50; }
.landingtimer-button--active:hover { background: #377f48; }

/* The panel. Above Torn's chat and Chat+'s menu. */
.landingtimer-panel {
  position: fixed;
  z-index: 2147483647;
  width: 320px;
  box-sizing: border-box;
  padding: 10px 12px;
  font: 12px/1.5 Arial, sans-serif;
  color: #e8e8e8;
  background: #232323;
  border: 1px solid #555;
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
}
.landingtimer-panel__title { font-size: 13px; margin-bottom: 2px; }
.landingtimer-panel__status { color: #aaa; margin-bottom: 8px; }
.landingtimer-panel__row { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
.landingtimer-panel select,
.landingtimer-panel input[type="number"] {
  font: inherit;
  color: #e8e8e8;
  background: #111;
  border: 1px solid #555;
  border-radius: 3px;
  padding: 2px 4px;
}
.landingtimer-panel input[type="number"] { width: 48px; }
.landingtimer-panel__planes { margin: 6px 0; }
.landingtimer-panel__plane {
  display: grid;
  grid-template-columns: 18px 84px 70px 1fr;
  align-items: center;
  padding: 2px 0;
  cursor: pointer;
}
.landingtimer-panel__minutes { font-variant-numeric: tabular-nums; }
.landingtimer-panel__tag { color: #8bc34a; font-size: 11px; }
.landingtimer-panel__summary { margin-top: 6px; font-weight: 600; }
.landingtimer-panel__variance { color: #aaa; font-size: 11px; }
.landingtimer-panel__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.landingtimer-panel__actions button {
  font: inherit;
  padding: 4px 12px;
  color: #e8e8e8;
  background: #333;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
}
.landingtimer-panel__actions button[data-action="start"] { color: #fff; background: #2f6f3e; border-color: #4caf50; }
.landingtimer-panel__actions button:disabled { opacity: 0.45; cursor: default; }

/* The floating timer box, on every page. Above Torn's and Chat+'s chats. */
.landingtimer-widget {
  position: fixed;
  z-index: 2147483646;
  top: 120px;
  right: 16px;
  min-width: 240px;
  font: 12px/1.4 Arial, sans-serif;
  color: #e8e8e8;
  background: rgba(28, 28, 28, 0.95);
  border: 1px solid #555;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  user-select: none;
}
.landingtimer-widget[hidden] { display: none !important; }
.landingtimer-widget__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #333;
  border-radius: 6px 6px 0 0;
  cursor: move;
  touch-action: none;
}
.landingtimer-widget__title { font-weight: 600; }
.landingtimer-widget__sound { font: inherit; padding: 0 2px; color: inherit; background: none; border: 0; cursor: pointer; }
.landingtimer-widget__list { padding: 2px 0; }
.landingtimer-row {
  display: grid;
  grid-template-columns: 1fr auto auto 18px;
  gap: 8px;
  align-items: center;
  padding: 3px 8px;
}
.landingtimer-row__name {
  max-width: 120px;
  overflow: hidden;
  color: #8ab4f8;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.landingtimer-row__name:hover { text-decoration: underline; }
.landingtimer-row__place { color: #bbb; }
.landingtimer-row__time { font-variant-numeric: tabular-nums; text-align: right; }
.landingtimer-row__remove { font: inherit; padding: 0; color: #999; background: none; border: 0; cursor: pointer; }
.landingtimer-row__remove:hover { color: #fff; }
.landingtimer-row--due { background: rgba(200, 40, 40, 0.35); }
.landingtimer-row--due .landingtimer-row__time { color: #ff8a80; font-weight: 700; }
```

- [ ] **Step 4: Replace `src/main.js`**

```js
import * as selectors from './core/selectors.js';
import { info, safe } from './core/log.js';
import { injectStyles } from './core/styles.js';
import { createStorage } from './core/storage.js';
import { createAlarm, defaultCanPlay } from './core/alarm.js';
import { createWidget } from './widget/widget.js';
import { readStatus } from './profile/readStatus.js';
import { mountProfileButton } from './profile/button.js';
import { createPanel } from './profile/panel.js';

/** States in which the profile button gets its accent. */
const FLYING_STATES = new Set(['traveling', 'hidden']);

function boot() {
  injectStyles(document);

  const storage = createStorage();
  const canPlay = () => defaultCanPlay();
  createWidget({ doc: document, storage, canPlay }).start();
  createAlarm({ storage, canPlay }).start();

  if (selectors.isProfilePage(location)) {
    const panel = createPanel({ doc: document, storage });
    const status = () => readStatus(document, location.href);
    mountProfileButton({
      doc: document,
      isFlying: () => FLYING_STATES.has(status().state),
      onOpen: (button) => (panel.isOpen() ? panel.close() : panel.open(button, status())),
    });
  }

  info('ready');
}

// Nothing above us catches a throw here, and a half-booted userscript must
// never take Torn's own page down with it.
const safeBoot = safe('main.boot', boot);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeBoot, { once: true });
} else {
  safeBoot();
}
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: every test passes (about 100). If a smoke test lists `problems`, read them: they are the userscript's own console warnings and point at the module that failed.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/main.js test/build.test.js dist
git commit -m "feat: wire button, panel, timer box and chime; stylesheet; smoke test" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: README

**Files:**
- Create: `README.md`, `LICENSE`

- [ ] **Step 1: Write `LICENSE`** (MIT, matching Chat+)

```
MIT License

Copyright (c) 2026 Torn Landing Timer contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Write `README.md`**

````markdown
# Landing Timer

A userscript for [Torn City](https://www.torn.com) that puts a landing timer on player profiles.

- **One button on the profile.** When someone is flying, a **⏱ Landing timer** button under their status opens a panel that already knows where they're headed and which plane the profile shows.
- **Every flight time at a glance.** The panel lists the Standard, Airstrip, WLT private and Business times for the destination, picks the likely one, and says how far flights can vary.
- **Rings early.** You choose how many minutes before the estimated landing it rings. The default is 2, and it remembers your last choice.
- **Follows you around Torn.** A small box on every page counts down, turns red when it's time, and then counts on past the estimated landing.
- **Several at once.** One row per player, soonest first.
- **One chime.** A short chime plays in one Torn tab when a timer comes due. The 🔊 button mutes it.

## Rule safety

**Landing Timer makes no network requests.** It sends nothing to Torn, to its API or to any other server, and it needs no API key. A test in the build fails if any network code ever appears in the finished script, and the script asks for no special permissions (`@grant none`).

What it reads:
- It reads **only the profile page you have open**, to fill in the panel.
- After you press **Start** it is a clock. The countdown and the chime use only the numbers you set, and read nothing from any page.

Torn's rules allow scripts that rely on "a page that you have manually loaded and are actively viewing". The chime can play while Torn is in a background tab. It reads nothing when it does, but if you'd rather not have that, the 🔊 button in the timer box turns it off.

Your timers are stored in your browser (`localStorage`, key `landingtimer.v1`) and nowhere else.

## Install

1. Install a userscript manager, such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the Tampermonkey dashboard and click the **+** tab to create a new script.
3. Select everything in the editor and delete it.
4. Open `dist/landingtimer.user.js`, copy the whole file and paste it in.
5. **File > Save** (or Ctrl+S).
6. Open a Torn profile.

## Using it

1. Open the profile of someone who is flying.
2. Click **⏱ Landing timer** under their status.
3. Check the plane. The profile shows **Commercial**, **Airstrip** or **Private**, and the panel picks the matching time.
   - A Business class ticket looks exactly like Commercial on a profile, so Commercial picks **Standard**.
   - If you know they bought a ticket, click **Business**.
4. Set how many minutes early it should ring, and press **Start**.

The timer starts when you press Start, so start it when you see them take off. Flights can run up to about 3% long or short. On a 4h42m flight that is about 8 minutes, and the panel shows the figure for each flight, so you can give long flights a bigger buffer.

The box can be dragged by its title bar. Click a name to open that profile, and click ✕ to remove a timer. Timers clear themselves an hour after landing.

If someone travels disguised, the profile only says "Traveling", so you pick the destination and plane yourself.

### Flight times (one way, minutes)

These are the times after Torn's 23 June 2026 travel patch, without the "Mailing Yourself Abroad" book.

| Destination | Standard | Airstrip | WLT private | Business |
|---|---:|---:|---:|---:|
| Mexico | 24 | 17 | 12 | 7 |
| Cayman Islands | 33 | 23 | 17 | 10 |
| Canada | 39 | 27 | 19 | 12 |
| Hawaii | 127 | 89 | 63 | 38 |
| United Kingdom | 151 | 106 | 75 | 45 |
| Argentina | 158 | 111 | 79 | 47 |
| Switzerland | 166 | 116 | 83 | 50 |
| Japan | 213 | 149 | 107 | 64 |
| China | 229 | 160 | 114 | 69 |
| UAE | 257 | 180 | 128 | 77 |
| South Africa | 282 | 197 | 141 | 85 |

## Build

Requires Node 20 or newer.

```bash
npm install
npm run build      # writes dist/landingtimer.user.js
npm test           # runs the tests, including the no-network check
npm run watch      # rebuilds on every change under src/
```

## Install your own build (dev loader)

To pick up every rebuild without pasting, create a *separate* tiny script in Tampermonkey that loads the build from disk:

```javascript
// ==UserScript==
// @name         Landing Timer (dev loader)
// @namespace    landingtimer.torn
// @version      1.0.0
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @require      file:///D:/dev/Torn%20City%20Scripts/LandingTimer/dist/landingtimer.user.js
// ==/UserScript==
```

- **Paths:** spaces are `%20` and the separators are forward slashes.
- **Chrome and Edge:** open `chrome://extensions`, then Tampermonkey's *Details*, and turn on **Allow access to file URLs**.
- **Avoid running it twice:** disable the pasted copy while the loader is on.

## Manual acceptance checklist

Run through this on `https://www.torn.com/` after installing a new build.

- [ ] Someone flying: the button under their status is green; the panel shows the right country and plane, the times match the table, and the ring time is 2 minutes before landing.
- [ ] Press Start, then go to another Torn page: the box is there and counting down.
- [ ] Two Torn tabs open when a timer comes due: one chime, not two.
- [ ] 🔊 mutes it in every tab; a timer comes due silently and its row still turns red.
- [ ] Reload: the timers are still there.
- [ ] Someone travelling disguised: the panel opens blank and Start waits for a country and plane.
- [ ] Drag the box somewhere, reload: it stays there. Shrink the window: it stays on screen.
- [ ] A profile of someone at home: the button is grey and still opens the panel.

## How to send the profile HTML

If the panel opens blank for someone who is clearly flying, Torn has changed its page and `src/core/selectors.js` needs updating. Send the real markup:

1. Open the profile of someone who is flying.
2. Right-click their travel status text and choose **Inspect**.
3. In the Elements panel, find the nearest `<div class="profile-status ...">` above the highlighted line.
4. Right-click it, choose **Copy > Copy outerHTML**, and paste it into the chat with Claude. A screenshot of the Elements panel works too.
5. Do the same for the player's **name** at the top of the profile.
6. Say what you saw on the page: where they were flying, and which plane.

## Project layout

```
build.mjs                     esbuild bundle + userscript header
src/header.txt                ==UserScript== metadata block
src/main.js                   bootstrap
src/styles.css                the whole stylesheet, injected once at boot
src/core/flights.js           the flight table
src/core/selectors.js         EVERY Torn page lookup lives here
src/core/storage.js           timers and settings, shared across tabs
src/core/alarm.js             rings each timer once, in one tab
src/core/time.js, clock.js    formatting; the injectable clock
src/core/dom.js, log.js       element builder; console helpers
src/core/version.js, styles.js build version; stylesheet injection
src/profile/readStatus.js     profile page → destination, direction, plane
src/profile/button.js         the profile button
src/profile/panel.js          the panel
src/widget/widget.js          the floating timer box
src/widget/drag.js            dragging the box
test/fixtures/                real Torn markup the player captured
testlib/                      test fakes and jsdom helpers
```

## License

MIT
````

- [ ] **Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: README with rule safety, usage, flight table and checklist" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Confirm the rest of the real markup (needs the player)

The fixture from Task 6 covers an outbound Commercial flight. These are still unconfirmed against real pages: the name heading and page title, a return flight, an Airstrip or Private flight (do their classes carry the plane word?), and someone abroad. Ask the player for each capture (README, "How to send the profile HTML"), together with what the page showed.

For **each** capture:

- [ ] **Step 1: Save it** to `test/fixtures/<case>.html`, with a comment at the top saying what it is and the date. Name the files:
  - `return-<plane>.html` for a return flight.
  - `outbound-airstrip.html` or `outbound-private.html` for those planes.
  - `abroad.html` for someone abroad.
  - `heading.html` for the name.

- [ ] **Step 2: Add a row to `CASES` in `test/realMarkup.test.js`.** Its `expect` holds exactly what the player saw. For example, a capture of someone flying home from Japan by airstrip gets:

```js
  {
    file: 'return-airstrip.html',
    seen: 'flying Japan to Torn, Airstrip (<date>)',
    expect: { state: 'traveling', direction: 'from', destination: 'japan', plane: 'airstrip' },
  },
```

For the name heading, wrap it in a page with the status fixture and assert `name` and `id`:

```js
test('real markup: the name heading gives the player name', () => {
  const heading = readFileSync(new URL('./fixtures/heading.html', import.meta.url), 'utf8');
  const status = readFileSync(new URL('./fixtures/outbound-commercial.html', import.meta.url), 'utf8');
  const doc = new JSDOM(`<!doctype html><body>${heading}${status}</body>`, { url: PROFILE_URL }).window.document;
  assert.equal(readStatus(doc, PROFILE_URL).name, '<the name the player saw>');
});
```

- [ ] **Step 3: Run** `node --test test/realMarkup.test.js`.
  - If it passes, the selectors are confirmed for that case.
  - If it fails, fix `src/core/selectors.js`, or the maps at the top of `src/profile/readStatus.js`, until it passes. Also update `statusHtml` in `testlib/dom.js` if the real structure differs from it. Never weaken the `expect` row. It is what the player saw.

- [ ] **Step 4: Run** `npm test`. Everything must pass.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures test/realMarkup.test.js src testlib
git commit -m "test: confirm profile reading against real <case> markup" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Live check on Torn (needs the player)

- [ ] **Step 1:** `npm run build`. Install `dist/landingtimer.user.js` as the README says.
- [ ] **Step 2:** Walk the player through the README's "Manual acceptance checklist", one item at a time. Record what they report.
- [ ] **Step 3:** Fix anything that fails with a test first (superpowers:systematic-debugging), rebuild, and repeat the failed item.
- [ ] **Step 4:** When every item passes, commit the rebuilt `dist/` if it changed:

```bash
git add dist
git commit -m "build: Landing Timer 1.0.0" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
