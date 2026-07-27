import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { overrideDevMode } from 'lifecycleion/dev-mode';
import { UnirendHead } from './UnirendHead';
import { UnirendHeadProvider } from './UnirendHeadProvider';
import { _test } from './page-metadata-tags';
import type { HeadCollector } from './context';
import type {
  PageErrorResponse,
  PageMetadata,
  PageSuccessResponse,
} from '../../api-envelope/api-envelope-types';

function createEmptyCollector(): HeadCollector {
  return {
    title: '',
    metas: [],
    links: [],
    htmlAttrs: {},
    bodyAttrs: {},
  };
}

const FULL_METADATA: PageMetadata = {
  title: 'Home - My App',
  description: 'Envelope description',
  keywords: 'envelope, metadata',
  canonical: 'https://example.com/',
  og: {
    title: 'Home OG title',
    description: 'Home OG description',
    image: 'https://example.com/og.png',
  },
};

function createSuccessEnvelope(
  page?: PageMetadata,
): PageSuccessResponse<{ ok: true }> {
  return {
    status: 'success',
    status_code: 200,
    request_id: 'test-request-id',
    type: 'page',
    data: { ok: true },
    meta: page ? { page } : {},
  };
}

function createErrorEnvelope(page?: PageMetadata): PageErrorResponse {
  return {
    status: 'error',
    status_code: 404,
    request_id: 'test-request-id',
    type: 'page',
    data: null,
    meta: page ? { page } : {},
    error: { code: 'not_found', message: 'Not found' },
  };
}

/**
 * Collect the head an SSR/SSG render produces for a single element.
 */
function collect(element: React.ReactElement): HeadCollector {
  const collector = createEmptyCollector();

  renderToString(
    <UnirendHeadProvider collector={collector}>{element}</UnirendHeadProvider>,
  );

  return collector;
}

