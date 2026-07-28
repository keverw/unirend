import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { overrideDevMode } from 'lifecycleion/dev-mode';
import { UnirendHead, _test } from './UnirendHead';
import { UnirendHeadProvider } from './UnirendHeadProvider';
import type { HeadCollector } from './context';
import {
  collectDuplicateHeadKeys,
  formatDuplicateHeadWarning,
} from './duplicate-head-warning';
import type { SeenHeadKeys } from './duplicate-head-warning';
import {
  isRepeatableHeadKey,
  setRepeatableHeadKeys,
} from './repeatable-head-keys';
import { _test as tagsTest } from './page-metadata-tags';
import type { PageSuccessResponse } from '../../api-envelope/api-envelope-types';

function createEmptyCollector(): HeadCollector {
  return {
    title: '',
    metas: [],
    links: [],
    htmlAttrs: {},
    bodyAttrs: {},
  };
}

describe('duplicate head key helpers', () => {
  describe('isRepeatableHeadKey', () => {
    it('treats the repeatable OpenGraph objects and their sub-properties as repeatable', () => {
      expect(isRepeatableHeadKey('property=og:image')).toBe(true);
      expect(isRepeatableHeadKey('property=og:image:width')).toBe(true);
      expect(isRepeatableHeadKey('property=og:video')).toBe(true);
      expect(isRepeatableHeadKey('property=og:audio:type')).toBe(true);
      expect(isRepeatableHeadKey('property=og:locale:alternate')).toBe(true);
      expect(isRepeatableHeadKey('property=article:tag')).toBe(true);
    });

    it('treats theme-color as repeatable for the light and dark pair', () => {
      expect(isRepeatableHeadKey('name=theme-color')).toBe(true);
    });

    it('treats the single-value metas as not repeatable', () => {
      expect(isRepeatableHeadKey('name=description')).toBe(false);
      expect(isRepeatableHeadKey('name=keywords')).toBe(false);
      expect(isRepeatableHeadKey('property=og:title')).toBe(false);
      expect(isRepeatableHeadKey('http-equiv=content-security-policy')).toBe(
        false,
      );
    });

    it('treats link relations as repeatable except the few that describe the document once', () => {
      expect(isRepeatableHeadKey('rel=preload')).toBe(true);
      expect(isRepeatableHeadKey('rel=icon')).toBe(true);
      expect(isRepeatableHeadKey('rel=alternate')).toBe(true);
      expect(isRepeatableHeadKey('rel=me')).toBe(true);
      expect(isRepeatableHeadKey('rel=canonical')).toBe(false);
      expect(isRepeatableHeadKey('rel=manifest')).toBe(false);
    });

    it('reads the attribute as part of the key, since repeatability is not a property name', () => {
      // `og:image` repeats on `property` and not on `name`, and `theme-color` the other way round.
      // A head tag's identity is the attribute and the value together everywhere in Unirend, and
      // this list is written that way for the same reason: two spellings of a vocabulary are two
      // tags, and only the documented one is the one that legitimately repeats.
      expect(isRepeatableHeadKey('property=og:image')).toBe(true);
      expect(isRepeatableHeadKey('name=og:image')).toBe(false);
      expect(isRepeatableHeadKey('name=theme-color')).toBe(true);
      expect(isRepeatableHeadKey('property=theme-color')).toBe(false);
    });
  });

  // The list this reads is not the structured-parent list in page-metadata-tags.ts, and must not
  // become it. They share og:image, og:video, and og:audio, which is enough to make merging them
  // look like a tidy-up, and the two disagree in both directions. Each case below is a silent bug
  // if the lists are ever collapsed, so these fail rather than letting one ship.
  describe('repeatable keys versus structured parents', () => {
    const isStructuredParent = (key: string): boolean =>
      tagsTest.structuredParentKeys.has(key);

    it('has structured parents that do not repeat', () => {
      // A Twitter card carries one image and one player, so a second is a mistake worth warning
      // about. They are still structured parents: a child replacing one takes its :width and
      // :height along, or the leftovers would describe a picture nobody is showing.
      for (const key of [
        'name=twitter:image',
        'property=twitter:image',
        'name=twitter:player',
        'property=twitter:player',
      ]) {
        expect(isStructuredParent(key)).toBe(true);
        expect(isRepeatableHeadKey(key)).toBe(false);
      }
    });

    it('has repeatable keys that are not structured parents', () => {
      // og:locale:alternate is spelled exactly like a sub-property of og:locale and is not one. It
      // lists the other locales the page exists in, so it repeats, and a child declaring og:locale
      // has no claim on it.
      expect(isRepeatableHeadKey('property=og:locale:alternate')).toBe(true);
      expect(isStructuredParent('property=og:locale')).toBe(false);
      expect(isStructuredParent('property=og:locale:alternate')).toBe(false);

      for (const key of [
        'property=article:tag',
        'property=book:author',
        'name=theme-color',
      ]) {
        expect(isRepeatableHeadKey(key)).toBe(true);
        expect(isStructuredParent(key)).toBe(false);
      }
    });

    it('recognizes a structured parent on either attribute, unlike repeatability', () => {
      // OpenGraph documents property and Twitter documents name, but each parser takes the other
      // and real pages write it both ways, so the sweep answers to both. Repeatability does not,
      // which is the asymmetry that keeps these two lists from being one.
      expect(isStructuredParent('name=og:image')).toBe(true);
      expect(isStructuredParent('property=og:image')).toBe(true);
      expect(isRepeatableHeadKey('name=og:image')).toBe(false);
      expect(isRepeatableHeadKey('property=og:image')).toBe(true);
    });
  });

  describe('takeWarningScopeID', () => {
    it('never hands out an ID twice', () => {
      // The one property anything asks of it. Two mounted instances holding one ID would read as
      // a single instance to updateDOM(), which collides a key with itself and reports nothing,
      // so the whole duplicate warning goes quiet for that pair.
      const taken = Array.from({ length: 100 }, () =>
        _test.takeWarningScopeID(),
      );

      expect(new Set(taken).size).toBe(taken.length);
    });

    it('is not rewound by resetDuplicateWarnings', () => {
      // The records that key on an ID are derived and can be thrown away freely. The IDs are
      // identity and cannot: rewinding the counter here would hand a fresh registration one a
      // still-mounted instance already holds, which is the collision above. Tidying this reset
      // into "clear everything in this module" is the obvious way to arrive there, and it fails
      // silently, so it is pinned rather than left to the comment on nextWarningScopeID.
      const before = _test.takeWarningScopeID();

      _test.resetDuplicateWarnings();

      expect(_test.takeWarningScopeID()).toBeGreaterThan(before);
    });
  });

  describe('collectDuplicateHeadKeys', () => {
    it('reports nothing for the first instance to claim a key', () => {
      const seen: SeenHeadKeys = new Map();

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'A']]),
          'first',
        ),
      ).toEqual([]);
    });

    it('reports the collision once, naming both values', () => {
      const seen: SeenHeadKeys = new Map();

      collectDuplicateHeadKeys(
        seen,
        new Map([['name=description', 'A']]),
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'B']]),
          'second',
        ),
      ).toEqual([
        {
          key: 'name=description',
          firstValue: 'A',
          secondValue: 'B',
          firstOwner: 'first',
          secondOwner: 'second',
        },
      ]);

      // A third instance does not reprint what the first warning already said.
      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'C']]),
          'third',
        ),
      ).toEqual([]);
    });

    it('reports nothing when the same instance is fed in twice', () => {
      // A server render can replay a subtree for one request, and the record for that request
      // outlives the replay. An instance colliding with itself is not two instances.
      const seen: SeenHeadKeys = new Map();

      collectDuplicateHeadKeys(
        seen,
        new Map([['name=description', 'A']]),
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'A']]),
          'first',
        ),
      ).toEqual([]);

      // A genuinely separate instance still collides, against the replayed value.
      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'B']]),
          'second',
        ),
      ).toEqual([
        {
          key: 'name=description',
          firstValue: 'A',
          secondValue: 'B',
          firstOwner: 'first',
          secondOwner: 'second',
        },
      ]);
    });

    it('stays quiet for a repeatable key', () => {
      const seen: SeenHeadKeys = new Map();

      collectDuplicateHeadKeys(
        seen,
        new Map([['property=og:image', 'one.png']]),
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['property=og:image', 'two.png']]),
          'second',
        ),
      ).toEqual([]);
    });
  });

  describe('formatDuplicateHeadWarning', () => {
    it('names the key and both values', () => {
      const message = formatDuplicateHeadWarning({
        key: 'name=description',
        firstValue: 'Layout description',
        secondValue: 'Page description',
        firstOwner: 'first',
        secondOwner: 'second',
      });

      expect(message).toContain('name=description');
      expect(message).toContain('Layout description');
      expect(message).toContain('Page description');
      expect(message).toContain('setRepeatableHeadKeys');
    });
  });
});

