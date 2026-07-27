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
  isRepeatableHeadKey,
  setRepeatableHeadKeys,
} from './duplicate-head-warning';
import type { SeenHeadKeys } from './duplicate-head-warning';
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
        { key: 'name=description', firstValue: 'A', secondValue: 'B' },
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
        { key: 'name=description', firstValue: 'A', secondValue: 'B' },
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
  const { getRegisteredList, updateDOM, resetInitialAttrs } = _test;

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

  it('reports the envelope projection across the mounted instances, like a duplicate', () => {
    // The tag warnings are derived from the registrations rather than accumulated, so they follow
    // the same lifecycle a duplicate does: said once while true, forgotten with the page that
    // produced it, said again if it comes back.
    overrideDevMode(true);

    const message =
      '[unirend] UnirendHead: meta.page.tags[0] (app-version) was skipped.';

    const layout = register(new Map());
    layout.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([message]);

    // Navigating to another page that returns the same bad tag is the same mistake, not a new
    // one, so it stays quiet however many pages hit it.
    const page = register(new Map());
    page.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // The page carrying it unmounts and the layout's copy goes too: nothing is wrong any more.
    layout.tagMessages = [];
    page.tagMessages = [];
    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // So a page that reintroduces it is news again.
    page.tagMessages = [message];
    expect(captureWarnings(() => updateDOM())).toEqual([message]);
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
