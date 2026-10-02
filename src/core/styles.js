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
