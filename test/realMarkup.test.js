import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { PROFILE_URL } from '../testlib/dom.js';
import * as selectors from '../src/core/selectors.js';
import { readStatus, parseClasses, parsePlaneLabel, parseStatusText } from '../src/profile/readStatus.js';

/**
 * Real Torn markup the player captured, and what they saw on the page at the
 * time. Every fixture must read back exactly what the player saw.
 */
const CASES = [
  {
    file: 'outbound-commercial.html',
    seen: 'flying Torn to Canada, Commercial (2026-10-02)',
    expect: { state: 'traveling', direction: 'to', destination: 'canada', plane: 'commercial' },
  },
];

function load(file) {
  const html = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
  return new JSDOM(`<!doctype html><body>${html}</body>`, { url: PROFILE_URL }).window.document;
}

for (const { file, seen, expect } of CASES) {
  test(`real markup: ${seen}`, () => {
    const status = readStatus(load(file), PROFILE_URL);
    for (const [field, value] of Object.entries(expect)) assert.equal(status[field], value, field);
  });
}

test('real markup: each source reads what it carries on a Commercial flight', () => {
  const box = selectors.statusBox(load('outbound-commercial.html'));
  assert.ok(box, 'the status box is found');
  assert.deepEqual(parseClasses(selectors.statusClasses(box)),
    { state: 'traveling', direction: 'to', destination: 'canada', plane: null },
    'Commercial puts no plane word in the classes');
  assert.equal(parsePlaneLabel(selectors.planeAriaLabel(box)).plane, 'commercial');
  assert.equal(selectors.statusText(box), 'Torn to Canada');
  assert.equal(parseStatusText(selectors.statusText(box)).destination, 'canada');
});
