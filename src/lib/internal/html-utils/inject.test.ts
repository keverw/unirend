import { describe, expect, it, spyOn } from 'bun:test';
import * as cheerio from 'cheerio';
import { prettifyHeadTags, injectContent } from './inject';
import { TAB_SPACES } from '../consts';

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
      '<script>globalThis.__lifecycleion_is_dev__=false;</script>\n' +
      '<script>window.__CDN_BASE_URL__="";</script>\n' +
      '<script>window.__DOMAIN_INFO__=null;</script>\n' +
      '<script>window.__UNIREND_TEMPLATE_ATTRS__={"html":{},"body":{}};</script>' +
      '</head><body><div>Hello World</div></body></html>';

    expect(await injectContent(template, headContent, bodyContent)).toBe(
      expected,
    );
  });

  it('should handle empty head and body content', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const expected =
      '<!DOCTYPE html><html><head><script>globalThis.__lifecycleion_is_dev__=false;</script>\n<script>window.__CDN_BASE_URL__="";</script>\n<script>window.__DOMAIN_INFO__=null;</script>\n<script>window.__UNIREND_TEMPLATE_ATTRS__={"html":{},"body":{}};</script></head><body></body></html>';

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
      '<script>globalThis.__lifecycleion_is_dev__=false;</script>\n' +
      '<script>window.__CDN_BASE_URL__="";</script>\n' +
      '<script>window.__DOMAIN_INFO__=null;</script>\n' +
      '<script>window.__UNIREND_TEMPLATE_ATTRS__={"html":{},"body":{}};</script>' +
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
    expect(result).not.toContain('window.__FRONTEND_REQUEST_CONTEXT__');
    expect(result).not.toContain('window.__PUBLIC_APP_CONFIG__');
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

  it('should inject window.__CDN_BASE_URL__ with the CDN URL when provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      CDNBaseURL: 'https://cdn.example.com',
    });

    expect(result).toContain(
      'window.__CDN_BASE_URL__="https://cdn.example.com"',
    );
  });

  it('should inject window.__CDN_BASE_URL__ as empty string when no CDN URL provided', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '');

    expect(result).toContain('window.__CDN_BASE_URL__=""');
  });

  it('should strip trailing slash from CDN URL in window.__CDN_BASE_URL__', async () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--><!--context-scripts-injection-point--></head><body><!--ss-outlet--></body></html>';

    const result = await injectContent(template, '', '', {
      CDNBaseURL: 'https://cdn.example.com/',
    });

    expect(result).toContain(
      'window.__CDN_BASE_URL__="https://cdn.example.com"',
    );
    expect(result).not.toContain(
      'window.__CDN_BASE_URL__="https://cdn.example.com/"',
    );
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

      // The script is NOT moved to the head, and remains in the body
      expect(headContentResult).not.toContain(
        'window.__staticRouterHydrationData',
      );
      expect(bodyContentResult).toContain(hydrationScript);
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
    expect(result).toContain(
      'window.__UNIREND_TEMPLATE_ATTRS__={"html":{"lang":"en"},"body":{"data-name":"A & B","data-label":"A\u00A0B","data-copy":"©"}}',
    );
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
    expect(result).toContain('window.__UNIREND_TEMPLATE_ATTRS__=');
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
