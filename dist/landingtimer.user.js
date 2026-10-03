// ==UserScript==
// @name         Landing Timer
// @namespace    landingtimer.torn
// @version      1.1.0
// @description  A landing countdown on Torn profiles: reads the destination and plane from the profile you are viewing, shows every flight time, and chimes a few minutes before they land, then again as they land. Makes no network requests.
// @license      MIT
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @homepageURL  https://github.com/Dickie1242/Torn-Flight-Landing-Timer
// @supportURL   https://github.com/Dickie1242/Torn-Flight-Landing-Timer/issues
// @downloadURL  https://raw.githubusercontent.com/Dickie1242/Torn-Flight-Landing-Timer/main/dist/landingtimer.user.js
// @updateURL    https://raw.githubusercontent.com/Dickie1242/Torn-Flight-Landing-Timer/main/dist/landingtimer.user.js
// ==/UserScript==
(() => {
  // src/core/selectors.js
  var PROFILE_PATH = "/profiles.php";
  var STATUS_BOX_SELECTOR = "div.profile-status";
  var STATUS_TEXT_SELECTOR = ".main-desc > span[aria-hidden]";
  var STATUS_DESC_SELECTOR = ".main-desc";
  var PLANE_LABEL_SELECTOR = '[aria-label*="type of plane" i]';
  var PROFILE_HEADING_SELECTOR = "#skip-to-content";
  var squash = (text) => text.replace(/\s+/g, " ").trim();
  function isProfilePage(loc) {
    return !!loc && loc.pathname === PROFILE_PATH;
  }
  function statusBox(doc) {
    return doc ? doc.querySelector(STATUS_BOX_SELECTOR) : null;
  }
  function statusClasses(box) {
    return box ? [...box.classList].map((name) => name.toLowerCase()) : [];
  }
  function statusText(box) {
    if (!box) return null;
    const node = box.querySelector(STATUS_TEXT_SELECTOR) || box.querySelector(STATUS_DESC_SELECTOR);
    const text = node ? squash(node.textContent) : "";
    return text || null;
  }
  function planeAriaLabel(box) {
    if (!box) return null;
    const node = box.matches(PLANE_LABEL_SELECTOR) ? box : box.querySelector(PLANE_LABEL_SELECTOR);
    return node ? node.getAttribute("aria-label") : null;
  }
  function profileIdFromUrl(href) {
    try {
      const id = new URL(href).searchParams.get("XID");
      return id && /^\d+$/.test(id) ? id : null;
    } catch {
      return null;
    }
  }
  function profileIdentity(doc) {
    const heading = doc ? doc.querySelector(PROFILE_HEADING_SELECTOR) : null;
    const fromHeading = heading ? /^(.+?)['’]s? Profile$/i.exec(squash(heading.textContent)) : null;
    const fromTitle = doc && typeof doc.title === "string" ? /^\s*(.+?)\s*\[(\d+)\]/.exec(doc.title) : null;
    return {
      name: fromHeading ? fromHeading[1] : fromTitle ? fromTitle[1] : null,
      id: fromTitle ? fromTitle[2] : null
    };
  }

  // src/core/log.js
  var PREFIX = "[Landing Timer]";
  var warned = /* @__PURE__ */ new Set();
  function info(...args) {
    try {
      console.info(PREFIX, ...args);
    } catch {
    }
  }
  function warnOnce(key, ...args) {
    if (warned.has(key)) return false;
    warned.add(key);
    console.warn(PREFIX, ...args);
    return true;
  }
  function safe(label, fn) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (err) {
        warnOnce(label, `${label} failed:`, err);
        return void 0;
      }
    };
  }

  // src/styles.css
  var styles_default = `/* Landing Timer: the whole stylesheet, injected once at boot.
 *
 * Torn styles plain elements (a, button, select, input, label, b) with rules
 * of its own, some under body classes, and loads some of its CSS after ours.
 * Every rule here carries :not(#_), which matches every element and adds an
 * id's worth of specificity, so ours win without !important. */

/* The profile button, right after Torn's status box. */
.landingtimer-button:not(#_) {
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
.landingtimer-button:not(#_):hover { background: #3d3d3d; }
.landingtimer-button--active:not(#_) { color: #fff; background: #2f6f3e; border-color: #4caf50; }
.landingtimer-button--active:not(#_):hover { background: #377f48; }

/* The panel. Above Torn's chat and Chat+'s menu. */
.landingtimer-panel:not(#_) {
  position: fixed;
  z-index: 2147483647;
  width: 320px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 10px 12px;
  font: 12px/1.5 Arial, sans-serif;
  color: #e8e8e8;
  color-scheme: dark;
  text-align: left;
  background: #232323;
  border: 1px solid #555;
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
}
/* Torn's own label/span/div rules must not reach in. :where() keeps this as
 * specific as the rules below, which come later and so still win. */
.landingtimer-panel:not(#_) :where(label, span, div, b) { color: inherit; font: inherit; }
.landingtimer-panel__title:not(#_) { font-size: 13px; margin-bottom: 2px; }
.landingtimer-panel__title:not(#_) b { font-weight: 700; color: inherit; }
.landingtimer-panel__status:not(#_) { color: #aaa; margin-bottom: 8px; }
.landingtimer-panel__row:not(#_) { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
.landingtimer-panel:not(#_) select,
.landingtimer-panel:not(#_) input[type="number"] {
  font: inherit;
  color: #e8e8e8;
  background: #111;
  border: 1px solid #555;
  border-radius: 3px;
  padding: 2px 4px;
}
.landingtimer-panel:not(#_) input[type="number"] { width: 48px; }
.landingtimer-panel__planes:not(#_) { margin: 6px 0; }
.landingtimer-panel__plane:not(#_) {
  display: grid;
  grid-template-columns: 18px 84px 70px 1fr;
  align-items: center;
  padding: 2px 0;
  cursor: pointer;
}
.landingtimer-panel__minutes:not(#_) { font-variant-numeric: tabular-nums; }
.landingtimer-panel__tag:not(#_) { color: #8bc34a; font-size: 11px; }
.landingtimer-panel__summary:not(#_) { margin-top: 6px; font-weight: 600; }
.landingtimer-panel__variance:not(#_) { color: #aaa; font-size: 11px; }
.landingtimer-panel__variance--warn:not(#_) { color: #ffb74d; }
.landingtimer-panel__error:not(#_) { color: #ff8a80; font-weight: 600; }
.landingtimer-panel__error:not(#_):empty { display: none; }
.landingtimer-panel__actions:not(#_) { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.landingtimer-panel__actions:not(#_) button {
  font: inherit;
  padding: 4px 12px;
  color: #e8e8e8;
  background: #333;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
}
.landingtimer-panel__actions:not(#_) button[data-action="start"] { color: #fff; background: #2f6f3e; border-color: #4caf50; }
.landingtimer-panel__actions:not(#_) button:disabled { opacity: 0.45; cursor: default; }

/* The floating timer box, on every page. Above Torn's and Chat+'s chats. */
.landingtimer-widget:not(#_) {
  position: fixed;
  z-index: 2147483646;
  top: 120px;
  right: 16px;
  min-width: 240px;
  font: 12px/1.4 Arial, sans-serif;
  color: #e8e8e8;
  color-scheme: dark;
  text-align: left;
  background: rgba(28, 28, 28, 0.95);
  border: 1px solid #555;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  user-select: none;
}
.landingtimer-widget[hidden]:not(#_) { display: none !important; }
.landingtimer-widget:not(#_) :where(span, div) { color: inherit; font: inherit; }
.landingtimer-widget__bar:not(#_) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #333;
  border-radius: 6px 6px 0 0;
  cursor: move;
  touch-action: none;
}
.landingtimer-widget__title:not(#_) { font-weight: 600; }
.landingtimer-widget__sound:not(#_) { font: inherit; padding: 0 2px; color: inherit; background: none; border: 0; cursor: pointer; }
.landingtimer-widget__list:not(#_) { max-height: calc(100vh - 48px); overflow-y: auto; padding: 2px 0; }
.landingtimer-row:not(#_) {
  display: grid;
  grid-template-columns: 1fr auto auto 18px;
  gap: 8px;
  align-items: center;
  padding: 3px 8px;
}
.landingtimer-row__name:not(#_) {
  font: inherit;
  max-width: 120px;
  overflow: hidden;
  color: #8ab4f8;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.landingtimer-row__name[href]:not(#_):hover { text-decoration: underline; }
.landingtimer-row__name:not([href]):not(#_) { color: inherit; }
.landingtimer-row__place:not(#_) { color: #bbb; }
.landingtimer-row__time:not(#_) { font-variant-numeric: tabular-nums; text-align: right; }
.landingtimer-row__remove:not(#_) { font: inherit; padding: 0; color: #999; background: none; border: 0; cursor: pointer; }
.landingtimer-row__remove:not(#_):hover { color: #fff; }
.landingtimer-row--due:not(#_) { background: rgba(200, 40, 40, 0.35); }
.landingtimer-row--due:not(#_) .landingtimer-row__time { color: #ff8a80; font-weight: 700; }

/* A visible focus ring, in case Torn turns outlines off. */
.landingtimer-button:not(#_):focus-visible,
.landingtimer-panel:not(#_) :focus-visible,
.landingtimer-widget:not(#_) :focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
`;

  // src/core/version.js
  var VERSION = true ? "1.1.0" : "dev";
  var VERSION_ATTR = "data-landingtimer-version";

  // src/core/styles.js
  var STYLE_ELEMENT_ID = "landingtimer-styles";
  function injectStyles(doc) {
    if (!doc || doc.getElementById(STYLE_ELEMENT_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.setAttribute(VERSION_ATTR, VERSION);
    style.textContent = styles_default;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // src/core/clock.js
  var realClock = Object.freeze({
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle)
  });

  // src/core/flights.js
  var DESTINATIONS = Object.freeze([
    Object.freeze({ key: "mexico", name: "Mexico" }),
    Object.freeze({ key: "cayman", name: "Cayman Islands" }),
    Object.freeze({ key: "canada", name: "Canada" }),
    Object.freeze({ key: "hawaii", name: "Hawaii" }),
    Object.freeze({ key: "uk", name: "United Kingdom" }),
    Object.freeze({ key: "argentina", name: "Argentina" }),
    Object.freeze({ key: "switzerland", name: "Switzerland" }),
    Object.freeze({ key: "japan", name: "Japan" }),
    Object.freeze({ key: "china", name: "China" }),
    Object.freeze({ key: "uae", name: "UAE" }),
    Object.freeze({ key: "southafrica", name: "South Africa" })
  ]);
  var PLANES = Object.freeze([
    Object.freeze({ key: "standard", label: "Standard" }),
    Object.freeze({ key: "airstrip", label: "Airstrip" }),
    Object.freeze({ key: "private", label: "WLT private" }),
    Object.freeze({ key: "business", label: "Business" })
  ]);
  var MINUTES = /* @__PURE__ */ new Map([
    ["mexico", [24, 17, 12, 7]],
    ["cayman", [33, 23, 17, 10]],
    ["canada", [39, 27, 19, 12]],
    ["hawaii", [127, 89, 63, 38]],
    ["uk", [151, 106, 75, 45]],
    ["argentina", [158, 111, 79, 47]],
    ["switzerland", [166, 116, 83, 50]],
    ["japan", [213, 149, 107, 64]],
    ["china", [229, 160, 114, 69]],
    ["uae", [257, 180, 128, 77]],
    ["southafrica", [282, 197, 141, 85]]
  ]);
  var VARIANCE = 0.03;
  var PROFILE_PLANES = Object.freeze({
    commercial: Object.freeze({ label: "Commercial", pick: "standard" }),
    airstrip: Object.freeze({ label: "Airstrip", pick: "airstrip" }),
    private: Object.freeze({ label: "WLT private", pick: "private" })
  });
  function isDestination(key) {
    return DESTINATIONS.some((d) => d.key === key);
  }
  function isPlane(key) {
    return PLANES.some((p) => p.key === key);
  }
  function minutesFor(destination, plane) {
    const row = MINUTES.get(destination);
    const index = PLANES.findIndex((p) => p.key === plane);
    return row && index >= 0 ? row[index] : null;
  }
  function destinationName(key) {
    const destination = DESTINATIONS.find((d) => d.key === key);
    return destination ? destination.name : null;
  }
  function planeLabel(key) {
    const plane = PLANES.find((p) => p.key === key);
    return plane ? plane.label : null;
  }
  function varianceMinutes(minutes) {
    return Math.round(minutes * VARIANCE);
  }

  // src/core/storage.js
  var STORAGE_KEY = "landingtimer.v1";
  var STORAGE_VERSION = 1;
  var EXPIRE_AFTER_MS = 60 * 60 * 1e3;
  var BUFFER = Object.freeze({ default: 2, min: 0, max: 30 });
  var DEFAULT_SETTINGS = Object.freeze({
    bufferMin: BUFFER.default,
    /** Chime when a timer comes due. Shared by every tab. */
    sound: true,
    /** Where the timer box was dragged to, or null for its default corner. */
    widgetPos: null
  });
  function sanitizeBuffer(value) {
    if (!Number.isFinite(value)) return BUFFER.default;
    return Math.min(BUFFER.max, Math.max(BUFFER.min, Math.round(value)));
  }
  function sanitizePos(raw) {
    return raw && typeof raw === "object" && Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: Math.round(raw.x), y: Math.round(raw.y) } : null;
  }
  function sanitizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      bufferMin: sanitizeBuffer(source.bufferMin),
      sound: typeof source.sound === "boolean" ? source.sound : DEFAULT_SETTINGS.sound,
      widgetPos: sanitizePos(source.widgetPos)
    };
  }
  var isTime = (value) => Number.isFinite(value) && value > 0;
  var MAX_FLIGHT_MS = 24 * 60 * 60 * 1e3;
  var MAX_ID_LENGTH = 80;
  var MAX_NAME_LENGTH = 64;
  function sanitizeTimer(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || id.length > MAX_ID_LENGTH || !isDestination(raw.destination) || !isPlane(raw.plane)) return null;
    if (!(Number.isFinite(raw.minutes) && raw.minutes > 0)) return null;
    if (!isTime(raw.startedAt) || !isTime(raw.landingAt) || !isTime(raw.ringAt)) return null;
    if (!(raw.startedAt <= raw.ringAt && raw.ringAt <= raw.landingAt)) return null;
    if (raw.landingAt - raw.startedAt > MAX_FLIGHT_MS) return null;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : `#${id}`;
    return {
      id,
      name,
      destination: raw.destination,
      plane: raw.plane,
      direction: raw.direction === "to" || raw.direction === "from" ? raw.direction : null,
      minutes: raw.minutes,
      startedAt: raw.startedAt,
      landingAt: raw.landingAt,
      ringAt: raw.ringAt,
      rungAt: isTime(raw.rungAt) ? raw.rungAt : null,
      landRungAt: isTime(raw.landRungAt) ? raw.landRungAt : null
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
      warnOnce("storage.read", "stored timers are not valid JSON; starting fresh");
      return emptyState();
    }
    if (!data || typeof data !== "object" || data.version !== STORAGE_VERSION) {
      warnOnce("storage.read", `stored timers have version ${data && data.version}, expected ${STORAGE_VERSION}; starting fresh`);
      return emptyState();
    }
    const byId = /* @__PURE__ */ new Map();
    for (const raw of Array.isArray(data.timers) ? data.timers : []) {
      const timer = sanitizeTimer(raw);
      if (timer) byId.set(timer.id, timer);
    }
    return { version: STORAGE_VERSION, timers: [...byId.values()], settings: sanitizeSettings(data.settings) };
  }
  function createStorage({ area = globalThis.localStorage, target = globalThis.window, clock = realClock } = {}) {
    let state = emptyState();
    const listeners = /* @__PURE__ */ new Set();
    let unsaved = false;
    function read() {
      try {
        state = parseState(area ? area.getItem(STORAGE_KEY) : null);
      } catch (err) {
        warnOnce("storage.read", "could not read stored timers; starting fresh:", err);
        state = emptyState();
      }
    }
    function write() {
      try {
        if (area) area.setItem(STORAGE_KEY, JSON.stringify(state));
        unsaved = !area;
      } catch (err) {
        unsaved = true;
        warnOnce("storage.write", "could not save timers:", err);
      }
    }
    function notify() {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (err) {
          warnOnce("storage.subscriber", "a storage subscriber threw:", err);
        }
      }
    }
    function commit() {
      write();
      notify();
    }
    function update(apply) {
      if (!unsaved) read();
      const changed = apply();
      if (changed) commit();
      return changed;
    }
    const live = (timer) => clock.now() - timer.landingAt < EXPIRE_AFTER_MS;
    function getTimers() {
      return state.timers.filter(live).sort((a, b) => a.ringAt - b.ringAt).map((t) => ({ ...t }));
    }
    function getTimer(id) {
      const timer = state.timers.find((t) => t.id === id);
      return timer && live(timer) ? { ...timer } : null;
    }
    function addTimer(raw) {
      const timer = sanitizeTimer(raw);
      if (!timer) return null;
      update(() => {
        state.timers = state.timers.filter((t) => t.id !== timer.id).concat(timer);
        return true;
      });
      return { ...timer };
    }
    function removeTimer(id) {
      return update(() => {
        const next = state.timers.filter((t) => t.id !== id);
        if (next.length === state.timers.length) return false;
        state.timers = next;
        return true;
      });
    }
    function mark(id, field, at) {
      if (!isTime(at)) return false;
      return update(() => {
        const timer = state.timers.find((t) => t.id === id);
        if (!timer || timer[field] != null) return false;
        timer[field] = at;
        return true;
      });
    }
    function markRung(id, at) {
      return mark(id, "rungAt", at);
    }
    function markLanded(id, at) {
      return mark(id, "landRungAt", at);
    }
    function prune() {
      if (state.timers.every(live)) return 0;
      let gone = 0;
      update(() => {
        const next = state.timers.filter(live);
        gone = state.timers.length - next.length;
        state.timers = next;
        return gone > 0;
      });
      return gone;
    }
    function getSetting(name) {
      const value = state.settings[name];
      return value && typeof value === "object" ? { ...value } : value;
    }
    function setSetting(name, value) {
      if (!Object.hasOwn(DEFAULT_SETTINGS, name)) return void 0;
      update(() => {
        const next = sanitizeSettings({ ...state.settings, [name]: value });
        if (JSON.stringify(next[name]) === JSON.stringify(state.settings[name])) return false;
        state.settings = next;
        return true;
      });
      return getSetting(name);
    }
    function reload() {
      if (!unsaved) read();
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
    const onPageShow = (event) => {
      if (!event || !event.persisted) return;
      read();
      notify();
    };
    function destroy() {
      if (target && typeof target.removeEventListener === "function") {
        target.removeEventListener("storage", onStorage);
        target.removeEventListener("pageshow", onPageShow);
      }
      listeners.clear();
    }
    read();
    if (target && typeof target.addEventListener === "function") {
      target.addEventListener("storage", onStorage);
      target.addEventListener("pageshow", onPageShow);
    }
    function saved() {
      return !unsaved;
    }
    return {
      getTimers,
      getTimer,
      addTimer,
      removeTimer,
      markRung,
      markLanded,
      prune,
      getSetting,
      setSetting,
      reload,
      saved,
      subscribe,
      destroy
    };
  }

  // src/core/audio.js
  var READY_TIMEOUT_MS = 300;
  var CHIMES = Object.freeze({
    ring: Object.freeze({ wave: "sine", notes: Object.freeze([880, 880, 880]), step: 0.45, length: 0.35, peak: 0.3 }),
    land: Object.freeze({
      wave: "triangle",
      notes: Object.freeze([523.25, 659.25, 783.99, 1046.5]),
      step: 0.28,
      length: 1.2,
      peak: 0.35,
      tail: 0.25
    })
  });
  function createAudio({ win = globalThis.window, timeoutMs = READY_TIMEOUT_MS } = {}) {
    let context = null;
    let blocked = false;
    const running = () => !!context && context.state === "running";
    function getContext() {
      if (context && context.state !== "closed") return context;
      const AudioCtx = win && (win.AudioContext || win.webkitAudioContext);
      if (!AudioCtx) return null;
      try {
        context = new AudioCtx();
      } catch {
        context = null;
      }
      return context;
    }
    function resume(ctx) {
      try {
        const result = ctx.resume();
        return result && typeof result.then === "function" ? result.catch(() => {
        }) : Promise.resolve();
      } catch {
        return Promise.resolve();
      }
    }
    function unlock() {
      blocked = false;
      const ctx = getContext();
      if (!ctx) return;
      if (ctx.state !== "running") resume(ctx);
    }
    async function ready() {
      const ctx = getContext();
      if (!ctx) {
        blocked = true;
        return false;
      }
      if (ctx.state !== "running") {
        const starting = resume(ctx);
        await Promise.race([starting, new Promise((resolve) => win.setTimeout(resolve, timeoutMs))]);
        if (ctx.state !== "running") {
          starting.then(() => {
            if (running()) blocked = false;
          });
        }
      }
      blocked = ctx.state !== "running";
      return !blocked;
    }
    function play(kind = "ring") {
      const ctx = getContext();
      if (!ctx || ctx.state !== "running") return false;
      const chime = Object.hasOwn(CHIMES, kind) ? CHIMES[kind] : CHIMES.ring;
      const start = ctx.currentTime + 0.05;
      chime.notes.forEach((frequency, i) => {
        const at = start + i * chime.step;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = chime.wave;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(1e-4, at);
        gain.gain.exponentialRampToValueAtTime(chime.peak, at + 0.02);
        if (chime.tail) gain.gain.setTargetAtTime(1e-4, at + 0.02, chime.tail);
        else gain.gain.exponentialRampToValueAtTime(1e-4, at + chime.length);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + chime.length + 0.05);
      });
      return true;
    }
    function isBlocked() {
      return blocked && !running();
    }
    function likely() {
      return running() || !blocked;
    }
    return { unlock, ready, play, isBlocked, likely };
  }

  // src/core/alarm.js
  var LATE_LIMIT_MS = 2 * 60 * 1e3;
  var LOCK_NAME = "landingtimer:ring";
  var HOLD_MS = 5e3;
  var RETRY_MS = 500;
  var MAX_DELAY = 2 ** 31 - 1;
  var GESTURES = ["pointerdown", "pointerup", "keydown", "touchend"];
  var EVENTS = [
    { kind: "ring", at: (t) => t.ringAt, done: (t) => t.rungAt != null, mark: (s, id, at) => s.markRung(id, at) },
    { kind: "land", at: (t) => t.landingAt, done: (t) => t.landRungAt != null, mark: (s, id, at) => s.markLanded(id, at) }
  ];
  function isLate(timer, now) {
    return now - timer.landingAt > LATE_LIMIT_MS;
  }
  function pendingChimes(timers, now = Infinity) {
    const chimes = [];
    for (const timer of timers) {
      for (const event of EVENTS) {
        if (!event.done(timer) && event.at(timer) <= now) chimes.push({ timer, event });
      }
    }
    return chimes;
  }
  function createAlarm({
    storage,
    win = globalThis.window,
    clock = realClock,
    locks = win && win.navigator ? win.navigator.locks : void 0,
    audio = createAudio({ win }),
    holdMs = HOLD_MS
  }) {
    const doc = win ? win.document : null;
    const scheduled = /* @__PURE__ */ new Map();
    let interval = null;
    let unsubscribe = null;
    let started = false;
    let claiming = false;
    let retryPending = false;
    let locksBroken = false;
    let probed = false;
    const told = /* @__PURE__ */ new Set();
    const seenDone = /* @__PURE__ */ new Set();
    const chimeKey = (timer, event) => `${timer.id}:${event.kind}:${event.at(timer)}`;
    function tellOnce(key, message) {
      if (told.has(key)) return;
      told.add(key);
      info(message);
    }
    function describe(chimes) {
      const landing = chimes.filter((c) => c.event.kind === "land").length;
      const soon = chimes.length - landing;
      return [landing && `${landing} landing`, soon && `${soon} landing soon`].filter(Boolean).join(", ");
    }
    const BLOCKED_NOTE = "a chime is due, but the browser has not let this page play sound yet: click anywhere on this page (or another open Torn tab will play it)";
    const safePlay = safe("alarm.play", (kind) => audio.play(kind));
    function pending(now) {
      const timers = storage.getTimers();
      for (const timer of timers) {
        for (const event of EVENTS) if (event.done(timer)) seenDone.add(chimeKey(timer, event));
      }
      return pendingChimes(timers, now).filter((c) => !seenDone.has(chimeKey(c.timer, c.event)));
    }
    async function ringDue() {
      storage.reload();
      const now = clock.now();
      const due = pending(now);
      if (due.length === 0) return;
      const sound = !!storage.getSetting("sound");
      const audible = [];
      const silent = [];
      for (const chime of due) {
        if (sound && !isLate(chime.timer, now)) audible.push(chime);
        else if (chime.event.mark(storage, chime.timer.id, now)) silent.push(chime);
      }
      if (silent.length > 0) {
        info(`no sound (${sound ? "landed over 2 minutes ago" : "chime is off"}): ${describe(silent)}`);
      }
      let rung = [];
      if (audible.length > 0) {
        if (await audio.ready()) {
          told.delete("blocked");
          rung = audible.filter((chime) => chime.event.mark(storage, chime.timer.id, clock.now()));
          if (rung.length > 0) {
            safePlay(rung.some((chime) => chime.event.kind === "land") ? "land" : "ring");
            info(`chimed: ${describe(rung)}`);
          }
        } else {
          tellOnce("blocked", BLOCKED_NOTE);
        }
      }
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
      if (locks && !locksBroken && typeof locks.request === "function") {
        return locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (lock) return ringDue();
          retrySoon();
          return void 0;
        });
      }
      return ringDue();
    }
    function check() {
      if (!started || claiming) return;
      const now = clock.now();
      const due = pending(now);
      if (due.length === 0) return;
      const sound = !!storage.getSetting("sound");
      const anySilent = due.some((chime) => !sound || isLate(chime.timer, now));
      if (!anySilent && audio.isBlocked()) {
        tellOnce("blocked", BLOCKED_NOTE);
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
      attempt.catch((err) => {
        failed = true;
        warnOnce("alarm.ring", "could not ring a timer:", err);
        if (err && (err.name === "SecurityError" || err.name === "NotSupportedError")) {
          locksBroken = true;
          clock.setTimeout(tick, 0);
        }
      }).finally(() => {
        claiming = false;
        if (!failed && started && !retryPending && pending(clock.now()).length > 0) {
          clock.setTimeout(tick, 0);
        }
      });
    }
    const tick = safe("alarm.check", check);
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
    function syncInterval(active) {
      if (active && interval === null) {
        interval = clock.setInterval(tick, 1e3);
      } else if (!active && interval !== null) {
        clock.clearInterval(interval);
        interval = null;
      }
    }
    const onChange = safe("alarm.reschedule", () => {
      const chimes = pending();
      reschedule(chimes);
      syncInterval(chimes.length > 0);
      if (chimes.length > 0 && !probed && storage.getSetting("sound")) {
        probed = true;
        Promise.resolve(audio.ready()).catch(() => {
        });
      }
      tick();
    });
    const onGesture = safe("alarm.gesture", () => {
      if (!storage.getSetting("sound")) return;
      if (pending().length === 0) {
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
        win.addEventListener("focus", tick);
        for (const type of GESTURES) win.addEventListener(type, onGesture, true);
        win.addEventListener("click", onGesture);
      }
      if (doc) doc.addEventListener("visibilitychange", tick);
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
        win.removeEventListener("focus", tick);
        for (const type of GESTURES) win.removeEventListener(type, onGesture, true);
        win.removeEventListener("click", onGesture);
      }
      if (doc) doc.removeEventListener("visibilitychange", tick);
    }
    return { start, destroy, check: tick };
  }

  // src/core/dom.js
  function el(doc, tag, { className, text, attrs, on } = {}, children = []) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    if (attrs) {
      for (const [name, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        node.setAttribute(name, value === true ? "" : String(value));
      }
    }
    if (on) {
      for (const [type, listener] of Object.entries(on)) node.addEventListener(type, listener);
    }
    for (const child of children) {
      if (child != null && child !== "") node.append(child);
    }
    return node;
  }

  // src/core/time.js
  var pad = (n) => String(n).padStart(2, "0");
  function hms(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor(totalSeconds % 3600 / 60);
    const s = totalSeconds % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function formatCountdown(ms) {
    return hms(Math.max(0, Math.ceil(ms / 1e3)));
  }
  function formatElapsed(ms) {
    return hms(Math.max(0, Math.floor(ms / 1e3)));
  }
  function formatClock(epochMs) {
    const date = new Date(epochMs);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function formatMinutes(minutes) {
    const total = Math.max(0, Math.round(minutes));
    if (total < 60) return `${total} min`;
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? `${hours}h ${rest}min` : `${hours}h`;
  }

  // src/widget/drag.js
  var DEFAULT_POS = Object.freeze({ right: 16, top: 120 });
  var MOVE_THRESHOLD_PX = 3;
  function clampPosition(pos, size, view) {
    const maxX = Math.max(0, view.width - size.width);
    const maxY = Math.max(0, view.height - size.height);
    return {
      x: Math.round(Math.min(Math.max(0, pos.x), maxX)),
      y: Math.round(Math.min(Math.max(0, pos.y), maxY))
    };
  }
  function attachDrag({ handle, element, win, getPos, setPos }) {
    let drag = null;
    function view() {
      const html = element.ownerDocument.documentElement;
      return {
        width: html && html.clientWidth || win.innerWidth,
        height: html && html.clientHeight || win.innerHeight
      };
    }
    function measure() {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }
    function place(pos, size = measure()) {
      const bounds = view();
      if (!pos) {
        element.style.left = "";
        element.style.right = `${DEFAULT_POS.right}px`;
        element.style.top = `${Math.max(0, Math.min(DEFAULT_POS.top, bounds.height - size.height))}px`;
        return;
      }
      const { x, y } = clampPosition(pos, size, bounds);
      element.style.right = "auto";
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    }
    function apply() {
      if (!drag) place(getPos());
    }
    function stopListening() {
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerup", onUp);
      win.removeEventListener("pointercancel", onUp);
      win.removeEventListener("blur", end);
      handle.removeEventListener("lostpointercapture", onLostCapture);
    }
    function end() {
      if (!drag) return;
      const { id, moved, pos } = drag;
      drag = null;
      stopListening();
      try {
        if (handle.hasPointerCapture && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      } catch {
      }
      if (moved) {
        setPos(pos);
        place(pos);
      } else {
        place(getPos());
      }
    }
    function onMove(event) {
      if (!drag || event.pointerId !== drag.id) return;
      if ((event.pointerType === "mouse" || event.pointerType === "pen") && !(event.buttons & 1)) {
        end();
        return;
      }
      if (!drag.moved && Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < MOVE_THRESHOLD_PX) return;
      drag.moved = true;
      drag.pos = clampPosition({ x: event.clientX - drag.dx, y: event.clientY - drag.dy }, drag.size, view());
      place(drag.pos, drag.size);
    }
    function onUp(event) {
      if (drag && event.pointerId === drag.id) end();
    }
    function onLostCapture(event) {
      if (drag && event.pointerId === drag.id && event.target === handle) end();
    }
    function onDown(event) {
      if (drag || event.button !== 0 || event.isPrimary === false) return;
      if (event.target && event.target.closest && event.target.closest("button, a")) return;
      const rect = element.getBoundingClientRect();
      drag = {
        id: event.pointerId,
        x0: event.clientX,
        y0: event.clientY,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        size: { width: rect.width, height: rect.height },
        pos: null,
        moved: false
      };
      event.preventDefault();
      try {
        if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
      } catch {
      }
      win.addEventListener("pointermove", onMove);
      win.addEventListener("pointerup", onUp);
      win.addEventListener("pointercancel", onUp);
      win.addEventListener("blur", end);
      handle.addEventListener("lostpointercapture", onLostCapture);
    }
    handle.addEventListener("pointerdown", onDown);
    win.addEventListener("resize", apply);
    apply();
    return {
      apply,
      destroy() {
        handle.removeEventListener("pointerdown", onDown);
        win.removeEventListener("resize", apply);
        stopListening();
        drag = null;
      }
    };
  }

  // src/widget/widget.js
  var WIDGET_CLASS = "landingtimer-widget";
  var ROW_CLASS = "landingtimer-row";
  var ROW_DUE_CLASS = "landingtimer-row--due";
  var SOUND_ON = "\u{1F50A}";
  var SOUND_OFF = "\u{1F507}";
  var SOUND_BLOCKED_TITLE = "Click anywhere on this page to allow the chime";
  var TICK_MS = 250;
  function rowState(timer, now) {
    if (now < timer.ringAt) return { due: false, text: formatCountdown(timer.ringAt - now) };
    if (now < timer.landingAt) return { due: true, text: `LANDING in ${formatCountdown(timer.landingAt - now)}` };
    return { due: true, text: `LANDED +${formatElapsed(now - timer.landingAt)}` };
  }
  function placeText(timer) {
    const place = destinationName(timer.destination) || timer.destination;
    return timer.direction === "from" ? `${place} \u2192 Torn` : place;
  }
  function rowTitle(timer) {
    return `Lands ~${formatClock(timer.landingAt)} \xB7 rings ${formatClock(timer.ringAt)} \xB7 ${planeLabel(timer.plane)}, ${formatMinutes(timer.minutes)}`;
  }
  function setCell(cell, node, text) {
    if (node.parentNode !== cell) cell.replaceChildren(node);
    if (node.data !== text) node.data = text;
  }
  function setAttr(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  function createWidget({ doc = globalThis.document, storage, clock = realClock, canPlay = () => true }) {
    const win = doc.defaultView;
    const rows = /* @__PURE__ */ new Map();
    let interval = null;
    let unsubscribe = null;
    let drag = null;
    let rendering = false;
    let shownBlocked = false;
    let lastShape = "";
    const soundText = doc.createTextNode("");
    const sound = el(doc, "button", {
      className: `${WIDGET_CLASS}__sound`,
      attrs: { type: "button", "aria-label": "Chime" },
      on: { click: onSoundClick }
    }, [soundText]);
    const bar = el(doc, "div", { className: `${WIDGET_CLASS}__bar` }, [
      el(doc, "span", { className: `${WIDGET_CLASS}__title` }, [
        el(doc, "span", { text: "\u2708", attrs: { "aria-hidden": "true" } }),
        " Landing timers"
      ]),
      sound
    ]);
    const list = el(doc, "div", { className: `${WIDGET_CLASS}__list` });
    const root = el(doc, "div", { className: WIDGET_CLASS, attrs: { hidden: true, translate: "no" } }, [bar, list]);
    function onSoundClick() {
      if (shownBlocked && canPlay()) {
        forced();
        return;
      }
      storage.setSetting("sound", !storage.getSetting("sound"));
    }
    function buildRow(id) {
      const nameText = doc.createTextNode("");
      const whereText = doc.createTextNode("");
      const timeText = doc.createTextNode("");
      const name = el(doc, "a", { className: `${ROW_CLASS}__name` }, [nameText]);
      const place = el(doc, "span", { className: `${ROW_CLASS}__place` }, [whereText]);
      const time = el(doc, "span", { className: `${ROW_CLASS}__time` }, [timeText]);
      const remove = el(doc, "button", {
        className: `${ROW_CLASS}__remove`,
        text: "\u2715",
        attrs: { type: "button", title: "Remove timer" },
        on: {
          click: (event) => {
            if (event.detail > 1) return;
            storage.removeTimer(id);
          }
        }
      });
      const row = el(doc, "div", { className: ROW_CLASS, attrs: { "data-id": id } }, [name, place, time, remove]);
      return { row, name, place, time, remove, nameText, whereText, timeText };
    }
    function renderSound() {
      const on = !!storage.getSetting("sound");
      const blocked = on && !canPlay();
      shownBlocked = blocked;
      setCell(sound, soundText, on && !blocked ? SOUND_ON : SOUND_OFF);
      let title = on ? "Chime on: click to mute" : "Chime off: click to turn it on";
      if (blocked) title = SOUND_BLOCKED_TITLE;
      setAttr(sound, "title", title);
      setAttr(sound, "aria-pressed", String(on));
    }
    function renderRow(parts, timer, state) {
      setCell(parts.name, parts.nameText, timer.name);
      if (/^\d+$/.test(timer.id)) setAttr(parts.name, "href", `/profiles.php?XID=${timer.id}`);
      else if (parts.name.hasAttribute("href")) parts.name.removeAttribute("href");
      setCell(parts.place, parts.whereText, placeText(timer));
      setCell(parts.time, parts.timeText, state.text);
      setAttr(parts.row, "title", rowTitle(timer));
      setAttr(parts.remove, "aria-label", `Remove timer for ${timer.name}`);
      parts.row.classList.toggle(ROW_DUE_CLASS, state.due);
    }
    function render(force) {
      if (rendering) return;
      rendering = true;
      try {
        storage.prune();
        const timers = storage.getTimers();
        if (timers.length === 0 && root.hidden && rows.size === 0) return;
        const now = clock.now();
        const hide = timers.length === 0;
        if (root.hidden !== hide) root.hidden = hide;
        renderSound();
        const live = new Set(timers.map((t) => t.id));
        for (const [id, parts] of rows) {
          if (!live.has(id)) {
            parts.row.remove();
            rows.delete(id);
          }
        }
        const shape = [];
        timers.forEach((timer, index) => {
          let parts = rows.get(timer.id);
          if (!parts) {
            parts = buildRow(timer.id);
            rows.set(timer.id, parts);
          }
          const state = rowState(timer, now);
          renderRow(parts, timer, state);
          let phase = 2;
          if (now < timer.ringAt) phase = 0;
          else if (now < timer.landingAt) phase = 1;
          shape.push(`${timer.id}:${phase}:${state.text.length}`);
          if (list.children[index] !== parts.row) list.insertBefore(parts.row, list.children[index] || null);
        });
        const key = `${hide}|${shape.join(",")}`;
        if (drag && (force || key !== lastShape)) drag.apply();
        lastShape = key;
      } finally {
        rendering = false;
      }
    }
    const forced = safe("widget.render", () => render(true));
    const ticked = safe("widget.tick", () => {
      if (!doc.hidden) render(false);
    });
    const onVisibility = () => {
      if (!doc.hidden) forced();
    };
    function start() {
      if (interval !== null) return;
      doc.body.append(root);
      drag = attachDrag({
        handle: bar,
        element: root,
        win,
        getPos: () => storage.getSetting("widgetPos"),
        setPos: (pos) => storage.setSetting("widgetPos", pos)
      });
      unsubscribe = storage.subscribe(forced);
      interval = clock.setInterval(ticked, TICK_MS);
      doc.addEventListener("visibilitychange", onVisibility);
      forced();
    }
    function destroy() {
      if (interval !== null) clock.clearInterval(interval);
      interval = null;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      doc.removeEventListener("visibilitychange", onVisibility);
      if (drag) drag.destroy();
      drag = null;
      root.remove();
    }
    return { start, destroy, render: forced, element: root };
  }

  // src/profile/readStatus.js
  var COUNTRY_CLASS = /* @__PURE__ */ new Map([
    ["mexico", "mexico"],
    ["cayman", "cayman"],
    ["canada", "canada"],
    ["hawaii", "hawaii"],
    ["kingdom", "uk"],
    ["argentina", "argentina"],
    ["switzerland", "switzerland"],
    ["japan", "japan"],
    ["china", "china"],
    ["uae", "uae"],
    ["africa", "southafrica"],
    ["emirates", "uae"]
  ]);
  var COUNTRY_NAME = /* @__PURE__ */ new Map([
    ["mexico", "mexico"],
    ["cayman islands", "cayman"],
    ["canada", "canada"],
    ["hawaii", "hawaii"],
    ["united kingdom", "uk"],
    ["uk", "uk"],
    ["argentina", "argentina"],
    ["switzerland", "switzerland"],
    ["japan", "japan"],
    ["china", "china"],
    ["uae", "uae"],
    ["united arab emirates", "uae"],
    ["south africa", "southafrica"],
    ["cayman", "cayman"]
  ]);
  var PLANE_CLASS = /* @__PURE__ */ new Set(["commercial", "airstrip", "private"]);
  var PLANE_WORD = /* @__PURE__ */ new Map([
    ["commercial", "commercial"],
    ["personal", "airstrip"],
    ["airstrip", "airstrip"],
    ["private", "private"]
  ]);
  function countryFromName(text) {
    if (typeof text !== "string") return null;
    const key = text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").replace(/^the /, "");
    return COUNTRY_NAME.get(key) || null;
  }
  function parseClasses(classes) {
    if (!Array.isArray(classes)) return {};
    if (!classes.includes("travelling") && !classes.includes("traveling")) return {};
    const country = classes.find((name) => COUNTRY_CLASS.has(name));
    if (!country) return {};
    const hasTo = classes.includes("to");
    const hasFrom = classes.includes("from");
    return {
      state: "traveling",
      // Both words, or neither, and the classes cannot say which way.
      direction: hasTo === hasFrom ? null : hasTo ? "to" : "from",
      destination: COUNTRY_CLASS.get(country),
      plane: classes.find((name) => PLANE_CLASS.has(name)) || null
    };
  }
  function travel(direction, place) {
    return { state: "traveling", direction, destination: countryFromName(place) };
  }
  var TEXT_RULES = [
    [/^traveling$/i, () => ({ state: "hidden" })],
    [/^(?:traveling from )?torn to (.+)$/i, (m) => travel("to", m[1])],
    [/^(?:traveling from )?(.+) to torn$/i, (m) => travel("from", m[1])],
    [/^traveling to (.+)$/i, (m) => travel("to", m[1])],
    [/^returning to torn from (.+)$/i, (m) => travel("from", m[1])],
    [/^(?:hiding out )?in (.+)$/i, (m) => {
      const destination = countryFromName(m[1]);
      return destination ? { state: "abroad", destination } : {};
    }]
  ];
  function parseStatusText(text) {
    if (typeof text !== "string") return {};
    const clean = text.replace(/\s+/g, " ").trim();
    for (const [pattern, make] of TEXT_RULES) {
      const match = pattern.exec(clean);
      if (match) return make(match);
    }
    return {};
  }
  function parsePlaneLabel(label) {
    if (typeof label !== "string") return {};
    const match = /^(.*?)\.?\s*Type of plane:\s*(\w+)/i.exec(label);
    if (!match) return {};
    return { ...parseStatusText(match[1]), plane: PLANE_WORD.get(match[2].toLowerCase()) || null };
  }
  function distinct(sources, field) {
    return [...new Set(sources.map((source) => source[field]).filter(Boolean))];
  }
  function pickRoute(sources) {
    const destinations = distinct(sources, "destination");
    const directions = distinct(sources, "direction");
    return {
      destination: destinations.length === 1 ? destinations[0] : null,
      direction: destinations.length <= 1 && directions.length === 1 ? directions[0] : null
    };
  }
  function readStatus(doc, href) {
    const box = statusBox(doc);
    const sources = [
      parseClasses(statusClasses(box)),
      parsePlaneLabel(planeAriaLabel(box)),
      parseStatusText(statusText(box))
    ];
    const pick = (field) => {
      for (const source of sources) if (source[field] != null) return source[field];
      return null;
    };
    const identity = profileIdentity(doc);
    const state = pick("state") || "other";
    const travelling = state === "traveling";
    const route = pickRoute(sources);
    const planes = distinct(sources, "plane");
    return {
      id: profileIdFromUrl(href) || identity.id,
      name: identity.name,
      state,
      direction: travelling ? route.direction : null,
      destination: travelling || state === "abroad" ? route.destination : null,
      // The plane sets the timer's length: sources that disagree leave it blank.
      plane: travelling && planes.length === 1 ? planes[0] : null
    };
  }

  // src/profile/button.js
  var BUTTON_CLASS = "landingtimer-button";
  var BUTTON_ACTIVE_CLASS = "landingtimer-button--active";
  var BUTTON_LABEL = "\u23F1 Landing timer";
  var FOLLOWING = 4;
  function mountProfileButton({ doc = globalThis.document, isFlying, onOpen }) {
    const win = doc.defaultView;
    const button = el(doc, "button", {
      className: BUTTON_CLASS,
      text: BUTTON_LABEL,
      attrs: { type: "button", title: "Set a timer for when this player lands" },
      on: {
        click: (event) => {
          event.preventDefault();
          onOpen(button);
        }
      }
    });
    function placed(box) {
      return button.parentNode === box.parentNode && (box.compareDocumentPosition(button) & FOLLOWING) !== 0;
    }
    function ensure() {
      const box = statusBox(doc);
      if (!box) {
        button.remove();
        return;
      }
      if (!placed(box)) {
        const focused = doc.activeElement === button;
        box.after(button);
        if (focused) button.focus({ preventScroll: true });
      }
      button.classList.toggle(BUTTON_ACTIVE_CLASS, !!isFlying());
    }
    let frame = 0;
    const run = safe("button.ensure", () => {
      frame = 0;
      ensure();
    });
    const observer = new win.MutationObserver(safe("button.schedule", () => {
      if (!frame) frame = win.requestAnimationFrame(run);
    }));
    observer.observe(doc.body, { childList: true, subtree: true });
    run();
    return {
      element: button,
      destroy() {
        observer.disconnect();
        if (frame) win.cancelAnimationFrame(frame);
        frame = 0;
        button.remove();
      }
    };
  }

  // src/profile/panel.js
  var PANEL_CLASS = "landingtimer-panel";
  var VARIANCE_WARN_CLASS = `${PANEL_CLASS}__variance--warn`;
  var MINUTE = 60 * 1e3;
  var REFRESH_MS = 15 * 1e3;
  var EDGE = 8;
  var OFFSET = 6;
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  function planTimer({ destination, plane, bufferMin, now }) {
    const minutes = minutesFor(destination, plane);
    if (minutes == null) return null;
    const landingAt = now + minutes * MINUTE;
    const ringAt = Math.max(now, landingAt - sanitizeBuffer(bufferMin) * MINUTE);
    return { minutes, startedAt: now, landingAt, ringAt };
  }
  function seenPlane(status) {
    return status.plane && Object.hasOwn(PROFILE_PLANES, status.plane) ? PROFILE_PLANES[status.plane] : null;
  }
  function describeRoute(direction, place) {
    if (direction === "to") return `Torn \u2192 ${place || "?"}`;
    if (direction === "from") return `${place || "?"} \u2192 Torn`;
    return place ? `Flying to or from ${place}` : "Flying, destination unclear";
  }
  function describeStatus(status) {
    const place = destinationName(status.destination);
    if (status.state === "hidden") return "Travelling disguised: pick the destination and plane.";
    if (status.state === "traveling") {
      const seen = seenPlane(status);
      return `${describeRoute(status.direction, place)} \xB7 plane on profile: ${seen ? seen.label : "not shown"}`;
    }
    if (status.state === "abroad" && place) return `In ${place}. Not flying yet: the timer starts when you press Start.`;
    return "Not flying right now: the timer starts when you press Start.";
  }
  function planeTag(status, planeKey) {
    const seen = seenPlane(status);
    if (!seen) return "";
    if (planeKey === seen.pick) return "\u2190 from profile";
    if (status.plane === "commercial" && planeKey === "business") return "\u2190 also Commercial";
    return "";
  }
  function panelPosition(anchorRect, size, view) {
    const left = Math.min(Math.max(EDGE, anchorRect.left), Math.max(EDGE, view.width - size.width - EDGE));
    let top = anchorRect.bottom + OFFSET;
    if (top + size.height > view.height - EDGE) top = Math.max(EDGE, anchorRect.top - OFFSET - size.height);
    return { left: Math.round(left), top: Math.round(top) };
  }
  function createPanel({ doc = globalThis.document, storage, clock = realClock }) {
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
    function readBuffer() {
      const raw = parts.buffer.value.trim();
      return raw === "" ? storage.getSetting("bufferMin") : sanitizeBuffer(Number(raw));
    }
    function chosen() {
      const radio = parts.radios.find((r) => r.checked);
      return {
        destination: parts.select.value || null,
        plane: radio ? radio.value : null,
        bufferMin: readBuffer()
      };
    }
    function update() {
      if (!parts) return;
      const { destination, plane, bufferMin } = chosen();
      for (const p of PLANES) {
        const minutes = minutesFor(destination, p.key);
        setText(parts.minutes[p.key], minutes == null ? "\u2013" : formatMinutes(minutes));
      }
      const now = clock.now();
      const plan = planTimer({ destination, plane, bufferMin, now });
      parts.start.disabled = !plan;
      if (!plan) {
        setText(parts.summary, "Pick a destination and a plane.");
        setText(parts.variance, "");
        parts.variance.classList.remove(VARIANCE_WARN_CLASS);
        position();
        return;
      }
      const wait = plan.ringAt - now;
      setText(parts.summary, wait > 0 ? `Rings in ${formatMinutes(wait / MINUTE)} (${formatClock(plan.ringAt)})` : `Rings now (${formatClock(plan.ringAt)})`);
      const spread = varianceMinutes(plan.minutes);
      const beyondBuffer = spread > bufferMin;
      setText(parts.variance, `Flights vary up to ~3% (${spread < 1 ? "under 1 min" : `about ${spread} min`} on this one)` + (beyondBuffer ? ": more than your buffer" : ""));
      parts.variance.classList.toggle(VARIANCE_WARN_CLASS, beyondBuffer);
      position();
    }
    function edited() {
      if (!parts) return;
      parts.error.textContent = "";
      update();
    }
    function tidyBuffer() {
      if (!parts) return;
      parts.buffer.value = String(readBuffer());
      update();
    }
    function startTimer() {
      if (!parts) return;
      const { destination, plane, bufferMin } = chosen();
      const plan = planTimer({ destination, plane, bufferMin, now: clock.now() });
      if (!plan) return;
      const timer = storage.addTimer({
        // Storage refuses ids over 80 characters; Torn names are far shorter, but a misread one must not be.
        id: status.id || `name:${(status.name || "unknown").slice(0, 64)}`,
        name: status.name || (status.id ? `#${status.id}` : "Unknown player"),
        destination,
        plane,
        // From abroad the only flight there is goes home.
        direction: status.direction || (status.state === "abroad" ? "from" : null),
        ...plan,
        rungAt: null,
        landRungAt: null
      });
      if (!timer) {
        parts.error.textContent = "Could not save this timer.";
        return;
      }
      storage.setSetting("bufferMin", bufferMin);
      if (!storage.saved()) {
        parts.error.textContent = "Running on this page only: the browser would not save it (its storage for torn.com may be full), so it will not survive leaving or reloading the page.";
        return;
      }
      close();
    }
    function build() {
      const seen = seenPlane(status);
      const pick = seen ? seen.pick : null;
      const select = el(doc, "select", { attrs: { name: "destination" }, on: { change: edited } }, [
        el(doc, "option", { text: "Pick a country", attrs: { value: "" } }),
        ...DESTINATIONS.map((d) => el(doc, "option", { text: d.name, attrs: { value: d.key } }))
      ]);
      select.value = status.destination || "";
      const radios = [];
      const minutes = {};
      const planeRows = PLANES.map((plane) => {
        const radio = el(doc, "input", {
          attrs: { type: "radio", name: "landingtimer-plane", value: plane.key },
          on: { change: edited }
        });
        radio.checked = plane.key === pick;
        radios.push(radio);
        minutes[plane.key] = el(doc, "span", { className: `${PANEL_CLASS}__minutes` });
        return el(doc, "label", { className: `${PANEL_CLASS}__plane`, attrs: { "data-plane": plane.key } }, [
          radio,
          el(doc, "span", { className: `${PANEL_CLASS}__plane-name`, text: plane.label }),
          minutes[plane.key],
          el(doc, "span", { className: `${PANEL_CLASS}__tag`, text: planeTag(status, plane.key) })
        ]);
      });
      const buffer = el(doc, "input", {
        attrs: { type: "number", name: "buffer", min: BUFFER.min, max: BUFFER.max, step: 1 },
        on: { input: edited, change: tidyBuffer }
      });
      buffer.value = String(storage.getSetting("bufferMin"));
      const summary = el(doc, "div", { className: `${PANEL_CLASS}__summary`, attrs: { "aria-live": "polite" } });
      const error = el(doc, "div", { className: `${PANEL_CLASS}__error`, attrs: { role: "alert" } });
      const variance = el(doc, "div", { className: `${PANEL_CLASS}__variance` });
      const start = el(doc, "button", { text: "Start", attrs: { type: "button", "data-action": "start" }, on: { click: startTimer } });
      const cancel = el(doc, "button", { text: "Cancel", attrs: { type: "button", "data-action": "cancel" }, on: { click: () => close() } });
      parts = { select, radios, minutes, buffer, summary, error, variance, start };
      return el(doc, "div", { className: PANEL_CLASS, attrs: { role: "dialog", "aria-label": "Landing timer" } }, [
        el(doc, "div", { className: `${PANEL_CLASS}__title` }, [
          "Landing timer: ",
          el(doc, "b", { text: status.name || "Unknown player" }),
          status.id ? ` [${status.id}]` : ""
        ]),
        el(doc, "div", { className: `${PANEL_CLASS}__status`, text: describeStatus(status) }),
        el(doc, "label", { className: `${PANEL_CLASS}__row` }, ["Destination ", select]),
        el(doc, "div", { className: `${PANEL_CLASS}__planes`, attrs: { role: "radiogroup", "aria-label": "Plane" } }, planeRows),
        el(doc, "label", { className: `${PANEL_CLASS}__row` }, ["Ring ", buffer, " min early"]),
        summary,
        error,
        variance,
        el(doc, "div", { className: `${PANEL_CLASS}__actions` }, [cancel, start])
      ]);
    }
    function viewport() {
      const html = doc.documentElement;
      return {
        width: html && html.clientWidth || win.innerWidth,
        height: html && html.clientHeight || win.innerHeight
      };
    }
    function position() {
      if (!root || !anchor.isConnected) return;
      const size = { width: root.offsetWidth || 320, height: root.offsetHeight || 0 };
      const { left, top } = panelPosition(anchor.getBoundingClientRect(), size, viewport());
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
    }
    function focusFirst() {
      if (!parts.select.value) parts.select.focus();
      else if (!parts.radios.some((r) => r.checked)) parts.radios[0].focus();
      else parts.start.focus();
    }
    function close({ restoreFocus = true } = {}) {
      const returnFocus = restoreFocus && root && anchor && root.contains(doc.activeElement) ? anchor : null;
      for (const off of cleanup) off();
      cleanup = [];
      if (root) root.remove();
      root = null;
      parts = null;
      anchor = null;
      status = null;
      if (returnFocus) returnFocus.focus({ preventScroll: true });
    }
    function open(anchorElement, profileStatus) {
      close();
      anchor = anchorElement;
      status = profileStatus;
      root = build();
      doc.body.append(root);
      update();
      focusFirst();
      listen(doc, "keydown", (event) => {
        if (event.key === "Escape") close();
      }, true);
      listen(doc, "pointerdown", (event) => {
        if (root && !root.contains(event.target) && !anchor.contains(event.target)) close({ restoreFocus: false });
      }, true);
      listen(win, "resize", position);
      listen(doc, "scroll", position, true);
      const refresh = clock.setInterval(safe("panel.refresh", update), REFRESH_MS);
      cleanup.push(() => clock.clearInterval(refresh));
    }
    return {
      open,
      close,
      isOpen: () => root !== null,
      get element() {
        return root;
      }
    };
  }

  // src/main.js
  var FLYING_STATES = /* @__PURE__ */ new Set(["traveling", "hidden"]);
  var RUNNING_ATTR = "data-landingtimer-running";
  function boot() {
    if (!document.body) return;
    const root = document.documentElement;
    if (root.hasAttribute(RUNNING_ATTR)) {
      info(`version ${root.getAttribute(RUNNING_ATTR)} is already running on this page; this copy stays idle`);
      return;
    }
    root.setAttribute(RUNNING_ATTR, VERSION);
    injectStyles(document);
    const storage = createStorage();
    const audio = createAudio({ win: window });
    safe("main.widget", () => createWidget({ doc: document, storage, canPlay: audio.likely }).start())();
    safe("main.alarm", () => createAlarm({ storage, audio }).start())();
    if (isProfilePage(location)) {
      safe("main.profile", () => {
        const panel = createPanel({ doc: document, storage });
        const status = () => readStatus(document, location.href);
        mountProfileButton({
          doc: document,
          isFlying: () => FLYING_STATES.has(status().state),
          onOpen: safe("main.panel", (button) => panel.isOpen() ? panel.close() : panel.open(button, status()))
        });
      })();
    }
    info("ready");
  }
  var safeBoot = safe("main.boot", boot);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeBoot, { once: true });
  } else {
    safeBoot();
  }
})();