describe('UnirendHead envelope projection (server collection)', () => {
  it('renders every populated meta.page field, og and canonical included', () => {
    const collector = collect(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)} />,
    );

    expect(collector.title).toBe('Home - My App');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Envelope description' },
      { name: 'keywords', content: 'envelope, metadata' },
      { property: 'og:title', content: 'Home OG title' },
      { property: 'og:description', content: 'Home OG description' },
      { property: 'og:image', content: 'https://example.com/og.png' },
    ]);
    expect(collector.links).toEqual([
      { rel: 'canonical', href: 'https://example.com/' },
    ]);
  });

  it('omits absent fields rather than emitting placeholders', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Only Title',
          description: 'Only Description',
        })}
      />,
    );

    expect(collector.title).toBe('Only Title');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Only Description' },
    ]);
    expect(collector.links).toEqual([]);
  });

  it('emits partial og objects without filling in the missing members', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Partial OG',
          description: 'Partial OG description',
          og: { image: 'https://example.com/only-image.png' },
        })}
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Partial OG description' },
      { property: 'og:image', content: 'https://example.com/only-image.png' },
    ]);
  });

  it('treats an empty string as absent, so no empty tag is emitted', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: '',
          description: '',
          keywords: '',
          canonical: '',
          og: { title: '', image: '' },
        })}
      />,
    );

    expect(collector.title).toBe('');
    expect(collector.metas).toEqual([]);
    expect(collector.links).toEqual([]);
  });

  it('emits no title at all when the handler forgot pageMetadata', () => {
    const collector = collect(
      <UnirendHead envelope={createSuccessEnvelope()} />,
    );

    expect(collector.title).toBe('');
    expect(collector.metas).toEqual([]);
    expect(collector.links).toEqual([]);
  });

  it('lets a child win for its own key only, keeping the other envelope fields', () => {
    const collector = collect(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)}>
        <meta name="description" content="Something more specific" />
      </UnirendHead>,
    );

    // One description, the child's. Everything else still comes from the envelope.
    expect(collector.metas).toEqual([
      { name: 'keywords', content: 'envelope, metadata' },
      { property: 'og:title', content: 'Home OG title' },
      { property: 'og:description', content: 'Home OG description' },
      { property: 'og:image', content: 'https://example.com/og.png' },
      { name: 'description', content: 'Something more specific' },
    ]);
    expect(collector.title).toBe('Home - My App');
    expect(collector.links).toEqual([
      { rel: 'canonical', href: 'https://example.com/' },
    ]);
  });

  it('lets a child title win over the envelope title', () => {
    const collector = collect(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)}>
        <title>Local Title</title>
      </UnirendHead>,
    );

    expect(collector.title).toBe('Local Title');
  });

  it('lets a child og meta win, keyed on property', () => {
    const collector = collect(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)}>
        <meta property="og:image" content="https://example.com/local.png" />
      </UnirendHead>,
    );

    const ogImages = collector.metas.filter(
      (meta) => meta.property === 'og:image',
    );

    expect(ogImages).toEqual([
      { property: 'og:image', content: 'https://example.com/local.png' },
    ]);
  });

  it('lets a child canonical link win, keyed on rel', () => {
    const collector = collect(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)}>
        <link rel="canonical" href="https://example.com/local" />
      </UnirendHead>,
    );

    expect(collector.links).toEqual([
      { rel: 'canonical', href: 'https://example.com/local' },
    ]);
  });

  it('emits additive children alongside the generated tags', () => {
    const collector = collect(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)}>
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="alternate" href="https://example.com/feed.xml" />
      </UnirendHead>,
    );

    expect(collector.metas).toContainEqual({
      name: 'description',
      content: 'Envelope description',
    });
    expect(collector.metas).toContainEqual({
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    expect(collector.links).toEqual([
      { rel: 'canonical', href: 'https://example.com/' },
      { rel: 'alternate', href: 'https://example.com/feed.xml' },
    ]);
  });

  it('keeps collecting html and body attributes from children', () => {
    const collector = collect(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)}>
        {/* eslint-disable-next-line jsx-a11y/html-has-lang */}
        <html className="dark" />
        <body className="bg-slate-900" />
      </UnirendHead>,
    );

    expect(collector.htmlAttrs.class).toBe('dark');
    expect(collector.bodyAttrs.class).toBe('bg-slate-900');
    expect(collector.title).toBe('Home - My App');
  });

  it('reads meta.page only, ignoring every sibling key under meta', () => {
    // M extends BaseMeta lets an app put anything under meta: session state, feature flags,
    // build details. None of it is Unirend's to publish, so none of it is looked at.
    const collector = collect(
      <UnirendHead
        envelope={
          {
            status: 'success',
            status_code: 200,
            request_id: 'test-request-id',
            type: 'page',
            data: null,
            meta: {
              page: { title: 'Home', description: 'Home description' },
              app: {
                version: '1.2.3',
                environment: 'production',
                buildTime: '2026-07-26',
              },
              account: {
                isAuthenticated: true,
                userID: 'u_123',
                role: 'admin',
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    expect(collector.title).toBe('Home');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
    ]);
    expect(collector.links).toEqual([]);

    // Nothing from the sibling keys reached the head, by name or by value.
    const serialized = JSON.stringify(collector);

    for (const leaked of [
      'version',
      'environment',
      'buildTime',
      'account',
      'userID',
      'admin',
      '1.2.3',
      'u_123',
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('works from an error envelope, the shape 404 and error components receive', () => {
    const collector = collect(
      <UnirendHead
        envelope={createErrorEnvelope({
          title: '404 - Page Not Found',
          description: 'The page you are looking for does not exist.',
        })}
      />,
    );

    expect(collector.title).toBe('404 - Page Not Found');
    expect(collector.metas).toEqual([
      {
        name: 'description',
        content: 'The page you are looking for does not exist.',
      },
    ]);
  });

  it('renders nothing extra and never crashes for the empty cases', () => {
    for (const element of [
      <UnirendHead key="none" />,
      <UnirendHead key="undefined-envelope" envelope={undefined} />,
      <UnirendHead key="null-envelope" envelope={null} />,
      <UnirendHead key="no-page" envelope={createSuccessEnvelope()} />,
      <UnirendHead
        key="no-meta"
        envelope={
          {
            status: 'success',
            status_code: 200,
            request_id: 'test-request-id',
            type: 'page',
            data: null,
          } as unknown as PageSuccessResponse<null>
        }
      />,
    ]) {
      const collector = collect(element);

      expect(collector.title).toBe('');
      expect(collector.metas).toEqual([]);
      expect(collector.links).toEqual([]);
    }
  });

  it('renders nothing and never crashes when the envelope is not an object', () => {
    // The value came off the wire or out of a hand-written local loader, so it is not trusted
    // to be the shape the types promise. Rendering no head is always better than throwing and
    // taking the page down with it.
    const malformed: unknown[] = [
      'not an envelope',
      42,
      0,
      true,
      false,
      [],
      ['nope'],
      () => 'nope',
      new Date(0),
    ];

    for (const [index, value] of malformed.entries()) {
      const collector = collect(
        <UnirendHead
          key={`malformed-${index}`}
          envelope={value as PageSuccessResponse<null>}
        />,
      );

      expect(collector.title).toBe('');
      expect(collector.metas).toEqual([]);
      expect(collector.links).toEqual([]);
    }
  });

  it('ignores keys under meta.page that are not part of PageMetadata', () => {
    // The named PageMetadata fields are read by name, not enumerated, so meta.page is as closed
    // a surface as meta itself. An extra key is a type error to begin with, and one forced past
    // the type checker still reaches no head: there is no fallback that turns an unrecognized
    // key into a meta tag named after it. `tags` is the deliberate way in, covered below.
    //
    // `og` is the one nested exception, since every key under it renders the same way. That is
    // its own suite further down.
    const collector = collect(
      <UnirendHead
        envelope={
          {
            meta: {
              page: {
                title: 'Home',
                foo: 'bar',
                'app-version': '1.2.3',
                og: { title: 'OG Home' },
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    expect(collector.title).toBe('Home');
    expect(collector.metas).toEqual([
      { property: 'og:title', content: 'OG Home' },
    ]);
    expect(collector.links).toEqual([]);
  });

  it('renders nothing and never crashes when meta or meta.page is not an object', () => {
    const malformedPages: unknown[] = [
      'not metadata',
      42,
      0,
      true,
      [],
      ['title'],
      null,
    ];

    for (const [index, page] of malformedPages.entries()) {
      const collector = collect(
        <UnirendHead
          key={`bad-page-${index}`}
          envelope={{ meta: { page } } as unknown as PageSuccessResponse<null>}
        />,
      );

      expect(collector.title).toBe('');
      expect(collector.metas).toEqual([]);
      expect(collector.links).toEqual([]);
    }

    for (const [index, meta] of ['nope', 42, [], true].entries()) {
      const collector = collect(
        <UnirendHead
          key={`bad-meta-${index}`}
          envelope={{ meta } as unknown as PageSuccessResponse<null>}
        />,
      );

      expect(collector.title).toBe('');
      expect(collector.metas).toEqual([]);
      expect(collector.links).toEqual([]);
    }
  });

  it('skips individual fields that are not strings, keeping the ones that are', () => {
    const collector = collect(
      <UnirendHead
        envelope={
          {
            meta: {
              page: {
                title: 123,
                description: 'A real description',
                keywords: null,
                canonical: { href: 'https://example.com/' },
                og: 'not an object',
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    // No String(123) title, no '[object Object]' canonical. Only the field that was a string.
    expect(collector.title).toBe('');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'A real description' },
    ]);
    expect(collector.links).toEqual([]);
  });

  it('tolerates a partially malformed og object', () => {
    const collector = collect(
      <UnirendHead
        envelope={
          {
            meta: {
              page: {
                title: 'Fine',
                description: 'Fine',
                og: { title: 42, description: null, image: 'https://ok/i.png' },
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    expect(collector.title).toBe('Fine');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Fine' },
      { property: 'og:image', content: 'https://ok/i.png' },
    ]);
  });

  it('leaves a children-only instance behaving exactly as before', () => {
    const collector = collect(
      <UnirendHead>
        <title>About - My App</title>
        <meta name="description" content="Learn about us" />
      </UnirendHead>,
    );

    expect(collector.title).toBe('About - My App');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Learn about us' },
    ]);
  });

  it('keeps separate instances relating to each other as documented', () => {
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead
          envelope={createSuccessEnvelope({
            title: 'Layout',
            description: 'Layout',
          })}
        />
        <UnirendHead
          envelope={createSuccessEnvelope({
            title: 'Page',
            description: 'Page',
          })}
        />
      </UnirendHeadProvider>,
    );

    // Title is last-write-wins, metas accumulate. The envelope prop does not change either rule.
    expect(collector.title).toBe('Page');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Layout' },
      { name: 'description', content: 'Page' },
    ]);
  });
});

describe('UnirendHead envelope projection (meta.page.og)', () => {
  it('renders every member as its own og: property, not just the named three', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          og: {
            title: 'OG title',
            type: 'article',
            url: 'https://example.com/',
            locale: 'en_US',
            'image:width': '1200',
          },
        })}
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
      { property: 'og:title', content: 'OG title' },
      { property: 'og:type', content: 'article' },
      { property: 'og:url', content: 'https://example.com/' },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:image:width', content: '1200' },
    ]);
  });

  it('keeps the named members in their documented order, ahead of the rest', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          og: {
            type: 'article',
            image: 'https://example.com/og.png',
            description: 'OG description',
            title: 'OG title',
          },
        })}
      />,
    );

    // Written in a scrambled order, rendered in the order the docs promise.
    expect(
      collector.metas
        .map((meta) => meta.property)
        .filter((property): property is string => property !== undefined),
    ).toEqual(['og:title', 'og:description', 'og:image', 'og:type']);
  });

  it('emits one meta when two members normalize onto the same property', () => {
    // `type` and `og:type` are two object keys describing one tag, so the pair must not ship as
    // two og:type metas. The named members render first, so `title` beats a swept `og:title`.
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          og: {
            title: 'From title',
            'og:title': 'From og:title',
            type: 'article',
            'og:type': 'website',
            'OG:Locale': 'en_US',
            locale: 'fr_FR',
          },
        })}
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
      { property: 'og:title', content: 'From title' },
      { property: 'og:type', content: 'article' },
      { property: 'OG:Locale', content: 'en_US' },
    ]);
  });

  it('does not prefix a member that already carries the og: prefix', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          og: { 'og:type': 'article' },
        })}
      />,
    );

    expect(collector.metas).toContainEqual({
      property: 'og:type',
      content: 'article',
    });
  });

  it('lets a child override an unnamed member, keyed the same way', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          og: { type: 'article' },
        })}
      >
        <meta property="og:type" content="website" />
      </UnirendHead>,
    );

    expect(
      collector.metas.filter((meta) => meta.property === 'og:type'),
    ).toEqual([{ property: 'og:type', content: 'website' }]);
  });

  it('cannot smuggle an attribute in through a member name', () => {
    // The attributes `tags` forbids are irrelevant here: an og member name becomes the value of
    // `property`, never an attribute of its own, so the worst it can produce is a meaningless
    // OpenGraph property rather than an instruction to the browser.
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          'http-equiv': 'refresh',
          onLoad: 'alert(1)',
        } as unknown as PageMetadata)}
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
    ]);
  });

  it('renders a forbidden-looking og member as an inert property, not an attribute', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          og: { 'http-equiv': 'refresh' },
        })}
      />,
    );

    expect(collector.metas).toContainEqual({
      property: 'og:http-equiv',
      content: 'refresh',
    });
    // The point: it is a property value, so nothing carries an http-equiv attribute.
    expect(collector.metas.some((meta) => 'http-equiv' in meta)).toBe(false);
  });

  it('skips members that are not populated strings or usable property names', () => {
    const collector = collect(
      <UnirendHead
        envelope={
          {
            meta: {
              page: {
                title: 'Home',
                og: {
                  type: 'article',
                  url: 42,
                  locale: null,
                  site_name: '',
                  nested: { toString: () => 'nope' },
                  '2bad': 'leading digit',
                  'has space': 'nope',
                },
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    expect(collector.metas).toEqual([
      { property: 'og:type', content: 'article' },
    ]);
  });

  it('still tolerates an og that is not an object', () => {
    for (const [index, og] of ['nope', 42, [], true, null].entries()) {
      const collector = collect(
        <UnirendHead
          key={`bad-og-${index}`}
          envelope={
            {
              meta: { page: { title: 'Home', og } },
            } as unknown as PageSuccessResponse<null>
          }
        />,
      );

      expect(collector.title).toBe('Home');
      expect(collector.metas).toEqual([]);
    }
  });
});

describe('UnirendHead envelope projection (meta.page.tags)', () => {
  it('renders meta and link entries after the named fields', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Named description',
          tags: [
            { meta: { name: 'app-version', content: '1.2.3' } },
            { meta: { property: 'twitter:card', content: 'summary' } },
            {
              link: { rel: 'alternate', href: 'https://example.com/feed.xml' },
            },
          ],
        })}
      />,
    );

    expect(collector.title).toBe('Home');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Named description' },
      { name: 'app-version', content: '1.2.3' },
      { property: 'twitter:card', content: 'summary' },
    ]);
    expect(collector.links).toEqual([
      { rel: 'alternate', href: 'https://example.com/feed.xml' },
    ]);
  });

  it('passes through attributes beyond the required ones', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          tags: [
            {
              meta: {
                name: 'theme-color',
                content: '#000',
                media: '(prefers-color-scheme: dark)',
              },
            },
            {
              link: {
                rel: 'alternate',
                href: 'https://example.com/es/',
                hreflang: 'es',
              },
            },
          ],
        })}
      />,
    );

    expect(collector.metas).toContainEqual({
      name: 'theme-color',
      content: '#000',
      media: '(prefers-color-scheme: dark)',
    });
    expect(collector.links).toContainEqual({
      rel: 'alternate',
      href: 'https://example.com/es/',
      hreflang: 'es',
    });
  });

  it('renders every entry that shares a key, since those are the ones a list is for', () => {
    // A map keyed by name could not express these at all. Two alternates and a light/dark
    // theme-color pair are correct output, not a duplicate to collapse.
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          tags: [
            {
              meta: {
                name: 'theme-color',
                content: '#fff',
                media: '(prefers-color-scheme: light)',
              },
            },
            {
              meta: {
                name: 'theme-color',
                content: '#000',
                media: '(prefers-color-scheme: dark)',
              },
            },
            { link: { rel: 'alternate', href: 'https://example.com/es/' } },
            { link: { rel: 'alternate', href: 'https://example.com/fr/' } },
          ],
        })}
      />,
    );

    expect(
      collector.metas.filter((meta) => meta.name === 'theme-color'),
    ).toHaveLength(2);
    expect(collector.links).toHaveLength(2);
  });

  it('lets a child win over an entry with the same key', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          tags: [
            { meta: { name: 'app-version', content: 'from envelope' } },
            {
              link: { rel: 'alternate', href: 'https://example.com/feed.xml' },
            },
          ],
        })}
      >
        <meta name="app-version" content="from child" />
      </UnirendHead>,
    );

    expect(
      collector.metas.filter((meta) => meta.name === 'app-version'),
    ).toEqual([{ name: 'app-version', content: 'from child' }]);
    // The entry the child said nothing about is untouched.
    expect(collector.links).toHaveLength(1);
  });

  it('lets an entry join a named field on a key that repeats by nature', () => {
    // An object cannot hold a second `image`, so the docs point at `tags` for a page offering
    // several. Dropping these as collisions would make that advice impossible to follow.
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          og: { image: 'https://example.com/first.png' },
          tags: [
            {
              meta: {
                property: 'og:image',
                content: 'https://example.com/second.png',
              },
            },
            { meta: { property: 'og:image:width', content: '1200' } },
          ],
        })}
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
      { property: 'og:image', content: 'https://example.com/first.png' },
      { property: 'og:image', content: 'https://example.com/second.png' },
      { property: 'og:image:width', content: '1200' },
    ]);
  });

  it('skips an entry a named field already produced', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Named description',
          canonical: 'https://example.com/',
          og: { title: 'Named OG title' },
          tags: [
            { meta: { name: 'description', content: 'Entry description' } },
            { meta: { property: 'og:title', content: 'Entry OG title' } },
            { link: { rel: 'canonical', href: 'https://example.com/entry' } },
          ],
        })}
      />,
    );

    // One of each, the named field's, so a handler setting both never ships two canonicals.
    // These are the single-value keys, unlike the og:image case above.
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Named description' },
      { property: 'og:title', content: 'Named OG title' },
    ]);
    expect(collector.links).toEqual([
      { rel: 'canonical', href: 'https://example.com/' },
    ]);
  });

  describe('the development-only warning for a dropped entry', () => {
    beforeEach(() => {
      _test.resetTagEntryWarnings();
    });

    afterEach(() => {
      overrideDevMode(false);
      _test.resetTagEntryWarnings();
    });

    /**
     * Capture what the projection prints while building, so a test can assert both that a
     * warning fires and that one does not.
     */
    function captureWarnings(render: () => void): string[] {
      const messages: string[] = [];
      const original = console.warn;

      console.warn = (...args: unknown[]) => {
        messages.push(args.map((arg) => String(arg)).join(' '));
      };

      try {
        render();
      } finally {
        console.warn = original;
      }

      return messages;
    }

    function renderWithCanonicalCollision(): string[] {
      return captureWarnings(() => {
        collect(
          <UnirendHead
            envelope={createSuccessEnvelope({
              title: 'Home',
              description: 'Home description',
              canonical: 'https://example.com/',
              tags: [
                {
                  link: { rel: 'canonical', href: 'https://example.com/entry' },
                },
              ],
            })}
          />,
        );
      });
    }

    it('names the field, the key, and both values', () => {
      overrideDevMode(true);

      const warnings = renderWithCanonicalCollision();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('rel=canonical');
      expect(warnings[0]).toContain('canonical field already produced');
      expect(warnings[0]).toContain('"https://example.com/"');
      expect(warnings[0]).toContain('"https://example.com/entry"');
    });

    it('prints once rather than on every render', () => {
      overrideDevMode(true);

      expect(renderWithCanonicalCollision()).toHaveLength(1);
      expect(renderWithCanonicalCollision()).toEqual([]);
    });

    it('stays silent in production', () => {
      overrideDevMode(false);

      expect(renderWithCanonicalCollision()).toEqual([]);
    });

    it('stays silent when a child claims the key, which is the documented override', () => {
      overrideDevMode(true);

      const warnings = captureWarnings(() => {
        collect(
          <UnirendHead
            envelope={createSuccessEnvelope({
              title: 'Home',
              description: 'Home description',
              tags: [{ meta: { name: 'app-version', content: 'from entry' } }],
            })}
          >
            <meta name="app-version" content="from child" />
          </UnirendHead>,
        );
      });

      expect(warnings).toEqual([]);
    });

    it('stays silent for entries that share a key with each other', () => {
      overrideDevMode(true);

      const warnings = captureWarnings(() => {
        collect(
          <UnirendHead
            envelope={createSuccessEnvelope({
              title: 'Home',
              description: 'Home description',
              tags: [
                { link: { rel: 'alternate', href: 'https://example.com/es/' } },
                { link: { rel: 'alternate', href: 'https://example.com/fr/' } },
              ],
            })}
          />,
        );
      });

      expect(warnings).toEqual([]);
    });

    it('warns for an entry it could not use at all, naming the index and the reason', () => {
      overrideDevMode(true);

      const warnings = captureWarnings(() => {
        collect(
          <UnirendHead
            envelope={
              {
                meta: {
                  page: {
                    title: 'Home',
                    tags: [
                      { meta: { name: 'app-version' } },
                      { meta: { content: 'orphaned' } },
                      { link: { rel: 'alternate' } },
                      'not a tag',
                      { image: 'neither' },
                    ],
                  },
                },
              } as unknown as PageSuccessResponse<null>
            }
          />,
        );
      });

      expect(warnings).toHaveLength(5);
      expect(warnings[0]).toContain('meta.page.tags[0]');
      expect(warnings[0]).toContain('its meta has no content');
      expect(warnings[1]).toContain('neither name nor property');
      expect(warnings[2]).toContain('its link needs both rel and href');
      expect(warnings[3]).toContain('it is not an object');
      expect(warnings[4]).toContain('it names neither meta nor link');
    });

    it('warns for attributes stripped from a tag that still rendered', () => {
      overrideDevMode(true);

      const warnings = captureWarnings(() => {
        collect(
          <UnirendHead
            envelope={createSuccessEnvelope({
              title: 'Home',
              description: 'Home description',
              tags: [
                {
                  meta: {
                    name: 'app-version',
                    content: '1.2.3',
                    'http-equiv': 'refresh',
                    onLoad: 'alert(1)',
                  },
                },
              ],
            })}
          />,
        );
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(
        'rendered without its http-equiv and onLoad',
      );
      expect(warnings[0]).toContain('instructs the browser');
    });

    it('still warns for a second page hitting the same index with a different tag', () => {
      // The warn-once record is module state that outlives a client-side navigation, so a message
      // that named only the index would let the first page visited silence every later one.
      overrideDevMode(true);

      function renderPageWithBadTag(name: string): string[] {
        return captureWarnings(() => {
          collect(
            <UnirendHead
              envelope={createSuccessEnvelope({
                title: 'A page',
                description: 'A page',
                tags: [
                  {
                    meta: {
                      name,
                      content: '1.2.3',
                      'http-equiv': 'refresh',
                    },
                  },
                ],
              })}
            />,
          );
        });
      }

      const first = renderPageWithBadTag('app-version');
      const second = renderPageWithBadTag('build-id');

      expect(first).toHaveLength(1);
      expect(first[0]).toContain('meta.page.tags[0] (app-version)');
      expect(second).toHaveLength(1);
      expect(second[0]).toContain('meta.page.tags[0] (build-id)');

      // The same tag with the same problem is one mistake, however many pages return it.
      expect(renderPageWithBadTag('app-version')).toEqual([]);
    });

    it('warns again for a page revisited after navigating away', () => {
      // The record tracks what is currently true, not what has ever been true. Leaving a page and
      // coming back has to say it again, or the one time it printed may have scrolled past.
      overrideDevMode(true);

      function renderBadPage(): string[] {
        return captureWarnings(() => {
          collect(
            <UnirendHead
              envelope={createSuccessEnvelope({
                title: 'Bad page',
                description: 'Bad page',
                tags: [
                  {
                    meta: {
                      name: 'app-version',
                      content: '1.2.3',
                      'http-equiv': 'refresh',
                    },
                  },
                ],
              })}
            />,
          );
        });
      }

      function renderFinePage(): string[] {
        return captureWarnings(() => {
          collect(
            <UnirendHead
              envelope={createSuccessEnvelope({
                title: 'Fine page',
                description: 'Fine page',
              })}
            />,
          );
        });
      }

      expect(renderBadPage()).toHaveLength(1);

      // A re-render of the same page, the state change case, stays quiet.
      _test.flushTagWarnings();
      expect(renderBadPage()).toEqual([]);

      // Navigate away, and the message is forgotten because it is no longer true.
      _test.flushTagWarnings();
      expect(renderFinePage()).toEqual([]);

      _test.flushTagWarnings();
      expect(renderBadPage()).toHaveLength(1);
    });

    it('survives the several DOM syncs one commit performs', () => {
      // The client flushes from updateDOM(), and a single commit calls that more than once: every
      // mounting instance's effect does, as does an unmounting instance's cleanup. Only the first
      // follows the render that filled the record, so the later ones have to leave it alone rather
      // than promote an already-drained one and let every message print again.
      overrideDevMode(true);

      function renderBadPage(): string[] {
        return captureWarnings(() => {
          collect(
            <UnirendHead
              envelope={createSuccessEnvelope({
                title: 'Bad page',
                description: 'Bad page',
                tags: [
                  {
                    meta: {
                      name: 'app-version',
                      content: '1.2.3',
                      'http-equiv': 'refresh',
                    },
                  },
                ],
              })}
            />,
          );
        });
      }

      expect(renderBadPage()).toHaveLength(1);

      // One commit, several syncs.
      _test.flushTagWarnings();
      _test.flushTagWarnings();
      _test.flushTagWarnings();

      expect(renderBadPage()).toEqual([]);
    });

    it('says nothing when every entry renders whole', () => {
      overrideDevMode(true);

      const warnings = captureWarnings(() => {
        collect(
          <UnirendHead
            envelope={createSuccessEnvelope({
              title: 'Home',
              description: 'Home description',
              tags: [
                {
                  meta: {
                    name: 'theme-color',
                    content: '#000',
                    media: '(prefers-color-scheme: dark)',
                  },
                },
              ],
            })}
          />,
        );
      });

      expect(warnings).toEqual([]);
    });

    it('stays silent in production for the skipped and stripped cases too', () => {
      overrideDevMode(false);

      const warnings = captureWarnings(() => {
        collect(
          <UnirendHead
            envelope={createSuccessEnvelope({
              title: 'Home',
              description: 'Home description',
              tags: [
                {
                  meta: { name: 'nothing-useful' } as unknown as {
                    name: string;
                    content: string;
                  },
                },
                {
                  meta: {
                    name: 'app-version',
                    content: '1.2.3',
                    'http-equiv': 'refresh',
                  },
                },
              ],
            })}
          />,
        );
      });

      expect(warnings).toEqual([]);
    });
  });

  it('drops http-equiv, so the wire cannot instruct the browser', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          tags: [
            // No identity left once http-equiv is dropped, so the tag goes with it.
            {
              meta: {
                'http-equiv': 'refresh',
                content: '0;url=https://evil.example.com',
              },
            },
            // Keeps its name, loses only the attribute.
            {
              meta: {
                name: 'app-version',
                'http-equiv': 'refresh',
                content: '1.2.3',
              },
            },
          ],
        })}
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
      { name: 'app-version', content: '1.2.3' },
    ]);
  });

  it('drops a forbidden attribute whatever its casing', () => {
    // HTML matches attribute names case-insensitively, so `HTTP-EQUIV` is an `http-equiv` by the
    // time a browser reads it. A case-sensitive filter would be one the wire opts out of by
    // changing case, which for http-equiv means a returned `refresh` navigating the page.
    const collector = collect(
      <UnirendHead
        envelope={
          {
            meta: {
              page: {
                title: 'Home',
                description: 'Home description',
                tags: [
                  {
                    meta: {
                      name: 'app-version',
                      content: '1.2.3',
                      'HTTP-EQUIV': 'refresh',
                      'Http-Equiv': 'refresh',
                      HttpEquiv: 'refresh',
                      ONLOAD: 'alert(1)',
                      OnError: 'alert(2)',
                      Children: 'injected',
                    },
                  },
                ],
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
      { name: 'app-version', content: '1.2.3' },
    ]);
  });

  it('canonicalizes the identity attributes so an odd casing still keys the tag', () => {
    // Rendered fine either way, but a `REL` the key lookup cannot see would escape both the
    // child-override check and the duplicate warning.
    const collector = collect(
      <UnirendHead
        envelope={
          {
            meta: {
              page: {
                title: 'Home',
                canonical: 'https://example.com/',
                tags: [
                  { link: { REL: 'canonical', HREF: 'https://example.com/x' } },
                  { meta: { NAME: 'app-version', CONTENT: '1.2.3' } },
                ],
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    // The link keyed as rel=canonical, so the canonical field beat it, exactly as the
    // lowercase spelling would have.
    expect(collector.links).toEqual([
      { rel: 'canonical', href: 'https://example.com/' },
    ]);
    expect(collector.metas).toEqual([
      { name: 'app-version', content: '1.2.3' },
    ]);
  });

  it('keeps only the first of two case-variant spellings of one attribute', () => {
    // A browser parsing duplicate attributes keeps the first, so emitting both would leave the
    // rendered value out of step with the one the identity checks read.
    const collector = collect(
      <UnirendHead
        envelope={
          {
            meta: {
              page: {
                title: 'Home',
                tags: [
                  {
                    meta: {
                      name: 'app-version',
                      content: 'first',
                      CONTENT: 'second',
                    },
                  },
                ],
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'app-version', content: 'first' },
    ]);
  });

  it('leaves React prop spellings alone, since lowercasing them would warn', () => {
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          tags: [
            {
              link: {
                rel: 'preload',
                href: 'https://cdn.example.com/hero.jpg',
                as: 'image',
                crossOrigin: 'anonymous',
                referrerPolicy: 'no-referrer',
              },
            },
          ],
        })}
      />,
    );

    expect(collector.links).toEqual([
      {
        rel: 'preload',
        href: 'https://cdn.example.com/hero.jpg',
        as: 'image',
        crossOrigin: 'anonymous',
        referrerPolicy: 'no-referrer',
      },
    ]);
  });

  it('drops React-special and event-handler attributes rather than rendering them', () => {
    // `children` on a void element is the one that matters: React throws on it, which would take
    // the page down instead of merely losing a tag. `style` is the same failure by a different
    // route: React expects an object, and everything that reaches here is a string.
    const collector = collect(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          tags: [
            {
              meta: {
                name: 'app-version',
                content: '1.2.3',
                children: 'injected',
                dangerouslySetInnerHTML: '<script>alert(1)</script>',
                style: 'color:red',
                onLoad: 'alert(1)',
                key: 'stolen',
              } as unknown as { name: string; content: string },
            },
          ],
        })}
      />,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
      { name: 'app-version', content: '1.2.3' },
    ]);
  });

  it('skips unusable entries individually and never throws', () => {
    const tags: unknown[] = [
      null,
      'not a tag',
      42,
      [],
      {},
      { meta: null },
      { meta: 'nope' },
      { meta: [] },
      { link: null },
      // No content says nothing.
      { meta: { name: 'app-version' } },
      { meta: { name: 'app-version', content: '' } },
      // No name or property means no identity a child could override.
      { meta: { content: 'orphaned' } },
      // Non-string values are dropped rather than coerced.
      { meta: { name: 'app-version', content: 123 } },
      { meta: { name: { toString: () => 'x' }, content: 'nope' } },
      { link: { rel: 'alternate' } },
      { link: { href: 'https://example.com/feed.xml' } },
      { link: { rel: 'alternate', href: '' } },
      // A usable one at the end, to prove the bad entries only cost themselves.
      { meta: { name: 'app-version', content: '1.2.3' } },
    ];

    const collector = collect(
      <UnirendHead
        envelope={
          {
            meta: { page: { title: 'Home', tags } },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    expect(collector.title).toBe('Home');
    expect(collector.metas).toEqual([
      { name: 'app-version', content: '1.2.3' },
    ]);
    expect(collector.links).toEqual([]);
  });

  it('ignores a tags value that is not an array', () => {
    for (const [index, value] of [
      'nope',
      42,
      true,
      {},
      { 0: { meta: { name: 'app-version', content: '1.2.3' } } },
      null,
    ].entries()) {
      const collector = collect(
        <UnirendHead
          key={`bad-tags-${index}`}
          envelope={
            {
              meta: { page: { title: 'Home', tags: value } },
            } as unknown as PageSuccessResponse<null>
          }
        />,
      );

      expect(collector.title).toBe('Home');
      expect(collector.metas).toEqual([]);
      expect(collector.links).toEqual([]);
    }
  });

  it('renders entries on the client path too', () => {
    const html = renderToString(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Home description',
          tags: [
            { meta: { name: 'app-version', content: '1.2.3' } },
            {
              link: { rel: 'alternate', href: 'https://example.com/feed.xml' },
            },
          ],
        })}
      />,
    );

    expect(html).toContain('name="app-version"');
    expect(html).toContain('content="1.2.3"');
    expect(html).toContain('href="https://example.com/feed.xml"');
  });
});

