/** Where the timer box sits until the player drags it: px from the right and top. */
export const DEFAULT_POS = Object.freeze({ right: 16, top: 120 });

/** A press that moves less than this, in px, is a click, not a drag. */
export const MOVE_THRESHOLD_PX = 3;

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
 * setPos(pos) saves a new one when a drag that really moved ends. apply()
 * re-places the box from getPos(); it measures the box, so call it after the
 * box is shown (a hidden box measures 0 × 0).
 *
 * - Only the pointer that started a drag moves the box, and the pointer is
 *   captured, so a drag ends properly however it ends: released outside the
 *   window or over an iframe, the window losing focus, the capture lost.
 * - Presses on buttons and links in the handle are left to them.
 * - The caller's stylesheet gives the handle `touch-action: none` and the box
 *   `user-select: none`; preventDefault alone does not stop text selection in
 *   every browser.
 */
export function attachDrag({ handle, element, win, getPos, setPos }) {
  let drag = null;

  function view() {
    const html = element.ownerDocument.documentElement;
    // clientWidth leaves out the page's scrollbar; innerWidth does not.
    return {
      width: (html && html.clientWidth) || win.innerWidth,
      height: (html && html.clientHeight) || win.innerHeight,
    };
  }

  function measure() {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function place(pos, size = measure()) {
    const bounds = view();
    if (!pos) {
      element.style.left = '';
      element.style.right = `${DEFAULT_POS.right}px`;
      // A tall box moves up to keep its bottom on screen, but never past the top.
      element.style.top = `${Math.max(0, Math.min(DEFAULT_POS.top, bounds.height - size.height))}px`;
      return;
    }
    const { x, y } = clampPosition(pos, size, bounds);
    element.style.right = 'auto';
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  function apply() {
    if (!drag) place(getPos());
  }

  function stopListening() {
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
    win.removeEventListener('pointercancel', onUp);
    win.removeEventListener('blur', end);
    handle.removeEventListener('lostpointercapture', onLostCapture);
  }

  /** Ends the drag, saving where the box went if it really moved. */
  function end() {
    if (!drag) return;
    const { id, moved, pos } = drag;
    drag = null;
    stopListening();
    try {
      if (handle.hasPointerCapture && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    } catch {
      // The capture is already gone.
    }
    if (moved) {
      setPos(pos);
      place(pos);
    } else {
      // apply() was ignored while the button was down: catch up now.
      place(getPos());
    }
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    // A mouse or pen released where we could not hear it: the drag is over.
    // (Touch is left out: a touch pointer only exists while it touches.)
    if ((event.pointerType === 'mouse' || event.pointerType === 'pen') && !(event.buttons & 1)) {
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

  // lostpointercapture bubbles: only the handle losing this drag's own pointer
  // ends it, not a second finger lifting off a button in the bar.
  function onLostCapture(event) {
    if (drag && event.pointerId === drag.id && event.target === handle) end();
  }

  function onDown(event) {
    if (drag || event.button !== 0 || event.isPrimary === false) return;
    if (event.target && event.target.closest && event.target.closest('button, a')) return;
    const rect = element.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      size: { width: rect.width, height: rect.height },
      pos: null,
      moved: false,
    };
    event.preventDefault();
    try {
      if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable (a synthetic event, say): the window listeners still carry the drag.
    }
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    win.addEventListener('pointercancel', onUp);
    win.addEventListener('blur', end);
    handle.addEventListener('lostpointercapture', onLostCapture);
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
