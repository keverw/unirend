import { describe, expect, it } from 'bun:test';
import {
  applyCSPPreset,
  cspHeaderName,
  serializeCSP,
  validateCSPConfig,
  type CSPConfig,
} from './csp-policy';
import { securityHeaders } from '../built-in-plugins/security-headers';

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

  it('rejects an empty reportTo group', () => {
    // An empty string contains none of the forbidden characters, so a check
    // that only looked for those would pass it through to serialization, where
    // it becomes the bare directive `report-to` with no group. A browser drops
    // that, which silently turns reporting off for the policy whose entire job
    // is telling you what got blocked.
    expectRejected({ reportTo: '' }, /is not a usable group name/);
    expectRejected({ reportTo: '   ' }, /is not a usable group name/);
  });

  it('accepts a report endpoint a browser can post to', () => {
    expect(() => validateCSPConfig({ reportURI: '/csp-report' })).not.toThrow();
    expect(() =>
      validateCSPConfig({
        reportURI: [
          'https://reports.example.com/collect',
          '//cdn.example.com/r',
        ],
      }),
    ).not.toThrow();
  });

  it('rejects a report endpoint that would silently collect nothing', () => {
    // Every one of these serializes into a header that looks like reporting is
    // on. A page-relative URI resolves against whatever page was being viewed,
    // so reports scatter across endpoints that mostly do not exist, and a
    // scheme a browser will not post over is dropped outright. Both fail the
    // same way: violations happen, nothing arrives, and the quiet reads as a
    // policy nobody is tripping over.
    expectRejected({ reportURI: 'csp-report' }, /relative to the current page/);
    expectRejected(
      { reportURI: 'javascript:alert(1)' },
      /only posts violation reports over http or https/,
    );
    expectRejected({ reportURI: 'https://' }, /is not a parsable URL/);
  });

  it('rejects an unknown preset before serialization can throw on it', () => {
    // Expanding a preset happens at serialization time, so without this the
    // name is the one mistake that passes validation and then fails per
    // request, which is exactly what validating a stored policy is meant to
    // catch first.
    expectRejected(
      { preset: 'strictest' } as unknown as CSPConfig,
      /is not a known preset/,
    );
  });

  it('does not emit a group-less report-to directive', () => {
    // The consequence the check above prevents, pinned separately so a future
    // relaxation of the validator cannot bring it back unnoticed.
    expect(serializeCSP({ defaultSrc: ["'self'"] })).not.toContain('report-to');
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

  it('adds inline hashes to the element directives, not just the fallbacks', () => {
    // script-src-elem overrides script-src for inline <script> elements rather
    // than adding to it, so when it is set it is the only directive a browser
    // consults for them. Hashes left only in the fallback are read by nothing,
    // and the content they cover is blocked by a policy that looks, on paper,
    // like it allows exactly that content.
    const policy = serializeCSP(
      {
        scriptSrc: ["'self'"],
        scriptSrcElem: ["'self'"],
        styleSrc: ["'self'"],
        styleSrcElem: ["'self'"],
      },
      { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
    );

    expect(policy).toContain("script-src-elem 'self' 'sha256-script'");
    expect(policy).toContain("style-src-elem 'self' 'sha256-style'");

    // Still in the fallbacks too, for browsers that do not implement the
    // element directives and therefore read these instead.
    expect(policy).toContain("script-src 'self' 'sha256-script'");
    expect(policy).toContain("style-src 'self' 'sha256-style'");
  });

  it('does not create an element directive that was not configured', () => {
    // Same rule the fallbacks follow. Emitting script-src-elem because a hash
    // exists would create a directive that overrides script-src and blocks
    // everything the author expected script-src to allow.
    const policy = serializeCSP(
      { scriptSrc: ["'self'"] },
      { scriptSrc: ["'sha256-script'"] },
    );

    expect(policy).not.toContain('script-src-elem');
    expect(policy).toBe("script-src 'self' 'sha256-script'");
  });

  it('leaves the attr directives alone, since these hashes are of elements', () => {
    // These particular hashes cover element content, and an attribute's value
    // is different content with a different digest, so listing them in
    // script-src-attr would match nothing on the page. An attribute can be
    // covered by a hash, just not by one of these.
    const policy = serializeCSP(
      { scriptSrcAttr: ["'none'"], styleSrcAttr: ["'none'"] },
      { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
    );

    expect(policy).toBe("script-src-attr 'none'; style-src-attr 'none'");
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

  describe("a directive that opted into 'unsafe-inline'", () => {
    // A browser ignores 'unsafe-inline' the moment a hash or nonce appears in
    // the same source list, so contributing hashes to such a directive would
    // revoke the opt-in and block every inline script the caller had just
    // declared they wanted. Confirmed in Chrome, which blocks an inline script
    // under `script-src 'unsafe-inline' 'sha256-<other>'` and says so:
    // "'unsafe-inline' is ignored if either a hash or nonce value is present".
    //
    // Skipping loses nothing, since 'unsafe-inline' already covers the content
    // the hashes were for.
    it('receives no additions', () => {
      expect(
        serializeCSP(
          { scriptSrc: ["'unsafe-inline'"] },
          { scriptSrc: ["'sha256-abc='"] },
        ),
      ).toBe("script-src 'unsafe-inline'");
    });

    it('does not affect a sibling directive that did not', () => {
      // Decided per directive, because script-src-elem is what governs an
      // inline <script> when both are set. A permissive script-src says nothing
      // about whether the element directive still wants its hashes.
      expect(
        serializeCSP(
          { scriptSrc: ["'unsafe-inline'"], scriptSrcElem: ["'self'"] },
          { scriptSrc: ["'sha256-abc='"] },
        ),
      ).toBe(
        "script-src 'unsafe-inline'; script-src-elem 'self' 'sha256-abc='",
      );
    });

    it('still receives additions once the caller adds their own hash', () => {
      // The keyword is only worth protecting while it is doing something. A
      // caller who writes a hash next to it has already made it inert, so the
      // directive is matching on hashes alone and withholding ours would leave
      // unirend's own inline content blocked while preserving nothing.
      expect(
        serializeCSP(
          { styleSrc: ["'unsafe-inline'", "'sha256-mine='"] },
          { styleSrc: ["'sha256-ours='"] },
        ),
      ).toBe("style-src 'unsafe-inline' 'sha256-mine=' 'sha256-ours='");
    });

    it('still receives additions when a nonce makes it inert', () => {
      expect(
        serializeCSP(
          { scriptSrc: ["'unsafe-inline'", "'nonce-abc123'"] },
          { scriptSrc: ["'sha256-ours='"] },
        ),
      ).toBe("script-src 'unsafe-inline' 'nonce-abc123' 'sha256-ours='");
    });

    it("still receives additions alongside 'strict-dynamic' in a script directive", () => {
      // 'strict-dynamic' disables 'unsafe-inline' the same way a hash or nonce
      // does, and hashes keep working under it, so this is the combination
      // where withholding would be most obviously wrong.
      expect(
        serializeCSP(
          { scriptSrc: ["'unsafe-inline'", "'strict-dynamic'"] },
          { scriptSrc: ["'sha256-ours='"] },
        ),
      ).toBe("script-src 'unsafe-inline' 'strict-dynamic' 'sha256-ours='");
    });

    it("is unmoved by 'strict-dynamic' in a style directive", () => {
      // 'strict-dynamic' is read only for scripts and script attributes, so in
      // style-src it is inert and 'unsafe-inline' is still doing its job. The
      // directive therefore has to stay untouched.
      //
      // Treating the keyword as disabling here would be actively destructive
      // rather than merely imprecise: we would add hashes to a working policy,
      // and those hashes really do disable 'unsafe-inline' for styles, so every
      // inline style on the page would stop applying. Confirmed in Chrome, both
      // that the style applies under this policy and that it stops the moment a
      // hash is added.
      expect(
        serializeCSP(
          { styleSrc: ["'unsafe-inline'", "'strict-dynamic'"] },
          { styleSrc: ["'sha256-ours='"] },
        ),
      ).toBe("style-src 'unsafe-inline' 'strict-dynamic'");
    });

    it('still withholds from a style directive once a hash joins it', () => {
      // A hash disables 'unsafe-inline' for every type, scripts and styles
      // alike. Only 'strict-dynamic' is script-only.
      expect(
        serializeCSP(
          { styleSrc: ["'unsafe-inline'", "'sha256-theirs='"] },
          { styleSrc: ["'sha256-ours='"] },
        ),
      ).toBe("style-src 'unsafe-inline' 'sha256-theirs=' 'sha256-ours='");
    });
  });
});

describe('presets', () => {
  it('expands a named preset', () => {
    const expanded = applyCSPPreset({ preset: 'strict' });

    expect(expanded.defaultSrc).toEqual(["'self'"]);
    expect(expanded.objectSrc).toEqual(["'none'"]);
    expect(expanded.baseURI).toEqual(["'self'"]);
    expect(expanded.frameAncestors).toEqual(["'none'"]);
  });

  it('replaces a preset directive rather than adding to it', () => {
    // Per-directive replacement, so a preset can never quietly widen something
    // that was deliberately narrowed.
    const expanded = applyCSPPreset({
      preset: 'strict',
      imgSrc: ["'none'"],
    });

    expect(expanded.imgSrc).toEqual(["'none'"]);
    // Untouched directives still come from the preset.
    expect(expanded.defaultSrc).toEqual(["'self'"]);
  });

  it('passes a config with no preset through unchanged', () => {
    const config: CSPConfig = { defaultSrc: ["'self'"] };

    expect(applyCSPPreset(config)).toBe(config);
  });

  it('rejects an unknown preset by name', () => {
    expect(() =>
      applyCSPPreset({ preset: 'ultra' as unknown as 'strict' }),
    ).toThrow(/is not a known preset/);
  });

  it('produces a policy that passes validation', () => {
    for (const preset of ['strict', 'strict-with-cdn'] as const) {
      expect(() => validateCSPConfig(applyCSPPreset({ preset }))).not.toThrow();
    }
  });

  it('serializes strict to a usable policy', () => {
    expect(serializeCSP(applyCSPPreset({ preset: 'strict' }))).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
    );
  });
});

describe('frameAncestors alongside frameOptions', () => {
  // frame-ancestors supersedes X-Frame-Options wherever CSP is supported, so
  // X-Frame-Options is a fallback for browsers that would otherwise get no
  // framing policy at all. A fallback may be stricter than what it backs up.
  // It must not be looser.
  it('rejects a fallback weaker than the policy', () => {
    expect(() =>
      securityHeaders({
        frameOptions: 'SAMEORIGIN',
        csp: { frameAncestors: ["'none'"] },
      }),
    ).toThrow(/supersedes X-Frame-Options/);
  });

  it('accepts a fallback that agrees', () => {
    expect(() =>
      securityHeaders({
        frameOptions: 'DENY',
        csp: { frameAncestors: ["'none'"] },
      }),
    ).not.toThrow();
  });

  it('accepts a stricter fallback, which errs the safe way', () => {
    // An old browser refuses framing a new one permits.
    expect(() =>
      securityHeaders({
        frameOptions: 'DENY',
        csp: { frameAncestors: ["'self'"] },
      }),
    ).not.toThrow();
  });

  it('leaves a deliberate blunt-fallback pairing alone', () => {
    // Modern browsers let the partner embed, old ones fall back to same-origin
    // only. A real pattern, and not this code's business to second-guess.
    expect(() =>
      securityHeaders({
        frameOptions: 'SAMEORIGIN',
        csp: { frameAncestors: ["'self'", 'https://partner.example.com'] },
      }),
    ).not.toThrow();
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
