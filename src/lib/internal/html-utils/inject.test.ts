import { describe, expect, it } from 'bun:test';
import { prettifyHeadTags, injectContent } from './inject';
import { tab_spaces } from '../consts';

describe('prettifyHeadTags', () => {
  it('should prettify head tags with default indentation', () => {
    const input =
      '<title>Test Title</title><meta name="description" content="Test Description"><link rel="stylesheet" href="styles.css">';
    const expected =
      `<title>Test Title</title>\n` +
      `${tab_spaces}<meta name="description" content="Test Description">\n` +
      `${tab_spaces}<link rel="stylesheet" href="styles.css">`;

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
      `${tab_spaces}<script src="script.js"></script>\n` +
      `${tab_spaces}<style>body { color: red; }</style>`;

    expect(prettifyHeadTags(input)).toBe(expected);
  });

  it('should filter out empty strings', () => {
    const input = '<title>Test</title><meta name="description" content="Test">';
    const expected =
      `<title>Test</title>\n` +
      `${tab_spaces}<meta name="description" content="Test">`;

    expect(prettifyHeadTags(input)).toBe(expected);
  });
});

describe('injectContent', () => {
  it('should inject head and body content into template', () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--></body></html>';
    const headContent =
      '<title>Test Title</title><meta name="description" content="Test">';
    const bodyContent = '<div>Hello World</div>';

    const expected =
      '<!DOCTYPE html><html><head>' +
      `<title>Test Title</title>\n` +
      `${tab_spaces}<meta name="description" content="Test">` +
      '</head><body><div>Hello World</div></body></html>';

    expect(injectContent(template, headContent, bodyContent)).toBe(expected);
  });

  it('should handle empty head and body content', () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--></body></html>';

    const expected = '<!DOCTYPE html><html><head></head><body></body></html>';

    expect(injectContent(template, '', '')).toBe(expected);
  });

  it('should preserve React attributes in template', () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><div id="root" data-reactroot=""><!--ss-outlet--></div><!--context-scripts-injection-point--></body></html>';
    const headContent = '<title>React App</title>';
    const bodyContent = '<div>React Content</div>';

    const expected =
      '<!DOCTYPE html><html><head>' +
      `<title>React App</title>` +
      '</head><body><div id="root" data-reactroot=""><div>React Content</div></div></body></html>';

    expect(injectContent(template, headContent, bodyContent)).toBe(expected);
  });

  it('should inject app config when provided', () => {
    const template =
      '<!DOCTYPE html><html><head><!--ss-head--></head><body><!--ss-outlet--><!--context-scripts-injection-point--></body></html>';
    const headContent = '<title>Test</title>';
    const bodyContent = '<div>Content</div>';
    const appConfig = { apiUrl: 'https://api.example.com', debug: true };

    const result = injectContent(template, headContent, bodyContent, {
      app: appConfig,
    });

    expect(result).toContain('window.__FRONTEND_APP_CONFIG__=');
    expect(result).toContain('"apiUrl":"https://api.example.com"');
    expect(result).toContain('"debug":true');
  });

  it('should escape < characters in app config', () => {
    const template =
      '<!DOCTYPE html><html><body><!--ss-outlet--><!--context-scripts-injection-point--></body></html>';
    const appConfig = { htmlContent: "<script>alert('xss')</script>" };

    const result = injectContent(template, '', '', { app: appConfig });

    expect(result).toContain('\\u003c');
    expect(result).not.toContain('<script>alert');
  });

  it('should inject request context when provided', () => {
    const template =
      '<!DOCTYPE html><html><body><!--ss-outlet--><!--context-scripts-injection-point--></body></html>';
    const requestContext = {
      user: { id: '123', name: 'John' },
      locale: 'en-US',
    };

    const result = injectContent(template, '', '', { request: requestContext });

    expect(result).toContain('window.__FRONTEND_REQUEST_CONTEXT__=');
    expect(result).toContain('"user"');
    expect(result).toContain('"id":"123"');
    expect(result).toContain('"locale":"en-US"');
  });

  it('should remove context scripts placeholder when not provided', () => {
    const template =
      '<!DOCTYPE html><html><body><!--ss-outlet--><!--context-scripts-injection-point--></body></html>';

    const result = injectContent(template, '', '');

    expect(result).not.toContain('<!--context-scripts-injection-point-->');
    expect(result).not.toContain('window.__FRONTEND_REQUEST_CONTEXT__');
    expect(result).not.toContain('window.__FRONTEND_APP_CONFIG__');
  });

  it('should inject both app config and request context', () => {
    const template =
      '<!DOCTYPE html><html><body><!--ss-outlet--><!--context-scripts-injection-point--></body></html>';
    const appConfig = { apiUrl: 'https://api.example.com' };
    const requestContext = { user: { id: '123' } };

    const result = injectContent(template, '', '', {
      app: appConfig,
      request: requestContext,
    });

    expect(result).toContain('window.__FRONTEND_APP_CONFIG__=');
    expect(result).toContain('"apiUrl":"https://api.example.com"');
    expect(result).toContain('window.__FRONTEND_REQUEST_CONTEXT__=');
    expect(result).toContain('"user"');
  });

  it('should inject both scripts on separate lines when both provided', () => {
    const template =
      '<!DOCTYPE html><html><body><!--ss-outlet--><!--context-scripts-injection-point--></body></html>';
    const appConfig = { apiUrl: 'https://api.example.com' };
    const requestContext = { user: { id: '123' } };

    const result = injectContent(template, '', '', {
      app: appConfig,
      request: requestContext,
    });

    // Should contain both scripts
    expect(result).toContain('window.__FRONTEND_REQUEST_CONTEXT__=');
    expect(result).toContain('window.__FRONTEND_APP_CONFIG__=');

    // Should have newline between them
    const requestIndex = result.indexOf('window.__FRONTEND_REQUEST_CONTEXT__');
    const configIndex = result.indexOf('window.__FRONTEND_APP_CONFIG__');
    expect(requestIndex).toBeLessThan(configIndex);
  });
});
