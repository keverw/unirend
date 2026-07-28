/* eslint-disable jsx-a11y/html-has-lang */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { overrideDevMode } from 'lifecycleion/dev-mode';
import { UnirendHead, _test } from './UnirendHead';
import { UnirendHeadProvider } from './UnirendHeadProvider';
import { scanHeadKeys } from './head-keys';
import { filterRenderableHeadChildren } from './head-children';
import type { HeadCollector } from './context';
import { TEMPLATE_META_MARKER_ATTRIBUTE } from '../consts';

let nextScopeID = 0;

function createEmptyCollector(): HeadCollector {
  return {
    title: '',
    metas: [],
    links: [],
    htmlAttrs: {},
    bodyAttrs: {},
  };
}

describe('UnirendHead SSR Collection & Merging', () => {
  it('serializes style objects in SSR correctly', () => {
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <html
            style={{ backgroundColor: 'red', fontSize: 16, opacity: 0.8 }}
          />
          <body style={'color: blue;' as any} />
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.htmlAttrs.style).toBe(
      'background-color:red;font-size:16px;opacity:0.8',
    );
    expect(collector.bodyAttrs.style).toBe('color: blue;');
  });

  it('collects titles using last-write-wins', () => {
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <title>Parent Title</title>
        </UnirendHead>
        <UnirendHead>
          <title>Child Title</title>
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.title).toBe('Child Title');
  });

  it('accumulates meta and link tags', () => {
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <meta name="description" content="Parent Description" />
          <link rel="canonical" href="https://example.com/parent" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Child Description" />
          <meta name="keywords" content="react, ssr" />
          <link rel="canonical" href="https://example.com/child" />
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.metas).toEqual([
      { name: 'description', content: 'Parent Description' },
      { name: 'description', content: 'Child Description' },
      { name: 'keywords', content: 'react, ssr' },
    ]);
    expect(collector.links).toEqual([
      { rel: 'canonical', href: 'https://example.com/parent' },
      { rel: 'canonical', href: 'https://example.com/child' },
    ]);
  });

  it('merges class names on html and body tags', () => {
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <html className="font-sans theme-light" />
          <body className="bg-white" />
        </UnirendHead>
        <UnirendHead>
          <html className="theme-light theme-dark text-lg" />
          <body className="text-gray-900 bg-white" />
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    // Classes should be unioned and deduplicated
    expect(collector.htmlAttrs.class).toBe(
      'font-sans theme-light theme-dark text-lg',
    );
    expect(collector.bodyAttrs.class).toBe('bg-white text-gray-900');
  });

  it('overwrites standard attributes using last-write-wins', () => {
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <html lang="en" data-theme="light" />
        </UnirendHead>
        <UnirendHead>
          <html lang="es" data-theme="dark" />
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.htmlAttrs.lang).toBe('es');
    expect(collector.htmlAttrs['data-theme']).toBe('dark');
  });

  it('maps httpEquiv onto the http-equiv attribute', () => {
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <meta httpEquiv="refresh" content="30" />
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    // Left as-is, this serializes to an httpEquiv="" attribute, which no parser reads as
    // http-equiv: the tag would do nothing, and it could never match the template's
    // http-equiv baseline to override it. Unlike charSet or crossOrigin, the two spellings
    // differ by a hyphen, so HTML's case-insensitive attribute matching doesn't save it.
    expect(collector.metas).toEqual([
      { 'http-equiv': 'refresh', content: '30' },
    ]);
  });

  it('flattens title children to text, contributing nothing for a non-text node', () => {
    // A title is text, so a number interpolated into it is part of the string. An element is not
    // something a title can carry, and contributing "[object Object]" for it would be worse than
    // contributing nothing.
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <title>
            {'Page '}
            {42}
            {<span key="ignored">dropped</span>}
            {' - My App'}
          </title>
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.title).toBe('Page 42 - My App');
  });

  it('merges multiple html tags within the same UnirendHead component', () => {
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <html className="parent" lang="en" />
          <html className="child" lang="es" />
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.htmlAttrs.class).toBe('parent child');
    expect(collector.htmlAttrs.lang).toBe('es');
  });

  it('ignores a script or style child, and still collects the head tags beside it', () => {
    // The server has no collector field for either, so neither reaches the head. Pinned alongside
    // the client half below, since the two ignoring it is the whole point: a script that is absent
    // from the SSR HTML and present after hydration is a mismatch rather than a feature.
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <title>Home</title>
          <script src="/analytics.js" />
          <style>{'body { color: red }'}</style>
          <meta name="description" content="Home description" />
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.title).toBe('Home');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
    ]);
    expect(collector.links).toEqual([]);
  });

  it('walks through a fragment, at any depth', () => {
    // A fragment is the absence of a level rather than one, so the tags inside it are collected as
    // though written in its place. The client always rendered these, since React hoists whatever
    // renders, so before this the same JSX produced a full head in SPA mode and an empty one in
    // SSR.
    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <>
            <title>Home</title>
            <>
              <meta name="description" content="Home description" />
              <link rel="canonical" href="https://example.com/" />
            </>
            <html lang="en" />
          </>
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.title).toBe('Home');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
    ]);
    expect(collector.links).toEqual([
      { rel: 'canonical', href: 'https://example.com/' },
    ]);
    expect(collector.htmlAttrs.lang).toBe('en');
  });

  it('does not walk into a component, which has not rendered yet', () => {
    // The one case a synchronous walk cannot serve: the element's type is a function, and its tags
    // do not exist until React renders it. Reuse goes through the component rendering its own
    // UnirendHead, which the next test covers.
    function SharedMetas() {
      return <meta name="description" content="Home description" />;
    }

    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <title>Home</title>
          <SharedMetas />
        </UnirendHead>
      </UnirendHeadProvider>,
    );

    expect(collector.title).toBe('Home');
    expect(collector.metas).toEqual([]);
  });

  it('collects a component that renders its own UnirendHead', () => {
    // The supported way to share tags, and the reason the case above needs no rescuing: several
    // instances is the design, so a component contributing its own head is ordinary usage.
    function SharedMetas() {
      return (
        <UnirendHead>
          <meta name="description" content="Home description" />
        </UnirendHead>
      );
    }

    const collector = createEmptyCollector();

    renderToString(
      <UnirendHeadProvider collector={collector}>
        <UnirendHead>
          <title>Home</title>
        </UnirendHead>
        <SharedMetas />
      </UnirendHeadProvider>,
    );

    expect(collector.title).toBe('Home');
    expect(collector.metas).toEqual([
      { name: 'description', content: 'Home description' },
    ]);
  });
});

