import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { stubRect, firePointer } from '../testlib/dom.js';
import { attachDrag, clampPosition, DEFAULT_POS } from '../src/widget/drag.js';

function setup(saved = null, rect = { left: 700, top: 120, width: 260, height: 80 }) {
  const dom = new JSDOM(
    '<!doctype html><body><div id="box"><div id="bar"><span id="title">title</span><button id="mute">x</button></div></div></body>',
    { pretendToBeVisual: true },
  );
  const win = dom.window;
  const doc = win.document;
  const element = doc.getElementById('box');
  const handle = doc.getElementById('bar');
  stubRect(element, rect);
  let pos = saved;
  const saves = [];
  const drag = attachDrag({ handle, element, win, getPos: () => pos, setPos: (p) => { pos = p; saves.push(p); } });
  return { win, doc, element, handle, drag, saves };
}

test('clampPosition keeps the whole box on screen', () => {
  const size = { width: 260, height: 80 };
  const view = { width: 1024, height: 768 };
  assert.deepEqual(clampPosition({ x: 100, y: 200 }, size, view), { x: 100, y: 200 });
  assert.deepEqual(clampPosition({ x: -50, y: -9 }, size, view), { x: 0, y: 0 });
  assert.deepEqual(clampPosition({ x: 2000, y: 2000 }, size, view), { x: 764, y: 688 });
  assert.deepEqual(clampPosition({ x: 10, y: 10 }, { width: 2000, height: 2000 }, view), { x: 0, y: 0 });
});

test('with nothing saved the box sits in its default corner', () => {
  const { element } = setup();
  assert.equal(element.style.right, `${DEFAULT_POS.right}px`);
  assert.equal(element.style.top, `${DEFAULT_POS.top}px`);
  assert.equal(element.style.left, '');
});

test('a saved position is used, pulled back on screen if needed', () => {
  assert.equal(setup({ x: 40, y: 50 }).element.style.left, '40px');
  const far = setup({ x: 2000, y: 50 });
  assert.equal(far.element.style.left, '764px');
  assert.equal(far.element.style.right, 'auto');
  assert.equal(far.element.style.top, '50px');
});

test('dragging the title bar moves the box and saves where it is let go', () => {
  const { doc, element, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  assert.equal(element.style.left, '100px');
  assert.equal(element.style.top, '200px');
  assert.deepEqual(saves, [], 'nothing is saved mid-drag');
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210 });
  assert.deepEqual(saves, [{ x: 100, y: 200 }]);
});

test('a press without a move saves nothing', () => {
  const { doc, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointerup', { clientX: 710, clientY: 130 });
  assert.deepEqual(saves, []);
});

test('presses on a button in the bar, or with another mouse button, do not drag', () => {
  const { doc, element, saves } = setup();
  firePointer(doc.getElementById('mute'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130, button: 2 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210 });
  assert.equal(element.style.left, '');
  assert.deepEqual(saves, []);
});

test('a smaller window pulls the box back without saving', () => {
  const { win, element, saves } = setup({ x: 760, y: 100 });
  Object.defineProperty(win, 'innerWidth', { value: 800, configurable: true });
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(element.style.left, '540px');
  assert.deepEqual(saves, []);
});

test('destroy stops dragging', () => {
  const { doc, element, drag, saves } = setup();
  drag.destroy();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210 });
  assert.equal(element.style.left, '');
  assert.deepEqual(saves, []);
});

test('apply() during a drag leaves the box where the pointer has it', () => {
  const { doc, element, drag } = setup({ x: 300, y: 300 });
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  drag.apply();
  assert.equal(element.style.left, '100px');
  assert.equal(element.style.top, '200px');
});

