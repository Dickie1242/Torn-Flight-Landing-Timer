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
