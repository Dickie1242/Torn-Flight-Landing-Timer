/** Where the timer box sits until the player drags it: px from the right and top. */
export const DEFAULT_POS = Object.freeze({ right: 16, top: 120 });

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
 * setPos(pos) saves a new one when a drag ends. Presses on buttons and links in
 * the handle are left to them. apply() re-places the box from getPos().
 */
export function attachDrag({ handle, element, win, getPos, setPos }) {
  let drag = null;

  const view = () => ({ width: win.innerWidth, height: win.innerHeight });

  function size() {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function place(pos) {
    if (!pos) {
      element.style.left = '';
      element.style.right = `${DEFAULT_POS.right}px`;
      element.style.top = `${DEFAULT_POS.top}px`;
      return;
    }
    const { x, y } = clampPosition(pos, size(), view());
    element.style.right = 'auto';
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  function apply() {
    if (!drag) place(getPos());
  }

  function onMove(event) {
    if (!drag) return;
    drag.moved = true;
    drag.pos = clampPosition({ x: event.clientX - drag.dx, y: event.clientY - drag.dy }, size(), view());
    place(drag.pos);
  }

  function stopListening() {
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
    win.removeEventListener('pointercancel', onUp);
  }

  function onUp() {
    if (!drag) return;
    const { moved, pos } = drag;
    drag = null;
    stopListening();
    if (moved) {
      setPos(pos);
      place(pos);
    }
  }

  function onDown(event) {
    if (event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest('button, a')) return;
    const rect = element.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, pos: null, moved: false };
    event.preventDefault();
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    win.addEventListener('pointercancel', onUp);
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
