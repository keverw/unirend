import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { overrideDevMode } from 'lifecycleion/dev-mode';
import { UnirendHead, _test } from './UnirendHead';
import { UnirendHeadProvider } from './UnirendHeadProvider';
import type { HeadCollector } from './context';
import {
  areAllowancesEqual,
  collectDuplicateHeadKeys,
  formatDuplicateHeadWarning,
  isDuplicateAllowed,
  isRepeatableHeadKey,
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

  describe('isDuplicateAllowed', () => {
    it('is false when nothing was passed', () => {
      expect(isDuplicateAllowed(undefined, 'name=description')).toBe(false);
      expect(isDuplicateAllowed(false, 'name=description')).toBe(false);
    });

    it('covers every key when true', () => {
      expect(isDuplicateAllowed(true, 'name=description')).toBe(true);
      expect(isDuplicateAllowed(true, 'rel=canonical')).toBe(true);
    });

    it('matches a list by the plain key name', () => {
      expect(isDuplicateAllowed(['description'], 'name=description')).toBe(
        true,
      );
      expect(isDuplicateAllowed(['og:title'], 'property=og:title')).toBe(true);
      expect(isDuplicateAllowed(['canonical'], 'rel=canonical')).toBe(true);
      expect(isDuplicateAllowed(['description'], 'name=keywords')).toBe(false);
    });

    it('also accepts the full internal key form, case-insensitively', () => {
      expect(isDuplicateAllowed(['name=description'], 'name=description')).toBe(
        true,
      );
      expect(isDuplicateAllowed(['Description'], 'name=description')).toBe(
        true,
      );
    });
  });

  describe('areAllowancesEqual', () => {
    it('compares lists by value, not by reference', () => {
      // The list form is almost always an inline literal, so it is a new array every render.
      // Reporting that as a change would force a pointless DOM sync on each one.
      expect(areAllowancesEqual(['description'], ['description'])).toBe(true);
      expect(
        areAllowancesEqual(
          ['description', 'og:title'],
          ['description', 'og:title'],
        ),
      ).toBe(true);
    });

    it('reports a genuinely different list as changed', () => {
      expect(areAllowancesEqual(['description'], ['keywords'])).toBe(false);
      expect(areAllowancesEqual(['description'], [])).toBe(false);
      expect(
        areAllowancesEqual(['description'], ['description', 'keywords']),
      ).toBe(false);
    });

    it('treats false and undefined as the same absence of an allowance', () => {
      expect(areAllowancesEqual(undefined, false)).toBe(true);
      expect(areAllowancesEqual(false, undefined)).toBe(true);
      expect(areAllowancesEqual(undefined, undefined)).toBe(true);
      expect(areAllowancesEqual(true, true)).toBe(true);
    });

    it('reports a toggled boolean as changed', () => {
      expect(areAllowancesEqual(true, false)).toBe(false);
      expect(areAllowancesEqual(true, undefined)).toBe(false);
      expect(areAllowancesEqual(false, true)).toBe(false);
    });

    it('never confuses a list with a boolean', () => {
      expect(areAllowancesEqual(true, ['description'])).toBe(false);
      expect(areAllowancesEqual(['description'], true)).toBe(false);
      expect(areAllowancesEqual([], false)).toBe(false);
      expect(areAllowancesEqual(undefined, [])).toBe(false);
    });
  });

  describe('collectDuplicateHeadKeys', () => {
    it('reports nothing for the first instance to claim a key', () => {
      const seen: SeenHeadKeys = new Map();

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'A']]),
          undefined,
          'first',
        ),
      ).toEqual([]);
    });

    it('reports the collision once, naming both values', () => {
      const seen: SeenHeadKeys = new Map();

      collectDuplicateHeadKeys(
        seen,
        new Map([['name=description', 'A']]),
        undefined,
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'B']]),
          undefined,
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
          undefined,
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
        undefined,
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'A']]),
          undefined,
          'first',
        ),
      ).toEqual([]);

      // A genuinely separate instance still collides, against the replayed value.
      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'B']]),
          undefined,
          'second',
        ),
      ).toEqual([
        { key: 'name=description', firstValue: 'A', secondValue: 'B' },
      ]);
    });

    it('stays quiet when either side of the collision allows it', () => {
      const allowedFirst: SeenHeadKeys = new Map();
      collectDuplicateHeadKeys(
        allowedFirst,
        new Map([['name=description', 'A']]),
        true,
        'first',
      );
      expect(
        collectDuplicateHeadKeys(
          allowedFirst,
          new Map([['name=description', 'B']]),
          undefined,
          'second',
        ),
      ).toEqual([]);

      const allowedSecond: SeenHeadKeys = new Map();
      collectDuplicateHeadKeys(
        allowedSecond,
        new Map([['name=description', 'A']]),
        undefined,
        'first',
      );
      expect(
        collectDuplicateHeadKeys(
          allowedSecond,
          new Map([['name=description', 'B']]),
          true,
          'second',
        ),
      ).toEqual([]);
    });

    it('exempts the instance that allows it, not the key', () => {
      // Three instances declaring the same key, with only the middle one allowing it. The outer
      // two still allow nothing between them, so the allowance must not silence them in passing.
      const seen: SeenHeadKeys = new Map();

      collectDuplicateHeadKeys(
        seen,
        new Map([['name=description', 'A']]),
        undefined,
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'B']]),
          true,
          'second',
        ),
      ).toEqual([]);

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'C']]),
          undefined,
          'third',
        ),
      ).toEqual([
        { key: 'name=description', firstValue: 'A', secondValue: 'C' },
      ]);
    });

    it('anchors on a claimant that allows nothing rather than the first one', () => {
      // The allowed instance comes first here, so it is the two after it that collide, and the
      // message has to name their values rather than the exempt one's.
      const seen: SeenHeadKeys = new Map();

      collectDuplicateHeadKeys(
        seen,
        new Map([['name=description', 'A']]),
        true,
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'B']]),
          undefined,
          'second',
        ),
      ).toEqual([]);

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'C']]),
          undefined,
          'third',
        ),
      ).toEqual([
        { key: 'name=description', firstValue: 'B', secondValue: 'C' },
      ]);
    });

    it('lets a replay take its own claim back when it adds an allowance', () => {
      // The server record outlives a render pass, so an instance React replays may come back
      // carrying an allowance it did not have. It should stop anchoring collisions for others.
      const seen: SeenHeadKeys = new Map();

      collectDuplicateHeadKeys(
        seen,
        new Map([['name=description', 'A']]),
        undefined,
        'first',
      );

      collectDuplicateHeadKeys(
        seen,
        new Map([['name=description', 'A']]),
        true,
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['name=description', 'B']]),
          undefined,
          'second',
        ),
      ).toEqual([]);
    });

    it('stays quiet for a repeatable key', () => {
      const seen: SeenHeadKeys = new Map();

      collectDuplicateHeadKeys(
        seen,
        new Map([['property=og:image', 'one.png']]),
        undefined,
        'first',
      );

      expect(
        collectDuplicateHeadKeys(
          seen,
          new Map([['property=og:image', 'two.png']]),
          undefined,
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
      expect(message).toContain('allowDuplicate');
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

  it('is silenced for the whole instance by allowDuplicate', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="Layout description" />
        </UnirendHead>
        <UnirendHead allowDuplicate>
          <meta name="description" content="Page description" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toEqual([]);
  });

  it('is silenced for named keys only by an allowDuplicate list', () => {
    overrideDevMode(true);

    const warnings = collectWarnings(
      <>
        <UnirendHead>
          <meta name="description" content="Layout description" />
          <meta name="keywords" content="layout" />
        </UnirendHead>
        <UnirendHead allowDuplicate={['description']}>
          <meta name="description" content="Page description" />
          <meta name="keywords" content="page" />
        </UnirendHead>
      </>,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('name=keywords');
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

  let nextInstanceID = 0;

  function register(
    headKeys: Map<string, string>,
    allowDuplicate?: boolean | string[],
  ) {
    const entry = {
      html: null,
      body: null,
      metaKeys: [],
      headKeys,
      allowDuplicate,
      instanceID: `test-instance-${(nextInstanceID += 1)}`,
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
    getRegisteredList().length = 0;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    overrideDevMode(false);
    resetInitialAttrs();
    _test.resetTemplateMetas();
    _test.resetDuplicateWarnings();
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

  it('honors allowDuplicate on a mounted instance', () => {
    overrideDevMode(true);

    register(new Map([['name=description', 'Layout description']]));
    register(new Map([['name=description', 'Page description']]), true);

    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });

  it('never warns for a repeatable key', () => {
    overrideDevMode(true);

    register(new Map([['property=og:image', 'one.png']]));
    register(new Map([['property=og:image', 'two.png']]));

    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });

  it('surfaces the warning once a mounted instance drops its allowDuplicate', () => {
    overrideDevMode(true);

    register(new Map([['name=description', 'Layout description']]));
    const page = register(
      new Map([['name=description', 'Page description']]),
      true,
    );

    expect(captureWarnings(() => updateDOM())).toEqual([]);

    // Effect 1 resyncs the allowance onto the existing registration rather than replacing it,
    // so a re-render that only drops allowDuplicate has to be reflected here and re-evaluated.
    page.allowDuplicate = undefined;

    expect(captureWarnings(() => updateDOM())).toHaveLength(1);
  });

  it('stops warning once a mounted instance adds allowDuplicate', () => {
    overrideDevMode(true);

    register(new Map([['name=description', 'Layout description']]));
    const page = register(new Map([['name=description', 'Page description']]));

    expect(captureWarnings(() => updateDOM())).toHaveLength(1);

    page.allowDuplicate = true;

    // Nothing to reprint, and the key leaves the reported set so it does not linger as warned.
    expect(captureWarnings(() => updateDOM())).toEqual([]);
    expect(captureWarnings(() => updateDOM())).toEqual([]);
  });
});
