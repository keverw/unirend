import { describe, expect, it } from 'bun:test';
import {
  cspHeaderName,
  serializeCSP,
  validateCSPConfig,
  type CSPConfig,
} from './csp-policy';

function expectRejected(config: CSPConfig, matching: RegExp): void {
  expect(() => validateCSPConfig(config)).toThrow(matching);
}

describe('validateCSPConfig', () => {
  it('accepts keywords, schemes, hosts, wildcards, hashes and nonces', () => {
    expect(() =>
      validateCSPConfig({
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'strict-dynamic'",
          "'sha256-K/xkFcAmnzC1nOFrLRqZTHNzZDzuqTMKC0mVeVJ8n1E='",
          "'nonce-abc123'",
          'https://cdn.example.com',
        ],
        imgSrc: ["'self'", 'data:', 'blob:', '*.images.example.com', '*'],
        connectSrc: ['https://api.example.com/v1/'],
        frameAncestors: ["'none'"],
        baseURI: ["'self'"],
      }),
    ).not.toThrow();
  });

  it('rejects an unquoted keyword by name', () => {
    // The failure this prevents is silent: a browser reads bare `self` as a
    // host name, matches nothing, and the policy is quietly stricter than
    // written.
    expectRejected({ defaultSrc: ['self'] }, /must be quoted as 'self'/);
    expectRejected({ scriptSrc: ['none'] }, /must be quoted as 'none'/);
  });

  it('rejects a quoted value that is not a keyword, hash, or nonce', () => {
    // Typo or a keyword invented from memory. The browser ignores it.
    expectRejected(
      { scriptSrc: ["'unsafe-inline-scripts'"] },
      /is quoted but is not a known keyword/,
    );
  });

  it("requires opting in to 'unsafe-inline' in a script directive", () => {
    expectRejected(
      { scriptSrc: ["'unsafe-inline'"] },
      /allowUnsafeInlineScript/,
    );
    // default-src covers script too when script-src is absent, so it counts.
    expectRejected(
      { defaultSrc: ["'unsafe-inline'"] },
      /allowUnsafeInlineScript/,
    );

    expect(() =>
      validateCSPConfig({
        scriptSrc: ["'unsafe-inline'"],
        allowUnsafeInlineScript: true,
      }),
    ).not.toThrow();
  });

  it("allows 'unsafe-inline' in a style directive without an opt-in", () => {
    // Not the same risk. Inline styles are a real but far narrower problem than
    // inline script, and gating them behind a flag would push people to set a
    // flag whose name says "script" for a style problem.
    expect(() =>
      validateCSPConfig({ styleSrc: ["'self'", "'unsafe-inline'"] }),
    ).not.toThrow();
  });

  it("requires opting in to 'unsafe-eval'", () => {
    expectRejected({ scriptSrc: ["'unsafe-eval'"] }, /allowUnsafeEval/);
  });

  it("rejects 'none' alongside other sources", () => {
    expectRejected(
      { scriptSrc: ["'none'", "'self'"] },
      /combines 'none' with other sources/,
    );
  });

  it('rejects schemes that reintroduce script injection', () => {
    expectRejected({ scriptSrc: ['javascript:'] }, /javascript:/);
    expectRejected({ defaultSrc: ['vbscript:'] }, /vbscript:/);
  });

  it('rejects a source that could break out of its directive', () => {
    // A semicolon ends the directive, so an unchecked value could append
    // whatever it liked to the policy.
    expectRejected(
      { imgSrc: ['https://a.example.com;default-src'] },
      /would break out of the directive/,
    );
    expectRejected(
      { imgSrc: ['https://a.example.com script-src'] },
      /contains whitespace/,
    );
  });

  it('rejects a host the CORS validator would also reject', () => {
    // Same validator as CORS origins, so a wildcard over a public suffix fails
    // identically in both places rather than each having its own idea.
    expectRejected({ imgSrc: ['*.co.uk'] }, /is not a valid host/);
  });

  it('rejects a malformed sandbox token', () => {
    expectRejected({ sandbox: ['forms'] }, /is not a valid sandbox token/);
    expect(() =>
      validateCSPConfig({ sandbox: ['allow-forms', 'allow-scripts'] }),
    ).not.toThrow();
  });
});

describe('serializeCSP', () => {
  it('emits directives in a fixed order regardless of key order', () => {
    // Stable output keeps the header byte-identical for caches and diffs.
    const a = serializeCSP({ scriptSrc: ["'self'"], defaultSrc: ["'self'"] });
    const b = serializeCSP({ defaultSrc: ["'self'"], scriptSrc: ["'self'"] });

    expect(a).toBe(b);
    expect(a).toBe("default-src 'self'; script-src 'self'");
  });

  it('emits valueless directives and report targets', () => {
    expect(
      serializeCSP({
        defaultSrc: ["'self'"],
        upgradeInsecureRequests: true,
        reportURI: '/csp-report',
        reportTo: 'csp-endpoint',
      }),
    ).toBe(
      "default-src 'self'; upgrade-insecure-requests; report-uri /csp-report; report-to csp-endpoint",
    );
  });

  it('emits a bare sandbox for an empty token list', () => {
    expect(serializeCSP({ sandbox: [] })).toBe('sandbox');
  });

  it('returns an empty string when nothing is configured', () => {
    // Read by the caller as "send no header" rather than sending an empty one.
    expect(serializeCSP({})).toBe('');
    expect(serializeCSP({ reportOnly: true })).toBe('');
  });

  it('merges additions into a directive that is set', () => {
    expect(
      serializeCSP({ scriptSrc: ["'self'"] }, { scriptSrc: ["'sha256-abc='"] }),
    ).toBe("script-src 'self' 'sha256-abc='");
  });

  it('does not create a directive that was not configured', () => {
    // The trap this avoids: adding a hash to an unset script-src would create a
    // script-src, which then overrides default-src and blocks everything the
    // caller expected default-src to allow.
    expect(
      serializeCSP(
        { defaultSrc: ["'self'"] },
        { scriptSrc: ["'sha256-abc='"] },
      ),
    ).toBe("default-src 'self'");
  });

  it('deduplicates a source already present', () => {
    expect(
      serializeCSP(
        { styleSrc: ["'self'", "'sha256-abc='"] },
        { styleSrc: ["'sha256-abc='"] },
      ),
    ).toBe("style-src 'self' 'sha256-abc='");
  });
});

describe('cspHeaderName', () => {
  it('switches to the report-only header', () => {
    expect(cspHeaderName({})).toBe('Content-Security-Policy');
    expect(cspHeaderName({ reportOnly: true })).toBe(
      'Content-Security-Policy-Report-Only',
    );
  });
});
