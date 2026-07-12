/**
 * Identity of a <meta> tag, shared by the server-side template merge (html-utils/inject) and
 * the client-side template reconciliation (UnirendHead). Both sides have to agree on what
 * counts as "the same meta", otherwise a page override that replaces a template meta during
 * SSR would fail to replace it again after a client-side navigation.
 */

// The attributes that identify a meta, in precedence order. These are what head managers
// conventionally key on: `name`, `property` (OpenGraph), and `http-equiv`.
const META_KEY_ATTRIBUTES = ['name', 'property', 'http-equiv'] as const;

/**
 * Build the identity key for a <meta> tag's attributes.
 *
 * Returns null for metas carrying none of the identifying attributes (e.g. <meta charset>).
 * Those are not something a page can override by name, so they are never part of the
 * baseline merge and are always left alone.
 */
export function getMetaKey(attrs: Record<string, string>): string | null {
  for (const attr of META_KEY_ATTRIBUTES) {
    const value = attrs[attr];

    if (value) {
      return `${attr}=${value.toLowerCase()}`;
    }
  }

  return null;
}

/**
 * Same identity, computed from a live DOM element rather than a parsed attribute record.
 */
export function getMetaKeyFromElement(element: Element): string | null {
  for (const attr of META_KEY_ATTRIBUTES) {
    const value = element.getAttribute(attr);

    if (value) {
      return `${attr}=${value.toLowerCase()}`;
    }
  }

  return null;
}
