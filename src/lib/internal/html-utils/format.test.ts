import { describe, it, expect } from "bun:test";
import * as cheerio from "cheerio";
import { prettifyHtml, processTemplate } from "./format";

// Helper: split output by new lines (trim the trailing \n added by prettifyHtml)
// and assert that each expected line appears in the output **in the given order**.
// This lets us verify ordering (and indentation) without listing every boilerplate line (html, head, body wrappers, etc.).
function expectLinesInOrder(result: string, expected: string[]) {
  const lines = result.trimEnd().split("\n");

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

describe("prettifyHtml", () => {
  it("should format simple HTML correctly", () => {
    const $ = cheerio.load("<div>Hello World</div>");
    const result = prettifyHtml($);

    expectLinesInOrder(result, [
      "    <div>",
      "      Hello World",
      "    </div>",
    ]);
  });

  it("should format nested HTML with proper indentation", () => {
    const $ = cheerio.load("<div><p>Hello</p><span>World</span></div>");
    const result = prettifyHtml($);

    expectLinesInOrder(result, [
      "    <div>",
      "      <p>",
      "        Hello",
      "      </p>",
      "      <span>",
      "        World",
      "      </span>",
      "    </div>",
    ]);
  });

  it("should handle self-closing tags", () => {
    const $ = cheerio.load("<div><img src='test.jpg' alt='test'/><br/></div>");
    const result = prettifyHtml($);

    expectLinesInOrder(result, [
      "    <div>",
      '      <img src="test.jpg" alt="test"/>',
      "      <br/>",
      "    </div>",
    ]);
  });

  it("should handle attributes correctly", () => {
    const $ = cheerio.load(
      '<div class="container" id="main"><p data-test>Content</p></div>',
    );
    const result = prettifyHtml($);

    expectLinesInOrder(result, [
      '    <div class="container" id="main">',
      "      <p data-test>",
      "        Content",
      "      </p>",
      "    </div>",
    ]);
  });

  it("should handle empty tags", () => {
    const $ = cheerio.load("<div><p></p><span></span></div>");
    const result = prettifyHtml($);

    expectLinesInOrder(result, [
      "    <div>",
      "      <p></p>",
      "      <span></span>",
      "    </div>",
    ]);
  });

  it("should handle comments", () => {
    const $ = cheerio.load(
      "<div><!-- This is a comment --><p>Content</p></div>",
    );
    const result = prettifyHtml($);

    expectLinesInOrder(result, [
      "    <div>",
      "      <!-- This is a comment -->",
      "      <p>",
      "        Content",
      "      </p>",
      "    </div>",
    ]);
  });

  it("should handle root element specially (single line content)", () => {
    const $ = cheerio.load('<div id="root"><span>App Content</span></div>');
    const result = prettifyHtml($);

    expectLinesInOrder(result, [
      '    <div id="root"><span>App Content</span></div>',
    ]);
  });

  it("should handle custom containerID", () => {
    const $ = cheerio.load(
      '<div id="app-container"><header><h1>Title</h1></header><main><p>Content</p></main></div>',
    );
    const result = prettifyHtml($, "app-container");

    expectLinesInOrder(result, [
      '    <div id="app-container"><header><h1>Title</h1></header><main><p>Content</p></main></div>',
    ]);
  });

  it("should handle mixed content types", () => {
    const $ = cheerio.load("<div>Text <strong>bold</strong> more text</div>");
    const result = prettifyHtml($);

    expect(result).toContain("Text");
    expect(result).toContain("<strong>");
    expect(result).toContain("bold");
    expect(result).toContain("more text");
  });

  it("should format complete HTML document", () => {
    const $ = cheerio.load(
      "<html><head><title>Test</title></head><body><div>Content</div></body></html>",
    );
    const result = prettifyHtml($);

    expect(result).toContain("<html>");
    expect(result).toContain("<head>");
    expect(result).toContain("<title>");
    expect(result).toContain("Test");
    expect(result).toContain("<body>");
    expect(result).toContain("<div>");
    expect(result).toContain("Content");
  });

  it("should handle directive nodes", () => {
    // Create HTML with DOCTYPE directive
    const html = "<!DOCTYPE html><html><body><div>Content</div></body></html>";
    const $ = cheerio.load(html);
    const result = prettifyHtml($);

    // Should contain the DOCTYPE directive
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("<html>");
    expect(result).toContain("Content");
  });

  it("should handle XML processing instructions", () => {
    // Test XML processing instruction (another type of directive)
    const html = "<?xml version='1.0'?><root><item>test</item></root>";
    const $ = cheerio.load(html, { xmlMode: true });
    const result = prettifyHtml($);

    // Should contain the XML processing instruction
    expect(result).toContain("<?xml version='1.0'?>");
    expect(result).toContain("<root>");
    expect(result).toContain("test");
  });
});

describe("processTemplate", () => {
  it("should remove title tags from head", () => {
    const html = `
      <html>
        <head>
          <title>Test Title</title>
          <meta charset="utf-8">
        </head>
        <body>
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    expect(result).not.toContain("<title>");
    expect(result).not.toContain("Test Title");
  });

  it("should add development comment when isDevelopment is true", () => {
    const html = `
      <html>
        <body>
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = processTemplate(html, true);

    expect(result).toContain("React hydration relies on data attributes");
    expect(result).toContain('<div id="root">Content</div>');
  });

  it("should not add development comment when isDevelopment is false", () => {
    const html = `
      <html>
        <body>
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    expect(result).not.toContain("React hydration relies on data attributes");
    expect(result).toContain('<div id="root">Content</div>');
  });

  it("should remove meta tags except apple-mobile-web-app-title", () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Test">
          <meta name="apple-mobile-web-app-title" content="App">
          <meta name="viewport" content="width=device-width">
        </head>
        <body>
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    expect(result).not.toContain('name="description"');
    expect(result).not.toContain('name="viewport"');
    expect(result).toContain('name="apple-mobile-web-app-title"');
  });

  it("should move scripts after root element", () => {
    const html = `
      <html>
        <head>
          <script src="header.js"></script>
        </head>
        <body>
          <div id="root">Content</div>
          <script src="footer.js"></script>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    // Scripts should be after the root element
    const rootIndex = result.indexOf('<div id="root">');
    const rootEndIndex = result.indexOf("</div>", rootIndex);
    const scriptIndex = result.indexOf("<script", rootEndIndex);

    expect(scriptIndex).toBeGreaterThan(rootEndIndex);
    expect(result).toContain('src="header.js"');
    expect(result).toContain('src="footer.js"');
  });

  it("should add app config as first script when provided", () => {
    const html = `
      <html>
        <body>
          <div id="root">Content</div>
          <script src="app.js"></script>
        </body>
      </html>
    `;

    const appConfig = { apiUrl: "https://api.example.com", debug: true };
    const result = processTemplate(html, false, appConfig);

    expect(result).toContain("window.__APP_CONFIG__");
    expect(result).toContain('"apiUrl":"https://api.example.com"');
    expect(result).toContain('"debug":true');

    // Config script should come before app.js
    const configIndex = result.indexOf("window.__APP_CONFIG__");
    const appJsIndex = result.indexOf('src="app.js"');
    expect(configIndex).toBeLessThan(appJsIndex);
  });

  it("should escape < characters in app config", () => {
    const html = `
      <html>
        <body>
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const appConfig = { htmlContent: "<script>alert('xss')</script>" };
    const result = processTemplate(html, false, appConfig);

    expect(result).toContain("\\u003c");
    expect(result).not.toContain("<script>alert");
  });

  it("should remove comments that don't start with ss- but preserve ss- comments", () => {
    const html = `
      <html>
        <body>
          <!-- Regular comment -->
          <!-- ss-special comment -->
          <div id="root">
            <!-- Another regular comment -->
            <!--ss-no-space-->
            <!-- ss-with-space -->
            Content
          </div>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    // Regular comments should be removed
    expect(result).not.toContain("Regular comment");
    expect(result).not.toContain("Another regular comment");

    // ss- comments should be preserved and normalized
    expect(result).toContain("ss-special comment");
    expect(result).toContain("ss-no-space");
    expect(result).toContain("ss-with-space");

    // Verify normalization - spaces should be trimmed
    expect(result).toContain("<!--ss-no-space-->");
    expect(result).toContain("<!--ss-with-space-->");
    expect(result).not.toContain("<!-- ss-with-space -->");

    expect(result).toContain("Content");
    expect(result).toContain('<div id="root">');
  });

  it("should handle ss- comments with various spacing and normalize them", () => {
    const html = `
      <html>
        <body>
          <!--ss-outlet-->
          <!-- ss-outlet -->
          <!--  ss-outlet  -->
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    // All variations should be preserved and normalized
    expect(result).toContain("ss-outlet");
    expect(result).toContain("Content");

    // Count occurrences - should have 3 ss-outlet comments
    const matches = result.match(/ss-outlet/g);
    expect(matches).toHaveLength(3);

    // Verify that spaces are trimmed from ss- comments
    // Should not contain comments with extra spaces
    expect(result).not.toContain("<!--  ss-outlet  -->");
    expect(result).not.toContain("<!-- ss-outlet -->");

    // Should contain normalized version
    expect(result).toContain("<!--ss-outlet-->");
  });

  it("should normalize ss- comments by removing leading/trailing spaces", () => {
    const html = `
      <html>
        <body>
          <!--   ss-special-comment   -->
          <!-- ss-another -->
          <div id="root">Content</div>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    // Should contain normalized comments without extra spaces
    expect(result).toContain("<!--ss-special-comment-->");
    expect(result).toContain("<!--ss-another-->");

    // Should not contain the original spaced versions
    expect(result).not.toContain("<!--   ss-special-comment   -->");
    expect(result).not.toContain("<!-- ss-another -->");
  });

  it("should handle HTML without root element", () => {
    const html = `
      <html>
        <body>
          <div class="container">Content</div>
          <script src="app.js"></script>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    // Script should be appended to body when no root element exists
    expect(result).toContain('src="app.js"');
    expect(result).toContain('class="container"');
    expect(result).toContain("Content");
  });

  it("should handle empty HTML", () => {
    const html = "<html><body></body></html>";

    const result = processTemplate(html, false);

    expect(result).toContain("<html>");
    expect(result).toContain("<body>");
  });

  it("should handle multiple script tags correctly", () => {
    const html = `
      <html>
        <head>
          <script src="lib1.js"></script>
          <script>console.log('inline1');</script>
        </head>
        <body>
          <div id="root">Content</div>
          <script src="lib2.js"></script>
          <script>console.log('inline2');</script>
        </body>
      </html>
    `;

    const result = processTemplate(html, false);

    expect(result).toContain('src="lib1.js"');
    expect(result).toContain('src="lib2.js"');
    expect(result).toContain("console.log('inline1')");
    expect(result).toContain("console.log('inline2')");

    // All scripts should be after root element
    const rootEndIndex = result.indexOf("</div>");
    const lib1Index = result.indexOf('src="lib1.js"');
    const lib2Index = result.indexOf('src="lib2.js"');

    expect(lib1Index).toBeGreaterThan(rootEndIndex);
    expect(lib2Index).toBeGreaterThan(rootEndIndex);
  });

  it("should preserve script order with app config first", () => {
    const html = `
      <html>
        <body>
          <div id="root">Content</div>
          <script src="first.js"></script>
          <script src="second.js"></script>
        </body>
      </html>
    `;

    const appConfig = { test: true };
    const result = processTemplate(html, false, appConfig);

    const configIndex = result.indexOf("window.__APP_CONFIG__");
    const firstJsIndex = result.indexOf('src="first.js"');
    const secondJsIndex = result.indexOf('src="second.js"');

    expect(configIndex).toBeLessThan(firstJsIndex);
    expect(firstJsIndex).toBeLessThan(secondJsIndex);
  });

  it("should handle complex nested HTML structure", () => {
    const html = `
      <html>
        <head>
          <title>Remove Me</title>
          <meta name="description" content="Remove me too">
          <meta name="apple-mobile-web-app-title" content="Keep me">
        </head>
        <body>
          <!-- Remove this comment -->
          <!-- ss-keep this comment -->
          <div id="root">
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

    const result = processTemplate(html, true);

    // Should remove title and description meta
    expect(result).not.toContain("<title>");
    expect(result).not.toContain('name="description"');

    // Should keep apple-mobile-web-app-title
    expect(result).toContain('name="apple-mobile-web-app-title"');

    // Should remove regular comment but keep ss- comment
    expect(result).not.toContain("Remove this comment");
    expect(result).toContain("ss-keep this comment");

    // Should add development comment and preserve it
    expect(result).toContain("React hydration relies on data attributes");

    // Should move script after root
    const rootEndIndex = result.indexOf("</div>");
    const scriptIndex = result.indexOf('src="app.js"');
    expect(scriptIndex).toBeGreaterThan(rootEndIndex);

    // Should format root element on single line
    expect(result).toContain('<div id="root"><header>');
    expect(result).toContain("Title");
    expect(result).toContain("Content");
    expect(result).toContain("</header><main>");
    expect(result).toContain("</main></div>");
  });
});

describe("processTemplate with custom containerID", () => {
  it("should handle custom containerID in processTemplate", () => {
    const html = `
      <html>
        <body>
          <div id="my-app">
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

    const result = processTemplate(html, false, undefined, "my-app");

    // Should format my-app element on single line
    expectLinesInOrder(result, [
      '    <div id="my-app"><header><h1>Title</h1></header><main><p>Content</p></main></div>',
    ]);

    // Should move script after my-app element
    const myAppEndIndex = result.indexOf("</div>");
    const scriptIndex = result.indexOf('src="app.js"');
    expect(scriptIndex).toBeGreaterThan(myAppEndIndex);
  });
});
