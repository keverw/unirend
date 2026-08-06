import { describe, expect, it, spyOn } from 'bun:test';
import * as cheerio from 'cheerio';
import { prettifyHeadTags, injectContent } from './inject';
import { processTemplate } from './format';
import { TAB_SPACES } from '../consts';
import { hashInlineContentForCSP } from '../csp-hash';
import {
  renderContextDataElements,
  UNIREND_DATA_BLOCK_ID,
  type UnirendContextData,
} from './context-data-block';

/**
 * The two elements injectContent emits in place of the seven per-global
 * assignment scripts it used to.
 *
 * Built through the same renderer the implementation uses, deliberately. These
 * tests are about placement and the surrounding markup; restating the
 * bootstrap's minified source in an expected string would make every one of
 * them fail on an unrelated edit to it, which is how a suite stops being worth
 * reading.
 */
function contextElements(overrides: Partial<UnirendContextData> = {}): string {
  return renderContextDataElements({
    isDev: false,
    cdnBaseURL: '',
    domainInfo: null,
    templateAttrs: { html: {}, body: {} },
    templateMetas: [],
    ...overrides,
  }).join('\n');
}

/**
 * Read the JSON data block back out of rendered HTML, the way the client
 * bootstrap does.
 */
function dataBlockPayload(html: string): Record<string, unknown> {
  const match = new RegExp(
    `<script type="application/json" id="${UNIREND_DATA_BLOCK_ID}">([\\s\\S]*?)</script>`,
  ).exec(html);

  if (!match) {
    throw new Error('no unirend data block found in output');
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe('prettifyHeadTags', () => {
  it('should prettify head tags with default indentation', () => {
    const input =
      '<title>Test Title</title><meta name="description" content="Test Description"><link rel="stylesheet" href="styles.css">';
    const expected =
      `<title>Test Title</title>\n` +
      `${TAB_SPACES}<meta name="description" content="Test Description">\n` +
      `${TAB_SPACES}<link rel="stylesheet" href="styles.css">`;

    expect(prettifyHeadTags(input)).toBe(expected);
  });

  it('should handle empty input', () => {
    expect(prettifyHeadTags('')).toBe('');
  });

  it('should use custom indentation when provided', () => {
    const input =
      '<title>Test Title</title><meta name="description" content="Test">';
    const customIndent = '  '; // 2 spaces
    const expected =
      `<title>Test Title</title>\n` +
      `${customIndent}<meta name="description" content="Test">`;

    expect(prettifyHeadTags(input, customIndent)).toBe(expected);
  });

  it('should handle script and style tags', () => {
    const input =
      '<title>Test</title><script src="script.js"></script><style>body { color: red; }</style>';
    const expected =
      `<title>Test</title>\n` +
      `${TAB_SPACES}<script src="script.js"></script>\n` +
      `${TAB_SPACES}<style>body { color: red; }</style>`;

    expect(prettifyHeadTags(input)).toBe(expected);
  });

  it('should filter out empty strings', () => {
    const input = '<title>Test</title><meta name="description" content="Test">';
    const expected =
      `<title>Test</title>\n` +
      `${TAB_SPACES}<meta name="description" content="Test">`;

    expect(prettifyHeadTags(input)).toBe(expected);
  });
});

describe('injectContent', () => {
  it('should inject head and body content into template', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';
    const headContent =
      '<title>Test Title</title><meta name="description" content="Test">';
    const bodyContent = '<div>Hello World</div>';

    const expected =
      '<!DOCTYPE html><html><head>' +
      `<title>Test Title</title>\n` +
      `${TAB_SPACES}<meta name="description" content="Test">` +
      contextElements() +
      '</head><body><div>Hello World</div></body></html>';

    expect(await injectContent(template, headContent, bodyContent)).toBe(
      expected,
    );
  });

  it('should handle empty head and body content', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const expected =
      '<!DOCTYPE html><html><head>' +
      contextElements() +
      '</head><body></body></html>';

    expect(await injectContent(template, '', '')).toBe(expected);
  });

  it('should preserve React attributes in template', async () => {
    // c:spell:ignore reactroot
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><div id="root" data-reactroot=""><!--ss-outlet--></div><!--context-scripts-injection-point--></body></html>';
    const headContent = '<title>React App</title>';
    const bodyContent = '<div>React Content</div>';

    const expected =
      '<!DOCTYPE html><html><head>' +
      `<title>React App</title>` +
      '</head><body><div id="root" data-reactroot=""><div>React Content</div></div>' +
      contextElements() +
      '</body></html>';

    expect(await injectContent(template, headContent, bodyContent)).toBe(
      expected,
    );
  });

  it('should inject app config when provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--><!--context-scripts-injection-point--></body></html>';
    const headContent = '<title>Test</title>';
    const bodyContent = '<div>Content</div>';
    const appConfig = { api_endpoint: 'https://api.example.com', debug: true };

    const result = await injectContent(template, headContent, bodyContent, {
      context: { app: appConfig },
    });

    expect(result).toContain('window.__PUBLIC_APP_CONFIG__=');
    expect(result).toContain('"api_endpoint":"https://api.example.com"');
    expect(result).toContain('"debug":true');
  });

  it('should escape < characters in app config', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';
    const appConfig = { htmlContent: "<script>alert('xss')</script>" };

    const result = await injectContent(template, '', '', {
      context: { app: appConfig },
    });

    expect(result).toContain('\\u003c');
    expect(result).not.toContain('<script>alert');
  });

  it('should inject request context when provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';
    const requestContext = {
      user: { id: '123', name: 'John' },
      locale: 'en-US',
    };

    const result = await injectContent(template, '', '', {
      context: { request: requestContext },
    });

    expect(result).toContain('window.__FRONTEND_REQUEST_CONTEXT__=');
    expect(result).toContain('"user"');
    expect(result).toContain('"id":"123"');
    expect(result).toContain('"locale":"en-US"');
  });

  it('should remove context scripts placeholder when not provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '');

    expect(result).not.toContain('<!--context-scripts-injection-point-->');

    // The bootstrap is fixed text, so it names both globals whether or not
    // they were provided. What says "not provided" is the key being absent
    // from the payload, which is what makes the bootstrap skip the assignment
    // and leave the global undefined rather than defining it as undefined.
    const payload = dataBlockPayload(result);

    expect(payload).not.toHaveProperty('requestContext');
    expect(payload).not.toHaveProperty('appConfig');
  });

  it('should inject both app config and request context', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';
    const appConfig = { api_endpoint: 'https://api.example.com' };
    const requestContext = { user: { id: '123' } };

    const result = await injectContent(template, '', '', {
      context: { app: appConfig, request: requestContext },
    });

    expect(result).toContain('window.__PUBLIC_APP_CONFIG__=');
    expect(result).toContain('"api_endpoint":"https://api.example.com"');
    expect(result).toContain('window.__FRONTEND_REQUEST_CONTEXT__=');
    expect(result).toContain('"user"');
  });

  it('should inject both scripts on separate lines when both provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';
    const appConfig = { api_endpoint: 'https://api.example.com' };
    const requestContext = { user: { id: '123' } };

    const result = await injectContent(template, '', '', {
      context: { app: appConfig, request: requestContext },
    });

    // Should contain both scripts
    expect(result).toContain('window.__FRONTEND_REQUEST_CONTEXT__=');
    expect(result).toContain('window.__PUBLIC_APP_CONFIG__=');

    // Should have newline between them
    const requestIndex = result.indexOf('window.__FRONTEND_REQUEST_CONTEXT__');
    const configIndex = result.indexOf('window.__PUBLIC_APP_CONFIG__');
    expect(requestIndex).toBeLessThan(configIndex);
  });

  it('should replace CDN placeholder with provided CDN URL', async () => {
    const template =
      '<!DOCTYPE html><html><head><script src="__CDN__INJECTION__POINT__/assets/main.js"></script><link href="__CDN__INJECTION__POINT__/assets/styles.css" rel="stylesheet" /></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      CDNBaseURL: 'https://cdn.example.com',
    });

    expect(result).toContain('src="https://cdn.example.com/assets/main.js"');
    expect(result).toContain(
      'href="https://cdn.example.com/assets/styles.css"',
    );
    expect(result).not.toContain('__CDN__INJECTION__POINT__');
  });

  it('should remove CDN placeholder when no CDN URL provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><script src="__CDN__INJECTION__POINT__/assets/main.js"></script><link href="__CDN__INJECTION__POINT__/assets/styles.css" rel="stylesheet" /></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '');

    expect(result).toContain('src="/assets/main.js"');
    expect(result).toContain('href="/assets/styles.css"');
    expect(result).not.toContain('__CDN__INJECTION__POINT__');
  });

  it('should handle CDN URL with trailing slash', async () => {
    const template =
      '<!DOCTYPE html><html><head><script src="__CDN__INJECTION__POINT__/assets/main.js"></script></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      CDNBaseURL: 'https://cdn.example.com/',
    });

    expect(result).toContain('src="https://cdn.example.com/assets/main.js"');
    expect(result).not.toContain('//assets/');
    expect(result).not.toContain('__CDN__INJECTION__POINT__');
  });

  it('should replace multiple CDN placeholders', async () => {
    const template =
      '<!DOCTYPE html><html><head><script src="__CDN__INJECTION__POINT__/assets/vendor.js"></script><script src="__CDN__INJECTION__POINT__/assets/main.js"></script><link href="__CDN__INJECTION__POINT__/assets/styles.css" rel="stylesheet" /><link href="__CDN__INJECTION__POINT__/favicon.ico" rel="icon" /></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      CDNBaseURL: 'https://cdn.example.com',
    });

    expect(result).toContain('src="https://cdn.example.com/assets/vendor.js"');
    expect(result).toContain('src="https://cdn.example.com/assets/main.js"');
    expect(result).toContain(
      'href="https://cdn.example.com/assets/styles.css"',
    );
    expect(result).toContain('href="https://cdn.example.com/favicon.ico"');
    expect(result).not.toContain('__CDN__INJECTION__POINT__');
  });

  it('should carry the CDN URL in the data block when provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      CDNBaseURL: 'https://cdn.example.com',
    });

    expect(dataBlockPayload(result).cdnBaseURL).toBe('https://cdn.example.com');
  });

  it('should carry an empty CDN URL when none is provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '');

    // Empty string rather than absent, so client code can read it
    // unconditionally without guarding against undefined.
    expect(dataBlockPayload(result).cdnBaseURL).toBe('');
  });

  it('should strip a trailing slash from the CDN URL', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      CDNBaseURL: 'https://cdn.example.com/',
    });

    expect(dataBlockPayload(result).cdnBaseURL).toBe('https://cdn.example.com');
  });

  it('should extract React Router hydration script from body and move it to head', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><div id="root"><!--ss-outlet--></div></body></html>';
    const hydrationScript =
      '<script>window.__staticRouterHydrationData = JSON.parse("{}");</script>';
    const bodyContent = `<div data-wrap="true"><main>content</main>${hydrationScript}</div>`;

    const result = await injectContent(template, '', bodyContent);

    // Script should be in <head>, not inside the React root
    const headEnd = result.indexOf('</head>');
    const rootStart = result.indexOf('<div id="root">');
    const scriptPos = result.indexOf('window.__staticRouterHydrationData');
    expect(scriptPos).toBeGreaterThan(0);
    expect(scriptPos).toBeLessThan(headEnd);
    expect(scriptPos).toBeLessThan(rootStart);

    // Body content should have the script removed
    expect(result).not.toContain(
      `<div data-wrap="true"><main>content</main>${hydrationScript}</div>`,
    );
    expect(result).toContain(
      '<div data-wrap="true"><main>content</main></div>',
    );
  });

  describe('React Router hydration payload', () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><div id="root"><!--ss-outlet--></div></body></html>';

    it('carries the payload in the data block rather than an executable script', async () => {
      // The reason this matters: the payload changes on every SSR response, so
      // as executable JavaScript no CSP hash can ever cover it and only a nonce
      // would do — which prerendered output cannot have, there being no request
      // to mint one for. In the data block it is not executable at all.
      const payload = '{"loaderData":{"root":{"id":7}},"errors":null}';
      const bodyContent = `<div><script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(
        payload,
      )});</script></div>`;

      const result = await injectContent(template, '', bodyContent);

      expect(dataBlockPayload(result).routerHydration).toBe(payload);
      expect(result).not.toContain('JSON.parse("{\\"loaderData');
    });

    it('carries the payload characters exactly as React Router encoded them', async () => {
      // Nothing here re-encodes a payload this code does not own. The string
      // that goes out is the one that came in.
      const payload = '{"loaderData":{"note":"a \\"quoted\\" <tag>"}}';
      const bodyContent = `<div><script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(
        payload,
      )});</script></div>`;

      const result = await injectContent(template, '', bodyContent);

      expect(dataBlockPayload(result).routerHydration).toBe(payload);
      // And the < inside it is still escaped out of the element.
      expect(result).not.toContain('<tag>');
    });

    it('omits the key when the page has no hydration script', async () => {
      const result = await injectContent(template, '', '<div>plain</div>');

      expect(dataBlockPayload(result)).not.toHaveProperty('routerHydration');
    });

    it('emits an unrecognized hydration script verbatim instead of guessing', async () => {
      // React Router owns that output and may change it. Declining to take
      // apart a shape we do not recognize costs only the data block; guessing
      // wrong would break hydration.
      const odd =
        '<script>window.__staticRouterHydrationData = someOtherThing();</script>';

      const result = await injectContent(template, '', `<div>${odd}</div>`);

      expect(dataBlockPayload(result)).not.toHaveProperty('routerHydration');
      expect(result).toContain(odd);
    });

    it('reports a CSP hash for a hydration script it emits verbatim', async () => {
      // Without this the forgiving branch above is a trap: the page renders,
      // an enforcing script-src blocks the one script hydration cannot start
      // without, and nothing says why. The hashes for a request are contributed
      // from the template before rendering, so this element does not exist yet
      // at that point and only injectContent can cover it.
      const inner = 'window.__staticRouterHydrationData = someOtherThing();';
      const sources: string[] = [];

      const result = await injectContent(
        template,
        '',
        `<div><script>${inner}</script></div>`,
        { addCSPSource: (source) => sources.push(source) },
      );

      expect(sources).toEqual([`'${hashInlineContentForCSP(inner)}'`]);

      // The assertion that matters is not that *a* hash was reported but that
      // it covers the bytes that ship. A digest of the element rather than its
      // text content, or of a cheerio round trip rather than the original
      // source, would still look like a hash and match nothing.
      // Anchored off one index. The bootstrap script mentions the same global,
      // so searching for the close tag independently finds that element's
      // instead of this one's.
      const openAt = result.indexOf(
        '<script>window.__staticRouterHydrationData',
      );
      const contentAt = openAt + '<script>'.length;
      const shipped = result.slice(
        contentAt,
        result.indexOf('</script>', contentAt),
      );

      expect(shipped).toBe(inner);
    });

    it('reports no hash for a hydration script it lifted into the data block', async () => {
      // The payload is not executable in there, so there is nothing for
      // script-src to govern and nothing to hash.
      const payload = '{"loaderData":{}}';
      const sources: string[] = [];

      await injectContent(
        template,
        '',
        `<div><script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(
          payload,
        )});</script></div>`,
        { addCSPSource: (source) => sources.push(source) },
      );

      expect(sources).toEqual([]);
    });
  });

  it('should preserve React hydration markers while moving router hydration data', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><div id="root"><!--ss-outlet--></div></body></html>';
    const hydrationScript =
      '<script>window.__staticRouterHydrationData = JSON.parse("{}");</script>';
    const bodyContent = `<!--$--><div data-reactroot=""><input checked=""/>${hydrationScript}</div><!--/$-->`;

    const result = await injectContent(template, '', bodyContent);

    expect(result).toContain(
      '<div id="root"><!--$--><div data-reactroot=""><input checked=""/></div><!--/$--></div>',
    );

    const bodyStart = result.indexOf('<body>');
    const bodyEnd = result.indexOf('</body>');
    const scriptPos = result.indexOf('window.__staticRouterHydrationData');

    expect(scriptPos).toBeGreaterThan(0);
    expect(scriptPos).toBeLessThan(bodyStart);
    expect(scriptPos).toBeLessThan(bodyEnd);
  });

  it('should inject html and body attributes', async () => {
    const template =
      '<!DOCTYPE html><html lang="en"><head><!--ss-head--></head><body class="light"><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      htmlAttrs: { class: 'dark', lang: 'es', 'data-foo': 'bar' },
      bodyAttrs: { class: 'dark-theme', style: 'background: red;' },
    });

    expect(result).toContain('<html lang="es" class="dark" data-foo="bar">');
    expect(result).toContain(
      '<body class="light dark-theme" style="background: red;">',
    );
  });

  it('should remove boolean attributes from html and body when value is "false"', async () => {
    const template =
      '<!DOCTYPE html><html lang="en" hidden><head><!--ss-head--></head><body class="light" inert="inert"><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      htmlAttrs: { hidden: 'false' },
      bodyAttrs: { inert: 'false' },
    });

    // Both hidden and inert should be removed
    expect(result).toContain('<html lang="en">');
    expect(result).toContain('<body class="light">');
  });

  it('should preserve original body and html attributes if none are passed', async () => {
    const template =
      '<!DOCTYPE html><html lang="en"><head><!--ss-head--></head><body class="light"><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '');

    expect(result).toContain('<html lang="en">');
    expect(result).toContain('<body class="light">');
  });

  it('should serialize empty string attributes as boolean attributes without value', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      htmlAttrs: { 'data-boolean': '', lang: 'es' },
    });

    expect(result).toContain('<html data-boolean lang="es">');
  });

  it('should gracefully handle cheerio script nodes without sourceCodeLocation', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';
    const hydrationScript =
      '<script>window.__staticRouterHydrationData = JSON.parse("{}");</script>';
    const bodyContent = `<div>${hydrationScript}</div>`;

    const originalLoad = cheerio.load.bind(cheerio);
    const loadSpy = spyOn(cheerio, 'load').mockImplementation(
      (content: any, options: any) => {
        return originalLoad(content, {
          ...options,
          sourceCodeLocationInfo: false,
        });
      },
    );

    try {
      const result = await injectContent(template, '', bodyContent);
      const headContentResult = result.slice(
        result.indexOf('<head>'),
        result.indexOf('</head>'),
      );
      const bodyContentResult = result.slice(
        result.indexOf('<body>'),
        result.indexOf('</body>'),
      );

      // The script is NOT touched, and remains in the body untouched.
      expect(bodyContentResult).toContain(hydrationScript);

      // Nothing was lifted into the data block either. Asserting on the payload
      // rather than on the global's name, since the bootstrap in the head names
      // it unconditionally.
      expect(dataBlockPayload(result)).not.toHaveProperty('routerHydration');
      expect(headContentResult).not.toContain(hydrationScript);
    } finally {
      loadSpy.mockRestore();
    }
  });

  it('should gracefully handle templates without html or body tags when attributes are passed', async () => {
    const template = '<div>Just a div</div>';
    const result = await injectContent(template, '', '', {
      htmlAttrs: { class: 'foo' },
      bodyAttrs: { class: 'bar' },
    });

    expect(result).toBe('<div>Just a div</div>');
  });

  it('should omit empty class and style attributes from html and body elements', async () => {
    const template =
      '<!DOCTYPE html><html lang="en" class="" style=""><head><!--ss-head--></head><body class="" style="  "><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      htmlAttrs: { lang: 'es' },
      bodyAttrs: { 'data-foo': 'bar' },
    });

    expect(result).toContain('<html lang="es">');
    expect(result).toContain('<body data-foo="bar">');
  });

  it('should decode HTML entities in template attributes before serialization to prevent double-escaping', async () => {
    const template =
      '<!DOCTYPE html><html lang="en"><head><!--ss-head--><!--context-scripts-injection-point--></head><body data-name="A &amp; B" data-label="A&nbsp;B" data-copy="&copy;"><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      bodyAttrs: { class: 'active' },
    });

    expect(result).toContain('data-name="A &amp; B"');
    expect(result).toContain('data-label="A\u00A0B"');
    expect(result).toContain('data-copy="©"');
    expect(dataBlockPayload(result).templateAttrs).toEqual({
      html: { lang: 'en' },
      body: {
        'data-name': 'A & B',
        'data-label': 'A\u00A0B',
        'data-copy': '©',
      },
    });
  });

  it('should correctly handle tags containing > inside attribute quotes without corrupting the document', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body data-label="a > b"><!--ss-outlet--></body></html>';
    const result = await injectContent(template, '', '', {
      bodyAttrs: { class: 'x' },
    });
    // Check that body tag was merged correctly and did not corrupt the markup
    expect(result).toContain('<body data-label="a &gt; b" class="x">');
  });

  it('should fallback to injecting context scripts before </head> if the placeholder comment is missing', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--></body></html>';
    const result = await injectContent(template, '', '');
    expect(dataBlockPayload(result).templateAttrs).toBeDefined();
    expect(result).toContain('</head>');
  });

  it('should ignore body and html tags inside script and style blocks when scanning', async () => {
    const template =
      '<!DOCTYPE html><html><head><script>const b = "<body>";</script><style>body { content: "<body>"; }</style><!--ss-head--></head><body><!--ss-outlet--></body></html>';
    const result = await injectContent(template, '', '', {
      bodyAttrs: { class: 'x' },
    });
    // Check that it ignored the fake body tags inside script/style, and updated the actual body tag
    expect(result).toContain('const b = "<body>";');
    expect(result).toContain('body { content: "<body>"; }');
    expect(result).toContain('<body class="x">');
  });
});

