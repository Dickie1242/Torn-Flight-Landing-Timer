/**
 * Torn flight times: one way from Torn, in whole minutes, without the
 * "Mailing Yourself Abroad" book. These are the times after the 23 June 2026
 * travel patch, checked on 2026-10-02 against the Torn wiki's table. A return
 * flight takes the same time by the same method.
 */

export const DESTINATIONS = Object.freeze([
  Object.freeze({ key: 'mexico', name: 'Mexico' }),
  Object.freeze({ key: 'cayman', name: 'Cayman Islands' }),
  Object.freeze({ key: 'canada', name: 'Canada' }),
  Object.freeze({ key: 'hawaii', name: 'Hawaii' }),
  Object.freeze({ key: 'uk', name: 'United Kingdom' }),
  Object.freeze({ key: 'argentina', name: 'Argentina' }),
  Object.freeze({ key: 'switzerland', name: 'Switzerland' }),
  Object.freeze({ key: 'japan', name: 'Japan' }),
  Object.freeze({ key: 'china', name: 'China' }),
  Object.freeze({ key: 'uae', name: 'UAE' }),
  Object.freeze({ key: 'southafrica', name: 'South Africa' }),
]);

export const PLANES = Object.freeze([
  Object.freeze({ key: 'standard', label: 'Standard' }),
  Object.freeze({ key: 'airstrip', label: 'Airstrip' }),
  Object.freeze({ key: 'private', label: 'WLT private' }),
  Object.freeze({ key: 'business', label: 'Business' }),
]);

/** Minutes per destination, in PLANES order: standard, airstrip, private, business. */
const MINUTES = new Map([
  ['mexico', [24, 17, 12, 7]],
  ['cayman', [33, 23, 17, 10]],
  ['canada', [39, 27, 19, 12]],
  ['hawaii', [127, 89, 63, 38]],
  ['uk', [151, 106, 75, 45]],
  ['argentina', [158, 111, 79, 47]],
  ['switzerland', [166, 116, 83, 50]],
  ['japan', [213, 149, 107, 64]],
  ['china', [229, 160, 114, 69]],
  ['uae', [257, 180, 128, 77]],
  ['southafrica', [282, 197, 141, 85]],
]);

/** Flights vary by up to 3% (Torn wiki, since Patch #26). */
export const VARIANCE = 0.03;

/**
 * What a profile can say about the plane, and the plane the panel picks for
 * it. Business class looks exactly like Commercial on a profile, so Commercial
 * picks Standard.
 */
export const PROFILE_PLANES = Object.freeze({
  commercial: Object.freeze({ label: 'Commercial', pick: 'standard' }),
  airstrip: Object.freeze({ label: 'Airstrip', pick: 'airstrip' }),
  private: Object.freeze({ label: 'WLT private', pick: 'private' }),
});

export function isDestination(key) {
  return DESTINATIONS.some((d) => d.key === key);
}

export function isPlane(key) {
  return PLANES.some((p) => p.key === key);
}

/** @returns {number|null} one-way minutes, or null for an unknown destination or plane. */
export function minutesFor(destination, plane) {
  const row = MINUTES.get(destination);
  const index = PLANES.findIndex((p) => p.key === plane);
  return row && index >= 0 ? row[index] : null;
}

/** @returns {string|null} */
export function destinationName(key) {
  const destination = DESTINATIONS.find((d) => d.key === key);
  return destination ? destination.name : null;
}

/** @returns {string|null} */
export function planeLabel(key) {
  const plane = PLANES.find((p) => p.key === key);
  return plane ? plane.label : null;
}

/** How many whole minutes a flight of `minutes` can be off by. */
export function varianceMinutes(minutes) {
  return Math.round(minutes * VARIANCE);
}
