import test from 'node:test';
import assert from 'node:assert/strict';
import { statusHtml, profileDoc, PROFILE_URL } from '../testlib/dom.js';
import {
  readStatus, parseClasses, parsePlaneLabel, parseStatusText, countryFromName,
} from '../src/profile/readStatus.js';
import { isProfilePage } from '../src/core/selectors.js';

function read(status, docOptions = {}) {
  const dom = profileDoc({ status: statusHtml(status), ...docOptions });
  return readStatus(dom.window.document, docOptions.url || PROFILE_URL);
}

const PLAYER = { id: '1234567', name: 'SomeName' };

test('an outbound airstrip flight is read from the status box', () => {
  assert.deepEqual(read({
    classes: 'profile-status m-top10 travelling to canada airstrip',
    label: 'Traveling from Torn to Canada. Type of plane: Personal',
    text: 'Torn to Canada',
  }), { ...PLAYER, state: 'traveling', direction: 'to', destination: 'canada', plane: 'airstrip' });
});

test('a commercial flight home from the UK', () => {
  assert.deepEqual(read({
    classes: 'profile-status m-top10 travelling from united kingdom  ',
    label: 'Traveling from United Kingdom to Torn  . Type of plane: Commercial',
    text: 'United Kingdom to Torn',
  }), { ...PLAYER, state: 'traveling', direction: 'from', destination: 'uk', plane: 'commercial' });
});

test('the classes alone are enough', () => {
  assert.deepEqual(read({ classes: 'profile-status m-top10 travelling to south africa private' }),
    { ...PLAYER, state: 'traveling', direction: 'to', destination: 'southafrica', plane: 'private' });
});

test('every country is recognised from its class words', () => {
  const cases = {
    mexico: 'mexico', 'cayman islands': 'cayman', canada: 'canada', hawaii: 'hawaii',
    'united kingdom': 'uk', argentina: 'argentina', switzerland: 'switzerland', japan: 'japan',
    china: 'china', uae: 'uae', 'south africa': 'southafrica', 'united arab emirates': 'uae',
  };
  for (const [words, key] of Object.entries(cases)) {
    assert.equal(parseClasses(['travelling', 'to', ...words.split(' ')]).destination, key, words);
  }
});

test('classes with no route claim nothing', () => {
  assert.deepEqual(parseClasses(['profile-status', 'm-top10']), {});
  assert.deepEqual(parseClasses(['profile-status', 'travelling']), {});
  assert.deepEqual(parseClasses(['travelling', 'to', 'constructor']), {});
  assert.deepEqual(parseClasses(['travelling', 'to']), {}, 'a bare direction is no route');
  assert.deepEqual(parseClasses(null), {});
});

test('the plane label alone gives direction, destination and plane', () => {
  assert.deepEqual(parsePlaneLabel('Traveling from Japan to Torn. Type of plane: Private'),
    { state: 'traveling', direction: 'from', destination: 'japan', plane: 'private' });
  assert.equal(parsePlaneLabel('Traveling from Torn to Mexico. Type of plane: Personal').plane, 'airstrip');
  assert.equal(parsePlaneLabel('Traveling from Torn to Canada  . Type of plane: Commercial').destination, 'canada');
  assert.deepEqual(parsePlaneLabel('Okay'), {});
  assert.deepEqual(parsePlaneLabel(null), {});
});

test('every status wording is read from the text', () => {
  const travel = (direction, destination) => ({ state: 'traveling', direction, destination });
  const cases = [
    ['Torn to Mexico', travel('to', 'mexico')],
    ['Mexico to Torn', travel('from', 'mexico')],
    ['Traveling from Torn to UAE', travel('to', 'uae')],
    ['Traveling from UAE to Torn', travel('from', 'uae')],
    ['Traveling to Japan', travel('to', 'japan')],
    ['Returning to Torn from United Arab Emirates', travel('from', 'uae')],
    ['  Torn   to\n Cayman Islands ', travel('to', 'cayman')],
    ['In Hawaii', { state: 'abroad', destination: 'hawaii' }],
    ['Hiding out in South Africa', { state: 'abroad', destination: 'southafrica' }],
    ['Traveling', { state: 'hidden' }],
    ['Okay', {}],
    ['In a Swiss hospital for 2 hrs', {}],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseStatusText(text), expected, text);
  assert.deepEqual(parseStatusText(null), {});
});

test('country names match however Torn writes them', () => {
  assert.equal(countryFromName('UAE'), 'uae');
  assert.equal(countryFromName('United Arab Emirates'), 'uae');
  assert.equal(countryFromName('the UK'), 'uk');
  assert.equal(countryFromName('South Africa.'), 'southafrica');
  assert.equal(countryFromName('Mars'), null);
  assert.equal(countryFromName('constructor'), null);
});