describe('the development-only warning for an unmanaged child', () => {
  afterEach(() => {
    overrideDevMode(false);
  });

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

  function renderChildren(children: React.ReactNode): string[] {
    return captureWarnings(() => {
      renderToString(
        <UnirendHeadProvider collector={createEmptyCollector()}>
          <UnirendHead>{children}</UnirendHead>
        </UnirendHeadProvider>,
      );
    });
  }

  it('names an element by its tag', () => {
    overrideDevMode(true);

    const warnings = renderChildren(
      <>
        <title>Home</title>
        <div>Child</div>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('<div> is not a tag UnirendHead manages');
    expect(warnings[0]).toContain('A fragment is walked through');
  });

  it('names a component, since that is the thing to go looking for', () => {
    overrideDevMode(true);

    function SharedMetas() {
      return null;
    }

    const warnings = renderChildren(<SharedMetas />);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('<SharedMetas />');
    expect(warnings[0]).toContain('Give it its own UnirendHead');
  });

  it('points a script and a style at where they belong', () => {
    overrideDevMode(true);

    const warnings = renderChildren(
      <>
        <script src="/analytics.js" />
        <style>{'body { color: red }'}</style>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('<script>, <style> are not tags');
    expect(warnings[0]).toContain('templateSlots');
  });

  it('says nothing for the tags it manages, a fragment included', () => {
    overrideDevMode(true);

    expect(
      renderChildren(
        <>
          <title>Home</title>
          <meta name="description" content="Home description" />
          <link rel="canonical" href="https://example.com/" />
          <html lang="en" />
          <body className="page" />
        </>,
      ),
    ).toEqual([]);
  });

  it('names a wrapped component, which carries no function type', () => {
    // memo(), forwardRef(), and lazy() make the element's type an object, so a plain function test
    // misses all three and falls through to the vaguest name this has. That is the worst place to
    // lose the name: the message deduplicates on what it prints, so three differently wrapped
    // components would collapse into one entry naming none of them.
    //
    // lazy() is the one that has no name to recover, so it gets its own tests below.
    overrideDevMode(true);

    const Memoized = React.memo(function MemoizedMetas() {
      return null;
    });

    const Forwarded = React.forwardRef<HTMLDivElement>(
      function ForwardedMetas() {
        return null;
      },
    );

    const warnings = renderChildren(
      <>
        <Memoized />
        <Forwarded />
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('<MemoizedMetas />');
    expect(warnings[0]).toContain('<ForwardedMetas />');
  });

  it('reads an unnamed lazy as a component rather than as an element', () => {
    // A lazy is the wrapper that cannot be unwrapped to a name: it holds `_payload` and `_init`
    // rather than the component, and the component is exactly what has not loaded. Recognizing
    // the shape is all there is to do, and it is worth doing — "an element" says nothing about
    // what kind of mistake this is, while "a component" points at the fix the message then gives.
    overrideDevMode(true);

    const Lazy = React.lazy(() =>
      Promise.resolve<{ default: React.ComponentType }>({
        default: function LazyMetas() {
          return null;
        },
      }),
    );

    const warnings = renderChildren(<Lazy />);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'a component is not a tag UnirendHead manages',
    );
    expect(warnings[0]).toContain('Give it its own UnirendHead');
  });

  it('prefers a displayName over the function name underneath it', () => {
    // displayName comes first at every level of the unwrapping, since that is what a component
    // carries when the function behind it is anonymous or minified into something meaningless.
    overrideDevMode(true);

    function Metas() {
      return null;
    }

    Metas.displayName = 'SharedMetas';

    const warnings = renderChildren(<Metas />);

    expect(warnings[0]).toContain('<SharedMetas />');
    expect(warnings[0]).not.toContain('<Metas />');
  });

  it('falls back to "an element" for a type it cannot place at all', () => {
    // Suspense is a symbol rather than a function or a wrapper object, so every branch above it
    // misses. It still has to name the child something rather than throw on the way to the
    // message, which is the only promise this fallback makes.
    overrideDevMode(true);

    const warnings = renderChildren(
      <React.Suspense fallback={null}>
        <title>Home</title>
      </React.Suspense>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('an element is not a tag UnirendHead manages');
  });

  it('counts the names it prints, not the children it found', () => {
    // Two of one kind is one name, so the sentence has to stay singular or it disagrees with the
    // list right beside it.
    overrideDevMode(true);

    const warnings = renderChildren(
      <>
        <div>One</div>
        <div>Two</div>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('<div> is not a tag');
    expect(warnings[0]).not.toContain('are not tags');
  });

  it('stays silent in production', () => {
    overrideDevMode(false);

    expect(renderChildren(<div>Child</div>)).toEqual([]);
  });
});

describe('the head keys a child claims', () => {
  /**
   * A child written with an attribute spelling TSX will not accept, which is the whole of what is
   * under test: `REL` is a `rel` to the browser, and nothing stops a page from writing it.
   */
  function oddChild(
    type: 'meta' | 'link',
    props: Record<string, string>,
  ): React.ReactElement {
    return React.createElement(type, props);
  }

  it('claims the key of an identity attribute written in any casing', () => {
    // HTML matches attribute names case-insensitively, and React's setAttribute lands on the same
    // attribute the browser would, so `REL` reaches the head as a `rel` on both sides. A property
    // lookup is the odd one out: read as written, the child would claim no key at all, override
    // no envelope field, and be invisible to the duplicate warning, while its tag shipped beside
    // the one it was meant to replace.
    const scan = scanHeadKeys([
      oddChild('link', { REL: 'canonical', HREF: 'https://example.com/' }),
      oddChild('meta', { NAME: 'description', CONTENT: 'Child description' }),
      oddChild('meta', { 'HTTP-EQUIV': 'content-language', content: 'en' }),
    ]);

    expect([...scan.claimed].sort()).toEqual([
      'http-equiv=content-language',
      'name=description',
      'rel=canonical',
    ]);
    expect(scan.values.get('rel=canonical')).toBe('https://example.com/');
    expect(scan.values.get('name=description')).toBe('Child description');
  });

  it('keeps the last spelling when a child writes one attribute two ways', () => {
    // Which is what React leaves in the DOM: it sets each prop in turn, and two casings of one
    // name are one setAttribute target, so the later write is the value the browser ends up with.
    const scan = scanHeadKeys(
      oddChild('meta', { NAME: 'first', name: 'second', content: 'x' }),
    );

    expect([...scan.claimed]).toEqual(['name=second']);
  });

  it('leaves the ordinary spelling untouched', () => {
    const scan = scanHeadKeys(
      <meta name="description" content="Child description" />,
    );

    expect([...scan.claimed]).toEqual(['name=description']);
    expect(scan.values.get('name=description')).toBe('Child description');
  });

  it('keeps a non-identity attribute exactly as React spelled it', () => {
    // crossOrigin and referrerPolicy warn when lowercased, and neither carries an identity, so
    // only the attributes a key is read from are re-keyed.
    const scan = scanHeadKeys(
      oddChild('link', {
        REL: 'preload',
        href: '/hero.png',
        crossOrigin: 'anonymous',
      }),
    );

    expect([...scan.claimed]).toEqual(['rel=preload']);
    expect(scan.values.get('rel=preload')).toBe('/hero.png');
  });
});

describe('the children the client renders', () => {
  it('keeps only the tags React hoists, and drops what is not an element', () => {
    // html and body are managed but never rendered into the root, since a <body> inside a div is
    // invalid DOM. A bare string is passed over the same way, which is what a stray space or an
    // interpolation that rendered to nothing leaves behind.
    const rendered = filterRenderableHeadChildren([
      <title key="t">Home</title>,
      <meta key="m" name="description" content="Home description" />,
      <link key="l" rel="canonical" href="https://example.com/" />,
      <html key="h" lang="en" />,
      <body key="b" className="page" />,
      <div key="d">Body content</div>,
      '  ',
      null,
    ]);

    expect(
      rendered.map((child) =>
        React.isValidElement(child) ? child.type : child,
      ),
    ).toEqual(['title', 'meta', 'link']);
  });
});

describe('UnirendHead Client-side Helpers', () => {
  const {
    areRecordsEqual,
    areHeadKeyMapsEqual,
    areMessageListsEqual,
    mergeHeadKeyValues,
    serializeStyleObject,
    toHeadAttributes,
    applyAttributes,
    captureInitialAttrs,
    getInitialHTMLAttrs,
    getInitialBodyAttrs,
    resetInitialAttrs,
    parseStyleString,
    getRegisteredList,
    updateDOM,
    captureTemplateMetas,
    reconcileTemplateMetas,
    areKeyListsEqual,
    getMetaKeysFromChildren,
    getTemplateMetaNodes,
    resetTemplateMetas,
  } = _test;

  function createMockElement(initialAttrs: Record<string, string> = {}) {
    const attributes = Object.entries(initialAttrs).map(([name, value]) => ({
      name,
      value,
    }));
    const mockStyle = {
      properties: {} as Record<string, string>,
      setProperty(name: string, val: string) {
        this.properties[name] = val;
      },
      removeProperty(name: string) {
        delete this.properties[name];
      },
    };

    if (initialAttrs.style) {
      const parsed = parseStyleString(initialAttrs.style);
      for (const [k, v] of Object.entries(parsed)) {
        mockStyle.setProperty(k, v);
      }
    }

    return {
      style: mockStyle,
      attributes: attributes as any,
      getAttribute(key: string) {
        const attr = (this.attributes as any[]).find(
          (a: any) => a.name === key,
        );
        return attr ? attr.value : null;
      },
      setAttribute(key: string, value: string) {
        const existing = (this.attributes as any[]).find(
          (a: any) => a.name === key,
        );
        if (existing) {
          existing.value = value;
        } else {
          (this.attributes as any[]).push({ name: key, value });
        }
      },
      removeAttribute(key: string) {
        this.attributes = (this.attributes as any[]).filter(
          (a: any) => a.name !== key,
        );
      },
    };
  }

  describe('areRecordsEqual', () => {
    it('returns true for identical references or both null', () => {
      const rec = { a: '1' };
      expect(areRecordsEqual(rec, rec)).toBe(true);
      expect(areRecordsEqual(null, null)).toBe(true);
    });

    it('returns false when one is null', () => {
      expect(areRecordsEqual({ a: '1' }, null)).toBe(false);
      expect(areRecordsEqual(null, { a: '1' })).toBe(false);
    });

    it('returns false for different number of keys', () => {
      expect(areRecordsEqual({ a: '1' }, { a: '1', b: '2' })).toBe(false);
    });

    it('returns false if a key value differs', () => {
      expect(areRecordsEqual({ a: '1' }, { a: '2' })).toBe(false);
    });

    it('returns true if keys and values match exactly', () => {
      expect(areRecordsEqual({ a: '1', b: '2' }, { a: '1', b: '2' })).toBe(
        true,
      );
    });
  });

  // The property that lets a render walk the children once instead of twice: merging two scans is
  // the same answer as scanning the concatenated list, so the split is equivalent by construction
  // rather than by an assumption about the generated tags and the children being disjoint.
  describe('mergeHeadKeyValues', () => {
    it('keeps the first side"s value for a key both carry', () => {
      const merged = mergeHeadKeyValues(
        new Map([['name=description', 'Envelope description']]),
        new Map([['name=description', 'Child description']]),
      );

      expect(merged.get('name=description')).toBe('Envelope description');
    });

    it('carries every key from either side', () => {
      const merged = mergeHeadKeyValues(
        new Map([['title', '']]),
        new Map([['rel=canonical', 'https://example.com/']]),
      );

      expect([...merged.entries()]).toEqual([
        ['title', ''],
        ['rel=canonical', 'https://example.com/'],
      ]);
    });

    it('leaves both inputs alone', () => {
      const first = new Map([['title', '']]);
      const second = new Map([['name=keywords', 'a, b']]);

      mergeHeadKeyValues(first, second);

      expect(first.size).toBe(1);
      expect(second.size).toBe(1);
    });

    it('matches a single scan of the concatenated list', () => {
      // The equivalence stated outright, over children that both share a key with the generated
      // side and add one of their own. If this ever fails, the split walk is no longer safe.
      const generated = [
        <meta key="a" name="description" content="Envelope description" />,
        <link key="b" rel="canonical" href="https://example.com/" />,
      ];

      const children = [
        <meta key="c" name="description" content="Child description" />,
        <meta key="d" name="keywords" content="a, b" />,
      ];

      const combined = scanHeadKeys([...generated, ...children]).values;
      const split = mergeHeadKeyValues(
        scanHeadKeys(generated).values,
        scanHeadKeys(children).values,
      );

      expect([...split.entries()]).toEqual([...combined.entries()]);
    });
  });

  // Gates whether a client re-render syncs the DOM. Answer true when the head actually changed
  // and the head goes stale, answer false when nothing did and every render touches the DOM.
  describe('areHeadKeyMapsEqual', () => {
    it('returns true for the same reference and for two empty maps', () => {
      const keys = new Map([['name=description', 'Home description']]);

      expect(areHeadKeyMapsEqual(keys, keys)).toBe(true);
      expect(areHeadKeyMapsEqual(new Map(), new Map())).toBe(true);
    });

    it('returns false when one map holds a key the other does not', () => {
      expect(
        areHeadKeyMapsEqual(
          new Map([['name=description', 'Home description']]),
          new Map([
            ['name=description', 'Home description'],
            ['rel=canonical', 'https://example.com/'],
          ]),
        ),
      ).toBe(false);
    });

    it('returns false when a key holds a different value', () => {
      expect(
        areHeadKeyMapsEqual(
          new Map([['name=description', 'Home description']]),
          new Map([['name=description', 'Something more specific']]),
        ),
      ).toBe(false);
    });

    it('returns false when the same number of entries are different keys', () => {
      // The size check alone would call these equal, which would leave the head carrying the
      // description after the page swapped it for a canonical.
      expect(
        areHeadKeyMapsEqual(
          new Map([['name=description', 'Home description']]),
          new Map([['name=keywords', 'Home description']]),
        ),
      ).toBe(false);
    });

    it('ignores insertion order, since a key set is not a sequence', () => {
      expect(
        areHeadKeyMapsEqual(
          new Map([
            ['name=description', 'Home description'],
            ['rel=canonical', 'https://example.com/'],
          ]),
          new Map([
            ['rel=canonical', 'https://example.com/'],
            ['name=description', 'Home description'],
          ]),
        ),
      ).toBe(true);
    });
  });

  // Overriding a template meta is a set membership question, which is why this compares as a set
  // rather than in order. Answer true for a list that lost a key and a template meta stays hidden
  // after the page that hid it stopped declaring it.
  describe('areKeyListsEqual', () => {
    it('returns true for the same keys in any order, and for two empty lists', () => {
      expect(areKeyListsEqual([], [])).toBe(true);
      expect(
        areKeyListsEqual(
          ['name=description', 'rel=canonical'],
          ['rel=canonical', 'name=description'],
        ),
      ).toBe(true);
    });

    it('returns false when the lists are different lengths', () => {
      expect(areKeyListsEqual(['name=description'], [])).toBe(false);
    });

    it('returns false when the same number of keys are different keys', () => {
      expect(areKeyListsEqual(['name=description'], ['name=keywords'])).toBe(
        false,
      );
    });
  });

  // The envelope projection's warnings, which do not always change the head: dropping a
  // forbidden `style` leaves the same keys behind, so this is what carries the fix to the sync.
  describe('areMessageListsEqual', () => {
    const first = '[unirend] UnirendHead: meta.page.tags[0] (app-version) …';
    const second = '[unirend] UnirendHead: meta.page.tags[1] (twitter:card) …';

    it('returns true for two empty lists and for equal lists', () => {
      expect(areMessageListsEqual([], [])).toBe(true);
      expect(areMessageListsEqual([first, second], [first, second])).toBe(true);
    });

    it('returns false when the lengths differ', () => {
      expect(areMessageListsEqual([first], [first, second])).toBe(false);
      expect(areMessageListsEqual([first], [])).toBe(false);
    });

    it('returns false when a message changed in place', () => {
      // The case the comparison exists for: the head keys are identical either way, so without
      // this the fixed envelope never reaches the sync and the warning stays on the record.
      expect(areMessageListsEqual([first], [second])).toBe(false);
    });

    it('returns false when the same messages arrive in a different order', () => {
      // Compared in order, since one render produces them in a fixed order and a difference
      // means a different set of entries went wrong.
      expect(areMessageListsEqual([first, second], [second, first])).toBe(
        false,
      );
    });
  });

  describe('serializeStyleObject', () => {
    it('serializes style properties to a kebab-case string', () => {
      const style = {
        backgroundColor: 'red',
        fontSize: 16,
        opacity: 0.8,
        fontWeight: 700,
        color: '',
        margin: null as any,
        padding: undefined as any,
      };
      expect(serializeStyleObject(style)).toBe(
        'background-color:red;font-size:16px;opacity:0.8;font-weight:700',
      );
    });

    it('returns empty string for empty objects', () => {
      expect(serializeStyleObject({})).toBe('');
    });

    it('skips values that are neither a string nor a number', () => {
      // A CSSProperties value is one or the other. Anything else would stringify to something
      // like "[object Object]", which is a declaration the browser drops anyway, so it is left
      // out rather than written into the style attribute where it reads as a real rule.
      const style = {
        color: 'red',
        background: {} as any,
        border: [] as any,
        transform: (() => 'none') as any,
        outline: true as any,
      };

      expect(serializeStyleObject(style)).toBe('color:red');
    });
  });

  describe('toHeadAttributes', () => {
    it('converts React props to standard HTML attributes', () => {
      const props = {
        className: 'my-class',
        lang: 'en',
        style: { color: 'blue', fontSize: 12 },
        disabled: true,
        checked: false,
        'data-active': false,
        contentEditable: true,
        children: 'ignored',
        somethingNull: null,
        somethingUndefined: undefined,
      };

      const result = toHeadAttributes(props);
      expect(result).toEqual({
        class: 'my-class',
        lang: 'en',
        style: 'color:blue;font-size:12px',
        disabled: '',
        checked: 'false',
        'data-active': 'false',
        contentEditable: 'true',
      });
    });

    it('maps boolean false values to "false" override marker for boolean attributes', () => {
      const props = {
        hidden: false,
        disabled: false,
        inert: 'false',
        autoplay: 'true',
      };
      const result = toHeadAttributes(props);
      expect(result).toEqual({
        hidden: 'false',
        disabled: 'false',
        inert: 'false',
        autoplay: '',
      });
    });

    it('stringifies numbers and bigints, which HTML attributes have no other form for', () => {
      expect(
        toHeadAttributes({ 'data-count': 5, 'data-total': 9007199254740993n }),
      ).toEqual({
        'data-count': '5',
        'data-total': '9007199254740993',
      });
    });

    it('falls through to the value rules for a boolean attribute holding neither', () => {
      // The boolean branch only answers for true, false, and their two string spellings. A
      // number on a boolean attribute is not one of those, so it is stringified like any other
      // value rather than being read as present or absent.
      expect(toHeadAttributes({ disabled: 3, hidden: 0 })).toEqual({
        disabled: '3',
        hidden: '0',
      });
    });

    it('drops values with no HTML attribute form rather than coercing them', () => {
      // "[object Object]" is a worse attribute than no attribute, and a function on a head tag is
      // a handler that was never going to survive serialization.
      expect(
        toHeadAttributes({
          lang: 'en',
          'data-config': { theme: 'dark' },
          'data-list': ['a', 'b'],
          onClick: () => 'nope',
        }),
      ).toEqual({ lang: 'en' });
    });
  });

  describe('applyAttributes', () => {
    it('applies, merges, and removes attributes on elements', () => {
      const mockElement = createMockElement({
        lang: 'en',
        'data-old': 'yes',
      });

      const initial = { lang: 'en', 'data-init': 'value' };
      const stack: Record<string, string>[] = [
        { class: 'class1', style: 'color: red' },
        { class: 'class2', style: 'font-size: 14px', lang: 'es' },
      ];

      applyAttributes(mockElement as unknown as HTMLElement, initial, stack);

      const attrsObj = (mockElement.attributes as any[]).reduce(
        (acc: Record<string, string>, attr: any) => {
          acc[attr.name] = attr.value;
          return acc;
        },
        {} as Record<string, string>,
      );

      expect(attrsObj).toEqual({
        lang: 'es',
        'data-init': 'value',
        class: 'class1 class2',
        'data-old': 'yes',
      });

      expect(mockElement.style.properties).toEqual({
        color: 'red',
        'font-size': '14px',
      });
    });

    it('removes boolean attributes when they are overridden with "false"', () => {
      const mockElement = createMockElement({
        hidden: '',
        disabled: '',
      });

      const initial = { hidden: '' };
      const stack: Record<string, string>[] = [
        { disabled: 'false', hidden: 'false' },
      ];

      applyAttributes(mockElement as unknown as HTMLElement, initial, stack);

      const attrsObj = (mockElement.attributes as any[]).reduce(
        (acc: Record<string, string>, attr: any) => {
          acc[attr.name] = attr.value;
          return acc;
        },
        {} as Record<string, string>,
      );

      expect(attrsObj.hidden).toBeUndefined();
      expect(attrsObj.disabled).toBeUndefined();
    });
  });

  describe('captureInitialAttrs', () => {
    let originalWindow: unknown;
    let originalDocument: unknown;

    beforeEach(() => {
      originalWindow = (globalThis as any).window;
      originalDocument = (globalThis as any).document;
      resetInitialAttrs();
    });

    afterEach(() => {
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
      resetInitialAttrs();
    });

    it('does nothing if document is undefined', () => {
      (globalThis as any).document = undefined;
      captureInitialAttrs();
      expect(getInitialHTMLAttrs()).toBeNull();
      expect(getInitialBodyAttrs()).toBeNull();
    });

    it('loads baseline from __UNIREND_TEMPLATE_ATTRS__ when present', () => {
      const mockDocument = {} as any;
      /* eslint-disable @typescript-eslint/naming-convention */
      const mockWindow = {
        __UNIREND_TEMPLATE_ATTRS__: {
          html: { lang: 'en', class: 'theme-light' },
          body: { class: 'bg-white' },
        },
      } as any;
      /* eslint-enable @typescript-eslint/naming-convention */

      (globalThis as any).document = mockDocument;
      (globalThis as any).window = mockWindow;

      captureInitialAttrs();

      expect(getInitialHTMLAttrs()).toEqual({
        lang: 'en',
        class: 'theme-light',
      });
      expect(getInitialBodyAttrs()).toEqual({ class: 'bg-white' });
    });

    it('parses live DOM and filters ignored classes when __UNIREND_TEMPLATE_ATTRS__ is not set', () => {
      const mockDocument = {
        documentElement: {
          attributes: [
            { name: 'lang', value: 'fr' },
            { name: 'class', value: 'static-class dynamic-class' },
          ],
        },
        body: {
          attributes: [
            { name: 'class', value: 'body-static body-dynamic' },
            // A non-class body attribute is recorded exactly as the template wrote it. Only
            // classes go through the ignored-class filter, since only they merge as a union.
            { name: 'data-layout', value: 'wide' },
          ],
        },
      } as any;
      /* eslint-disable @typescript-eslint/naming-convention */
      const mockWindow = {
        __UNIREND_IGNORED_CLASSES__: new Set(['dynamic-class', 'body-dynamic']),
      } as any;
      /* eslint-enable @typescript-eslint/naming-convention */

      (globalThis as any).document = mockDocument;
      (globalThis as any).window = mockWindow;

      captureInitialAttrs();

      expect(getInitialHTMLAttrs()).toEqual({
        lang: 'fr',
        class: 'static-class',
      });
      expect(getInitialBodyAttrs()).toEqual({
        class: 'body-static',
        'data-layout': 'wide',
      });
    });
  });

  describe('parseStyleString', () => {
    it('parses empty and simple style strings', () => {
      expect(parseStyleString('')).toEqual({});
      expect(parseStyleString('color: red; font-size: 12px;')).toEqual({
        color: 'red',
        'font-size': '12px',
      });
    });

    it('correctly handles semicolons inside quotes or parentheses (e.g. data URIs)', () => {
      const style =
        'background-image: url("data:image/png;base64,12;34"); font-family: "Courier;New", Courier;';
      const parsed = parseStyleString(style);
      expect(parsed).toEqual({
        'background-image': 'url("data:image/png;base64,12;34")',
        'font-family': '"Courier;New", Courier',
      });
    });

    it('treats single quotes as quoting too, since CSS accepts either', () => {
      // A single-quoted URL is as ordinary as a double-quoted one, and a semicolon inside it is
      // part of the value. Splitting there would cut the declaration in half.
      const style =
        "background-image: url('data:image/png;base64,12;34'); content: 'a;b'; color: red";

      expect(parseStyleString(style)).toEqual({
        'background-image': "url('data:image/png;base64,12;34')",
        content: "'a;b'",
        color: 'red',
      });
    });
  });

  describe('external mutation isolation and non-clobbering', () => {
    it('does not clobber external classes, styles, or attributes', () => {
      const mockElement = createMockElement({
        class: 'theme-light external-class',
        lang: 'en',
        'data-external': 'yes',
        style: 'color: blue',
      });

      mockElement.style.setProperty('overflow', 'hidden');

      const initial = { class: 'theme-light', lang: 'en', style: 'color: red' };
      const stack = [{ class: 'dark', style: 'font-size: 16px' }];

      applyAttributes(mockElement as unknown as HTMLElement, initial, stack);

      let classes = (mockElement.getAttribute('class') || '').split(/\s+/);
      expect(classes).toContain('theme-light');
      expect(classes).toContain('dark');
      expect(classes).toContain('external-class');

      expect(mockElement.style.properties).toEqual({
        overflow: 'hidden',
        color: 'red',
        'font-size': '16px',
      });

      expect(mockElement.getAttribute('data-external')).toBe('yes');

      applyAttributes(mockElement as unknown as HTMLElement, initial, []);

      classes = (mockElement.getAttribute('class') || '').split(/\s+/);
      expect(classes).toContain('theme-light');
      expect(classes).not.toContain('dark');
      expect(classes).toContain('external-class');

      expect(mockElement.style.properties).toEqual({
        overflow: 'hidden',
        color: 'red',
      });

      expect(mockElement.getAttribute('data-external')).toBe('yes');
    });

    it('removes an attribute a previous run set once no instance still declares it', () => {
      // Only the ones this module calculated. An attribute that came from a component and then
      // went away with it has to come off, or a theme a page set would outlive the page. The
      // external attribute beside it was never ours and stays either way.
      const mockElement = createMockElement({ 'data-external': 'yes' });
      const initial = { lang: 'en' };

      applyAttributes(mockElement as unknown as HTMLElement, initial, [
        { 'data-theme': 'dark' },
      ]);

      expect(mockElement.getAttribute('data-theme')).toBe('dark');

      applyAttributes(mockElement as unknown as HTMLElement, initial, []);

      expect(mockElement.getAttribute('data-theme')).toBeNull();
      expect(mockElement.getAttribute('lang')).toBe('en');
      expect(mockElement.getAttribute('data-external')).toBe('yes');
    });
  });

  describe('client-side render ordering sorting', () => {
    let originalWindow: unknown;
    let originalDocument: unknown;

    beforeEach(() => {
      originalWindow = (globalThis as any).window;
      originalDocument = (globalThis as any).document;
      resetInitialAttrs();
      getRegisteredList().length = 0;
    });

    afterEach(() => {
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
      resetInitialAttrs();
      getRegisteredList().length = 0;
    });

    it('does nothing at all when there is no document to sync to', () => {
      // The module is imported by the server bundle too, where a registration can never exist but
      // the guard is what makes that safe to rely on rather than something to remember.
      (globalThis as any).document = undefined;

      expect(() => updateDOM()).not.toThrow();
    });

    it('folds body attributes and meta keys from every mounted registration', () => {
      // The html half is covered by the ordering tests above. This is the other two things a
      // registration carries into the sync, and the comparator answering something other than
      // "B follows A": markers that report each other as preceding, and one that reports neither.
      const mockHTML = createMockElement();
      const mockBody = createMockElement();
      const mockDocument = {
        documentElement: mockHTML,
        body: mockBody,
      } as any;
      /* eslint-disable @typescript-eslint/naming-convention */
      const mockWindow = {
        __UNIREND_TEMPLATE_ATTRS__: { html: {}, body: {} },
      } as any;
      /* eslint-enable @typescript-eslint/naming-convention */

      (globalThis as any).document = mockDocument;
      (globalThis as any).window = mockWindow;

      // `position` answers with a bit mask. 2 is "the other precedes me", and 0 is the answer for
      // two nodes with no order between them, neither of which the ordering tests below reach.
      const marker = (position: number): any => ({
        isConnected: true,
        compareDocumentPosition: () => position,
      });

      const register = (position: number, bodyClass: string, key: string) => {
        getRegisteredList().push({
          html: null,
          body: { class: bodyClass },
          metaKeys: [key],
          headKeys: new Map(),
          tagMessages: [],
          warningScopeID: (nextScopeID += 1),
          markerRef: { current: marker(position) },
        });
      };

      register(2, 'bg-white', 'name=description');
      register(2, 'text-gray-900', 'rel=canonical');

      updateDOM();

      // Body classes union across instances, exactly as the html ones do.
      let classes = (mockBody.getAttribute('class') || '').split(/\s+/);
      expect(classes).toContain('bg-white');
      expect(classes).toContain('text-gray-900');

      getRegisteredList().length = 0;
      register(0, 'bg-slate-900', 'name=keywords');
      register(0, 'font-sans', 'name=robots');

      updateDOM();

      classes = (mockBody.getAttribute('class') || '').split(/\s+/);
      expect(classes).toContain('bg-slate-900');
      expect(classes).toContain('font-sans');
      expect(classes).not.toContain('bg-white');
    });

    it('sorts active registrations by marker document order', () => {
      const mockHTML = createMockElement();
      const mockBody = createMockElement();
      const mockDocument = {
        documentElement: mockHTML,
        body: mockBody,
      } as any;
      /* eslint-disable @typescript-eslint/naming-convention */
      const mockWindow = {
        __UNIREND_TEMPLATE_ATTRS__: { html: {}, body: {} },
      } as any;
      /* eslint-enable @typescript-eslint/naming-convention */

      (globalThis as any).document = mockDocument;
      (globalThis as any).window = mockWindow;

      const markerA = {
        isConnected: true,
        compareDocumentPosition(other: any) {
          if (other === markerB) {
            return 4;
          }
          return 0;
        },
      } as any;

      const markerB = {
        isConnected: true,
        compareDocumentPosition(other: any) {
          if (other === markerA) {
            return 2;
          }
          return 0;
        },
      } as any;

      getRegisteredList().push({
        html: { lang: 'es' },
        body: null,
        metaKeys: [],
        headKeys: new Map(),
        tagMessages: [],
        warningScopeID: (nextScopeID += 1),
        markerRef: { current: markerB },
      });

      getRegisteredList().push({
        html: { lang: 'en' },
        body: null,
        metaKeys: [],
        headKeys: new Map(),
        tagMessages: [],
        warningScopeID: (nextScopeID += 1),
        markerRef: { current: markerA },
      });

      updateDOM();

      expect(mockHTML.getAttribute('lang')).toBe('es');
    });

    it('correctly resorts when a marker is updated from null to element', () => {
      const mockHTML = createMockElement();
      const mockBody = createMockElement();
      const mockDocument = {
        documentElement: mockHTML,
        body: mockBody,
      } as any;
      /* eslint-disable @typescript-eslint/naming-convention */
      const mockWindow = {
        __UNIREND_TEMPLATE_ATTRS__: { html: {}, body: {} },
      } as any;
      /* eslint-enable @typescript-eslint/naming-convention */

      (globalThis as any).document = mockDocument;
      (globalThis as any).window = mockWindow;

      const markerA = {
        isConnected: true,
        compareDocumentPosition(other: any) {
          if (other === markerB) {
            return 4;
          }
          return 0;
        },
      } as any;

      const markerB = {
        isConnected: true,
        compareDocumentPosition(other: any) {
          if (other === markerA) {
            return 2;
          }
          return 0;
        },
      } as any;

      const regB = {
        html: { lang: 'es' },
        body: null,
        metaKeys: [],
        headKeys: new Map(),
        tagMessages: [],
        warningScopeID: (nextScopeID += 1),
        markerRef: { current: null as any },
      };
      const regA = {
        html: { lang: 'en' },
        body: null,
        metaKeys: [],
        headKeys: new Map(),
        tagMessages: [],
        warningScopeID: (nextScopeID += 1),
        markerRef: { current: null as any },
      };

      getRegisteredList().push(regB);
      getRegisteredList().push(regA);

      updateDOM();
      expect(mockHTML.getAttribute('lang')).toBe('en');

      regB.markerRef.current = markerB;
      regA.markerRef.current = markerA;

      updateDOM();

      expect(mockHTML.getAttribute('lang')).toBe('es');
    });
  });

  describe('SPA vs server-rendered baseline template rendering logic', () => {
    let originalWindow: any;

    beforeEach(() => {
      originalWindow = (globalThis as any).window;
    });

    afterEach(() => {
      (globalThis as any).window = originalWindow;
    });

    it('should render the marker template immediately in SPA mode', () => {
      // Simulate SPA mode: no __UNIREND_TEMPLATE_ATTRS__ on window
      (globalThis as any).window = {};

      const html = renderToString(
        <UnirendHead>
          <title>Home</title>
        </UnirendHead>,
      );

      // In SPA mode, the template marker must render immediately. Asserted separately from the
      // title rather than as one substring, since React hoists the title ahead of the marker.
      expect(html).toContain('<template style="display:none"></template>');
      expect(html).toContain('<title>Home</title>');
    });

    it('should NOT render the marker template immediately in server-rendered baseline template mode', () => {
      // Simulate server-rendered baseline template mode: __UNIREND_TEMPLATE_ATTRS__ is present
      (globalThis as any).window = {
        /* eslint-disable @typescript-eslint/naming-convention */
        __UNIREND_TEMPLATE_ATTRS__: { html: {}, body: {} },
        /* eslint-enable @typescript-eslint/naming-convention */
      };

      const html = renderToString(
        <UnirendHead>
          <title>Home</title>
        </UnirendHead>,
      );

      // In server-rendered mode, it must defer template marker to avoid hydration mismatches
      expect(html).not.toContain('<template');
      expect(html).toContain('<title>Home</title>');
    });

    it('renders only the tags it manages into the React root', () => {
      // The client half of the server test above. None of these is a tag UnirendHead collects, so
      // rendering them here would put a script, a style, and a div in the body that the server
      // never emitted, which hydration then has to reconcile.
      (globalThis as any).window = {};

      const html = renderToString(
        <UnirendHead>
          <title>Home</title>
          <script src="/analytics.js" />
          <style>{'body { color: red }'}</style>
          <div>Child</div>
        </UnirendHead>,
      );

      expect(html).not.toContain('<script');
      expect(html).not.toContain('<style');
      expect(html).not.toContain('<div>');
      expect(html).toContain('<title>Home</title>');
    });

    it('keeps html and body out of the root even inside a fragment', () => {
      // The case the old direct-children filter got wrong once fragments became transparent: a
      // <body> rendered inside #root is invalid DOM, and it would now arrive there one level down.
      (globalThis as any).window = {};

      const html = renderToString(
        <UnirendHead>
          <>
            <html lang="en" />
            <body className="page" />
            <title>Home</title>
          </>
        </UnirendHead>,
      );

      expect(html).not.toContain('<html');
      expect(html).not.toContain('<body');
      expect(html).toContain('<title>Home</title>');
    });

    it('renders mapped children and keyed fragments', () => {
      // Every other test here writes literal JSX. A list built with .map() and an explicit keyed
      // React.Fragment are the two shapes a rewrite of the walker would be most likely to break,
      // and a lost key shows up as a console error rather than a failed assertion.
      (globalThis as any).window = {};

      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.map((arg) => String(arg)).join(' '));
      };

      let html = '';

      try {
        html = renderToString(
          <UnirendHead>
            <React.Fragment key="grouped">
              <title>Home</title>
            </React.Fragment>
            {['a', 'b'].map((name) => (
              <meta key={name} name={name} content={name} />
            ))}
          </UnirendHead>,
        );
      } finally {
        console.error = originalError;
      }

      expect(errors).toEqual([]);
      expect(html).toContain('<title>Home</title>');
      expect(html).toContain('name="a"');
      expect(html).toContain('name="b"');
    });

    it('renders the tags inside a fragment, as the server now collects them', () => {
      // A fragment is not a level of nesting, so both sides walk through it. Pinned on the client
      // as well because this half already worked: React hoists whatever renders, which is exactly
      // what made the server-only gap invisible.
      (globalThis as any).window = {};

      const html = renderToString(
        <UnirendHead>
          <>
            <title>Home</title>
            <meta name="description" content="Home description" />
          </>
        </UnirendHead>,
      );

      expect(html).toContain('<title>Home</title>');
      expect(html).toContain('name="description"');
    });
  });

  describe('template meta reconciliation', () => {
    let originalWindow: unknown;
    let originalDocument: unknown;

    // Minimal stand-in for the parts of the head this code touches. The suite has no DOM, and
    // the existing helpers here mock document the same way.
    function createMockHead() {
      const children: any[] = [];

      return {
        children,
        appendChild(element: any) {
          children.push(element);
          element.isConnected = true;
          return element;
        },
        querySelectorAll(selector: string) {
          const isMarkerQuery = selector.includes('[');

          return children.filter(
            (child) =>
              child.tagName === 'META' &&
              (!isMarkerQuery ||
                child.hasAttribute(TEMPLATE_META_MARKER_ATTRIBUTE)),
          );
        },
      };
    }

    function createMockMeta(head: any, attrs: Record<string, string> = {}) {
      const store: Record<string, string> = { ...attrs };

      const element: any = {
        tagName: 'META',
        isConnected: false,
        getAttribute: (key: string) => (key in store ? store[key] : null),
        setAttribute: (key: string, value: string) => {
          store[key] = value;
        },
        hasAttribute: (key: string) => key in store,
        remove: () => {
          const index = head.children.indexOf(element);

          if (index !== -1) {
            head.children.splice(index, 1);
          }

          element.isConnected = false;
        },
      };

      return element;
    }

    /**
     * Stand up a served page: `served` is what's in the head (template metas carry the marker,
     * the way injectContent writes them), and `baseline` is the global the server ships,
     * describing index.html as authored.
     */
    function setupPage(options: {
      served: Array<Record<string, string>>;
      baseline?: Array<Record<string, string>>;
    }) {
      const head = createMockHead();

      for (const attrs of options.served) {
        head.appendChild(createMockMeta(head, attrs));
      }

      const mockDocument = {
        head,
        createElement: () => createMockMeta(head),
      } as any;

      /* eslint-disable @typescript-eslint/naming-convention */
      const mockWindow = {
        __UNIREND_TEMPLATE_METAS__: options.baseline,
      } as any;
      /* eslint-enable @typescript-eslint/naming-convention */

      (globalThis as any).document = mockDocument;
      (globalThis as any).window = mockWindow;

      return head;
    }

    const metasInHead = (head: any, name: string) =>
      head.children.filter((child: any) => child.getAttribute('name') === name);

    // The baseline is grouped under a serialized identity set, so a group reads back as the list
    // of identities it covers rather than as one string that has to be spelled exactly.
    const groupedIdentities = (nodes: Map<string, unknown> | null) =>
      Array.from(nodes?.keys() ?? []).map((key) => JSON.parse(key) as string[]);

    beforeEach(() => {
      originalWindow = (globalThis as any).window;
      originalDocument = (globalThis as any).document;
      resetTemplateMetas();
    });

    afterEach(() => {
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
      resetTemplateMetas();
    });

    it('rebuilds the half of a split group the server stripped', () => {
      // Two template metas share `name=site` but carry different properties, so the server strips
      // them independently. Grouped by that first identity, the survivor would be read as proof
      // that both were served, and the stripped one would never be rebuilt: gone for good the
      // moment the page stopped overriding it.
      const head = setupPage({
        served: [
          // Only the og:other one survived the merge, and it is the marked node.
          {
            name: 'site',
            property: 'og:other',
            content: '#other',
            [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
          },
          // The page's own tag, unmarked, React's to manage.
          { property: 'og:site_name', content: '#page' },
        ],
        baseline: [
          { name: 'site', property: 'og:site_name', content: '#template' },
          { name: 'site', property: 'og:other', content: '#other' },
        ],
      });

      captureTemplateMetas();

      // While the page overrides og:site_name, only the survivor is in the head.
      reconcileTemplateMetas(new Set(['property=og:site_name']));
      expect(metasInHead(head, 'site')).toHaveLength(1);

      // Navigating away: the stripped one has to come back, and the survivor stays.
      reconcileTemplateMetas(new Set());

      const restored = metasInHead(head, 'site');
      expect(restored).toHaveLength(2);
      expect(
        restored.map((meta: any) => meta.getAttribute('property')).sort(),
      ).toEqual(['og:other', 'og:site_name']);
    });

    it('does not read one identity as two because the value contains the separator', () => {
      // The grouping key is a serialized identity set rather than a joined string, so a `name`
      // spelling out what a two-identity meta's key list looks like is still one identity. Joined
      // on a pipe these two are one group, the marked survivor stands in for the stripped one, and
      // the stripped one is never rebuilt. A meta name like this is nobody's real index.html, but
      // the value is arbitrary text and the encoding is free to get right.
      const head = setupPage({
        served: [
          {
            name: 'a',
            property: 'b',
            content: '#two',
            [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
          },
          // The page's own override of the other one, unmarked.
          { name: 'a|property=b', content: '#page' },
        ],
        baseline: [
          { name: 'a|property=b', content: '#one' },
          { name: 'a', property: 'b', content: '#two' },
        ],
      });

      const templateMetas = () =>
        head.children.filter((child: any) =>
          child.hasAttribute(TEMPLATE_META_MARKER_ATTRIBUTE),
        );

      captureTemplateMetas();

      reconcileTemplateMetas(new Set(['name=a|property=b']));
      expect(templateMetas()).toHaveLength(1);

      reconcileTemplateMetas(new Set());
      expect(
        templateMetas()
          .map((meta: any) => meta.getAttribute('content'))
          .sort(),
      ).toEqual(['#one', '#two']);
    });

    it('steps a dual-identity template meta aside for either identity', () => {
      // Filed under `name=site`, its first identity, but a page declaring og:site_name overrides
      // it just the same, matching what the server's template merge strips.
      const head = setupPage({
        served: [
          {
            name: 'site',
            property: 'og:site_name',
            content: '#template',
            [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
          },
        ],
        baseline: [
          { name: 'site', property: 'og:site_name', content: '#template' },
        ],
      });

      captureTemplateMetas();

      reconcileTemplateMetas(new Set(['property=og:site_name']));
      expect(metasInHead(head, 'site')).toHaveLength(0);

      // And comes back once nothing declares it.
      reconcileTemplateMetas(new Set());
      expect(metasInHead(head, 'site')).toHaveLength(1);
    });

    it('restores a template meta when the page overriding it navigates away', () => {
      // Landing page overrides theme-color, so the server stripped the template's copy from
      // the served head and only the page's (unmarked, React-hydrated) meta is present.
      const head = setupPage({
        served: [
          { name: 'theme-color', content: '#page' },
          {
            name: 'viewport',
            content: 'width=device-width',
            [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
          },
        ],
        baseline: [
          { name: 'theme-color', content: '#template' },
          { name: 'viewport', content: 'width=device-width' },
        ],
      });

      captureTemplateMetas();

      // While the page overrides it, the template's copy stays out of the head.
      reconcileTemplateMetas(new Set(['name=theme-color']));
      expect(metasInHead(head, 'theme-color')).toHaveLength(1);
      expect(metasInHead(head, 'theme-color')[0].getAttribute('content')).toBe(
        '#page',
      );

      // Navigating to a page that declares no theme-color: React unmounts its meta, and the
      // template's baseline has to come back rather than leaving the page with none at all.
      metasInHead(head, 'theme-color')[0].remove();
      reconcileTemplateMetas(new Set());

      expect(metasInHead(head, 'theme-color')).toHaveLength(1);
      expect(metasInHead(head, 'theme-color')[0].getAttribute('content')).toBe(
        '#template',
      );
    });

    it('removes the template meta when a page starts overriding it', () => {
      // Landing page overrides nothing, so the template's theme-color is in the served head.
      const head = setupPage({
        served: [
          {
            name: 'theme-color',
            content: '#template',
            [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
          },
          {
            name: 'viewport',
            content: 'width=device-width',
            [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
          },
        ],
        baseline: [
          { name: 'theme-color', content: '#template' },
          { name: 'viewport', content: 'width=device-width' },
        ],
      });

      captureTemplateMetas();
      reconcileTemplateMetas(new Set());
      expect(metasInHead(head, 'theme-color')).toHaveLength(1);

      // Navigate to a page that declares theme-color: React appends its own, and the template's
      // has to step aside. Otherwise both are served, the template's first, and since consumers
      // read the first match the override would silently do nothing.
      head.appendChild(
        createMockMeta(head, { name: 'theme-color', content: '#page' }),
      );
      reconcileTemplateMetas(new Set(['name=theme-color']));

      expect(metasInHead(head, 'theme-color')).toHaveLength(1);
      expect(metasInHead(head, 'theme-color')[0].getAttribute('content')).toBe(
        '#page',
      );
    });

    it('leaves template metas no page declares alone', () => {
      const head = setupPage({
        served: [
          {
            name: 'viewport',
            content: 'width=device-width',
            [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
          },
        ],
        baseline: [{ name: 'viewport', content: 'width=device-width' }],
      });

      captureTemplateMetas();
      reconcileTemplateMetas(new Set(['name=description']));
      reconcileTemplateMetas(
        new Set(['name=description', 'property=og:title']),
      );

      // Nothing overrides viewport, so it is never touched across any navigation.
      expect(metasInHead(head, 'viewport')).toHaveLength(1);
    });

    it('never adopts a meta React hoisted, only the marked template ones', () => {
      const head = setupPage({
        served: [
          { name: 'description', content: '#page' },
          {
            name: 'viewport',
            content: 'width=device-width',
            [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
          },
        ],
        baseline: [{ name: 'viewport', content: 'width=device-width' }],
      });

      captureTemplateMetas();

      // description is not in the template baseline, so it is React's to manage and this module
      // must not hold a reference to it or remove it.
      const nodes = getTemplateMetaNodes();
      expect(nodes).not.toBeNull();
      expect(groupedIdentities(nodes)).toEqual([['name=viewport']]);

      reconcileTemplateMetas(new Set(['name=description']));
      expect(metasInHead(head, 'description')).toHaveLength(1);
    });

    it('overrides a template meta of either identity a page meta carries', () => {
      // Matches what the server's template merge strips by. Keyed on the first attribute found,
      // the og:site_name identity would be invisible and the template's copy would survive a
      // client-side navigation, sitting ahead of the page's own in document order.
      const keys = getMetaKeysFromChildren([
        <meta
          key="a"
          name="twitter:title"
          property="og:site_name"
          content="Page site name"
        />,
      ]);

      expect(keys).toEqual(['name=twitter:title', 'property=og:site_name']);
    });

    it('treats a repeated meta key as overriding once, so a stale key set is never held', () => {
      // A page can declare the same meta twice (two conditional branches both rendering it).
      const keys = getMetaKeysFromChildren([
        <meta key="a" name="viewport" content="a" />,
        <meta key="b" name="viewport" content="b" />,
      ]);

      expect(keys).toEqual(['name=viewport']);
    });

    it('does not call a duplicate-padded key set equal to a different one', () => {
      // Comparing by length and membership alone would call these equal: same length, and every
      // key of the second is present in the first. The registry would then skip the update and
      // leave the theme-color baseline detached even though the page stopped overriding it.
      expect(
        areKeyListsEqual(
          ['name=viewport', 'name=theme-color'],
          ['name=viewport', 'name=viewport'],
        ),
      ).toBe(false);

      // Order still doesn't matter, since overriding is a set membership question.
      expect(
        areKeyListsEqual(
          ['name=viewport', 'name=theme-color'],
          ['name=theme-color', 'name=viewport'],
        ),
      ).toBe(true);
    });

    it('moves every template meta sharing an identity together, media variants included', () => {
      // The standard light/dark pair: two template metas, one identity. A page declaring
      // theme-color overrides that identity, so both have to step aside — and both have to come
      // back. Tracking only one would strand the other in the head beside the page's override
      // (ahead of it in document order, so the stale template value would win).
      const light = {
        name: 'theme-color',
        media: '(prefers-color-scheme: light)',
        content: '#fff',
        [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
      };
      const dark = {
        name: 'theme-color',
        media: '(prefers-color-scheme: dark)',
        content: '#000',
        [TEMPLATE_META_MARKER_ATTRIBUTE]: '',
      };

      const head = setupPage({
        served: [light, dark],
        baseline: [
          {
            name: 'theme-color',
            media: '(prefers-color-scheme: light)',
            content: '#fff',
          },
          {
            name: 'theme-color',
            media: '(prefers-color-scheme: dark)',
            content: '#000',
          },
        ],
      });

      captureTemplateMetas();
      reconcileTemplateMetas(new Set());
      expect(metasInHead(head, 'theme-color')).toHaveLength(2);

      // Page overrides theme-color: both template copies leave the head.
      head.appendChild(
        createMockMeta(head, { name: 'theme-color', content: '#page' }),
      );
      reconcileTemplateMetas(new Set(['name=theme-color']));

      const overridden = metasInHead(head, 'theme-color');
      expect(overridden).toHaveLength(1);
      expect(overridden[0].getAttribute('content')).toBe('#page');

      // Navigate away: React unmounts its meta and the template's whole set returns.
      overridden[0].remove();
      reconcileTemplateMetas(new Set());

      const restored = metasInHead(head, 'theme-color');
      expect(restored).toHaveLength(2);
      expect(restored.map((meta: any) => meta.getAttribute('media'))).toEqual([
        '(prefers-color-scheme: light)',
        '(prefers-color-scheme: dark)',
      ]);
    });

    it('overrides a template http-equiv meta declared with React httpEquiv spelling', () => {
      const keys = getMetaKeysFromChildren([
        <meta
          key="a"
          httpEquiv="content-security-policy"
          content="default-src 'self'"
        />,
      ]);

      // Must key on the HTML attribute, or the page's meta would never be seen as overriding
      // the template's http-equiv baseline.
      expect(keys).toEqual(['http-equiv=content-security-policy']);
    });

    it('falls back to reading the head when no baseline global was injected (pure SPA)', () => {
      // No server injection, so index.html's metas are still the only ones in the head. This
      // capture happens in the render phase, before React commits and hoists any page metas.
      const head = setupPage({
        served: [
          { name: 'viewport', content: 'width=device-width' },
          { name: 'theme-color', content: '#template' },
        ],
        baseline: undefined,
      });

      captureTemplateMetas();

      const nodes = getTemplateMetaNodes();
      expect(nodes).not.toBeNull();
      expect(groupedIdentities(nodes)).toEqual([
        ['name=viewport'],
        ['name=theme-color'],
      ]);

      reconcileTemplateMetas(new Set(['name=theme-color']));
      expect(metasInHead(head, 'theme-color')).toHaveLength(0);
      expect(metasInHead(head, 'viewport')).toHaveLength(1);

      reconcileTemplateMetas(new Set());
      expect(metasInHead(head, 'theme-color')).toHaveLength(1);
    });
  });
});
