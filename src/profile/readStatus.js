import * as selectors from '../core/selectors.js';

/**
 * @typedef {{
 *   id: string|null, name: string|null,
 *   state: 'traveling'|'hidden'|'abroad'|'other',
 *   direction: 'to'|'from'|null,
 *   destination: string|null,
 *   plane: 'commercial'|'airstrip'|'private'|null,
 * }} ProfileStatus
 */

/** The class-name word Torn's stylesheet keys each country on. */
const COUNTRY_CLASS = new Map([
  ['mexico', 'mexico'], ['cayman', 'cayman'], ['canada', 'canada'], ['hawaii', 'hawaii'],
  ['kingdom', 'uk'], ['argentina', 'argentina'], ['switzerland', 'switzerland'],
  ['japan', 'japan'], ['china', 'china'], ['uae', 'uae'], ['africa', 'southafrica'],
  ['emirates', 'uae'],
]);

/** Country names as Torn writes them in status text, lower-cased. */
const COUNTRY_NAME = new Map([
  ['mexico', 'mexico'], ['cayman islands', 'cayman'], ['canada', 'canada'], ['hawaii', 'hawaii'],
  ['united kingdom', 'uk'], ['uk', 'uk'], ['argentina', 'argentina'], ['switzerland', 'switzerland'],
  ['japan', 'japan'], ['china', 'china'], ['uae', 'uae'], ['united arab emirates', 'uae'],
  ['south africa', 'southafrica'], ['cayman', 'cayman'],
]);

/** Plane words in the status classes. Commercial has none (seen live 2026-10-02). */
const PLANE_CLASS = new Set(['commercial', 'airstrip', 'private']);

/** "Type of plane: <word>" → the profile's plane. Torn calls the airstrip plane "Personal". */
const PLANE_WORD = new Map([
  ['commercial', 'commercial'], ['personal', 'airstrip'], ['airstrip', 'airstrip'], ['private', 'private'],
]);

/** @returns {string|null} a destination key for a country name as Torn writes it. */
export function countryFromName(text) {
  if (typeof text !== 'string') return null;
  const key = text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').replace(/^the /, '');
  return COUNTRY_NAME.get(key) || null;
}

/**
 * Reads the status box's classes. Claims nothing unless they name a country:
 * Torn fills a class template and leaves empty slots blank, so a bare
 * "travelling to" may be a disguised flight.
 */
export function parseClasses(classes) {
  if (!Array.isArray(classes)) return {};
  if (!classes.includes('travelling') && !classes.includes('traveling')) return {};
  const country = classes.find((name) => COUNTRY_CLASS.has(name));
  if (!country) return {};
  const hasTo = classes.includes('to');
  const hasFrom = classes.includes('from');
  return {
    state: 'traveling',
    // Both words, or neither, and the classes cannot say which way.
    direction: hasTo === hasFrom ? null : (hasTo ? 'to' : 'from'),
    destination: COUNTRY_CLASS.get(country),
    plane: classes.find((name) => PLANE_CLASS.has(name)) || null,
  };
}

function travel(direction, place) {
  return { state: 'traveling', direction, destination: countryFromName(place) };
}

/** Status wordings, newest first. The old ones survive in Torn's hospital and jail variants. */
const TEXT_RULES = [
  [/^traveling$/i, () => ({ state: 'hidden' })],
  [/^(?:traveling from )?torn to (.+)$/i, (m) => travel('to', m[1])],
  [/^(?:traveling from )?(.+) to torn$/i, (m) => travel('from', m[1])],
  [/^traveling to (.+)$/i, (m) => travel('to', m[1])],
  [/^returning to torn from (.+)$/i, (m) => travel('from', m[1])],
  [/^(?:hiding out )?in (.+)$/i, (m) => {
    const destination = countryFromName(m[1]);
    return destination ? { state: 'abroad', destination } : {};
  }],
];

/** Reads a status sentence: "Torn to Mexico", "In Mexico", "Traveling", … */
export function parseStatusText(text) {
  if (typeof text !== 'string') return {};
  const clean = text.replace(/\s+/g, ' ').trim();
  for (const [pattern, make] of TEXT_RULES) {
    const match = pattern.exec(clean);
    if (match) return make(match);
  }
  return {};
}

/** Reads "Traveling from <route>. Type of plane: <word>". */
export function parsePlaneLabel(label) {
  if (typeof label !== 'string') return {};
  const match = /^(.*?)\.?\s*Type of plane:\s*(\w+)/i.exec(label);
  if (!match) return {};
  return { ...parseStatusText(match[1]), plane: PLANE_WORD.get(match[2].toLowerCase()) || null };
}

/**
 * Where the player is going, as one piece. Sources that disagree about the
 * country or the direction leave both blank: a wrong pre-fill is worse than a
 * blank the player fills in.
 */
function pickRoute(sources) {
  const destinations = new Set(sources.map((s) => s.destination).filter(Boolean));
  const directions = new Set(sources.map((s) => s.direction).filter(Boolean));
  if (destinations.size > 1 || directions.size > 1) return { direction: null, destination: null };
  return {
    direction: directions.size ? [...directions][0] : null,
    destination: destinations.size ? [...destinations][0] : null,
  };
}

/**
 * Everything the open profile says about where its player is going. The
 * state and the plane come from the most trusted source that has one; the
 * route comes from `pickRoute`. A field nothing could read is null. Never
 * throws on a strange page.
 * @returns {ProfileStatus}
 */
export function readStatus(doc, href) {
  const box = selectors.statusBox(doc);
  const sources = [
    parseClasses(selectors.statusClasses(box)),
    parsePlaneLabel(selectors.planeAriaLabel(box)),
    parseStatusText(selectors.statusText(box)),
  ];
  const pick = (field) => {
    for (const source of sources) if (source[field] != null) return source[field];
    return null;
  };
  const identity = selectors.profileIdentity(doc);
  const state = pick('state') || 'other';
  const travelling = state === 'traveling';
  const route = pickRoute(sources);
  return {
    id: selectors.profileIdFromUrl(href) || identity.id,
    name: identity.name,
    state,
    direction: travelling ? route.direction : null,
    destination: (travelling || state === 'abroad') ? route.destination : null,
    plane: travelling ? pick('plane') : null,
  };
}
