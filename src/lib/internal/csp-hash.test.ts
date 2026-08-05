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
