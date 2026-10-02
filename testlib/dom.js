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

/**
 * Waits until work a DOM change scheduled onto the next animation frame has
 * run: MutationObserver callbacks run in a microtask, and jsdom runs frame
 * callbacks in the order they were requested. Needs `pretendToBeVisual`.
 */
export async function nextFrame(doc) {
  await Promise.resolve();
  await new Promise((resolve) => doc.defaultView.requestAnimationFrame(() => resolve()));
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
 * name reaches pointerdown/pointermove/pointerup listeners just fine. The
 * pointer fields are added by hand. `buttons` defaults to the left button held,
 * except on pointerup and pointercancel.
 */
export function firePointer(target, type, {
  clientX = 0, clientY = 0, button = 0, buttons, pointerId = 1, pointerType = 'mouse', isPrimary = true,
} = {}) {
  const doc = target.ownerDocument || target;
  const held = buttons ?? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1);
  const event = new doc.defaultView.MouseEvent(type, {
    bubbles: true, cancelable: true, clientX, clientY, button, buttons: held,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'isPrimary', { value: isPrimary });
  target.dispatchEvent(event);
  return event;
}
