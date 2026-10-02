// ==UserScript==
// @name         Landing Timer
// @namespace    landingtimer.torn
// @version      1.0.0
// @description  A landing countdown on Torn profiles: reads the destination and plane from the profile you are viewing, shows every flight time, and chimes a few minutes before they land. Makes no network requests.
// @license      MIT
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
(() => {
  // src/core/log.js
  var PREFIX = "[Landing Timer]";
  var warned = /* @__PURE__ */ new Set();
  function info(...args) {
    console.info(PREFIX, ...args);
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
  var styles_default = "/* Landing Timer: the whole stylesheet, injected once at boot. */\n\n.landingtimer-widget[hidden] {\n  display: none !important;\n}\n";

  // src/core/version.js
  var VERSION = true ? "1.0.0" : "dev";
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

  // src/main.js
  function boot() {
    injectStyles(document);
    info("ready");
  }
  var safeBoot = safe("main.boot", boot);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeBoot, { once: true });
  } else {
    safeBoot();
  }
})();
