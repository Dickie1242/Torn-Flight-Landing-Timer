/**
 * Builds an element. `className`, `text` (set as textContent), `attrs`
 * (true → empty attribute, null/false → left off) and `on` listeners are all
 * optional; children are nodes or strings. Text from the page always goes in
 * as text, never as HTML.
 */
export function el(doc, tag, { className, text, attrs, on } = {}, children = []) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (on) {
    for (const [type, listener] of Object.entries(on)) node.addEventListener(type, listener);
  }
  for (const child of children) {
    if (child != null && child !== '') node.append(child);
  }
  return node;
}
