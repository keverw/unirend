import type { ReactNode } from 'react';
import { getMetaKeys } from '../html-utils/meta-key';
import { toHeadAttributes } from './head-attributes';
import { forEachHeadChild } from './head-children';

/**
 * The identity of a head tag within a single `UnirendHead`.
 *
 * Metas reuse the identity the server-side template merge and the client-side template
 * reconciliation already agree on, so `og:*` and `http-equiv` are covered for free. Links key on
 * `rel`, and the document title is a single fixed key because there is only ever one of it.
 *
 * A tag can occupy more than one key. A meta carrying both `name` and `property` is both of those
 * things, and a `rel` is a token set. Overriding and collision detection have to see every identity
 * a tag has, or a tag hides behind whichever one happened to be checked.
 *
 * These keys drive two things: which envelope-derived tags an instance's own children have
 * already claimed, and which tags two separate instances both emit (the development-only
 * duplicate warning).
 */
export const TITLE_HEAD_KEY = 'title';

/**
 * Link relations that must not repeat.
 *
 * Links are handled the other way round from metas on purpose. Most relations are repeatable by
 * nature — a page preloads several assets, ships several icon sizes, lists several `alternate`
 * language variants — so an allowlist of the repeatable ones would be long, incomplete, and a
 * steady source of false positives. Only a handful of relations describe the document once, and
 * those are the ones worth flagging.
 */
export const SINGULAR_LINK_RELATIONS = new Set([
  'canonical',
  'manifest',
  'amphtml',
]);

/**
 * One identity key for a `<link>`, built from its `rel`.
 *
 * `rel` is a space-separated token set, so the whitespace is normalized on the way in and two
 * spellings of one list are one key.
 *
 * For building a key from a `rel` you already control, such as the `canonical` this file emits for
 * the envelope field of that name. Deciding what an arbitrary link overrides or collides with
 * wants `getLinkHeadKeys()`, since a `rel` naming a single-value relation among several tokens is
 * that relation too, and keying on the list alone hides it.
 */
export function getLinkHeadKey(rel: string): string {
  return `rel=${rel.trim().toLowerCase().split(/\s+/).join(' ')}`;
}

/**
 * Every identity key a `<link>` occupies.
 *
 * The `rel` as written is the primary key, because overriding should replace the tag an author
 * declared and not a neighbor that happens to share a token: a child `rel="alternate stylesheet"`
 * has no business suppressing the envelope's `rel="alternate"` feed link.
 *
 * A singular relation named inside a longer list is the exception and gets a key of its own. Those
 * are the relations where a second one is a mistake rather than a feature, so they are the only
 * ones where the difference has a consequence — without this a `rel="alternate canonical"` would
 * neither override the `canonical` field nor collide with another instance's canonical, which is
 * precisely the case the warning exists for. Adding only these keys is what keeps it from
 * over-claiming: `alternate` and `stylesheet` never become keys of their own.
 */
export function getLinkHeadKeys(rel: string): string[] {
  const primary = getLinkHeadKey(rel);
  const keys = [primary];

  for (const token of getHeadKeyValue(primary).split(' ')) {
    const key = `rel=${token}`;

    if (key !== primary && SINGULAR_LINK_RELATIONS.has(token)) {
      keys.push(key);
    }
  }

  return keys;
}

/**
 * The value part of a head key, i.e. `description` for `name=description` and `og:image` for
 * `property=og:image`. Used to match a key against author-facing key lists, where writing the
 * plain name reads better than the internal `attribute=value` form.
 */
export function getHeadKeyValue(key: string): string {
  const separator = key.indexOf('=');

  return separator === -1 ? key : key.slice(separator + 1);
}

/**
 * What a single `UnirendHead`'s children declare.
 */
export interface HeadKeyScan {
  /**
   * Every key the children claim, the title included. A claimed key suppresses the
   * envelope-derived tag for that same key, which is how a child wins over the envelope.
   */
  claimed: Set<string>;

  /**
   * Meta and link keys mapped to the value that identifies them (a meta's `content`, a link's
   * `href`), for the duplicate warning's message. The title is deliberately absent: titles are
   * last-write-wins across instances by design, so a second one is never a collision.
   */
  values: Map<string, string>;
}

/**
 * Walk a child list and record the head keys it declares.
 *
 * Fragments are walked through and nothing else is, matching how the rest of `UnirendHead`
 * collects: the server collector and the client attribute readers all use the same walker, so a
 * child that claims a key here is a child that reaches the head there. See `forEachHeadChild()`.
 */
export function scanHeadKeys(children: ReactNode): HeadKeyScan {
  const claimed = new Set<string>();
  const values = new Map<string, string>();

  forEachHeadChild(children, (child) => {
    const type = child.type;
    const props = child.props as Record<string, unknown>;

    if (type === 'title') {
      claimed.add(TITLE_HEAD_KEY);

      return;
    }

    if (type !== 'meta' && type !== 'link') {
      return;
    }

    const attrs = toHeadAttributes(props);

    // Either kind may occupy more than one key: a meta carrying both `name` and `property` is
    // both identities, and a link's `rel` is a token set. See getMetaKeys() and getLinkHeadKeys().
    const keys =
      type === 'meta'
        ? getMetaKeys(attrs)
        : attrs.rel
          ? getLinkHeadKeys(attrs.rel)
          : [];

    for (const key of keys) {
      claimed.add(key);

      // First value wins, so the message a duplicate warning prints names the tag that was
      // already there rather than the last repeat of it.
      if (!values.has(key)) {
        values.set(key, attrs.content ?? attrs.href ?? '');
      }
    }
  });

  return { claimed, values };
}
