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
