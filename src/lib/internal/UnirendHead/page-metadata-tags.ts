import React from 'react';
import type { ReactElement } from 'react';
import type {
  PageMetadata,
  PageResponseEnvelope,
} from '../../api-envelope/api-envelope-types';
import { getLinkHeadKey, TITLE_HEAD_KEY } from './head-keys';

/**
 * Pull the page metadata a `UnirendHead` should project onto tags.
 *
 * Everything is optional-chained rather than trusted. `meta` is a required field on the envelope
 * types, but the value arriving here came off the wire (or out of a hand-written local loader),
 * and a page that renders without a title is a far better outcome than one that throws.
 */
export function resolvePageMetadata(
  envelope: PageResponseEnvelope | null | undefined,
): PageMetadata | null {
  return envelope?.meta?.page ?? null;
}

/**
 * A metadata value is only rendered when it is actually a populated string.
 *
 * Absent means no tag. Unirend never substitutes placeholder text for a missing field: a
 * `content="Error loading description"` that ships to production is worse than nothing, and a
 * visibly missing title is the clearer signal that a handler forgot its `pageMetadata`.
 */
function isPopulated(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Build the head tags a `PageMetadata` describes, skipping every key the instance's own children
 * already claim.
 *
 * The result is prepended to the declared children, so from here on the rest of `UnirendHead`
 * sees one ordinary child list and behaves exactly as it always has — the same list on the
 * server and on the client, so there is no parity to keep in sync.
 */
export function buildPageMetadataTags(
  metadata: PageMetadata | null,
  claimedKeys: Set<string>,
): ReactElement[] {
  if (metadata === null) {
    return [];
  }

  const tags: ReactElement[] = [];

  const addMeta = (
    attribute: 'name' | 'property',
    identifier: string,
    content: unknown,
  ): void => {
    if (!isPopulated(content)) {
      return;
    }

    const key = `${attribute}=${identifier.toLowerCase()}`;

    if (claimedKeys.has(key)) {
      return;
    }

    tags.push(
      React.createElement('meta', {
        key: `unirend-head-${key}`,
        [attribute]: identifier,
        content,
      }),
    );
  };

  if (isPopulated(metadata.title) && !claimedKeys.has(TITLE_HEAD_KEY)) {
    tags.push(
      React.createElement(
        'title',
        { key: `unirend-head-${TITLE_HEAD_KEY}` },
        metadata.title,
      ),
    );
  }

  addMeta('name', 'description', metadata.description);
  addMeta('name', 'keywords', metadata.keywords);

  const canonicalKey = getLinkHeadKey('canonical');

  if (isPopulated(metadata.canonical) && !claimedKeys.has(canonicalKey)) {
    tags.push(
      React.createElement('link', {
        key: `unirend-head-${canonicalKey}`,
        rel: 'canonical',
        href: metadata.canonical,
      }),
    );
  }

  addMeta('property', 'og:title', metadata.og?.title);
  addMeta('property', 'og:description', metadata.og?.description);
  addMeta('property', 'og:image', metadata.og?.image);

  return tags;
}
