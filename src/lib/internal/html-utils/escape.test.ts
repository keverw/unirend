import { describe, it, expect } from 'bun:test';
import { escapeHTML, escapeHTMLAttr, decodeHTMLAttributeValue } from './escape';

// Half-written entities, spelled out so the attribute rule can be pinned.
// cspell:ignore ampy notit

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

describe('escapeHTMLAttr', () => {
  it('should escape ampersands', () => {
    expect(escapeHTMLAttr('foo & bar')).toBe('foo &amp; bar');
    expect(escapeHTMLAttr('&&&')).toBe('&amp;&amp;&amp;');
  });

  it('should escape less-than signs', () => {
    expect(escapeHTMLAttr('1 < 2')).toBe('1 &lt; 2');
    expect(escapeHTMLAttr('<')).toBe('&lt;');
  });

  it('should escape greater-than signs', () => {
    expect(escapeHTMLAttr('2 > 1')).toBe('2 &gt; 1');
    expect(escapeHTMLAttr('>')).toBe('&gt;');
  });

  it('should escape double quotes', () => {
    expect(escapeHTMLAttr('say "hello"')).toBe('say &quot;hello&quot;');
    expect(escapeHTMLAttr('"')).toBe('&quot;');
  });

  it('should not escape single quotes', () => {
    expect(escapeHTMLAttr("it's working")).toBe("it's working");
    expect(escapeHTMLAttr("'")).toBe("'");
  });

  it('should escape all attribute-sensitive characters in combination', () => {
    const input = '<img src="x" alt="A & B">';
    const expected = '&lt;img src=&quot;x&quot; alt=&quot;A &amp; B&quot;&gt;';
    expect(escapeHTMLAttr(input)).toBe(expected);
  });

  it('should handle empty strings', () => {
    expect(escapeHTMLAttr('')).toBe('');
  });

  it('should not modify strings without special characters', () => {
    expect(escapeHTMLAttr('hello world')).toBe('hello world');
    expect(escapeHTMLAttr('12345')).toBe('12345');
  });

  it('should preserve already-escaped sequences', () => {
    expect(escapeHTMLAttr('&lt;')).toBe('&amp;lt;');
  });
});

describe('decodeHTMLAttributeValue', () => {
  it('should decode standard named entities', () => {
    expect(decodeHTMLAttributeValue('foo &amp; bar')).toBe('foo & bar');
    expect(decodeHTMLAttributeValue('&quot;hello&quot;')).toBe('"hello"');
    expect(decodeHTMLAttributeValue('&lt;script&gt;')).toBe('<script>');
    expect(decodeHTMLAttributeValue('it&apos;s working')).toBe("it's working");
  });

  it('should decode other named HTML entities like nbsp and copy', () => {
    expect(decodeHTMLAttributeValue('A&nbsp;B')).toBe('A\u00A0B');
    expect(decodeHTMLAttributeValue('&copy;')).toBe('©');
  });

  it('should decode decimal numeric entities', () => {
    expect(decodeHTMLAttributeValue('&#38;')).toBe('&');
    expect(decodeHTMLAttributeValue('&#60;')).toBe('<');
    expect(decodeHTMLAttributeValue('&#62;')).toBe('>');
  });

  it('should decode hexadecimal numeric entities', () => {
    expect(decodeHTMLAttributeValue('&#x26;')).toBe('&');
    expect(decodeHTMLAttributeValue('&#x3c;')).toBe('<');
    expect(decodeHTMLAttributeValue('&#x3E;')).toBe('>');
  });

  it('should decode entities above 0xFFFF correctly using fromCodePoint', () => {
    expect(decodeHTMLAttributeValue('&#128512;')).toBe('😀');
    expect(decodeHTMLAttributeValue('&#x1f600;')).toBe('😀');
  });

  it('should handle invalid or malformed numeric entities', () => {
    expect(decodeHTMLAttributeValue('&#1114112;')).toBe('\uFFFD'); // > 0x10FFFF becomes replacement character
    expect(decodeHTMLAttributeValue('&#-1;')).toBe('&#-1;'); // '-' is malformed inside entity syntax
  });

  it('should handle unencoded text and leave unknown entities untouched', () => {
    expect(decodeHTMLAttributeValue('hello world')).toBe('hello world');
    expect(decodeHTMLAttributeValue('&unknown;')).toBe('&unknown;');
    expect(decodeHTMLAttributeValue('&#xyz;')).toBe('&#xyz;');
  });

  it('leaves a legacy reference alone when an alphanumeric follows it', () => {
    // The rule that makes this an attribute decoder rather than the general one. `amp`, `lt`, and
    // `not` are all legacy, so a missing semicolon still decodes them in character data, and an
    // attribute value does not when what follows could have been part of a longer name. A parser
    // reads all three of these as written, and so does the browser the client reads them back
    // from, so this has to agree or a tag's identity differs by which side computed it.
    expect(decodeHTMLAttributeValue('x&ampy')).toBe('x&ampy');
    expect(decodeHTMLAttributeValue('x&lty')).toBe('x&lty');
    expect(decodeHTMLAttributeValue('x&notit;')).toBe('x&notit;');
  });

  it('still decodes a legacy reference that ends the value', () => {
    // Nothing follows, so there is no longer name it could have been part of.
    expect(decodeHTMLAttributeValue('x&amp')).toBe('x&');
  });
});
