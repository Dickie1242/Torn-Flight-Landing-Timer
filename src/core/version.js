/**
 * The userscript version, lifted from src/header.txt at build time by
 * build.mjs so the two can never drift apart. It is stamped onto the injected
 * <style> tag: the ==UserScript== block is not readable from the page.
 */
/* global __LANDINGTIMER_VERSION__ */
export const VERSION = typeof __LANDINGTIMER_VERSION__ === 'string' ? __LANDINGTIMER_VERSION__ : 'dev';

export const VERSION_ATTR = 'data-landingtimer-version';
