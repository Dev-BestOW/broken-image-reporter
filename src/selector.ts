/**
 * Builds a CSS path locating a broken image in the page.
 *
 * A record carrying only a URL tells you an image is broken; it does not tell you
 * where to go and fix it. The same URL can be rendered by three different templates,
 * and `alt` is frequently empty on exactly the decorative images nobody notices.
 */

/** Past this many segments a path stops being useful to a human. */
const MAX_DEPTH = 6;

/** Attributes worth anchoring a path to, in preference order. */
const ANCHOR_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-cy'];

/**
 * `CSS.escape` is absent outside a browser, and the reporter's unit tests run against
 * a hand-rolled DOM. Fall back to escaping every character a CSS identifier may not
 * contain unescaped.
 */
function escapeValue(value: string): string {
  const cssEscape = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS
    ?.escape;
  return cssEscape ? cssEscape(value) : value.replace(/[^\w-]/g, ch => `\\${ch}`);
}

function attribute(el: Element, name: string): string | null {
  return typeof el.getAttribute === 'function' ? el.getAttribute(name) : null;
}

/** Quote an attribute selector's value, escaping the quote and the escape itself. */
function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, ch => `\\${ch}`);
}

/** `:nth-of-type` is only needed when a sibling shares the tag name. */
function positionAmongSiblings(el: Element): string {
  const parent = el.parentElement;
  if (!parent) return '';

  const sameTag = Array.from(parent.children).filter(c => c.tagName === el.tagName);
  if (sameTag.length < 2) return '';
  return `:nth-of-type(${sameTag.indexOf(el) + 1})`;
}

/**
 * A CSS selector locating `el`, or `null` when the element is too detached from a
 * document to describe.
 *
 * The path is anchored at the nearest ancestor carrying an `id` or a test id, which
 * keeps it stable against unrelated markup changes elsewhere on the page. Without
 * such an ancestor the walk stops at `MAX_DEPTH` segments, and the result is a
 * locator hint rather than a guaranteed-unique selector — `querySelector` may match
 * an earlier element. Treat it as a signpost, not an identity.
 */
export function cssPath(el: Element | null | undefined): string | null {
  if (!el?.tagName) return null;

  const segments: string[] = [];

  for (
    let node: Element | null = el;
    node?.tagName && segments.length < MAX_DEPTH;
    node = node.parentElement
  ) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') break;

    const id = attribute(node, 'id');
    if (id) {
      segments.unshift(`#${escapeValue(id)}`);
      return segments.join(' > ');
    }

    const anchorName = ANCHOR_ATTRIBUTES.find(name => attribute(node!, name));
    if (anchorName) {
      const value = escapeAttributeValue(attribute(node, anchorName)!);
      segments.unshift(`${tag}[${anchorName}="${value}"]`);
      return segments.join(' > ');
    }

    segments.unshift(`${tag}${positionAmongSiblings(node)}`);
  }

  return segments.length > 0 ? segments.join(' > ') : null;
}
