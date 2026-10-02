import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { statusHtml, settle } from '../testlib/dom.js';
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
  await settle();
  assert.equal(buttons(doc).length, 1);
});

test('a redrawn status box gets the button back, still only one', async () => {
  const doc = page(FLYING);
  mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  doc.getElementById('profile').innerHTML = FLYING;
  await settle();
  assert.equal(buttons(doc).length, 1);
  assert.ok(doc.querySelector('div.profile-status').nextElementSibling.classList.contains(BUTTON_CLASS));
});

test('the button leaves with the status box', async () => {
  const doc = page(FLYING);
  mountProfileButton({ doc, isFlying: () => true, onOpen: () => {} });
  doc.querySelector('div.profile-status').remove();
  await settle();
  assert.equal(buttons(doc).length, 0);
});

test('the accent follows isFlying whenever the page changes', async () => {
  let flying = false;
  const doc = page(FLYING);
  const mount = mountProfileButton({ doc, isFlying: () => flying, onOpen: () => {} });
  assert.equal(mount.element.classList.contains(BUTTON_ACTIVE_CLASS), false);
  flying = true;
  doc.body.append(doc.createElement('div'));
  await settle();
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
  await settle();
  assert.equal(buttons(doc).length, 0);
});