test('disguised travel gives no destination or plane', () => {
  assert.deepEqual(read({ text: 'Traveling' }),
    { ...PLAYER, state: 'hidden', direction: null, destination: null, plane: null });
});

test('abroad keeps the country but no direction or plane', () => {
  assert.deepEqual(read({ text: 'In Mexico' }),
    { ...PLAYER, state: 'abroad', direction: null, destination: 'mexico', plane: null });
});

test('a player at home, or a page with no status box, reads as other', () => {
  const nobody = { ...PLAYER, state: 'other', direction: null, destination: null, plane: null };
  assert.deepEqual(read({ text: 'Okay' }), nobody);
  const dom = profileDoc({ status: '' });
  assert.deepEqual(readStatus(dom.window.document, PROFILE_URL), nobody);
});

test('the id comes from the address first, then the title', () => {
  const dom = profileDoc({ title: 'OtherName [7654321] | TORN' });
  const doc = dom.window.document;
  assert.equal(readStatus(doc, 'https://www.torn.com/profiles.php?XID=1234567').id, '1234567');
  assert.equal(readStatus(doc, 'https://www.torn.com/profiles.php?NID=OtherName').id, '7654321');
  assert.equal(readStatus(doc, 'not a url').id, '7654321');
});

test('the name comes from the heading first, then the title', () => {
  assert.equal(read({}, { heading: "SomeName's Profile" }).name, 'SomeName');
  assert.equal(read({}, { heading: 'Profile', title: 'OtherName [7654321] | TORN' }).name, 'OtherName');
  assert.equal(read({}, { heading: 'Profile', title: 'TORN' }).name, null);
});

test('classes naming both directions leave the direction to the other sources', () => {
  assert.equal(parseClasses(['travelling', 'from', 'mexico', 'to', 'torn']).direction, null);
  assert.deepEqual(read({
    classes: 'profile-status m-top10 travelling from mexico to torn',
    label: 'Traveling from Mexico to Torn. Type of plane: Private',
  }), { ...PLAYER, state: 'traveling', direction: 'from', destination: 'mexico', plane: 'private' });
});

test('a bare "travelling to" in the classes does not hide a disguised flight', () => {
  assert.deepEqual(read({ classes: 'profile-status m-top10 travelling to  ', text: 'Traveling' }),
    { ...PLAYER, state: 'hidden', direction: null, destination: null, plane: null });
});

test('sources that disagree about the route leave it blank rather than guess', () => {
  assert.deepEqual(read({ classes: 'profile-status m-top10 travelling to canada airstrip', text: 'Japan to Torn' }),
    { ...PLAYER, state: 'traveling', direction: null, destination: null, plane: 'airstrip' });
});

test('the American class spelling, short country names and the plane label in any case are understood', () => {
  assert.equal(parseClasses(['traveling', 'to', 'japan']).destination, 'japan');
  assert.deepEqual(parseStatusText('Torn to Cayman'), { state: 'traveling', direction: 'to', destination: 'cayman' });
  assert.equal(read({ label: 'Traveling from Torn to Japan. TYPE OF PLANE: Private' }).plane, 'private');
});

test('a name ending in s has a bare apostrophe in the heading', () => {
  assert.equal(read({}, { heading: "James' Profile" }).name, 'James');
});

test('isProfilePage is true only on profiles.php', () => {
  assert.equal(isProfilePage({ pathname: '/profiles.php' }), true);
  assert.equal(isProfilePage({ pathname: '/index.php' }), false);
  assert.equal(isProfilePage(null), false);
});

test('sources that disagree only about the direction keep the agreed country', () => {
  assert.deepEqual(read({
    classes: 'profile-status m-top10 travelling from mexico',
    label: 'Traveling from Torn to Mexico. Type of plane: Commercial',
  }), { ...PLAYER, state: 'traveling', direction: null, destination: 'mexico', plane: 'commercial' });
});

test('sources that disagree about the plane leave it blank', () => {
  assert.deepEqual(read({
    classes: 'profile-status m-top10 travelling to canada airstrip',
    label: 'Traveling from Torn to Canada. Type of plane: Private',
  }), { ...PLAYER, state: 'traveling', direction: 'to', destination: 'canada', plane: null });
  assert.equal(read({ classes: 'profile-status m-top10 travelling to canada airstrip private' }).plane, 'airstrip',
    'two plane words in the classes: the classes take the first, there is no second source to disagree');
});