/**
 * Capture what UnirendHead prints while rendering, so a test can assert both that a warning
 * fires and that one does not.
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

function createSuccessEnvelope(page: {
  title: string;
  description: string;
  canonical?: string;
  og?: { image?: string };
}): PageSuccessResponse<null> {
  return {
    status: 'success',
    status_code: 200,
    request_id: 'test-request-id',
    type: 'page',
    data: null,
    meta: { page },
  };
}

describe('UnirendHead duplicate warning (server render)', () => {
  afterEach(() => {
    overrideDevMode(false);
    // Module state, so it would otherwise leak into the next test.
    setRepeatableHeadKeys([]);
  });

  function collectWarnings(tree: React.ReactNode): string[] {
    const collector = createEmptyCollector();

    return captureWarnings(() => {
      renderToString(
        <UnirendHeadProvider collector={collector}>{tree}</UnirendHeadProvider>,
      );
    });
  }

  it('warns when two separate instances declare the same meta', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="Layout description" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Page description" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('name=description');
    expect(warnings[0]).toContain('Layout description');
    expect(warnings[0]).toContain('Page description');
  });

  it('sees a key declared inside a fragment', () => {
    // scanHeadKeys walks through fragments now, so a tag wrapped in one claims its key like any
    // other. Before that it claimed nothing, and this pair went unreported on the server while the
    // client, which renders whatever React hoists, warned about it.
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <>
            <meta name="description" content="Layout description" />
          </>
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Page description" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('name=description');
    expect(warnings[0]).toContain('Layout description');
  });

  it('sees a key whose attribute was written in another casing', () => {
    // `NAME` is a `name` to the browser, so these two really do both ship a description. Read as
    // written it would claim no key at all and this pair would go unreported, which is the same
    // gap the fragment walk above closed, one attribute lower down.
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          {React.createElement('meta', {
            NAME: 'description',
            content: 'Layout description',
          })}
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Page description" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('name=description');
    expect(warnings[0]).toContain('Layout description');
    expect(warnings[0]).toContain('Page description');
  });

  it('warns when two separate instances declare the same canonical link', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <link rel="canonical" href="https://example.com/a" />
        </UnirendHead>
        <UnirendHead>
          <link rel="canonical" href="https://example.com/b" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('rel=canonical');
  });

  it('warns when a canonical is one token of a longer rel on either side', () => {
    // `rel` is a token set, so two canonicals are two canonicals whatever else they name. Without
    // this the two would key differently and the collision the warning exists for would be missed.
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <link rel="canonical" href="https://example.com/a" />
        </UnirendHead>
        <UnirendHead>
          <link rel="alternate CANONICAL" href="https://example.com/b" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('rel=canonical');
    expect(warnings[0]).toContain('"https://example.com/a"');
    expect(warnings[0]).toContain('"https://example.com/b"');
  });

  it('stays quiet for two links sharing only a repeatable token', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <link rel="alternate" href="https://example.com/feed.xml" />
        </UnirendHead>
        <UnirendHead>
          <link rel="alternate icon" href="/favicon.ico" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('never warns in a production build', () => {
    overrideDevMode(false);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="Layout description" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Page description" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('never warns for a duplicate title, which is a designed pattern', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <title>Layout default</title>
        </UnirendHead>
        <UnirendHead>
          <title>Page title</title>
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('never warns for a child overriding an envelope field', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <UnirendHead
        envelope={createSuccessEnvelope({
          title: 'Home',
          description: 'Envelope description',
          canonical: 'https://example.com/',
        })}
      >
        <meta name="description" content="Something more specific" />
        <link rel="canonical" href="https://example.com/local" />
      </UnirendHead>,
    );

    expect(warnings).toEqual([]);
  });

  it('never warns for a key repeated inside one instance', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <UnirendHead>
        <meta name="description" content="First" />
        <meta name="description" content="Second" />
      </UnirendHead>,
    );

    expect(warnings).toEqual([]);
  });

  it('never warns for allowlisted repeatable keys', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta property="og:image" content="https://example.com/one.png" />
          <meta property="article:tag" content="one" />
          <link rel="preload" as="image" href="https://example.com/a.jpg" />
        </UnirendHead>
        <UnirendHead>
          <meta property="og:image" content="https://example.com/two.png" />
          <meta property="article:tag" content="two" />
          <link rel="preload" as="image" href="https://example.com/b.jpg" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('never warns for an envelope og:image alongside a page one', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead
          envelope={createSuccessEnvelope({
            title: 'Home',
            description: 'Envelope description',
            og: { image: 'https://example.com/envelope.png' },
          })}
        />
        <UnirendHead>
          <meta property="og:image" content="https://example.com/extra.png" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('is silenced for a key the app declared repeatable', () => {
    overrideDevMode(true);
    setRepeatableHeadKeys(['description']);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="Layout description" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Page description" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('still warns for the keys the app did not name', () => {
    // Naming a key is a statement about that key, so everything else is judged as before.
    overrideDevMode(true);
    setRepeatableHeadKeys(['description']);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="Layout description" />
          <meta name="keywords" content="layout" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Page description" />
          <meta name="keywords" content="page" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('name=keywords');
  });

  it('stays quiet however many instances declare a key the app named', () => {
    // The reason this replaced a per-instance prop: three instances need no more written down
    // than two do, and there is no question of which one has to carry it.
    overrideDevMode(true);
    setRepeatableHeadKeys(['description']);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="Root description" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Section description" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Page description" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('warns once when three instances declare the same key', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="One" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Two" />
        </UnirendHead>
        <UnirendHead>
          <meta name="description" content="Three" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toHaveLength(1);
  });

  it('does not warn for an envelope description and an unrelated page meta', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead
          envelope={createSuccessEnvelope({
            title: 'Home',
            description: 'Envelope description',
          })}
        />
        <UnirendHead>
          <meta name="twitter:card" content="summary" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('warns when a layout meta collides with an envelope-derived one', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="Layout description" />
        </UnirendHead>
        <UnirendHead
          envelope={createSuccessEnvelope({
            title: 'Home',
            description: 'Envelope description',
          })}
        />
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Envelope description');
  });
});

describe('UnirendHead duplicate warning (client DOM sync)', () => {
  const {
    getRegisteredList,
    updateDOM,
    resetInitialAttrs,
    takeWarningScopeID,
  } = _test;

  let originalWindow: unknown;
  let originalDocument: unknown;

  function createMockElement() {
    const attributes: Array<{ name: string; value: string }> = [];

    return {
      style: {
        setProperty() {},
        removeProperty() {},
      },
      attributes: attributes as any,
      getAttribute(key: string) {
        return attributes.find((attr) => attr.name === key)?.value ?? null;
      },
      setAttribute(key: string, value: string) {
        const existing = attributes.find((attr) => attr.name === key);

        if (existing) {
          existing.value = value;
        } else {
          attributes.push({ name: key, value });
        }
      },
      removeAttribute(key: string) {
        const index = attributes.findIndex((attr) => attr.name === key);

        if (index !== -1) {
          attributes.splice(index, 1);
        }
      },
    };
  }

  function register(headKeys: Map<string, string>) {
    const entry = {
      html: null,
      body: null,
      metaKeys: [],
      headKeys,
      tagMessages: [] as string[],
      // The production allocator, so these registrations are identified exactly as mounted ones
      // are. See the note on _test.takeWarningScopeID.
      warningScopeID: takeWarningScopeID(),
      markerRef: { current: null },
    };

    getRegisteredList().push(entry);

    return entry;
  }

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
    /* eslint-disable @typescript-eslint/naming-convention */
    (globalThis as any).window = {
      __UNIREND_TEMPLATE_ATTRS__: { html: {}, body: {} },
      location: { pathname: '/' },
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    (globalThis as any).document = {
      documentElement: createMockElement(),
      body: createMockElement(),
    };
    resetInitialAttrs();
    _test.resetTemplateMetas();
    _test.resetDuplicateWarnings();
    setRepeatableHeadKeys([]);
    getRegisteredList().length = 0;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    overrideDevMode(false);
    resetInitialAttrs();
    _test.resetTemplateMetas();
    _test.resetDuplicateWarnings();
    setRepeatableHeadKeys([]);
    getRegisteredList().length = 0;
  });

  it('warns once for a duplicate across two mounted instances', () => {
    overrideDevMode(true);

    register(new Map([['name=description', 'Layout description']]));
    register(new Map([['name=description', 'Page description']]));

    const first = captureWarnings(() => updateDOM());
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('name=description');

    // An unrelated re-sync does not reprint the same warning.
    const second = captureWarnings(() => updateDOM());
    expect(second).toEqual([]);
  });

  it('warns again after the duplicate goes away and comes back', () => {
    overrideDevMode(true);

    register(new Map([['name=description', 'Layout description']]));
    register(new Map([['name=description', 'Page description']]));
    expect(captureWarnings(() => updateDOM())).toHaveLength(1);

    // Navigating away unmounts the second instance.
    getRegisteredList().pop();
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // Coming back is a fresh mistake worth pointing out again.
    register(new Map([['name=description', 'Page description']]));
    expect(captureWarnings(() => updateDOM())).toHaveLength(1);
  });

  it('never warns in a production build', () => {
    overrideDevMode(false);

    register(new Map([['name=description', 'Layout description']]));
    register(new Map([['name=description', 'Page description']]));

    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });

  it('honors an app-declared repeatable key across mounted instances', () => {
    overrideDevMode(true);
    setRepeatableHeadKeys(['description']);

    register(new Map([['name=description', 'Layout description']]));
    register(new Map([['name=description', 'Page description']]));

    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });

  it('reports the envelope projection per instance, like a duplicate', () => {
    // Derived from the registrations rather than accumulated, so it follows the same lifecycle a
    // duplicate does: attributed to the instance that produced it, quiet while that instance keeps
    // saying it, gone when the instance is.
    overrideDevMode(true);

    const message =
      '[unirend] UnirendHead: meta.page.tags[0] (app-version) was skipped.';

    const layout = register(new Map());
    layout.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([message]);

    // The layout has not changed, so re-syncing says nothing more about it.
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // A second instance returning the same bad tag is a second handler with the same bug, in its
    // own file, so it says so rather than hiding behind the layout's.
    const page = register(new Map());
    page.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([message]);

    // And neither repeats once both are standing.
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // Both fixed: nothing is wrong any more.
    layout.tagMessages = [];
    page.tagMessages = [];
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // So reintroducing it is news again.
    page.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([message]);
  });

  it('stays quiet about a layout while pages come and go beneath it', () => {
    // The reason this is scoped by instance and not by URL. A bad tag in a persistent layout is
    // one mistake, and neither instance behind it changed just because you navigated.
    overrideDevMode(true);

    const message =
      '[unirend] UnirendHead: meta.page.tags[0] (layout-tag) was skipped.';

    const layout = register(new Map());
    layout.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([message]);

    // Three navigations under the same layout, each mounting a fresh page instance.
    for (const path of ['/posts/1', '/posts/2', '/posts/3']) {
      navigateTo(path);

      const page = register(new Map());
      expect(captureWarnings(() => updateDOM())).toEqual([]);

      getRegisteredList().splice(getRegisteredList().indexOf(page), 1);
    }

    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });

  it("forgets an unmounted page's tag warning", () => {
    overrideDevMode(true);

    const message =
      '[unirend] UnirendHead: meta.page.tags[0] (app-version) was skipped.';

    const page = register(new Map());
    page.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([message]);

    // Navigating away unmounts it, and the record is rebuilt from what is left.
    getRegisteredList().pop();
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // Coming back says it again rather than leaving you with one you may have scrolled past.
    const again = register(new Map());
    again.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([message]);
  });

  it('follows the route being rendered, with a layout mounted throughout', () => {
    // The worry this pins down: a duplicate is between the instances mounted right now, never
    // between a page you are on and one you left. The record is rebuilt from the registrations on
    // every sync, so a page that has navigated away cannot collide with anything.
    overrideDevMode(true);

    const layout = register(
      new Map([['name=description', 'Layout description']]),
    );
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // Route 1 also declares description, which is the real collision.
    const pageA = register(
      new Map([['name=description', 'Page A description']]),
    );
    expect(captureWarnings(() => updateDOM())).toHaveLength(1);

    // Navigate to a route that declares none. React unmounts A, and its cleanup syncs before the
    // new page registers, so this is the intermediate state too.
    getRegisteredList().splice(getRegisteredList().indexOf(pageA), 1);
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    const pageB = register(new Map([['name=keywords', 'Page B keywords']]));
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // Navigate to a third route that does declare description. It collides with the layout that
    // never went anywhere, and says so, rather than being suppressed by route 1's warning.
    getRegisteredList().splice(getRegisteredList().indexOf(pageB), 1);
    const pageC = register(
      new Map([['name=description', 'Page C description']]),
    );

    const warnings = captureWarnings(() => updateDOM());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Layout description');
    expect(warnings[0]).toContain('Page C description');

    // And the layout leaving takes the collision with it, since one instance cannot collide.
    getRegisteredList().splice(getRegisteredList().indexOf(layout), 1);
    expect(captureWarnings(() => updateDOM())).toEqual([]);
    expect(pageC.headKeys.size).toBe(1);
  });

  function navigateTo(pathname: string) {
    (globalThis as any).window.location.pathname = pathname;
  }

  it('reports the same collision on a second page as its own issue', () => {
    // Two pages each duplicating the layout's description are two bugs in two files. Scoped by the
    // pair of instances, so replacing the page half is a new pair and says so.
    overrideDevMode(true);

    const layout = register(
      new Map([['name=description', 'Layout description']]),
    );

    navigateTo('/a');
    const pageA = register(
      new Map([['name=description', 'Page A description']]),
    );
    expect(captureWarnings(() => updateDOM())).toHaveLength(1);

    // Straight to the next page, no clean route in between.
    getRegisteredList().splice(getRegisteredList().indexOf(pageA), 1);
    navigateTo('/b');
    const pageB = register(
      new Map([['name=description', 'Page B description']]),
    );

    const warnings = captureWarnings(() => updateDOM());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Page B description');

    // Staying on /b and re-syncing is still one mistake, not a new one each time.
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    expect(layout.headKeys.size).toBe(1);
    expect(pageB.headKeys.size).toBe(1);
  });

  it('stays quiet about a collision between two persistent layouts', () => {
    // Neither instance behind this changed, so navigating underneath them is not new information.
    // Scoped by URL, this said the same thing on every record of a parameterized route.
    overrideDevMode(true);

    register(new Map([['name=description', 'Root description']]));
    register(new Map([['name=description', 'Section description']]));
    expect(captureWarnings(() => updateDOM())).toHaveLength(1);

    for (const path of ['/posts/1', '/posts/2', '/posts/3']) {
      navigateTo(path);

      const page = register(new Map([['name=keywords', 'Page keywords']]));
      expect(captureWarnings(() => updateDOM())).toEqual([]);

      getRegisteredList().splice(getRegisteredList().indexOf(page), 1);
    }
  });

  it('does not re-warn when a page changes the value it collides with', () => {
    // Scoped by path and key rather than by value, so a description that moves with component
    // state is still the one mistake it was a render ago.
    overrideDevMode(true);

    register(new Map([['name=description', 'Layout description']]));
    navigateTo('/a');
    const page = register(new Map([['name=description', 'First']]));

    expect(captureWarnings(() => updateDOM())).toHaveLength(1);

    page.headKeys = new Map([['name=description', 'Second']]);
    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });

  it("says it once through StrictMode's setup, cleanup, setup on mount", () => {
    // StrictMode is on by default, and it replays layout effects on mount. The cleanup discards
    // the registration and the second setup builds another, so the identity comes from render
    // state that outlives both, and a cleanup-driven sync leaves the records alone.
    overrideDevMode(true);

    const message =
      '[unirend] UnirendHead: meta.page.tags[0] (app-version) was skipped.';

    // The instance renders once and keeps that identity across the replay. Taken from the real
    // allocator rather than written as a constant, since a constant is the premise this test is
    // meant to be checking the consequences of: the component takes one of these in lazy state,
    // which outlives the replay, and hands the same one to whichever registration exists.
    const scopeID = takeWarningScopeID();

    function mount() {
      const entry = register(new Map([['name=description', 'Page']]));
      entry.warningScopeID = scopeID;
      entry.tagMessages = [message];
      return entry;
    }

    const layout = register(new Map([['name=description', 'Layout']]));

    // setup
    const first = mount();
    const printed = captureWarnings(() => updateDOM());
    expect(printed).toHaveLength(2);

    // cleanup: the registration goes, and the sync it drives must not turn the records over
    getRegisteredList().splice(getRegisteredList().indexOf(first), 1);
    expect(
      captureWarnings(() => updateDOM({ shouldSyncWarnings: false })),
    ).toEqual([]);

    // setup again, a fresh registration carrying the same identity
    mount();
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    expect(layout.headKeys.size).toBe(1);
  });

  it('never warns for a repeatable key', () => {
    overrideDevMode(true);

    register(new Map([['property=og:image', 'one.png']]));
    register(new Map([['property=og:image', 'two.png']]));

    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });

  it('surfaces the warning once the app stops calling a key repeatable', () => {
    overrideDevMode(true);
    setRepeatableHeadKeys(['description']);

    register(new Map([['name=description', 'Layout description']]));
    register(new Map([['name=description', 'Page description']]));

    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // The list is read on each sync rather than captured at registration, so a change to it takes
    // effect on the next one without the instances having to re-render.
    setRepeatableHeadKeys([]);

    expect(captureWarnings(() => updateDOM())).toHaveLength(1);
  });

  it('stops warning once the app calls the key repeatable', () => {
    overrideDevMode(true);

    register(new Map([['name=description', 'Layout description']]));
    register(new Map([['name=description', 'Page description']]));

    expect(captureWarnings(() => updateDOM())).toHaveLength(1);

    setRepeatableHeadKeys(['description']);

    // Nothing to reprint, and the key leaves the reported set so it does not linger as warned.
    expect(captureWarnings(() => updateDOM())).toEqual([]);
    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });
});