test('a wobble under the threshold is still a click', () => {
  const { doc, element, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointermove', { clientX: 711, clientY: 131 });
  firePointer(doc.body, 'pointerup', { clientX: 711, clientY: 131 });
  assert.deepEqual(saves, []);
  assert.equal(element.style.left, '');
});

test('a drag whose release was missed ends at the next move with no button held', () => {
  const { doc, element, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  firePointer(doc.body, 'pointermove', { clientX: 500, clientY: 400, buttons: 0 });
  assert.equal(element.style.left, '100px', 'the box stays where it was let go');
  assert.deepEqual(saves, [{ x: 100, y: 200 }]);
  firePointer(doc.body, 'pointermove', { clientX: 600, clientY: 500 });
  assert.equal(element.style.left, '100px', 'and no longer follows the pointer');
});

test('losing the window, the pointer capture or the pointer ends the drag', () => {
  for (const ending of ['blur', 'lostpointercapture', 'pointercancel']) {
    const { win, doc, handle, element, saves } = setup();
    firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
    firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
    if (ending === 'blur') win.dispatchEvent(new win.Event('blur'));
    else if (ending === 'lostpointercapture') firePointer(handle, 'lostpointercapture', { pointerId: 1 });
    else firePointer(doc.body, 'pointercancel', { clientX: 110, clientY: 210 });
    firePointer(doc.body, 'pointermove', { clientX: 500, clientY: 400 });
    assert.deepEqual(saves, [{ x: 100, y: 200 }], ending);
    assert.equal(element.style.left, '100px', ending);
  }
});

test('only the pointer that started the drag moves the box', () => {
  const { doc, element, saves } = setup();
  const title = doc.getElementById('title');
  firePointer(title, 'pointerdown', { clientX: 710, clientY: 130, pointerId: 1 });
  firePointer(title, 'pointerdown', { clientX: 900, clientY: 130, pointerId: 2, pointerType: 'touch' });
  firePointer(doc.body, 'pointermove', { clientX: 300, clientY: 300, pointerId: 2, pointerType: 'touch' });
  assert.equal(element.style.left, '', 'a second finger moves nothing');
  firePointer(doc.body, 'pointerup', { pointerId: 2, pointerType: 'touch' });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210, pointerId: 1 });
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210, pointerId: 1 });
  assert.deepEqual(saves, [{ x: 100, y: 200 }]);
});

test('a press on a link in the bar is left to the link', () => {
  const { doc, saves } = setup();
  const link = doc.createElement('a');
  link.textContent = 'profile';
  doc.getElementById('bar').append(link);
  firePointer(link, 'pointerdown', { clientX: 710, clientY: 130 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210 });
  assert.deepEqual(saves, []);
});

test('the default corner keeps a tall box on screen', () => {
  assert.equal(setup(null, { left: 700, top: 0, width: 260, height: 700 }).element.style.top, '68px');
  assert.equal(setup(null, { left: 700, top: 0, width: 260, height: 900 }).element.style.top, '0px');
});

test('destroy in the middle of a drag leaves nothing behind', () => {
  const { doc, element, drag, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130 });
  drag.destroy();
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210 });
  firePointer(doc.body, 'pointerup', { clientX: 110, clientY: 210 });
  assert.equal(element.style.left, '');
  assert.deepEqual(saves, []);
});

test('a second finger lifting off a button in the bar does not end the drag', () => {
  const { doc, element, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130, pointerId: 1 });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210, pointerId: 1 });
  firePointer(doc.getElementById('mute'), 'lostpointercapture', { pointerId: 2, pointerType: 'touch' });
  firePointer(doc.body, 'pointermove', { clientX: 210, clientY: 210, pointerId: 1 });
  assert.equal(element.style.left, '200px', 'still following the first pointer');
  assert.deepEqual(saves, []);
});

test('a pen lifted where we could not hear it ends the drag like a mouse', () => {
  const { doc, element, saves } = setup();
  firePointer(doc.getElementById('title'), 'pointerdown', { clientX: 710, clientY: 130, pointerType: 'pen' });
  firePointer(doc.body, 'pointermove', { clientX: 110, clientY: 210, pointerType: 'pen' });
  firePointer(doc.body, 'pointermove', { clientX: 500, clientY: 400, pointerType: 'pen', buttons: 0 });
  assert.equal(element.style.left, '100px');
  assert.deepEqual(saves, [{ x: 100, y: 200 }]);
});
