/**
 * The ONLY module that knows the shape of Torn's profile page.
 * If Torn changes its markup, this is the one file to edit.
 *
 * Hashed CSS-module class names (e.g. interactionLog___lLO31) must never
 * appear here: they change between Torn builds. Neither may anything another
 * userscript adds (e.g. ff-flight-element).
 *
 * Worked out from Torn's profile stylesheet and app code and confirmed against
 * real markup the player captured (test/fixtures/).
 */

export const PROFILE_PATH = '/profiles.php';

/** The status box. Its classes say `travelling to|from <country words> [airstrip|private]`. */
export const STATUS_BOX_SELECTOR = 'div.profile-status';
/** The status a sighted player reads: "Torn to Canada", "In Mexico", "Traveling". */
export const STATUS_TEXT_SELECTOR = '.main-desc > span[aria-hidden]';
/** Fallback if the inner span goes: the whole description. */
export const STATUS_DESC_SELECTOR = '.main-desc';
/** span.main-desc's aria-label: "Traveling from Torn to Canada  . Type of plane: Commercial". */
export const PLANE_LABEL_SELECTOR = '[aria-label*="Type of plane"]';
/** The page heading, "<name>'s Profile". To be confirmed against a real capture. */
export const PROFILE_HEADING_SELECTOR = '#skip-to-content';

const squash = (text) => text.replace(/\s+/g, ' ').trim();

export function isProfilePage(loc) {
  return !!loc && loc.pathname === PROFILE_PATH;
}

/** @returns {Element|null} */
export function statusBox(doc) {
  return doc ? doc.querySelector(STATUS_BOX_SELECTOR) : null;
}

/** @returns {string[]} the status box's class names, lower-cased. */
export function statusClasses(box) {
  return box ? [...box.classList].map((name) => name.toLowerCase()) : [];
}

/** @returns {string|null} the status sentence, whitespace squashed. */
export function statusText(box) {
  if (!box) return null;
  const node = box.querySelector(STATUS_TEXT_SELECTOR) || box.querySelector(STATUS_DESC_SELECTOR);
  const text = node ? squash(node.textContent) : '';
  return text || null;
}

/** @returns {string|null} the aria-label that names the plane, on the box or inside it. */
export function planeAriaLabel(box) {
  if (!box) return null;
  const node = box.matches(PLANE_LABEL_SELECTOR) ? box : box.querySelector(PLANE_LABEL_SELECTOR);
  return node ? node.getAttribute('aria-label') : null;
}

/** @returns {string|null} the player id from a profiles.php?XID=… address. */
export function profileIdFromUrl(href) {
  try {
    const id = new URL(href).searchParams.get('XID');
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** @returns {{ name: string|null, id: string|null }} whose profile the page says this is. */
export function profileIdentity(doc) {
  const heading = doc ? doc.querySelector(PROFILE_HEADING_SELECTOR) : null;
  const fromHeading = heading ? /^(.+?)['’]s Profile$/i.exec(squash(heading.textContent)) : null;
  const fromTitle = doc && typeof doc.title === 'string' ? /^\s*(.+?)\s*\[(\d+)\]/.exec(doc.title) : null;
  return {
    name: fromHeading ? fromHeading[1] : (fromTitle ? fromTitle[1] : null),
    id: fromTitle ? fromTitle[2] : null,
  };
}
