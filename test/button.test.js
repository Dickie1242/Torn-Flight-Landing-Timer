import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { statusHtml, nextFrame } from '../testlib/dom.js';
import {
  mountProfileButton, BUTTON_CLASS, BUTTON_ACTIVE_CLASS, BUTTON_LABEL,
} from '../src/profile/button.js';

const FLYING = statusHtml({ classes: 'profile-status m-top10 travelling to canada  ', text: 'Torn to Canada' });

function page(body) {
  return new JSDOM(`<!doctype html><body><div id="profile">${body}</div></body>`, { pretendToBeVisual: true }).window.document;
}

const buttons = (doc) => doc.querySelectorAll(`.${BUTTON_CLASS}`);

test('one button goes straight after the status box', () => {
  const doc = page(FLYING);
  const mount = mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  assert.equal(buttons(doc).length, 1);
  assert.equal(doc.querySelector('div.profile-status').nextElementSibling, mount.element);
  assert.equal(mount.element.textContent, BUTTON_LABEL);
  assert.equal(mount.element.type, 'button');
  mount.destroy();
});

test('the button waits for a status box that arrives later', async () => {
  const doc = page('');
  mountProfileButton({ doc, isFlying: () => false, onOpen: () => {} });
  assert.equal(buttons(doc).length, 0);
  doc.getElementById('profile').insertAdjacentHTML('beforeend', FLYING);
  await nextFrame(doc);
  assert.equal(buttons(doc).length, 1);
});

test('a redrawn status box gets the button back, still only one', async () => {
  const doc = page(FLYING);
  mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  doc.getElementById('profile').innerHTML = FLYING;
  await nextFrame(doc);
  assert.equal(buttons(doc).length, 1);
  assert.ok(doc.querySelector('div.profile-status').nextElementSibling.classList.contains(BUTTON_CLASS));
});

test('the button leaves with the status box', async () => {
  const doc = page(FLYING);
  mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  doc.querySelector('div.profile-status').remove();
  await nextFrame(doc);
  assert.equal(buttons(doc).length, 0);
});

test('the accent follows isFlying whenever the page changes', async () => {
  let flying = false;
  const doc = page(FLYING);
  const mount = mountProfileButton({ doc, isFlying: () => flying, onOpen: () => {} });
  assert.equal(mount.element.classList.contains(BUTTON_ACTIVE_CLASS), false);
  flying = true;
  doc.body.append(doc.createElement('div'));
  await nextFrame(doc);
  assert.equal(mount.element.classList.contains(BUTTON_ACTIVE_CLASS), true);
});

test('a click opens the panel with the button as its anchor', () => {
  const doc = page(FLYING);
  let opened = null;
  const mount = mountProfileButton({ doc, isFlying: () => true, onOpen: (anchor) => { opened = anchor; } });
  mount.element.click();
  assert.equal(opened, mount.element);
});

test('destroy removes the button and stops watching', async () => {
  const doc = page(FLYING);
  const mount = mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  mount.destroy();
  doc.getElementById('profile').innerHTML = FLYING;
  await nextFrame(doc);
  assert.equal(buttons(doc).length, 0);
});

test('two copies on one page settle instead of swapping places forever', async () => {
  const doc = page(FLYING);
  let checks = 0;
  const isFlying = () => { checks += 1; return true; };
  const one = mountProfileButton({ doc, isFlying, onOpen: () => {} });
  const two = mountProfileButton({ doc, isFlying, onOpen: () => {} });
  for (let i = 0; i < 5; i += 1) await nextFrame(doc);
  assert.ok(checks < 20, `settled after ${checks} checks`);
  const box = doc.querySelector('div.profile-status');
  for (const mount of [one, two]) {
    assert.equal(mount.element.parentNode, box.parentNode);
    assert.ok(box.compareDocumentPosition(mount.element) & 4, 'after the box');
  }
});

test('a burst of page changes is checked once per frame, not once per change', async () => {
  const doc = page(FLYING);
  let checks = 0;
  mountProfileButton({ doc, isFlying: () => { checks += 1; return true; }, onOpen: () => {} });
  checks = 0;
  for (let i = 0; i < 50; i += 1) {
    doc.body.append(doc.createElement('div'));
    await Promise.resolve();
  }
  await nextFrame(doc);
  assert.equal(checks, 1);
});

test('a focused button keeps the keyboard when it has to move', async () => {
  const doc = page(FLYING);
  const mount = mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  mount.element.focus();
  const box = doc.querySelector('div.profile-status');
  const fresh = box.cloneNode(true);
  mount.element.after(fresh);
  box.remove();
  await nextFrame(doc);
  assert.equal(fresh.nextElementSibling, mount.element);
  assert.equal(doc.activeElement, mount.element);
});