describe('template head baseline merge', () => {
  // A template carrying the head tags an app actually ships in index.html: the tags
  // UnirendHead manages per page (title, description, og:title), and the document-level
  // tags it doesn't (viewport, theme-color, charset, plus the site-wide og:site_name).
  const templateHTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Template Title</title>
    <!--ss-head-->
    <meta name="description" content="Template description" />
    <meta property="og:title" content="Template OG Title" />
    <meta name="twitter:card" content="summary" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#ffffff" />
    <meta property="og:site_name" content="My App" />
  </head>
  <body>
    <div id="root"><!--ss-outlet--></div>
  </body>
</html>`;

  // What UnirendHead serializes for a page that sets a title and a description.
  const pageHead = [
    '<title>Page Title</title>',
    '<meta name="description" content="Page description" />',
  ].join('\n');

  // processTemplate() runs on all three paths, so each one has to merge identically.
  const renderPaths = [
    { name: 'SSR dev', mode: 'ssr', isDevelopment: true, isDevServer: true },
    {
      name: 'SSR built',
      mode: 'ssr',
      isDevelopment: false,
      isDevServer: false,
    },
    { name: 'SSG', mode: 'ssg', isDevelopment: false, isDevServer: false },
  ] as const;

  async function renderHead(path: (typeof renderPaths)[number], head: string) {
    const processed = await processTemplate(
      templateHTML,
      path.mode,
      path.isDevelopment,
      path.isDevServer,
    );

    expect(processed.success).toBe(true);

    if (!processed.success) {
      throw new Error(processed.error);
    }

    const html = await injectContent(processed.html, head, '<div>App</div>');
    return cheerio.load(html);
  }

  for (const path of renderPaths) {
    describe(path.name, () => {
      it('should serve the page SEO tags and the template baseline, one of each', async () => {
        const $ = await renderHead(path, pageHead);

        // The page's title and description are the only ones served — the template's
        // copies are gone rather than sitting alongside them.
        expect($('title').length).toBe(1);
        expect($('title').text()).toBe('Page Title');
        expect($('meta[name="description"]').length).toBe(1);
        expect($('meta[name="description"]').attr('content')).toBe(
          'Page description',
        );

        // The template's viewport survives. Losing this is what made every page render
        // as a scaled-down desktop layout on phones.
        expect($('meta[name="viewport"]').length).toBe(1);
        expect($('meta[name="viewport"]').attr('content')).toBe(
          'width=device-width, initial-scale=1.0',
        );

        // Document-level metas the page never mentions pass through untouched.
        expect($('meta[name="theme-color"]').length).toBe(1);
        expect($('meta[name="theme-color"]').attr('content')).toBe('#ffffff');
        expect($('meta[charset]').length).toBe(1);
      });

      it('should let a page meta carrying two identities override either one', async () => {
        // `name="twitter:title" property="og:site_name"` is both of those tags, so it replaces the
        // template's og:site_name rather than shipping alongside it. Keyed on the first attribute
        // found, the og:site_name identity would be invisible here and both would be served.
        const $ = await renderHead(
          path,
          '<meta name="twitter:title" property="og:site_name" content="Page site name" />',
        );

        expect($('meta[property="og:site_name"]').length).toBe(1);
        expect($('meta[property="og:site_name"]').attr('content')).toBe(
          'Page site name',
        );
      });

      it('should let a page override a template meta by either identity it carries', async () => {
        // The template's og:site_name is written with a name too, so it keys on `name=site`. A page
        // declaring og:site_name has to replace it anyway, or both are served.
        const templateWithDualIdentity = templateHTML.replace(
          '<meta property="og:site_name" content="My App" />',
          '<meta name="site" property="og:site_name" content="My App" />',
        );

        const processed = await processTemplate(
          templateWithDualIdentity,
          path.mode,
          path.isDevelopment,
          path.isDevServer,
        );

        expect(processed.success).toBe(true);

        if (!processed.success) {
          throw new Error(processed.error);
        }

        const html = await injectContent(
          processed.html,
          '<meta property="og:site_name" content="Page site name" />',
          '<div>App</div>',
        );
        const $ = cheerio.load(html);

        expect($('meta[property="og:site_name"]').length).toBe(1);
        expect($('meta[property="og:site_name"]').attr('content')).toBe(
          'Page site name',
        );
        expect($('meta[name="site"]').length).toBe(0);
      });

      it('should drop the page-owned SEO tags from the template while keeping the site-wide ones', async () => {
        const $ = await renderHead(path, '');

        // UnirendHead owns these, so the template's copies go even when the page declares
        // nothing. A surviving template tag would sit ahead of the one React hoists on a
        // later client-side navigation, and the stale value would win.
        expect($('title').length).toBe(0);
        expect($('meta[name="description"]').length).toBe(0);
        expect($('meta[property="og:title"]').length).toBe(0);
        expect($('meta[name="twitter:card"]').length).toBe(0);

        // og:site_name describes the site rather than the page, so it stays a template
        // baseline like viewport does.
        expect($('meta[property="og:site_name"]').length).toBe(1);
        expect($('meta[property="og:site_name"]').attr('content')).toBe(
          'My App',
        );

        expect($('meta[name="viewport"]').length).toBe(1);
        expect($('meta[name="theme-color"]').length).toBe(1);
        expect($('meta[charset]').length).toBe(1);
      });

      it('should serve the page OpenGraph tags without duplicating the template copies', async () => {
        const $ = await renderHead(
          path,
          [
            '<meta property="og:title" content="Page OG Title" />',
            '<meta name="twitter:card" content="summary_large_image" />',
          ].join('\n'),
        );

        expect($('meta[property="og:title"]').length).toBe(1);
        expect($('meta[property="og:title"]').attr('content')).toBe(
          'Page OG Title',
        );
        expect($('meta[name="twitter:card"]').length).toBe(1);
        expect($('meta[name="twitter:card"]').attr('content')).toBe(
          'summary_large_image',
        );
      });

      it('should override a template meta declared by property rather than name', async () => {
        const $ = await renderHead(
          path,
          '<meta property="og:site_name" content="Page Site Name" />',
        );

        expect($('meta[property="og:site_name"]').length).toBe(1);
        expect($('meta[property="og:site_name"]').attr('content')).toBe(
          'Page Site Name',
        );

        // A page overriding an og: tag must not disturb the name-keyed baseline.
        expect($('meta[name="viewport"]').length).toBe(1);
        expect($('meta[name="theme-color"]').length).toBe(1);
      });
    });
  }

  it('should not mistake markup inside an inline script for a head tag', async () => {
    const withScript = templateHTML.replace(
      '<!--ss-head-->',
      '<!--ss-head-->\n    <script>\n      const tpl = \'<meta name="viewport" content="nope" /><title>nope</title>\';\n    </script>',
    );

    const processed = await processTemplate(withScript, 'ssr', false, false);
    expect(processed.success).toBe(true);

    if (!processed.success) {
      throw new Error(processed.error);
    }

    const html = await injectContent(
      processed.html,
      pageHead,
      '<div>App</div>',
    );
    const $ = cheerio.load(html);

    // The real viewport meta is untouched and the script's string literal survives intact.
    expect($('meta[name="viewport"]').attr('content')).toBe(
      'width=device-width, initial-scale=1.0',
    );
    expect(html).toContain('const tpl =');
    expect($('title').text()).toBe('Page Title');
  });

  it('should ship the full template meta baseline to the client, including overridden ones', async () => {
    const processed = await processTemplate(templateHTML, 'ssr', false, false);
    expect(processed.success).toBe(true);

    if (!processed.success) {
      throw new Error(processed.error);
    }

    // This page overrides theme-color, so it is absent from the served head.
    const html = await injectContent(
      processed.html,
      '<meta name="theme-color" content="#page" />',
      '<div>App</div>',
    );

    const baseline = dataBlockPayload(html).templateMetas as Array<
      Record<string, string>
    >;
    const names = baseline.map((attrs) => attrs.name ?? attrs.property);

    // The baseline must describe index.html as authored, not the head as served: theme-color
    // is in it even though the server stripped it for this page. Without that the client would
    // have nothing to put back when the user navigates to a page that doesn't override it.
    expect(names).toContain('theme-color');
    expect(names).toContain('viewport');
    expect(names).toContain('og:site_name');

    // Metas with no identifying attribute can't be overridden, so they're not part of it.
    expect(names).not.toContain(undefined);

    const $ = cheerio.load(html);

    // The served theme-color is the page's and carries no marker — it's React's to manage.
    expect($('meta[name="theme-color"]').length).toBe(1);
    expect($('meta[name="theme-color"]').attr('content')).toBe('#page');
    expect(
      $('meta[name="theme-color"]').attr('data-unirend-template-meta'),
    ).toBeUndefined();

    // The template metas left in the head are marked, so the client can tell which nodes are
    // its own to reconcile and which were hoisted by React.
    expect(
      $('meta[name="viewport"]').attr('data-unirend-template-meta'),
    ).toBeDefined();
    expect($('meta[name="viewport"]').attr('content')).toBe(
      'width=device-width, initial-scale=1.0',
    );

    // Marking must not touch a meta that can't be overridden.
    expect(
      $('meta[charset]').attr('data-unirend-template-meta'),
    ).toBeUndefined();
  });

  it('should let a page override a template meta keyed by http-equiv', async () => {
    const withHTTPEquiv = templateHTML.replace(
      '<meta name="theme-color" content="#ffffff" />',
      `<meta http-equiv="content-security-policy" content="default-src *" />`,
    );

    const processed = await processTemplate(withHTTPEquiv, 'ssr', false, false);
    expect(processed.success).toBe(true);

    if (!processed.success) {
      throw new Error(processed.error);
    }

    // What UnirendHead serializes for <meta httpEquiv="content-security-policy" ... />.
    const html = await injectContent(
      processed.html,
      `<meta http-equiv="content-security-policy" content="default-src 'self'" />`,
      '<div>App</div>',
    );
    const $ = cheerio.load(html);

    expect($('meta[http-equiv="content-security-policy"]').length).toBe(1);
    expect(
      $('meta[http-equiv="content-security-policy"]').attr('content'),
    ).toBe("default-src 'self'");
    expect($('meta[name="viewport"]').length).toBe(1);
  });

  // HTML allows whitespace before the '>' of a closing tag, so </script > and </head > are
  // valid closes. A scanner matching only the exact strings would run a script's body past its
  // real close (swallowing the metas after it), or miss the end of the head and walk into the
  // body. processTemplate() never emits these spellings, so this guards the scanner rather
  // than the pipeline, and injectContent() is exported.
  const closingTagSpellings = [
    { name: 'a script closed with whitespace', script: '</script >' },
    { name: 'a script closed normally', script: '</script>' },
  ];

  for (const spelling of closingTagSpellings) {
    it(`should merge template metas that follow ${spelling.name}`, async () => {
      const template = [
        '<!DOCTYPE html><html><head>',
        '<!--ss-head-->',
        `<script>const marker = 1;${spelling.script}`,
        '<meta name="description" content="Template description" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '<!--context-scripts-injection-point-->',
        '</head><body><!--ss-outlet--></body></html>',
      ].join('\n');

      const html = await injectContent(
        template,
        '<meta name="description" content="Page description" />',
        '<div>App</div>',
      );
      const $ = cheerio.load(html);

      // The scan has to reach past the script: the page's description replaces the template's
      // rather than being served next to it, and the viewport beyond it survives.
      expect($('meta[name="description"]').length).toBe(1);
      expect($('meta[name="description"]').attr('content')).toBe(
        'Page description',
      );
      expect($('meta[name="viewport"]').length).toBe(1);
    });
  }

  it('should stop at a head closed with whitespace and never touch the body', async () => {
    const template = [
      '<!DOCTYPE html><html><head>',
      '<!--ss-head-->',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '<!--context-scripts-injection-point-->',
      '</head >',
      '<body><!--ss-outlet-->',
      // Invalid, but it must be left strictly alone rather than marked or removed as if it
      // were part of the template's head baseline.
      '<meta name="viewport" content="body-meta" />',
      '</body></html>',
    ].join('\n');

    const html = await injectContent(
      template,
      '<meta name="viewport" content="page" />',
      '<div>App</div>',
    );

    // The body's meta is untouched: not marked, and not removed as an overridden baseline.
    expect(html).toContain('<meta name="viewport" content="body-meta" />');
    expect(html).not.toContain(
      '<meta name="viewport" content="body-meta" data-unirend-template-meta',
    );

    // The head's own viewport is overridden by the page's, as normal. Asserted on the tag,
    // not the raw text: the baseline global script in the head legitimately carries the
    // template's value in its JSON.
    const headHTML = html.slice(0, html.indexOf('</head >'));
    expect(headHTML).toContain('<meta name="viewport" content="page" />');
    expect(headHTML).not.toContain(
      '<meta name="viewport" content="width=device-width',
    );

    // And it is not in the baseline the client would restore from twice over.
    const baseline = dataBlockPayload(html).templateMetas as Array<
      Record<string, string>
    >;
    expect(baseline).toHaveLength(1);
    expect(baseline[0].content).toBe('width=device-width, initial-scale=1.0');
  });

  it('should treat template metas sharing an identity as one group', async () => {
    // The standard light/dark pair: two metas, one identity. A page overriding theme-color
    // replaces the identity, so both template copies go. The client reconciler relies on this
    // being all-or-nothing per key, and this pins the server to the same rule.
    const withPair = templateHTML.replace(
      '<meta name="theme-color" content="#ffffff" />',
      [
        '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fff" />',
        '    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000" />',
      ].join('\n'),
    );

    const processed = await processTemplate(withPair, 'ssr', false, false);
    expect(processed.success).toBe(true);

    if (!processed.success) {
      throw new Error(processed.error);
    }

    // A page that doesn't override it gets both, untouched.
    const untouched = cheerio.load(
      await injectContent(processed.html, pageHead, '<div>App</div>'),
    );
    expect(untouched('meta[name="theme-color"]').length).toBe(2);

    // A page that overrides it gets only its own — neither template copy is left behind.
    const html = await injectContent(
      processed.html,
      '<meta name="theme-color" content="#page" />',
      '<div>App</div>',
    );
    const $ = cheerio.load(html);

    expect($('meta[name="theme-color"]').length).toBe(1);
    expect($('meta[name="theme-color"]').attr('content')).toBe('#page');

    // Both are still in the baseline the client restores from, media attribute included.
    const baseline = dataBlockPayload(html).templateMetas as Array<
      Record<string, string>
    >;
    const themeColors = baseline.filter(
      (attrs) => attrs.name === 'theme-color',
    );

    expect(themeColors).toHaveLength(2);
    expect(themeColors.map((attrs) => attrs.media)).toEqual([
      '(prefers-color-scheme: light)',
      '(prefers-color-scheme: dark)',
    ]);
  });

  it('should not treat a "</head>" string inside an inline script as the end of the head', async () => {
    // Only </script> closes a script, so this is a legal inline script and the metas after
    // it are still in the head. A template written by hand can order things this way;
    // processTemplate() happens to relocate head scripts to the end of the head, so this
    // guards the scanner rather than the pipeline.
    const template = [
      '<!DOCTYPE html><html><head>',
      '<!--ss-head-->',
      '<script>const marker = "</head>";</script>',
      '<meta name="description" content="Template description" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '<!--context-scripts-injection-point-->',
      '</head><body><!--ss-outlet--></body></html>',
    ].join('\n');

    const html = await injectContent(
      template,
      '<meta name="description" content="Page description" />',
      '<div>App</div>',
    );
    const $ = cheerio.load(html);

    // The scan must reach past the script: the template's description is overridden rather
    // than served next to the page's, and the viewport beyond it is left alone.
    expect($('meta[name="description"]').length).toBe(1);
    expect($('meta[name="description"]').attr('content')).toBe(
      'Page description',
    );
    expect($('meta[name="viewport"]').length).toBe(1);
    expect(html).toContain('const marker =');
  });

  // The scanner treats '</head>', '<!--', '<script' and '<style' as significant. Each of
  // these puts one inside another tag's attribute value, ahead of the metas, where it is
  // just text: it must be passed over with the tag that contains it rather than cutting the
  // scan short and leaving the metas beyond it undiscovered (which would serve the
  // template's description alongside the page's instead of overriding it).
  const decoyAttributeValues = [
    { name: 'a closing head tag', value: 'a </head> b' },
    { name: 'a comment opener', value: 'a <!-- b' },
    { name: 'a script opener', value: 'a <script> b' },
    { name: 'a style opener', value: 'a <style> b' },
  ];

  for (const decoy of decoyAttributeValues) {
    it(`should not act on ${decoy.name} inside another tag's attribute value`, async () => {
      const template = [
        '<!DOCTYPE html><html><head>',
        '<!--ss-head-->',
        `<link rel="preload" as="image" href="/hero.jpg" title="${decoy.value}" />`,
        '<meta name="description" content="Template description" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '<!--context-scripts-injection-point-->',
        '</head><body><!--ss-outlet--></body></html>',
      ].join('\n');

      const html = await injectContent(
        template,
        '<meta name="description" content="Page description" />',
        '<div>App</div>',
      );
      const $ = cheerio.load(html);

      expect($('meta[name="description"]').length).toBe(1);
      expect($('meta[name="description"]').attr('content')).toBe(
        'Page description',
      );
      expect($('meta[name="viewport"]').length).toBe(1);

      // The decoy tag itself is left exactly as it was.
      expect($('link[rel="preload"]').attr('title')).toBe(decoy.value);
    });
  }

  it('should keep a template meta whose value contains a bare angle bracket', async () => {
    const withBracket = templateHTML.replace(
      '<meta name="theme-color" content="#ffffff" />',
      '<meta name="rating" content="a > b" />',
    );

    const processed = await processTemplate(withBracket, 'ssr', false, false);
    expect(processed.success).toBe(true);

    if (!processed.success) {
      throw new Error(processed.error);
    }

    const html = await injectContent(
      processed.html,
      pageHead,
      '<div>App</div>',
    );
    const $ = cheerio.load(html);

    // A '>' inside an attribute value must not end the tag early and swallow the
    // metas that follow it.
    expect($('meta[name="rating"]').length).toBe(1);
    expect($('meta[name="viewport"]').length).toBe(1);
    expect($('meta[property="og:site_name"]').length).toBe(1);
  });

  it('should read an attribute name carrying an underscore or a dot as one name', async () => {
    // A name is not a restricted alphabet, and reading it as one did not reject the odd
    // character, it ended the name there and read the tail as a second attribute. So this page
    // meta, whose only identity is name="app-version", was read as declaring name="viewport"
    // and http-equiv="content-language" too, and the template's copies of both were stripped
    // from the served head. Only the server ever saw it that way: the client reads the real
    // React prop, so the tags came back on hydration and only the crawler's copy lost them.
    //
    // `_` and `.` are both allowed in an envelope tag's attribute name, so the values here
    // could arrive over the wire. See VALID_ATTRIBUTE_NAME in UnirendHead/page-metadata-tags.ts.
    const withHTTPEquiv = templateHTML.replace(
      '<meta name="theme-color" content="#ffffff" />',
      '<meta http-equiv="content-language" content="en" />',
    );

    const processed = await processTemplate(withHTTPEquiv, 'ssr', false, false);
    expect(processed.success).toBe(true);

    if (!processed.success) {
      throw new Error(processed.error);
    }

    const html = await injectContent(
      processed.html,
      '<meta name="app-version" content="1.2.3" data_name="viewport" x.http-equiv="content-language" />',
      '<div>App</div>',
    );
    const $ = cheerio.load(html);

    expect($('meta[name="viewport"]').length).toBe(1);
    expect($('meta[name="viewport"]').attr('content')).toBe(
      'width=device-width, initial-scale=1.0',
    );
    expect($('meta[http-equiv="content-language"]').length).toBe(1);
    expect($('meta[name="app-version"]').length).toBe(1);
  });
});
