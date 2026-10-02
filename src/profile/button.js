import { el } from '../core/dom.js';
import { safe } from '../core/log.js';
import * as selectors from '../core/selectors.js';

export const BUTTON_CLASS = 'landingtimer-button';
export const BUTTON_ACTIVE_CLASS = 'landingtimer-button--active';
export const BUTTON_LABEL = '⏱ Landing timer';

/** Node.DOCUMENT_POSITION_FOLLOWING, without needing a Node global. */
const FOLLOWING = 4;

/**
 * Keeps one Landing timer button after the profile's status box, in the same
 * parent. Torn's page is React-rendered and redraws that box, so a
 * MutationObserver puts the button back whenever it goes missing, at most once
 * per animation frame: Torn's chat changes the page constantly.
 *
 * "After the box" means any later sibling, not the very next node. If another
 * copy of this script, or another script, wants the very next spot too, the
 * two settle instead of swapping places forever.
 *
 * `isFlying()` decides the accent. It is re-checked when the page's nodes
 * change, not when Torn edits the box's classes in place; the panel re-reads
 * the profile when it opens, so a stale accent is only cosmetic.
 * `onOpen(button)` runs on click.
 */
export function mountProfileButton({ doc = globalThis.document, isFlying, onOpen }) {
  const win = doc.defaultView;
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

  function placed(box) {
    return button.parentNode === box.parentNode
      && (box.compareDocumentPosition(button) & FOLLOWING) !== 0;
  }

  function ensure() {
    const box = selectors.statusBox(doc);
    if (!box) {
      button.remove();
      return;
    }
    if (!placed(box)) {
      // Moving a focused node drops its focus; give it back.
      const focused = doc.activeElement === button;
      box.after(button);
      if (focused) button.focus({ preventScroll: true });
    }
    button.classList.toggle(BUTTON_ACTIVE_CLASS, !!isFlying());
  }

  let frame = 0;
  const run = safe('button.ensure', () => {
    frame = 0;
    ensure();
  });
  const observer = new win.MutationObserver(() => {
    if (!frame) frame = win.requestAnimationFrame(run);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  run();

  return {
    element: button,
    destroy() {
      observer.disconnect();
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0;
      button.remove();
    },
  };
}
