import { describe, it, expect } from 'bun:test';
import { escapeHTML } from './escape';

describe('escapeHTML', () => {
  it('should escape ampersands', () => {
    expect(escapeHTML('foo & bar')).toBe('foo &amp; bar');
    expect(escapeHTML('&&&')).toBe('&amp;&amp;&amp;');
  });

  it('should escape less-than signs', () => {
    expect(escapeHTML('1 < 2')).toBe('1 &lt; 2');
    expect(escapeHTML('<')).toBe('&lt;');
  });

  it('should escape greater-than signs', () => {
    expect(escapeHTML('2 > 1')).toBe('2 &gt; 1');
    expect(escapeHTML('>')).toBe('&gt;');
  });

  it('should escape double quotes', () => {
    expect(escapeHTML('say "hello"')).toBe('say &quot;hello&quot;');
    expect(escapeHTML('"')).toBe('&quot;');
  });

  it('should escape single quotes', () => {
    expect(escapeHTML("it's working")).toBe('it&#39;s working');
    expect(escapeHTML("'")).toBe('&#39;');
  });

  it('should escape all special characters in combination', () => {
    const input = '<script>alert("XSS & \'hacks\'")</script>';
    const expected =
      '&lt;script&gt;alert(&quot;XSS &amp; &#39;hacks&#39;&quot;)&lt;/script&gt;';
    expect(escapeHTML(input)).toBe(expected);
  });

  it('should handle empty strings', () => {
    expect(escapeHTML('')).toBe('');
  });

  it('should not modify strings without special characters', () => {
    expect(escapeHTML('hello world')).toBe('hello world');
    expect(escapeHTML('12345')).toBe('12345');
  });

  it('should escape multiple occurrences', () => {
    expect(escapeHTML('<<>>')).toBe('&lt;&lt;&gt;&gt;');
    expect(escapeHTML('""""')).toBe('&quot;&quot;&quot;&quot;');
  });

  it('should preserve already-escaped sequences', () => {
    // Note: This tests the actual behavior - it will double-escape
    // If you need idempotent escaping, that would require a different function
    expect(escapeHTML('&lt;')).toBe('&amp;lt;');
  });

  it('should handle XSS injection attempts', () => {
    const xssAttempts = [
      '<img src=x onerror="alert(1)">',
      '<svg/onload=alert(1)>',
      'javascript:alert(1)',
      '<iframe src="javascript:alert(1)">',
      '"><script>alert(1)</script>',
      "' onclick='alert(1)",
    ];

    for (const attempt of xssAttempts) {
      const escaped = escapeHTML(attempt);
      // Verify none of the dangerous characters remain unescaped
      expect(escaped).not.toMatch(/<(?!&)/); // No unescaped <
      expect(escaped).not.toMatch(/(?<!&)>/); // No unescaped >
      expect(escaped).not.toMatch(/(?<!&)"/); // No unescaped "
      expect(escaped).not.toMatch(/(?<!&#)'/); // No unescaped '
    }
  });

  it('should work with real-world error messages', () => {
    const errorMessage = 'Error: <Module> not found in "/path/to/file.ts"';
    const expected =
      'Error: &lt;Module&gt; not found in &quot;/path/to/file.ts&quot;';
    expect(escapeHTML(errorMessage)).toBe(expected);
  });

  it('should work with URLs containing query params', () => {
    const url = 'https://example.com/search?q=<script>&foo="bar"';
    const expected =
      'https://example.com/search?q=&lt;script&gt;&amp;foo=&quot;bar&quot;';
    expect(escapeHTML(url)).toBe(expected);
  });
});
