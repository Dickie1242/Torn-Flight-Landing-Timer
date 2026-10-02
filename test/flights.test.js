import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESTINATIONS, PLANES, PROFILE_PLANES, VARIANCE,
  minutesFor, destinationName, planeLabel, isDestination, isPlane, varianceMinutes,
} from '../src/core/flights.js';

// Standard, Airstrip, WLT benefit, Business Class: the wiki's columns.
const WIKI = {
  mexico: ['24min', '17min', '12min', '7min'],
  cayman: ['33min', '23min', '17min', '10min'],
  canada: ['39min', '27min', '19min', '12min'],
  hawaii: ['2h 7min', '1h 29min', '1h 3min', '38min'],
  uk: ['2h 31min', '1h 46min', '1h 15min', '45min'],
  argentina: ['2h 38min', '1h 51min', '1h 19min', '47min'],
  switzerland: ['2h 46min', '1h 56min', '1h 23min', '50min'],
  japan: ['3h 33min', '2h 29min', '1h 47min', '1h 4min'],
  china: ['3h 49min', '2h 40min', '1h 54min', '1h 9min'],
  uae: ['4h 17min', '3h 00min', '2h 8min', '1h 17min'],
  southafrica: ['4h 42min', '3h 17min', '2h 21min', '1h 25min'],
};

function toMinutes(text) {
  const match = /^(?:(\d+)h\s*)?(?:(\d+)min)?$/.exec(text);
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

test('every flight time matches the Torn wiki table', () => {
  assert.deepEqual(DESTINATIONS.map((d) => d.key), Object.keys(WIKI));
  assert.deepEqual(PLANES.map((p) => p.key), ['standard', 'airstrip', 'private', 'business']);
  for (const [destination, cells] of Object.entries(WIKI)) {
    PLANES.forEach((plane, index) => {
      assert.equal(minutesFor(destination, plane.key), toMinutes(cells[index]), `${destination} ${plane.key}`);
    });
  }
});

test('unknown keys give null, including names that live on Object.prototype', () => {
  assert.equal(minutesFor('mars', 'standard'), null);
  assert.equal(minutesFor('canada', 'rocket'), null);
  assert.equal(minutesFor(null, null), null);
  assert.equal(minutesFor('constructor', 'standard'), null);
  assert.equal(isDestination('toString'), false);
  assert.equal(isPlane('constructor'), false);
});

test('names and labels read the way the player sees them', () => {
  assert.equal(destinationName('uk'), 'United Kingdom');
  assert.equal(destinationName('southafrica'), 'South Africa');
  assert.equal(destinationName('cayman'), 'Cayman Islands');
  assert.equal(destinationName('mars'), null);
  assert.equal(planeLabel('private'), 'WLT private');
  assert.equal(planeLabel('airstrip'), 'Airstrip');
  assert.equal(planeLabel('rocket'), null);
  assert.ok(isDestination('uae'));
  assert.ok(isPlane('business'));
});

test('Commercial on a profile picks Standard; the others pick themselves', () => {
  assert.equal(PROFILE_PLANES.commercial.pick, 'standard');
  assert.equal(PROFILE_PLANES.airstrip.pick, 'airstrip');
  assert.equal(PROFILE_PLANES.private.pick, 'private');
  assert.equal(PROFILE_PLANES.commercial.label, 'Commercial');
});

test('variance is 3% of the flight, in whole minutes', () => {
  assert.equal(VARIANCE, 0.03);
  assert.equal(varianceMinutes(27), 1);
  assert.equal(varianceMinutes(7), 0);
  assert.equal(varianceMinutes(282), 8);
});
