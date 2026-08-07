import { describe, expect, it } from 'bun:test';
import {
  applyCSPPreset,
  cspHeaderName,
  isUnsafeInlineEffective,
  serializeCSP,
  validateCSPConfig,
  type CSPConfig,
} from './csp-policy';
import { securityHeaders } from '../built-in-plugins/security-headers';

function expectRejected(config: CSPConfig, matching: RegExp): void {
  expect(() => validateCSPConfig(config)).toThrow(matching);
}

/**
 * The same, for a config the type rules out.
 *
 * Removed directives and misspellings are not in `CSPConfig` by definition, and
 * the point of validating them at runtime is that a config can arrive from a
 * JSON file or a database row where the type never applied.
 */
function expectRejectedUntyped(
  config: Record<string, unknown>,
  matching: RegExp,
): void {
  expect(() => validateCSPConfig(config as CSPConfig)).toThrow(matching);
}

describe('validateCSPConfig', () => {
  it('accepts keywords, schemes, hosts, wildcards and hashes', () => {
    expect(() =>
      validateCSPConfig({
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'strict-dynamic'",
          "'sha256-K/xkFcAmnzC1nOFrLRqZTHNzZDzuqTMKC0mVeVJ8n1E='",
          'https://cdn.example.com',
        ],
        imgSrc: ["'self'", 'data:', 'blob:', '*.images.example.com', '*'],
        connectSrc: ['https://api.example.com/v1/'],
        frameAncestors: ["'none'"],
        baseURI: ["'self'"],
      }),
    ).not.toThrow();
  });

  it('accepts a hash written in the base64url alphabet', () => {
    // CSP3's base64-value admits "-" and "_" alongside "+" and "/", so a digest
    // that came out of a base64url encoder is one a browser honors. Rejecting
    // it here failed startup on a source expression that works, and disagreed
    // with the nonce rule, which has always taken both alphabets.
    expect(() =>
      validateCSPConfig({
        scriptSrc: ["'sha256-K_xkFcAmnzC1nOFrLRqZTHNzZDzuqTMKC0mVeVJ8n1E='"],
        styleSrc: ["'sha384-abc-_XYZ123'"],
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

  it('accepts the host-source forms an origin validator does not know', () => {
    // CSP3 2.3.1:
    //   host-source = [ scheme-part "://" ] host-part [ ":" port-part ] [ path-part ]
    //   port-part   = 1*DIGIT / "*"
    //
    // Two of those are wider than an origin: the scheme is optional, and the
    // port may be a wildcard. Handing the whole source to the CORS origin
    // validator refused both, which meant a policy every browser honors failed
    // at startup.
    //
    // Verified in Chrome rather than read off the grammar. A script loads under
    // `script-src http://localhost:*` and under `script-src localhost:8792`,
    // and stays blocked under a control naming a different port, so the
    // wildcard is really being matched rather than the source being ignored.
    for (const source of [
      'https://cdn.example.com:*',
      'ws://localhost:*',
      'localhost:3000',
      'example.com:443',
      'https://cdn.example.com:8443',
      'https://cdn.example.com',
      'https://cdn.example.com/assets/',
    ]) {
      expect(() => validateCSPConfig({ connectSrc: [source] })).not.toThrow();
    }

    // The reason this one matters most: it is how a dev server's HMR socket
    // gets allowed, so refusing it lands on a correctly written policy. The
    // natural way around a validator that refuses a port constraint is to drop
    // the port constraint, which leaves the policy *wider* than intended.
    expect(() =>
      validateCSPConfig({ connectSrc: ["'self'", 'ws://localhost:*'] }),
    ).not.toThrow();
  });

  it('still rejects a port that is not a port', () => {
    // Widening the grammar must not turn the port into an unchecked field.
    expectRejected({ imgSrc: ['https://cdn.example.com:0'] }, /port/);
    expectRejected({ imgSrc: ['https://cdn.example.com:99999'] }, /port/);
    expectRejected(
      { imgSrc: ['https://cdn.example.com:80abc'] },
      /is not a valid host/,
    );
  });

  it('rejects a sandbox token that is not one of the real ones', () => {
    expectRejected({ sandbox: ['forms'] }, /is not a sandbox token/);

    // The case that matters, and the one a shape test cannot catch. `allow-form`
    // looks exactly like a sandbox token and is not one, so a browser ignores
    // it and the sandbox keeps forms disabled. Nothing downstream would say so:
    // the header serializes, the page loads, and the capability the author
    // thought they had granted is simply absent. Same silence this file already
    // refuses to accept for a misspelled directive name.
    expectRejected({ sandbox: ['allow-form'] }, /is not a sandbox token/);
    expectRejected({ sandbox: ['allow-nonsense'] }, /is not a sandbox token/);

    // The message has to name the alternatives, since "not a sandbox token" is
    // useless when the whole problem is not knowing which ones exist.
    expectRejected({ sandbox: ['allow-form'] }, /allow-forms/);

    expect(() =>
      validateCSPConfig({ sandbox: ['allow-forms', 'allow-scripts'] }),
    ).not.toThrow();

    // Tokens are ASCII case-insensitive in HTML, so this is a real token.
    expect(() =>
      validateCSPConfig({ sandbox: ['ALLOW-SCRIPTS'] }),
    ).not.toThrow();

    // An empty array is still the bare directive, which is the most restrictive
    // form rather than a mistake.
    expect(() => validateCSPConfig({ sandbox: [] })).not.toThrow();
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

  it('holds reportTo to the name a Reporting-Endpoints key may carry', () => {
    // The directive's own grammar is a token, and checking against that is the
    // wrong half of the pair. A group is only ever a name plus the key that
    // defines it, and that key lives in a structured-headers *dictionary*,
    // whose member-key grammar (RFC 8941 3.2) has no uppercase in it and none
    // of the token punctuation. So a name this rejects is one that could never
    // be defined, whatever report-to would have accepted on its own.
    //
    // The cost of the looser check is the reason it is worth a test rather than
    // a comment. An invalid key is not an entry a browser skips, it is a header
    // a browser cannot parse, so every group defined alongside it stops existing
    // too. Reporting then goes quiet in the one way that reads as an absence of
    // violations.
    for (const reportTo of ['CSP', 'Csp', 'csp!x', "csp'x", 'csp+x', 'csp~x']) {
      expectRejected({ reportTo }, /is not a usable group name/);
    }

    // Everything the dictionary key grammar does allow, including the leading
    // "*" the spec permits.
    for (const reportTo of [
      'csp',
      'csp-endpoint',
      'csp_1',
      'csp.a',
      '*',
      'a',
    ]) {
      expect(() => validateCSPConfig({ reportTo })).not.toThrow();
    }
  });

  it('accepts every URI reference the grammar allows', () => {
    // report-uri takes a URI reference, not an absolute URL, so a relative one
    // is valid and is resolved against the page the policy protected. Rejecting
    // it would be this validator inventing a rule CSP does not have.
    for (const reportURI of [
      '/csp-report',
      'csp-report',
      './reports',
      '../reports',
      '?report',
      'https://reports.example.com/collect',
      '//cdn.example.com/r',
    ]) {
      expect(() => validateCSPConfig({ reportURI })).not.toThrow();
    }
  });

  it('rejects a report endpoint that would silently collect nothing', () => {
    // Each of these serializes into a header that looks like reporting is on. A
    // scheme a browser will not post over is dropped outright, and the rest name
    // no endpoint to drop: they are network-path references with no authority,
    // which look rooted enough to pass a test on the leading slash and resolve
    // to nothing. Both fail the same way, with violations happening, nothing
    // arriving, and the quiet reading as a policy nobody is tripping over.
    expectRejected(
      { reportURI: 'javascript:alert(1)' },
      /only posts violation reports over http or https/,
    );
    expectRejected({ reportURI: 'mailto:security@example.com' }, /"mailto"/);

    for (const reportURI of ['//', '///', '//?x', 'https://', 'http://[']) {
      expectRejected({ reportURI }, /is not a usable URL/);
    }
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
    // caller expected default-src to allow. The hash goes to default-src
    // instead, which is the directive a browser will actually consult here.
    expect(
      serializeCSP(
        { defaultSrc: ["'self'"] },
        { scriptSrc: ["'sha256-abc='"] },
      ),
    ).toBe("default-src 'self' 'sha256-abc='");
  });

  describe('a policy that sets only default-src', () => {
    // The shape the documentation recommends starting from, and the one where
    // withholding the hashes is worst: default-src is what a browser consults
    // for an inline <script> when no script directive is set, so hashes kept
    // out of it are in no directive anything reads. That blocked unirend's own
    // bootstrap script, taking every injected global and the router hydration
    // payload with it, under a policy that reads as though it allows
    // same-origin content.
    it('receives the script and style hashes', () => {
      expect(
        serializeCSP(
          { defaultSrc: ["'self'"] },
          { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
        ),
      ).toBe("default-src 'self' 'sha256-script' 'sha256-style'");
    });

    it('still creates no script-src or style-src of its own', () => {
      const policy = serializeCSP(
        { defaultSrc: ["'self'"] },
        { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
      );

      expect(policy).not.toContain('script-src');
      expect(policy).not.toContain('style-src');
    });
  });

  it('sends each kind of hash to whichever directive governs it', () => {
    // The two chains fall through independently, so a policy can govern scripts
    // specifically and leave styles to default-src. Duplicating the script
    // hashes into default-src would be harmless but pointless, since nothing
    // consults it for scripts once script-src is set.
    const policy = serializeCSP(
      { defaultSrc: ["'self'"], scriptSrc: ["'self'"] },
      { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
    );

    expect(policy).toBe(
      "default-src 'self' 'sha256-style'; script-src 'self' 'sha256-script'",
    );
  });

  it('keeps default-src covered when only script-src-elem is set', () => {
    // script-src-elem governs an inline <script> for a browser that implements
    // it, so it gets the hashes. But it only shipped in Firefox 124, and with no
    // script-src in between, a browser without it reads straight past to
    // default-src. Withholding them there blocked unirend's bootstrap script on
    // exactly those browsers, silently, so both directives carry them.
    const policy = serializeCSP(
      { defaultSrc: ["'self'"], scriptSrcElem: ["'self'"] },
      { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
    );

    expect(policy).toBe(
      "default-src 'self' 'sha256-script' 'sha256-style'; script-src-elem 'self' 'sha256-script'",
    );
  });

  it('keeps default-src covered when only style-src-elem is set', () => {
    // The style half of the same rule. style-src-elem landed in Firefox 124
    // alongside its script counterpart.
    const policy = serializeCSP(
      { defaultSrc: ["'self'"], styleSrcElem: ["'self'"] },
      { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
    );

    expect(policy).toBe(
      "default-src 'self' 'sha256-script' 'sha256-style'; style-src-elem 'self' 'sha256-style'",
    );
  });

  describe('an empty source list', () => {
    // An empty array is the caller saying nothing: it serializes to nothing and
    // a browser falls through it to the fallback. Treating it as a real
    // directive is wrong in both directions, and both were reachable.
    it('does not become a directive holding only the hashes', () => {
      // The worse half. Contributing here emitted `script-src 'sha256-...'`,
      // a directive nobody wrote that overrides default-src and blocks every
      // other script on the page while allowing unirend's bootstrap.
      expect(
        serializeCSP({ scriptSrc: [] }, { scriptSrc: ["'sha256-script'"] }),
      ).toBe('');
    });

    it('lets the hashes fall through to default-src', () => {
      expect(
        serializeCSP(
          { defaultSrc: ["'self'"], scriptSrc: [] },
          { scriptSrc: ["'sha256-script'"] },
        ),
      ).toBe("default-src 'self' 'sha256-script'");
    });

    it('takes no hashes when it is default-src itself', () => {
      expect(
        serializeCSP({ defaultSrc: [] }, { scriptSrc: ["'sha256-script'"] }),
      ).toBe('');
    });
  });

  it("withholds hashes from a default-src where 'unsafe-inline' is live", () => {
    // Same rule the specific directives follow, for the same reason: a browser
    // ignores 'unsafe-inline' as soon as a hash joins the list, so contributing
    // here would revoke an opt-in the caller had just written.
    expect(
      serializeCSP(
        { defaultSrc: ["'self'", "'unsafe-inline'"] },
        { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
      ),
    ).toBe("default-src 'self' 'unsafe-inline'");
  });

  it("stays out of default-src when 'unsafe-inline' is live for either kind", () => {
    // The subtlety this directive has and the specific ones do not. Both kinds
    // share one source list, and CSP3 returns Does Not Allow on encountering
    // any hash whatever type it was asked about, so contributing for one kind
    // revokes 'unsafe-inline' for the other too.
    //
    // Under `default-src 'unsafe-inline' 'strict-dynamic'` the inline scripts
    // are already blocked by the caller's own 'strict-dynamic' and the inline
    // styles work. Adding the script hashes would fix the scripts and break
    // every style on the page, which is not a trade to make for someone.
    expect(
      serializeCSP(
        { defaultSrc: ["'self'", "'unsafe-inline'", "'strict-dynamic'"] },
        { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
      ),
    ).toBe("default-src 'self' 'unsafe-inline' 'strict-dynamic'");
  });

  it('contributes to default-src once nothing is left to revoke', () => {
    // The same policy with a hash of the caller's own already in it. The
    // keyword is inert for both kinds now, so withholding preserves nothing and
    // only leaves unirend's bootstrap blocked.
    expect(
      serializeCSP(
        {
          defaultSrc: ["'self'", "'unsafe-inline'", "'sha256-theirs'"],
        },
        { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
      ),
    ).toBe(
      "default-src 'self' 'unsafe-inline' 'sha256-theirs' 'sha256-script' 'sha256-style'",
    );
  });

  describe("a directive set to 'none'", () => {
    // `'none'` means "allow nothing", and the grammar admits it only as a
    // source list's sole member. A browser meeting it beside a hash drops the
    // `'none'` with a parse warning, which would quietly turn "allow nothing"
    // into "allow unirend's inline content".
    it('is left alone rather than widened', () => {
      expect(
        serializeCSP(
          { defaultSrc: ["'none'"] },
          { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
        ),
      ).toBe("default-src 'none'");
    });

    it('is left alone as a specific directive too', () => {
      expect(
        serializeCSP(
          { scriptSrc: ["'none'"], styleSrc: ["'none'"] },
          { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
        ),
      ).toBe("script-src 'none'; style-src 'none'");
    });

    it('does not stop a sibling directive from receiving hashes', () => {
      // `script-src 'none'` is a statement about scripts, so the styles falling
      // through to default-src are unaffected by it.
      expect(
        serializeCSP(
          { defaultSrc: ["'self'"], scriptSrc: ["'none'"] },
          { scriptSrc: ["'sha256-script'"], styleSrc: ["'sha256-style'"] },
        ),
      ).toBe("default-src 'self' 'sha256-style'; script-src 'none'");
    });
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

  it('passes something that is not a policy through unchanged', () => {
    // Expanding a preset is not the step that should have an opinion about a
    // value that came out of a JSON config. Handing it back is what lets
    // validation describe it in a sentence, instead of this failing first with
    // a TypeError about reading a property of null.
    for (const value of [null, 0, '', 'strict', []]) {
      const config = value as unknown as CSPConfig;

      expect(() => applyCSPPreset(config)).not.toThrow();
      expect(applyCSPPreset(config)).toBe(config);
    }
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

describe('a CSP block that is neither a policy nor turned off', () => {
  // `false` and an absent key are the two ways to say "no CSP". Everything else
  // is meant to be a policy, so it is held to the rules even when it is falsy.
  // Read as "off" instead, a `csp: null` out of a JSON config starts a server
  // with the header quietly missing, and nothing anywhere says so.
  it('rejects a falsy value that does not mean off', () => {
    for (const value of [null, 0, '']) {
      expect(() =>
        securityHeaders({ csp: value as unknown as CSPConfig }),
      ).toThrow(/csp must be an object of directives/);
    }
  });

  it('rejects a value that is the wrong kind of thing', () => {
    for (const value of ['strict', ['self'], 42]) {
      expect(() =>
        securityHeaders({ csp: value as unknown as CSPConfig }),
      ).toThrow(/csp must be an object of directives/);
    }
  });

  it('still accepts the two ways to mean off', () => {
    expect(() => securityHeaders({ csp: false })).not.toThrow();
    expect(() => securityHeaders({})).not.toThrow();
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

describe('nonces, Trusted Types, and removed directives', () => {
  it('rejects a nonce written in config', () => {
    // A nonce has to be unpredictable and different on every response to mean
    // anything. One written in a config file is the same value forever, so it
    // authorizes an injected script exactly as readily as your own, and
    // unirend generates none, so there is no path by which it could be
    // anything else. It also silently kills any 'unsafe-inline' beside it.
    expectRejected({ scriptSrc: ["'nonce-abc123'"] }, /contains a nonce/);
    expectRejected(
      { scriptSrc: ["'nonce-abc123'"] },
      /use hashes here instead/,
    );
  });

  it("still treats a nonce as killing 'unsafe-inline' at the source-list layer", () => {
    // Config can no longer carry one, so this is unreachable from the outside
    // and stays as defense: the rule is a CSP fact rather than a unirend one,
    // and a future that generates nonces per response would need it to be
    // right. Asserted directly rather than through the plugin for that reason.
    expect(
      isUnsafeInlineEffective(["'unsafe-inline'", "'nonce-abc123'"], 'script'),
    ).toBe(false);
    expect(isUnsafeInlineEffective(["'unsafe-inline'"], 'script')).toBe(true);
  });

  it('rejects data: in a script directive but allows it elsewhere', () => {
    // data: in a script directive is 'unsafe-inline' in everything but name:
    // <script src="data:text/javascript,..."> carries its own payload, so an
    // injected tag needs no hash and no nonce.
    expectRejected({ scriptSrc: ["'self'", 'data:'] }, /carry its own source/);
    expectRejected({ defaultSrc: ["'self'", 'data:'] }, /carry its own source/);
    expectRejected({ scriptSrcElem: ['data:'] }, /carry its own source/);

    // Ordinary and useful everywhere else, which is why this is not a blanket
    // ban on the scheme.
    expect(() =>
      validateCSPConfig({ imgSrc: ["'self'", 'data:'], fontSrc: ['data:'] }),
    ).not.toThrow();
  });

  it("leaves '*' alone in a script directive", () => {
    // Deliberately different from data:. `*` does not match data:, blob: or
    // filesystem: and does not permit inline, so it is a coarse policy rather
    // than a bypass, and it is visible in the config someone wrote.
    expect(() => validateCSPConfig({ scriptSrc: ['*'] })).not.toThrow();
  });

  it('accepts and serializes the Trusted Types directives', () => {
    const value = serializeCSP({
      defaultSrc: ["'self'"],
      requireTrustedTypesFor: ["'script'"],
      trustedTypes: ['default', 'dompurify', "'allow-duplicates'"],
    });

    expect(value).toContain("require-trusted-types-for 'script'");
    expect(value).toContain(
      "trusted-types default dompurify 'allow-duplicates'",
    );
  });

  it('rejects Trusted Types values a browser would drop', () => {
    expectRejected(
      { requireTrustedTypesFor: ['script'] },
      /is not a sink group/,
    );
    expectRejected({ requireTrustedTypesFor: [] }, /is empty/);
    expectRejected({ trustedTypes: ["'nope'"] }, /is quoted but is not one of/);
    expectRejected({ trustedTypes: ['bad name'] }, /not a valid policy name/);
  });

  it('serializes a bare trusted-types for an empty list', () => {
    // The bare directive is valid and means "no policy may be created", unlike
    // require-trusted-types-for, whose grammar needs at least one sink group.
    expect(serializeCSP({ trustedTypes: [] })).toBe('trusted-types');
  });

  it('names a removed directive rather than calling it a typo', () => {
    // A misspelling means the author meant something else. A removed directive
    // means they meant exactly this and the platform moved, so the message
    // should say which and what replaced it.
    expectRejectedUntyped({ prefetchSrc: ["'self'"] }, /no longer part of CSP/);
    expectRejectedUntyped(
      { prefetchSrc: ["'self'"] },
      /defaultSrc or the specific one/,
    );
    expectRejectedUntyped({ pluginTypes: ['application/pdf'] }, /objectSrc/);
    expectRejectedUntyped(
      { blockAllMixedContent: true },
      /upgradeInsecureRequests/,
    );
    expectRejectedUntyped({ referrer: 'no-referrer' }, /referrerPolicy option/);

    // An actual typo still reads as one.
    expectRejectedUntyped({ script_src: ["'self'"] }, /is not a CSP option/);
  });
});
