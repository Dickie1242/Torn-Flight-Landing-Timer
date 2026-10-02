import * as selectors from './core/selectors.js';
import { info, safe } from './core/log.js';
import { injectStyles } from './core/styles.js';
import { VERSION } from './core/version.js';
import { createStorage } from './core/storage.js';
import { createAlarm } from './core/alarm.js';
import { createAudio } from './core/audio.js';
import { createWidget } from './widget/widget.js';
import { readStatus } from './profile/readStatus.js';
import { mountProfileButton } from './profile/button.js';
import { createPanel } from './profile/panel.js';

/** States in which the profile button gets its accent. */
const FLYING_STATES = new Set(['traveling', 'hidden']);

/** Marks the page, so a second installed copy (a dev build beside the release, say) stays idle. */
const RUNNING_ATTR = 'data-landingtimer-running';

function boot() {
  const root = document.documentElement;
  if (root.hasAttribute(RUNNING_ATTR)) {
    info('another copy is already running on this page; this one stays idle');
    return;
  }
  root.setAttribute(RUNNING_ATTR, VERSION);

  injectStyles(document);

  const storage = createStorage();
  const audio = createAudio({ win: window });
  createWidget({ doc: document, storage, canPlay: audio.likely }).start();
  createAlarm({ storage, audio }).start();

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