describe('UnirendHead envelope projection (client render path)', () => {
  /**
   * With no provider the context collector is null, which is the client path: the merged child
   * list is returned as real elements for React to hoist. Rendering it to a string is how this
   * suite reads back what the browser would hoist into <head>.
   */
  function renderClientPath(element: React.ReactElement): string {
    return renderToString(element);
  }

  it('renders the generated tags for React to hoist', () => {
    const html = renderClientPath(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)} />,
    );

    expect(html).toContain('<title>Home - My App</title>');
    expect(html).toContain('name="description" content="Envelope description"');
    expect(html).toContain('name="keywords" content="envelope, metadata"');
    expect(html).toContain('property="og:title" content="Home OG title"');
    expect(html).toContain(
      'property="og:description" content="Home OG description"',
    );
    expect(html).toContain(
      'property="og:image" content="https://example.com/og.png"',
    );
    expect(html).toContain('rel="canonical" href="https://example.com/"');
  });

  it('renders only the child tag for a key the child claims', () => {
    const html = renderClientPath(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)}>
        <meta name="description" content="Something more specific" />
      </UnirendHead>,
    );

    expect(html).toContain(
      'name="description" content="Something more specific"',
    );
    expect(html).not.toContain('Envelope description');
    // The keys the child did not claim still come from the envelope.
    expect(html).toContain('property="og:title" content="Home OG title"');
  });

  it('renders nothing extra for a malformed envelope, same as the server path', () => {
    const malformed: unknown[] = [
      'not an envelope',
      42,
      [],
      { meta: { page: 'nope' } },
    ];

    for (const value of malformed) {
      const html = renderClientPath(
        <UnirendHead envelope={value as PageSuccessResponse<null>} />,
      );

      expect(html).not.toContain('<title');
      expect(html).not.toContain('<meta');
      expect(html).not.toContain('<link');
    }
  });

  it('renders an entry whose attributes React would throw on, minus those attributes', () => {
    // The client path is where these actually reach React. A string `style` throws there ("the
    // style prop expects a mapping from style properties to values"), which is the whole render
    // gone rather than one tag missing, so the projection has to have stripped it already.
    const html = renderClientPath(
      <UnirendHead
        envelope={
          {
            meta: {
              page: {
                title: 'Home',
                tags: [
                  {
                    meta: {
                      name: 'app-version',
                      content: '1.2.3',
                      style: 'color:red',
                      children: 'injected',
                    },
                  },
                  {
                    link: {
                      rel: 'alternate',
                      href: 'https://example.com/feed.xml',
                      style: 'visibility:hidden',
                    },
                  },
                ],
              },
            },
          } as unknown as PageSuccessResponse<null>
        }
      />,
    );

    expect(html).toContain('name="app-version" content="1.2.3"');
    expect(html).toContain(
      'rel="alternate" href="https://example.com/feed.xml"',
    );
    // Not asserted on the word `style` itself: the hidden marker template legitimately has one.
    expect(html).not.toContain('color:red');
    expect(html).not.toContain('visibility');
    expect(html).not.toContain('injected');
  });

  it('keeps html and body elements out of the rendered React output', () => {
    const html = renderClientPath(
      <UnirendHead envelope={createSuccessEnvelope(FULL_METADATA)}>
        {/* eslint-disable-next-line jsx-a11y/html-has-lang */}
        <html className="dark" />
        <body className="bg-slate-900" />
      </UnirendHead>,
    );

    expect(html).not.toContain('<html');
    expect(html).not.toContain('<body');
    expect(html).toContain('<title>Home - My App</title>');
  });
});
