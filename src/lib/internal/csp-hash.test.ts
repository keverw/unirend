import { describe, it, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { hashInlineContentForCSP } from './csp-hash';

describe('hashInlineContentForCSP', () => {
  it('returns an unquoted sha256 source expression by default', () => {
    const hash = hashInlineContentForCSP('body { margin: 0; }');

    expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
    // Unquoted: the directive assembler adds the quotes, since a source list
    // has unquoted members too.
    expect(hash).not.toContain("'");
  });

  it('matches a digest computed independently', () => {
    const content = 'console.log("hi");';
    const expected = createHash('sha256')
      .update(content, 'utf8')
      .digest('base64');

    expect(hashInlineContentForCSP(content)).toBe(`sha256-${expected}`);
  });

  it('supports sha384 and sha512', () => {
    expect(hashInlineContentForCSP('x', 'sha384')).toStartWith('sha384-');
    expect(hashInlineContentForCSP('x', 'sha512')).toStartWith('sha512-');
  });

  it('treats whitespace as significant', () => {
    // The reason every caller has to hash the delivered bytes rather than a
    // tidied-up copy of them. Browsers do not trim before hashing.
    expect(hashInlineContentForCSP('a{}')).not.toBe(
      hashInlineContentForCSP(' a{}'),
    );
    expect(hashInlineContentForCSP('a{}')).not.toBe(
      hashInlineContentForCSP('a{}\n'),
    );
  });

  it('normalizes line endings the way a browser does before hashing', () => {
    // The reason this is not "no normalization at all": a CSP hash is matched
    // against a DOM value, and newline normalization happens while the input
    // stream is preprocessed, before any of the markup is tokenized. So a
    // constant living in a file checked out on Windows carries CRLFs, ships
    // with them, and is hashed by the browser without them. Hashing the source
    // literally published a digest nothing could match, and the page rendered
    // unstyled under a strict style-src.
    const lf = 'body{\n  margin:0\n}';

    expect(hashInlineContentForCSP('body{\r\n  margin:0\r\n}')).toBe(
      hashInlineContentForCSP(lf),
    );

    // A lone CR is normalized too, not only the CRLF pair.
    expect(hashInlineContentForCSP('body{\r  margin:0\r}')).toBe(
      hashInlineContentForCSP(lf),
    );

    // Whitespace that is not a line ending is still significant, so this has
    // not quietly become a trimming hash.
    expect(hashInlineContentForCSP(lf)).not.toBe(
      hashInlineContentForCSP(`${lf}\n`),
    );
  });

  it('replaces NUL the way the tokenizer does before hashing', () => {
    // The other character that cannot reach a DOM value. Written as an escape
    // rather than a raw byte, which the repo's null-byte gate also requires.
    expect(hashInlineContentForCSP('a{content:"\0"}')).toBe(
      hashInlineContentForCSP('a{content:"�"}'),
    );
  });

  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // A stylesheet with a non-ASCII content: string is enough to hit this, and
    // getting the encoding wrong produces a hash that never matches in a
    // browser while looking perfectly plausible in a test.
    const content = '.x::after { content: "→"; }';

    expect(hashInlineContentForCSP(content)).toBe(
      `sha256-${createHash('sha256').update(Buffer.from(content, 'utf8')).digest('base64')}`,
    );
  });
});
