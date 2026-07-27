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
 * Every identity key a <meta>'s attributes carry.
 *
 * A tag can carry more than one: `<meta name="twitter:title" property="og:title">` is a
 * `twitter:title` and an `og:title` both, and anything deciding what a tag overrides, collides
 * with, or replaces has to see all of them, or the second identity is invisible and a duplicate
 * ships beside it.
 *
 * Deliberately the only shape on offer. Earlier versions also returned just the first identity,
 * which read as the tag's one true name and was correct only where a group of tags was being
 * filed under something stable. Every place that reached for it to make a decision got that
 * decision wrong for a two-identity tag, twice over, so the choice is gone: a caller that wants a
 * stable grouping key builds one from the whole set.
 *
 * Returns an empty list for metas carrying none of the identifying attributes, `<meta charset>`
 * being the usual one. Those are not something a page can override by name, so they are never part
 * of the baseline merge and are always left alone.
 */
export function getMetaKeys(attrs: Record<string, string>): string[] {
  const keys: string[] = [];

  for (const attr of META_KEY_ATTRIBUTES) {
    const value = attrs[attr];

    if (value) {
      keys.push(`${attr}=${value.toLowerCase()}`);
    }
  }

  return keys;
}

/**
 * Every identity, computed from a live DOM element rather than a parsed attribute record.
 */
export function getMetaKeysFromElement(element: Element): string[] {
  const keys: string[] = [];

  for (const attr of META_KEY_ATTRIBUTES) {
    const value = element.getAttribute(attr);

    if (value) {
      keys.push(`${attr}=${value.toLowerCase()}`);
    }
  }

  return keys;
}
