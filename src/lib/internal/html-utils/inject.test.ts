import { describe, expect, it } from "bun:test";
import { prettifyHeadTags, injectContent } from "./inject";
import { tab_spaces } from "../consts";

describe("prettifyHeadTags", () => {
  it("should prettify head tags with default indentation", () => {
    const input =
      '<title>Test Title</title><meta name="description" content="Test Description"><link rel="stylesheet" href="styles.css">';
    const expected =
      `<title>Test Title</title>\n` +
      `${tab_spaces}<meta name="description" content="Test Description">\n` +
      `${tab_spaces}<link rel="stylesheet" href="styles.css">`;

    expect(prettifyHeadTags(input)).toBe(expected);
  });

  it("should handle empty input", () => {
    expect(prettifyHeadTags("")).toBe("");
  });

  it("should use custom indentation when provided", () => {
    const input =
      '<title>Test Title</title><meta name="description" content="Test">';
    const customIndent = "  "; // 2 spaces
    const expected =
      `<title>Test Title</title>\n` +
      `${customIndent}<meta name="description" content="Test">`;

    expect(prettifyHeadTags(input, customIndent)).toBe(expected);
  });

  it("should handle script and style tags", () => {
    const input =
      '<title>Test</title><script src="script.js"></script><style>body { color: red; }</style>';
    const expected =
      `<title>Test</title>\n` +
      `${tab_spaces}<script src="script.js"></script>\n` +
      `${tab_spaces}<style>body { color: red; }</style>`;

    expect(prettifyHeadTags(input)).toBe(expected);
  });

  it("should filter out empty strings", () => {
    const input = '<title>Test</title><meta name="description" content="Test">';
    const expected =
      `<title>Test</title>\n` +
      `${tab_spaces}<meta name="description" content="Test">`;

    expect(prettifyHeadTags(input)).toBe(expected);
  });
});

describe("injectContent", () => {
  it("should inject head and body content into template", () => {
    const template =
      "<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--></body></html>";
    const headContent =
      '<title>Test Title</title><meta name="description" content="Test">';
    const bodyContent = "<div>Hello World</div>";

    const expected =
      "<!DOCTYPE html><html><head>" +
      `<title>Test Title</title>\n` +
      `${tab_spaces}<meta name="description" content="Test">` +
      "</head><body><div>Hello World</div></body></html>";

    expect(injectContent(template, headContent, bodyContent)).toBe(expected);
  });

  it("should handle empty head and body content", () => {
    const template =
      "<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--></body></html>";

    const expected = "<!DOCTYPE html><html><head></head><body></body></html>";

    expect(injectContent(template, "", "")).toBe(expected);
  });

  it("should preserve React attributes in template", () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><div id="root" data-reactroot=""><!--ss-outlet--></div></body></html>';
    const headContent = "<title>React App</title>";
    const bodyContent = "<div>React Content</div>";

    const expected =
      "<!DOCTYPE html><html><head>" +
      `<title>React App</title>` +
      '</head><body><div id="root" data-reactroot=""><div>React Content</div></div></body></html>';

    expect(injectContent(template, headContent, bodyContent)).toBe(expected);
  });

  it("should work with isDev parameter", () => {
    const template =
      "<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--></body></html>";
    const headContent = "<title>Dev Mode</title>";
    const bodyContent = "<div>Dev Content</div>";

    // isDev parameter doesn't change the output in the current implementation
    // but we test it to ensure the function accepts it correctly
    const expected =
      "<!DOCTYPE html><html><head>" +
      `<title>Dev Mode</title>` +
      "</head><body><div>Dev Content</div></body></html>";

    expect(injectContent(template, headContent, bodyContent, true)).toBe(
      expected,
    );
  });
});
