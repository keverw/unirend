import { describe, it, expect } from 'bun:test';
import * as cheerio from 'cheerio';
import { prettifyHTML, processTemplate } from './format';

// Helper: split output by new lines (trim the trailing \n added by prettifyHTML)
// and assert that each expected line appears in the output **in the given order**.
// This lets us verify ordering (and indentation) without listing every boilerplate line (html, head, body wrappers, etc.).
function expectLinesInOrder(result: string, expected: string[]) {
  const lines = result.trimEnd().split('\n');

  // Walk through the output ensuring each expected line appears after the previous one
  let searchStart = 0;
  for (const expectedLine of expected) {
    // Find the first occurrence of the expected line after `searchStart`
    const idx = lines.slice(searchStart).findIndex((l) => l === expectedLine);
    expect(idx).not.toBe(-1);

    // Move search start pointer past the found index
    searchStart += idx + 1;
  }
}

describe('prettifyHTML', () => {
  it('should format simple HTML correctly', () => {
    const $ = cheerio.load('<div>Hello World</div>');
    const result = prettifyHTML($);

    expectLinesInOrder(result, [
      '    <div>',
      '      Hello World',
      '    </div>',
    ]);
  });

  it('should format nested HTML with proper indentation', () => {
    const $ = cheerio.load('<div><p>Hello</p><span>World</span></div>');
    const result = prettifyHTML($);

    expectLinesInOrder(result, [
      '    <div>',
      '      <p>',
      '        Hello',
      '      </p>',
      '      <span>',
      '        World',
      '      </span>',
      '    </div>',
    ]);
  });

  it('should handle self-closing tags', () => {
    const $ = cheerio.load("<div><img src='test.jpg' alt='test'/><br/></div>");
    const result = prettifyHTML($);

    expectLinesInOrder(result, [
      '    <div>',
      '      <img src="test.jpg" alt="test"/>',
      '      <br/>',
      '    </div>',
    ]);
  });

  it('should handle attributes correctly', () => {
    const $ = cheerio.load(
      '<div class="container" id="main"><p data-test>Content</p></div>',
    );
    const result = prettifyHTML($);

    expectLinesInOrder(result, [
      '    <div class="container" id="main">',
      '      <p data-test>',
      '        Content',
      '      </p>',
      '    </div>',
    ]);
  });

  it('should handle empty tags', () => {
    const $ = cheerio.load('<div><p></p><span></span></div>');
    const result = prettifyHTML($);

    expectLinesInOrder(result, [
      '    <div>',
      '      <p></p>',
      '      <span></span>',
      '    </div>',
    ]);
  });

  it('should handle comments', () => {
    const $ = cheerio.load(
      '<div><!-- This is a comment --><p>Content</p></div>',
    );
    const result = prettifyHTML($);

    expectLinesInOrder(result, [
      '    <div>',
      '      <!-- This is a comment -->',
      '      <p>',
      '        Content',
      '      </p>',
      '    </div>',
    ]);
  });

  it('should handle root element specially (single line content)', () => {
    const $ = cheerio.load('<div id="root"><span>App Content</span></div>');
    const result = prettifyHTML($);

    expectLinesInOrder(result, [
      '    <div id="root"><span>App Content</span></div>',
    ]);
  });

  it('should handle custom containerID', () => {
    const $ = cheerio.load(
      '<div id="app-container"><header><h1>Title</h1></header><main><p>Content</p></main></div>',
    );
    const result = prettifyHTML($, 'app-container');

    expectLinesInOrder(result, [
      '    <div id="app-container"><header><h1>Title</h1></header><main><p>Content</p></main></div>',
    ]);
  });

  it('should handle mixed content types', () => {
    const $ = cheerio.load('<div>Text <strong>bold</strong> more text</div>');
    const result = prettifyHTML($);

    expect(result).toContain('Text');
    expect(result).toContain('<strong>');
    expect(result).toContain('bold');
    expect(result).toContain('more text');
  });

  it('should format complete HTML document', () => {
    const $ = cheerio.load(
      '<html><head><title>Test</title></head><body><div>Content</div></body></html>',
    );
    const result = prettifyHTML($);

    expect(result).toContain('<html>');
    expect(result).toContain('<head>');
    expect(result).toContain('<title>');
    expect(result).toContain('Test');
    expect(result).toContain('<body>');
    expect(result).toContain('<div>');
    expect(result).toContain('Content');
  });

  it('should handle directive nodes', () => {
    // Create HTML with DOCTYPE directive
    const html = '<!DOCTYPE html><html><body><div>Content</div></body></html>';
    const $ = cheerio.load(html);
    const result = prettifyHTML($);

    // Should contain the DOCTYPE directive
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<html>');
    expect(result).toContain('Content');
  });

  it('should handle XML processing instructions', () => {
    // Test XML processing instruction (another type of directive)
    const html = "<?xml version='1.0'?><root><item>test</item></root>";
    const $ = cheerio.load(html, { xmlMode: true });
    const result = prettifyHTML($);

    // Should contain the XML processing instruction
    expect(result).toContain("<?xml version='1.0'?>");
    expect(result).toContain('<root>');
    expect(result).toContain('test');
  });

  it('should preserve whitespace inside <pre> verbatim', () => {
    // Indentation is content inside a <pre>. Trimming the text node or re-indenting it
    // would visibly change the rendered page.
    const $ = cheerio.load(
      '<pre>line one\n    indented two\n\nblank above</pre>',
    );
    const result = prettifyHTML($);

    expect(result).toContain(
      '<pre>line one\n    indented two\n\nblank above</pre>',
    );
  });

  it('should preserve whitespace inside <textarea> verbatim', () => {
    // Whitespace here is the value the user submits.
    const $ = cheerio.load('<textarea name="note">  keep   me  </textarea>');
    const result = prettifyHTML($);

    expect(result).toContain('<textarea name="note">  keep   me  </textarea>');
  });

  it('should keep a leading newline inside <pre>', () => {
    // The parser drops a newline directly after the open tag, so it has to be re-added or a
    // <pre> starting with a blank line would lose one on every round trip.
    const $ = cheerio.load('<pre>\n\nstarts blank</pre>');
    const result = prettifyHTML($);

    expect(result).toContain('<pre>\n\nstarts blank</pre>');
  });

  it('should still format elements nested inside a <pre>', () => {
    const $ = cheerio.load('<pre>plain <strong>bold</strong>\n  next</pre>');
    const result = prettifyHTML($);

    // Nested markup is serialized, but no indentation or line breaks are introduced.
    expect(result).toContain('<pre>plain <strong>bold</strong>\n  next</pre>');
  });

  it('should not emit a closing tag for void elements inside a <pre>', () => {
    // HTML5 parses a stray `</br>` as another <br> start tag, so `<br></br>` would re-parse
    // into two line breaks and the content would grow on every round trip.
    const $ = cheerio.load('<pre>a<br>b<img src="x.png">c</pre>');
    const result = prettifyHTML($);

    expect(result).toContain('<pre>a<br>b<img src="x.png">c</pre>');
    expect(result).not.toContain('</br>');
    expect(result).not.toContain('</img>');
  });

  it('should re-escape entities in text so escaped markup stays inert', () => {
    // The parser hands text back decoded. Emitting it raw would turn an author's escaped
    // &lt;b&gt; back into a live <b> tag, and an encoded </pre> into a real closing tag.
    const $ = cheerio.load(
      '<pre>&lt;b&gt;safe&lt;/b&gt;</pre><p>Tom &amp; Jerry</p>',
    );
    const result = prettifyHTML($);

    expect(result).toContain('<pre>&lt;b&gt;safe&lt;/b&gt;</pre>');
    expect(result).toContain('Tom &amp; Jerry');
    expect(result).not.toContain('<b>safe</b>');
  });

  it('should re-escape attribute values', () => {
    // An unescaped double quote here would close the attribute early and inject markup.
    const $ = cheerio.load('<div data-x="a&quot;b &amp; c">t</div>');
    const result = prettifyHTML($);

    expect(result).toContain('data-x="a&quot;b &amp; c"');
  });

  it('should NOT escape the contents of raw-text elements', () => {
    // These were never decoded by the parser. Encoding them would corrupt the code they hold:
    // `a && b` would become `a &amp;&amp; b` and stop being valid JavaScript.
    const $ = cheerio.load(
      '<script>if (a && b < c) x();</script><style>a > b { color: red }</style>',
    );
    const result = prettifyHTML($);

    expect(result).toContain('if (a && b < c) x();');
    expect(result).toContain('a > b { color: red }');
    expect(result).not.toContain('&amp;&amp;');
  });

  it('should keep markup inside <noscript> intact', () => {
    // The parser treats <noscript> as raw text, handing back one text node of source
    // characters. Escaping it would render literal, visible "&lt;div&gt;" on the page.
    const $ = cheerio.load(
      '<body><noscript><div class="warn">Enable JS</div></noscript></body>',
    );
    const result = prettifyHTML($);

    expect(result).toContain('<div class="warn">Enable JS</div>');
    expect(result).not.toContain('&lt;div');
  });
});

