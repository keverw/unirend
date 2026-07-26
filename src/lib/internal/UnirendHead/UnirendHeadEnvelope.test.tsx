import { describe, it, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { UnirendHead } from './UnirendHead';
import { UnirendHeadProvider } from './UnirendHeadProvider';
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
