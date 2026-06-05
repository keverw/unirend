/* eslint-disable jsx-a11y/html-has-lang */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { UnirendHead, _test } from './UnirendHead';
import { UnirendHeadProvider } from './UnirendHeadProvider';
import type { HeadCollector } from './context';

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
});

describe('UnirendHead Client-side Helpers', () => {
  const {
    areRecordsEqual,
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
          attributes: [{ name: 'class', value: 'body-static body-dynamic' }],
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
      expect(getInitialBodyAttrs()).toEqual({ class: 'body-static' });
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
        markerRef: { current: markerB },
      });

      getRegisteredList().push({
        html: { lang: 'en' },
        body: null,
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
        markerRef: { current: null as any },
      };
      const regA = {
        html: { lang: 'en' },
        body: null,
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
          <div>Child</div>
        </UnirendHead>,
      );

      // In SPA mode, the template marker must render immediately
      expect(html).toContain(
        '<template style="display:none"></template><div>Child</div>',
      );
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
          <div>Child</div>
        </UnirendHead>,
      );

      // In server-rendered mode, it must defer template marker to avoid hydration mismatches
      expect(html).not.toContain('<template');
      expect(html).toContain('<div>Child</div>');
    });
  });
});
