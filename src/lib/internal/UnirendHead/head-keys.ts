import React from 'react';
import type { ReactNode } from 'react';
import { getMetaKey } from '../html-utils/meta-key';
import { toHeadAttributes } from './head-attributes';

/**
 * The identity of a head tag within a single `UnirendHead`.
 *
 * Metas reuse `getMetaKey()`, the identity the server-side template merge and the client-side
 * template reconciliation already agree on, so `og:*` and `http-equiv` are covered for free.
 * Links key on `rel`, and the document title is a single fixed key because there is only ever
 * one of it.
 *
 * These keys drive two things: which envelope-derived tags an instance's own children have
 * already claimed, and which tags two separate instances both emit (the development-only
 * duplicate warning).
 */
export const TITLE_HEAD_KEY = 'title';

/**
 * Identity key for a `<link>`, built from its `rel`.
 */
export function getLinkHeadKey(rel: string): string {
  return `rel=${rel.toLowerCase()}`;
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
 * Only direct children are considered, matching how the rest of `UnirendHead` collects: the
 * server collector and the client attribute readers all walk the same single level.
 */
export function scanHeadKeys(children: ReactNode): HeadKeyScan {
  const claimed = new Set<string>();
  const values = new Map<string, string>();

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      return;
    }

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
    const key =
      type === 'meta'
        ? getMetaKey(attrs)
        : attrs.rel
          ? getLinkHeadKey(attrs.rel)
          : null;

    if (key === null) {
      return;
    }

    claimed.add(key);

    // First value wins, so the message a duplicate warning prints names the tag that was
    // already there rather than the last repeat of it.
    if (!values.has(key)) {
      values.set(key, attrs.content ?? attrs.href ?? '');
    }
  });

  return { claimed, values };
}
