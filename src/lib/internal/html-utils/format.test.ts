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

    const result = await processTemplate(html, 'ssr', false);

    expect(result.success).toBe(true);

    if (result.success) {
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

    const result = await processTemplate(html, 'ssr', true);

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

    const result = await processTemplate(html, 'ssr', false);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).not.toContain(
        'React hydration relies on data attributes',
      );
      expect(result.html).toContain('<div id="root">');
      expect(result.html).toContain('Content');
    }
  });

  it('should remove meta tags except apple-mobile-web-app-title', async () => {
    const html = `
      <html>
        <head>
          <!--ss-head-->
          <meta name="description" content="Test">
          <meta name="apple-mobile-web-app-title" content="App">
          <meta name="viewport" content="width=device-width">
        </head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).not.toContain('name="description"');
      expect(result.html).not.toContain('name="viewport"');
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

    const result = await processTemplate(html, 'ssr', false);

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

  it('should add app config placeholder as first script', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
          <script src="app.js"></script>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssg', false);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain('<!--context-scripts-injection-point-->');

      // Context scripts placeholder should come before app.js
      const contextIndex = result.html.indexOf(
        '<!--context-scripts-injection-point-->',
      );
      const appJsIndex = result.html.indexOf('src="app.js"');
      expect(contextIndex).toBeLessThan(appJsIndex);
    }
  });

  it('should add request context placeholder before app config in SSR mode', async () => {
    const html = `
      <html>
        <head><!--ss-head--></head>
        <body>
          <div id="root"><!--ss-outlet-->Content</div>
        </body>
      </html>
    `;

    const result = await processTemplate(html, 'ssr', false);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain('<!--context-scripts-injection-point-->');
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

    const result = await processTemplate(html, 'ssr', false);

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

    const result = await processTemplate(html, 'ssg', false);

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

    const result = await processTemplate(html, 'ssr', false);

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

    const result = await processTemplate(html, 'ssg', false);

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

    const result = await processTemplate(html, 'ssr', false);

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

    const result = await processTemplate(html, 'ssr', false);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.html).toContain('src="lib1.js"');
      expect(result.html).toContain('src="lib2.js"');
      expect(result.html).toContain("console.log('inline1')");
      expect(result.html).toContain("console.log('inline2')");

      // All scripts should be after root element
      const rootEndIndex = result.html.indexOf('</div>');
      const lib1Index = result.html.indexOf('src="lib1.js"');
      const lib2Index = result.html.indexOf('src="lib2.js"');

      expect(lib1Index).toBeGreaterThan(rootEndIndex);
      expect(lib2Index).toBeGreaterThan(rootEndIndex);
    }
  });

  it('should preserve script order with app config first', async () => {
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

    const result = await processTemplate(html, 'ssg', false);

    expect(result.success).toBe(true);

    if (result.success) {
      const contextIndex = result.html.indexOf(
        '<!--context-scripts-injection-point-->',
      );
      const firstJsIndex = result.html.indexOf('src="first.js"');
      const secondJsIndex = result.html.indexOf('src="second.js"');

      expect(contextIndex).toBeLessThan(firstJsIndex);
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

    const result = await processTemplate(html, 'ssr', true);

    expect(result.success).toBe(true);

    if (result.success) {
      // Should remove title and description meta
      expect(result.html).not.toContain('<title>');
      expect(result.html).not.toContain('name="description"');

      // Should keep apple-mobile-web-app-title
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

    const result = await processTemplate(html, 'ssr', false);

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

    const result = await processTemplate(html, 'ssg', false);

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

    const result = await processTemplate(html, 'ssr', false);

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

    const result = await processTemplate(html, 'ssg', false);

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

    const result = await processTemplate(html, 'ssg', false, 'my-app');

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