describe('processTemplate', () => {
  it('should remove title tags from head', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <title>Test Title</title>
          <meta charset="utf-8">
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // UnirendHead owns the title, so the template's copy always goes.
      expect(result.html).not.toContain('<title>');
      expect(result.html).not.toContain('Test Title');
    }
  });

  it('should add development comment when isDevelopment is true', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', true, true);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain(
        'React hydration relies on data attributes',
      );
      expect(result.html).toContain('<div id="root">');
      expect(result.html).toContain('Content');
    }
  });

  it('should not add development comment when isDevelopment is false', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).not.toContain(
        'React hydration relies on data attributes',
      );
      expect(result.html).toContain('<div id="root">');
      expect(result.html).toContain('Content');
    }
  });

  it('should remove only the metas UnirendHead manages, keeping the rest as a baseline', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <meta name="description" content="Test">
          <meta property="og:title" content="OG Title">
          <meta property="og:image" content="/og.png">
          <meta name="twitter:card" content="summary">
          <meta property="og:site_name" content="My App">
          <meta name="apple-mobile-web-app-title" content="App">
          <meta name="viewport" content="width=device-width">
          <meta name="theme-color" content="#fff">
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // Per-page SEO is UnirendHead's to set, so the template's copies go.
      expect(result.html).not.toContain('name="description"');
      expect(result.html).not.toContain('property="og:title"');
      expect(result.html).not.toContain('property="og:image"');
      expect(result.html).not.toContain('name="twitter:card"');

      // og:site_name describes the site, not the page, so it stays as a baseline.
      expect(result.html).toContain('property="og:site_name"');

      // Everything document-level is template-owned and survives. Dropping viewport here
      // is what left every page rendering as a scaled-down desktop layout on phones.
      expect(result.html).toContain('name="viewport"');
      expect(result.html).toContain('name="theme-color"');
      expect(result.html).toContain('name="apple-mobile-web-app-title"');
    }
  });

  it('should move scripts after root element', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script src="header.js"></script>
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="footer.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // Scripts should be after the root element
      const rootIndex = result.html.indexOf('<div id="root">');
      const rootEndIndex = result.html.indexOf('</div>', rootIndex);
      const scriptIndex = result.html.indexOf('<script', rootEndIndex);

      expect(scriptIndex).toBeGreaterThan(rootEndIndex);
      expect(result.html).toContain('src="header.js"');
      expect(result.html).toContain('src="footer.js"');
    }
  });

  it('should keep <!--ss-head--> in processed template for runtime injection', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="app.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // ss-head marker must survive for injectContent to inject context scripts after it
      expect(result.html).toContain('<!--ss-head-->');

      // body scripts are moved after #root
      const ssHeadIndex = result.html.indexOf('<!--ss-head-->');
      const appJsIndex = result.html.indexOf('src="app.js"');
      expect(appJsIndex).toBeGreaterThan(ssHeadIndex);
    }
  });

  it('should preserve inline <head> scripts and re-append them after static head content', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script>(function(){ var t = 'light'; document.documentElement.className = 'theme-' + t; })();</script>
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="app.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      const ssHeadIndex = result.html.indexOf('<!--ss-head-->');
      const inlineScriptIndex = result.html.indexOf('theme-');
      const appJsIndex = result.html.indexOf('src="app.js"');
      const headCloseIndex = result.html.indexOf('</head>');

      // ss-head stays in head, inline script comes after it in head
      expect(inlineScriptIndex).toBeGreaterThan(ssHeadIndex);
      expect(inlineScriptIndex).toBeLessThan(headCloseIndex);
      // app.js is in body (after </head>)
      expect(appJsIndex).toBeGreaterThan(headCloseIndex);
    }
  });

  it("should remove comments that don't start with ss- but preserve ss- comments", async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <!-- Regular comment -->
          <!-- ss-special comment -->
          <div id="root">
            <!--ss-outlet-->
            <!-- Another regular comment -->
            <!--ss-no-space-->
            <!-- ss-with-space -->
            Content
          </div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // Regular comments should be removed
      expect(result.html).not.toContain('Regular comment');
      expect(result.html).not.toContain('Another regular comment');

      // ss- comments should be preserved and normalized
      expect(result.html).toContain('ss-special comment');
      expect(result.html).toContain('ss-no-space');
      expect(result.html).toContain('ss-with-space');

      // Verify normalization - spaces should be trimmed
      expect(result.html).toContain('<!--ss-no-space-->');
      expect(result.html).toContain('<!--ss-with-space-->');
      expect(result.html).not.toContain('<!-- ss-with-space -->');

      expect(result.html).toContain('Content');
      expect(result.html).toContain('<div id="root">');
    }
  });

  it('should handle ss- comments with various spacing and normalize them', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <!--ss-outlet-->
          <!-- ss-outlet -->
          <!--  ss-outlet  -->
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // All variations should be preserved and normalized
      expect(result.html).toContain('ss-outlet');
      expect(result.html).toContain('Content');

      // Count occurrences - should have 3 ss-outlet comments
      const matches = result.html.match(/ss-outlet/g);
      expect(matches).toHaveLength(3);

      // Verify that spaces are trimmed from ss- comments
      // Should not contain comments with extra spaces
      expect(result.html).not.toContain('<!--  ss-outlet  -->');
      expect(result.html).not.toContain('<!-- ss-outlet -->');

      // Should contain normalized version
      expect(result.html).toContain('<!--ss-outlet-->');
    }
  });

  it('should normalize ss- comments by removing leading/trailing spaces', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <!--   ss-special-comment   -->
          <!-- ss-another -->
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // Should contain normalized comments without extra spaces
      expect(result.html).toContain('<!--ss-special-comment-->');
      expect(result.html).toContain('<!--ss-another-->');

      // Should not contain the original spaced versions
      expect(result.html).not.toContain('<!--   ss-special-comment   -->');
      expect(result.html).not.toContain('<!-- ss-another -->');
    }
  });

  it('should handle HTML without root element', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <!--ss-outlet-->
          <div class="container">Content</div>
          <script src="app.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // Script should be appended to body when no root element exists
      expect(result.html).toContain('src="app.js"');
      expect(result.html).toContain('class="container"');
      expect(result.html).toContain('Content');
    }
  });

  it('should handle empty HTML', async () => {
    const html =
      '<html><head><!--ss-head--></head><body><!--ss-outlet--></body></html>';

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain('<html>');
      expect(result.html).toContain('<body>');
    }
  });

  it('should handle multiple script tags correctly', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script src="lib1.js"></script>
          <script>console.log('inline1');</script>
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="lib2.js"></script>
          <script>console.log('inline2');</script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain('src="lib1.js"');
      expect(result.html).toContain('src="lib2.js"');
      expect(result.html).toContain("console.log('inline1')");
      expect(result.html).toContain("console.log('inline2')");

      const headCloseIndex = result.html.indexOf('</head>');
      const rootEndIndex = result.html.indexOf('</div>');
      const lib1Index = result.html.indexOf('src="lib1.js"');
      const inline1Index = result.html.indexOf("console.log('inline1')");
      const lib2Index = result.html.indexOf('src="lib2.js"');
      const inline2Index = result.html.indexOf("console.log('inline2')");

      // Head scripts stay in <head>
      expect(lib1Index).toBeLessThan(headCloseIndex);
      expect(inline1Index).toBeLessThan(headCloseIndex);
      // Body scripts stay in body after root element
      expect(lib2Index).toBeGreaterThan(rootEndIndex);
      expect(inline2Index).toBeGreaterThan(rootEndIndex);
    }
  });

  it('should preserve user script order in body', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="first.js"></script>
          <script src="second.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      const headCloseIndex = result.html.indexOf('</head>');
      const firstJsIndex = result.html.indexOf('src="first.js"');
      const secondJsIndex = result.html.indexOf('src="second.js"');

      // ss-head marker stays in head
      const ssHeadIndex = result.html.indexOf('<!--ss-head-->');
      expect(ssHeadIndex).toBeLessThan(headCloseIndex);

      // User scripts follow in order in body
      expect(firstJsIndex).toBeGreaterThan(headCloseIndex);
      expect(firstJsIndex).toBeLessThan(secondJsIndex);
    }
  });

  it('should handle complex nested HTML structure', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <title>Remove Me</title>
          <meta name="description" content="Remove me too">
          <meta name="apple-mobile-web-app-title" content="Keep me">
        </head>
        <body>
          <!-- Remove this comment -->
          <!-- ss-keep this comment -->
          <div id="root">
            <!--ss-outlet-->
            <header>
              <h1>Title</h1>
            </header>
            <main>
              <p>Content</p>
            </main>
          </div>
          <script src="app.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', true, true);

    expect(result.success).toBe(true);

    if (result.success) {
      // Should remove the tags UnirendHead manages (title and description)
      expect(result.html).not.toContain('<title>');
      expect(result.html).not.toContain('name="description"');

      // Should keep the rest of the template's head baseline
      expect(result.html).toContain('name="apple-mobile-web-app-title"');

      // Should remove regular comment but keep ss- comment
      expect(result.html).not.toContain('Remove this comment');
      expect(result.html).toContain('ss-keep this comment');

      // Should add development comment and preserve it
      expect(result.html).toContain(
        'React hydration relies on data attributes',
      );

      // Should move script after root
      const rootEndIndex = result.html.indexOf('</div>');
      const scriptIndex = result.html.indexOf('src="app.js"');
      expect(scriptIndex).toBeGreaterThan(rootEndIndex);

      // Should format root element on single line (with ss-outlet comment preserved)
      expect(result.html).toContain('<div id="root">');
      expect(result.html).toContain('<!--ss-outlet-->');
      expect(result.html).toContain('<header>');
      expect(result.html).toContain('Title');
      expect(result.html).toContain('Content');
      expect(result.html).toContain('</header><main>');
      expect(result.html).toContain('</main></div>');
    }
  });

  // Validation tests for missing markers
  it('should return error when ss-head marker is missing', async () => {
    const html = `
      <html>
        <head>
          <title>Test</title>
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Missing required comment markers');
      expect(result.error).toContain('<!--ss-head-->');
      expect(result.error).toContain(
        'server-rendered content will be injected',
      );
    }
  });

  it('should return error when ss-outlet marker is missing', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <title>Test</title>
        </head>
        <body>
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Missing required comment markers');
      expect(result.error).toContain('<!--ss-outlet-->');
      expect(result.error).toContain('generated content will be injected');
    }
  });

  it('should return error when both markers are missing', async () => {
    const html = `
      <html>
        <head>
          <title>Test</title>
        </head>
        <body>
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Missing required comment markers');
      expect(result.error).toContain('<!--ss-head-->');
      expect(result.error).toContain('<!--ss-outlet-->');
    }
  });

  it('should detect markers even with extra spaces', async () => {
    const html = `
      <html>
        <head>
          <!--  ss-head  -->
          <title>Test</title>
        </head>
        <body>
          <div id="root"><!--   ss-outlet   -->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false);

    expect(result.success).toBe(true);

    if (result.success) {
      // Markers should be normalized (spaces removed)
      expect(result.html).toContain('<!--ss-head-->');
      expect(result.html).toContain('<!--ss-outlet-->');
      expect(result.html).not.toContain('<!--  ss-head  -->');
      expect(result.html).not.toContain('<!--   ss-outlet   -->');
    }
  });
});

describe('processTemplate with custom containerID', () => {
  it('should handle custom containerID in processTemplate', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="my-app">
            <!--ss-outlet-->
            <header>
              <h1>Title</h1>
            </header>
            <main>
              <p>Content</p>
            </main>
          </div>
          <script src="app.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false, false, 'my-app');

    expect(result.success).toBe(true);

    if (result.success) {
      // Should format my-app element on single line (with ss-outlet comment preserved)
      expect(result.html).toContain('<div id="my-app">');
      expect(result.html).toContain('<!--ss-outlet-->');
      expect(result.html).toContain('<header><h1>Title</h1></header>');
      expect(result.html).toContain('<main><p>Content</p></main>');
      expect(result.html).toContain('</div>');

      // Should move script after my-app element
      const myAppEndIndex = result.html.indexOf('</div>');
      const scriptIndex = result.html.indexOf('src="app.js"');
      expect(scriptIndex).toBeGreaterThan(myAppEndIndex);
    }
  });
});

describe('processTemplate with CDN placeholder injection', () => {
  it('should add CDN placeholder to absolute script src URLs', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script src="/assets/vendor.js"></script>
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="/assets/main.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root');

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain(
        'src="__CDN__INJECTION__POINT__/assets/vendor.js"',
      );
      expect(result.html).toContain(
        'src="__CDN__INJECTION__POINT__/assets/main.js"',
      );
      expect(result.html).not.toContain('src="/assets/vendor.js"');
      expect(result.html).not.toContain('src="/assets/main.js"');
    }
  });

  it('should add CDN placeholder to absolute link href URLs', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <link rel="stylesheet" href="/assets/styles.css" />
          <link rel="icon" href="/favicon.ico" />
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root');

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain(
        'href="__CDN__INJECTION__POINT__/assets/styles.css"',
      );
      expect(result.html).toContain(
        'href="__CDN__INJECTION__POINT__/favicon.ico"',
      );
      expect(result.html).not.toContain('href="/assets/styles.css"');
      expect(result.html).not.toContain('href="/favicon.ico"');
    }
  });

  it('should NOT add placeholder to relative URLs (without leading slash)', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script src="vendor.js"></script>
          <link rel="stylesheet" href="styles.css" />
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root');

    expect(result.success).toBe(true);

    if (result.success) {
      // Relative URLs should remain unchanged
      expect(result.html).toContain('src="vendor.js"');
      expect(result.html).toContain('href="styles.css"');
      expect(result.html).not.toContain('__CDN__INJECTION__POINT__');
    }
  });

  it('should NOT add placeholder to protocol-relative URLs', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <link rel="stylesheet" href="//fonts.vendor.com/font.css" />
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="//widget.vendor.com/w.js"></script>
          <script src="/assets/main.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root');

    expect(result.success).toBe(true);

    if (result.success) {
      // A protocol-relative URL starts with a slash but points at another origin. Prefixing
      // it would yield "https://cdn.example.com//widget.vendor.com/w.js", so it stays as-is.
      expect(result.html).toContain('src="//widget.vendor.com/w.js"');
      expect(result.html).toContain('href="//fonts.vendor.com/font.css"');

      // The genuinely local asset alongside them is still rewritten.
      expect(result.html).toContain(
        'src="__CDN__INJECTION__POINT__/assets/main.js"',
      );
    }
  });

  it('should NOT add placeholder to fully-qualified external URLs', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <link rel="stylesheet" href="https://fonts.vendor.com/font.css" />
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="https://analytics.vendor.com/a.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root');

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain('src="https://analytics.vendor.com/a.js"');
      expect(result.html).toContain('href="https://fonts.vendor.com/font.css"');
      expect(result.html).not.toContain('__CDN__INJECTION__POINT__');
    }
  });

  it('should NOT add placeholder to external URLs', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script src="https://external.com/lib.js"></script>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css" />
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root');

    expect(result.success).toBe(true);

    if (result.success) {
      // External URLs should remain unchanged
      expect(result.html).toContain('src="https://external.com/lib.js"');
      expect(result.html).toContain('href="https://fonts.googleapis.com/css"');
      expect(result.html).not.toContain('__CDN__INJECTION__POINT__');
    }
  });

  it('should handle mixed absolute and relative URLs correctly', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script src="/assets/vendor.js"></script>
          <script src="inline.js"></script>
          <script src="https://external.com/lib.js"></script>
          <link rel="stylesheet" href="/assets/styles.css" />
          <link rel="stylesheet" href="local.css" />
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root');

    expect(result.success).toBe(true);

    if (result.success) {
      // Absolute paths should have placeholder
      expect(result.html).toContain(
        'src="__CDN__INJECTION__POINT__/assets/vendor.js"',
      );
      expect(result.html).toContain(
        'href="__CDN__INJECTION__POINT__/assets/styles.css"',
      );

      // Relative paths should remain unchanged
      expect(result.html).toContain('src="inline.js"');
      expect(result.html).toContain('href="local.css"');

      // External URLs should remain unchanged
      expect(result.html).toContain('src="https://external.com/lib.js"');
    }
  });

  it('should NOT add CDN placeholder in development mode', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script src="/assets/vendor.js"></script>
          <link rel="stylesheet" href="/assets/styles.css" />
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    // isDevelopment = true
    const result = await processTemplate(html, 'ssr', true, true, 'root');

    expect(result.success).toBe(true);

    if (result.success) {
      // In development mode, URLs should remain unchanged (no CDN placeholder)
      expect(result.html).toContain('src="/assets/vendor.js"');
      expect(result.html).toContain('href="/assets/styles.css"');
      expect(result.html).not.toContain('__CDN__INJECTION__POINT__');
    }
  });
});

describe('processTemplate templateSlots', () => {
  const baseHTML = `
      <html>
        <head>
          <!--ss-head-->
          <meta charset="utf-8">
        </head>
        <body>
          <div id="root"><!--ss-outlet--></div>
          <script type="module" src="/EntryClient.tsx"></script>
        </body>
      </html>
    `;

  it('should produce identical output to no slots when the option is omitted', async () => {
    const withoutSlots = await processTemplate(baseHTML, 'ssr', false, false);
    const withEmptySlots = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {},
    );

    expect(withoutSlots.success).toBe(true);
    expect(withEmptySlots.success).toBe(true);

    if (withoutSlots.success && withEmptySlots.success) {
      // An app with no slots must be byte-for-byte what it was before slots existed. Nothing
      // is inserted, so there is no placeholder left behind and no stray blank line.
      expect(withEmptySlots.html).toBe(withoutSlots.html);
    }
  });

  it('should wrap headInlineScripts in script tags and place them at the end of head', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        headInlineScripts: ['console.log("first");', 'console.log("second");'],
      },
    );

    expect(result.success).toBe(true);

    if (result.success) {
      // The prettifier puts a script's source on its own indented line, so the tag and its
      // body are asserted separately rather than as one string.
      expect(result.html).toContain('<script>');
      expect(result.html).toContain('console.log("first");');
      expect(result.html).toContain('console.log("second");');

      // Slotted scripts go through the same relocation as the template's own head scripts,
      // so they land after the context placeholder and can read the context globals.
      const contextIndex = result.html.indexOf(
        '<!--context-scripts-injection-point-->',
      );
      const firstIndex = result.html.indexOf('console.log("first");');
      const secondIndex = result.html.indexOf('console.log("second");');

      expect(contextIndex).toBeGreaterThan(-1);
      expect(firstIndex).toBeGreaterThan(contextIndex);
      // Array order is preserved.
      expect(secondIndex).toBeGreaterThan(firstIndex);

      // ...and still inside the head, not spilled into the body.
      expect(secondIndex).toBeLessThan(result.html.indexOf('</head>'));
    }
  });

  it('should place slotted head scripts after the template own inline scripts', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <script>window.templateScript = true;</script>
        </head>
        <body>
          <div id="root"><!--ss-outlet--></div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root', {
      headInlineScripts: ['window.slottedScript = true;'],
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html.indexOf('window.slottedScript')).toBeGreaterThan(
        result.html.indexOf('window.templateScript'),
      );
    }
  });

  it('should skip blank headInlineScripts entries rather than emit an empty script tag', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        headInlineScripts: ['', '   ', 'console.log("real");'],
      },
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).not.toContain('<script></script>');
      expect(result.html).toContain('console.log("real");');
    }
  });

  it('should reject a headInlineScripts entry containing a script tag', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        headInlineScripts: ['<script>console.log("nested");</script>'],
      },
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toContain('headInlineScripts[0]');
      expect(result.error).toContain('JavaScript source only');
    }
  });

  it('should reject a headInlineScripts entry with a literal closing script tag in a string', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        // Would terminate the wrapper early and dump the rest into the document as markup.
        headInlineScripts: ['const s = "</script>";'],
      },
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toContain('headInlineScripts[0]');
    }
  });

  it('should prepend bodyPrepend before the container element', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        bodyPrepend: '<noscript><p>JavaScript is required.</p></noscript>',
      },
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain('JavaScript is required.');

      const noscriptIndex = result.html.indexOf('<noscript>');
      const bodyIndex = result.html.indexOf('<body>');
      const containerIndex = result.html.indexOf('<div id="root">');

      expect(noscriptIndex).toBeGreaterThan(bodyIndex);
      expect(noscriptIndex).toBeLessThan(containerIndex);
    }
  });

  it('should keep the development comment first in body when bodyPrepend is set', async () => {
    const result = await processTemplate(baseHTML, 'ssr', true, true, 'root', {
      bodyPrepend: '<noscript><p>JavaScript is required.</p></noscript>',
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(
        result.html.indexOf('React hydration relies on data attributes'),
      ).toBeLessThan(result.html.indexOf('<noscript>'));
    }
  });

  it('should preserve whitespace-sensitive content in a body slot, same as in the template', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <pre id="from-template">line one
    indented two</pre>
          <div id="root"><!--ss-outlet--></div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false, false, 'root', {
      bodyPrepend: `<pre id="from-slot">line one
    indented two</pre>`,
    });

    expect(result.success).toBe(true);

    if (result.success) {
      // A slot is not a special case: whitespace-sensitive content survives wherever it is
      // written, so slot content and template content behave the same way.
      expect(result.html).toContain(
        '<pre id="from-slot">line one\n    indented two</pre>',
      );
      expect(result.html).toContain(
        '<pre id="from-template">line one\n    indented two</pre>',
      );
    }
  });

  it('should preserve a style tag and comments inside bodyPrepend', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        bodyPrepend: `<noscript>
        <style>.warn { color: red; }</style>
        <!-- warning icon -->
        <div class="warn">No JS</div>
      </noscript>`,
      },
    );

    expect(result.success).toBe(true);

    if (result.success) {
      // Slot content is emitted as authored. Unlike template comments, which are stripped
      // unless ss- prefixed, a comment in a slot survives.
      expect(result.html).toContain('.warn { color: red; }');
      expect(result.html).toContain('<!-- warning icon -->');
      expect(result.html).toContain('No JS');
    }
  });

  it('should not relocate a script inside bodyPrepend to after the container', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        bodyPrepend: '<script>window.stayPut = true;</script>',
      },
    );

    expect(result.success).toBe(true);

    if (result.success) {
      // A <script> written in the template body is moved to after the container element.
      // One written in a slot is not: it stays where it was placed.
      const slotScriptIndex = result.html.indexOf('window.stayPut');
      const containerIndex = result.html.indexOf('<div id="root">');

      expect(slotScriptIndex).toBeGreaterThan(-1);
      expect(slotScriptIndex).toBeLessThan(containerIndex);

      // The template's own body script is still relocated after the container.
      expect(result.html.indexOf('EntryClient.tsx')).toBeGreaterThan(
        containerIndex,
      );
    }
  });

  it('should reject a headInlineScripts entry containing an ss- marker', async () => {
    // The head is emitted before the body, so this literal would be the document's first
    // occurrence of the marker and would take the injection meant for the real outlet,
    // swallowing the rendered page into a JS string and leaving the real outlet empty.
    const outletResult = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      { headInlineScripts: [`const tpl = "<!--ss-outlet-->";`] },
    );

    expect(outletResult.success).toBe(false);

    if (!outletResult.success) {
      expect(outletResult.error).toContain('headInlineScripts[0]');
      expect(outletResult.error).toContain('ss-outlet');
    }

    const headResult = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      { headInlineScripts: [`const tpl = "<!--ss-head-->";`] },
    );

    expect(headResult.success).toBe(false);

    if (!headResult.success) {
      expect(headResult.error).toContain('ss-head');
    }
  });

  it('should reject bodyPrepend containing an ss- marker', async () => {
    const outletResult = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      { bodyPrepend: '<div><!--ss-outlet--></div>' },
    );

    expect(outletResult.success).toBe(false);

    if (!outletResult.success) {
      expect(outletResult.error).toContain('ss-outlet');
    }

    const headResult = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      { bodyPrepend: '<div><!--ss-head--></div>' },
    );

    expect(headResult.success).toBe(false);

    if (!headResult.success) {
      expect(headResult.error).toContain('ss-head');
    }
  });

  it('should reject bodyPrepend that declares the container ID', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        bodyPrepend: '<div id="root">duplicate</div>',
      },
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toContain('id="root"');
    }
  });

  it('should reject the container ID however the attribute is spelled', async () => {
    // The check parses the slot rather than pattern-matching it, so every spelling HTML
    // allows for the same attribute is caught, not just the double-quoted one.
    const spellings = [
      '<div id=root>unquoted</div>',
      "<div id='root'>single quoted</div>",
      '<div ID="root">uppercase attribute name</div>',
      '<div id = "root">spaces around equals</div>',
      '<div class="wrap"><span id=root>nested</span></div>',
    ];

    for (const bodyPrepend of spellings) {
      const result = await processTemplate(
        baseHTML,
        'ssr',
        false,
        false,
        'root',
        { bodyPrepend },
      );

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error).toContain('id="root"');
      }
    }
  });

  it('should not treat an id that merely contains the container ID as a conflict', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      { bodyPrepend: '<div id="root-banner">not the container</div>' },
    );

    expect(result.success).toBe(true);
  });

  it('should handle a container ID with regex metacharacters', async () => {
    // containerID is caller-supplied and interpolated into no regex, so characters that
    // would be special in a pattern (".", "+") are matched literally.
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="app.v1+beta"><!--ss-outlet--></div>
        </body>
      </html>
    `;

    const conflict = await processTemplate(
      html,
      'ssr',
      false,
      false,
      'app.v1+beta',
      { bodyPrepend: '<div id="app.v1+beta">duplicate</div>' },
    );

    expect(conflict.success).toBe(false);

    // "." must not act as a wildcard: this ID differs only at those positions.
    const allowed = await processTemplate(
      html,
      'ssr',
      false,
      false,
      'app.v1+beta',
      { bodyPrepend: '<div id="appXv1+beta">different element</div>' },
    );

    expect(allowed.success).toBe(true);
  });

  it('should check bodyPrepend against a custom container ID', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="my-app"><!--ss-outlet--></div>
        </body>
      </html>
    `;

    const conflict = await processTemplate(
      html,
      'ssr',
      false,
      false,
      'my-app',
      {
        bodyPrepend: '<div id="my-app">duplicate</div>',
      },
    );

    expect(conflict.success).toBe(false);

    // The default container ID is not special: "root" is fine when the app mounts elsewhere.
    const allowed = await processTemplate(html, 'ssr', false, false, 'my-app', {
      bodyPrepend: '<div id="root">unrelated</div>',
    });

    expect(allowed.success).toBe(true);
  });

  it('should append bodyAppend at the end of body, after the client entry script', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        bodyAppend: '<div id="widget-mount">widget</div>',
      },
    );

    expect(result.success).toBe(true);

    if (result.success) {
      const widgetIndex = result.html.indexOf('widget-mount');
      const containerIndex = result.html.indexOf('<div id="root">');
      const entryIndex = result.html.indexOf('EntryClient.tsx');
      const bodyCloseIndex = result.html.indexOf('</body>');

      expect(widgetIndex).toBeGreaterThan(containerIndex);
      // Lands after the relocated body scripts, so it really is the last thing in <body>.
      expect(widgetIndex).toBeGreaterThan(entryIndex);
      expect(widgetIndex).toBeLessThan(bodyCloseIndex);
    }
  });

  it('should reject bodyAppend containing a marker or the container ID', async () => {
    const markerResult = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      { bodyAppend: '<div><!--ss-outlet--></div>' },
    );

    expect(markerResult.success).toBe(false);

    if (!markerResult.success) {
      expect(markerResult.error).toContain('bodyAppend');
      expect(markerResult.error).toContain('ss-outlet');
    }

    const containerResult = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      { bodyAppend: '<div id="root">duplicate</div>' },
    );

    expect(containerResult.success).toBe(false);

    if (!containerResult.success) {
      expect(containerResult.error).toContain('bodyAppend');
    }
  });

  it('should leave the container element untouched when body slots are used', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        bodyPrepend: '<noscript><p>No JS</p></noscript>',
        bodyAppend: '<div id="widget-mount">widget</div>',
      },
    );

    expect(result.success).toBe(true);

    if (result.success) {
      // The container stays on one line with no whitespace text nodes around the outlet,
      // which is what keeps hydration from mismatching.
      expect(result.html).toContain('<div id="root"><!--ss-outlet--></div>');
    }
  });

  it('should apply all slots together', async () => {
    const result = await processTemplate(
      baseHTML,
      'ssr',
      false,
      false,
      'root',
      {
        headInlineScripts: ['document.documentElement.classList.add("dark");'],
        bodyPrepend: '<noscript><p>No JS</p></noscript>',
        bodyAppend: '<div id="widget-mount">widget</div>',
      },
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain(
        'document.documentElement.classList.add("dark");',
      );
      expect(result.html).toContain('<noscript>');
      expect(result.html).toContain('No JS');
      expect(result.html).toContain('widget-mount');
    }
  });
});
