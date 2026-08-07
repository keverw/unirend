import { describe, it, expect } from 'bun:test';
import fastify from 'fastify';
import { validateSecurityHeadersPolicy } from './security-headers-validation';
import { securityHeaders } from '../built-in-plugins/security-headers';
import { domainValidation } from '../built-in-plugins/domain-validation';
import type { SecurityHeadersConfig } from '../built-in-plugins/security-headers';
import type {
  PluginHostInstance,
  PluginOptions,
  UnirendServerMode,
} from '../types';

function createMockOptions(): PluginOptions {
  return {
    mode: 'ssr' as UnirendServerMode,
    isDevelopment: false,
    serverType: 'ssr',
  } as unknown as PluginOptions;
}

describe('validateSecurityHeadersPolicy', () => {
  it('accepts a valid policy', () => {
    const result = validateSecurityHeadersPolicy({
      csp: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] },
      hsts: { maxAge: 86400 },
      frameOptions: 'DENY',
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts an empty policy', () => {
    // What a resolver returning "no override" looks like once the null has been
    // handled. Nothing set is nothing to complain about.
    expect(validateSecurityHeadersPolicy({}).valid).toBe(true);
  });

  it('accepts blocks turned off outright', () => {
    // `false` means "send no such header", which is a real answer rather than a
    // malformed one.
    const result = validateSecurityHeadersPolicy({
      csp: false,
      hsts: false,
      frameOptions: false,
    });

    expect(result.valid).toBe(true);
  });

  describe('input that is not a policy at all', () => {
    // The documented use passes a request body straight in, so every one of
    // these is a shape a real caller can receive. Reporting is the contract:
    // a validator that throws on malformed input has failed at the one job it
    // was added for, since the caller's alternative was already a try/catch.

    const notObjects: { name: string; value: unknown }[] = [
      { name: 'null', value: null },
      { name: 'undefined', value: undefined },
      { name: 'a string', value: 'DENY' },
      { name: 'a number', value: 0 },
      { name: 'a boolean', value: false },
      { name: 'an array', value: [] },
    ];

    for (const { name, value } of notObjects) {
      it(`reports ${name} rather than throwing`, () => {
        const result = validateSecurityHeadersPolicy(value);

        expect(result.valid).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].path).toBe('');
      });
    }

    it('reports a null block instead of reading it as unset', () => {
      // What a JSON column or a form serializer produces for an empty field.
      // Guessing would mean choosing between "inherit the baseline" and "send
      // no header", which are opposite answers, so it asks instead.
      const result = validateSecurityHeadersPolicy({
        csp: null,
        hsts: null,
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.path).sort()).toEqual([
        'csp',
        'hsts',
      ]);
    });

    it('reports a block that is a primitive', () => {
      const result = validateSecurityHeadersPolicy({
        csp: 'default-src *',
        hsts: 31536000,
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.path).sort()).toEqual([
        'csp',
        'hsts',
      ]);
    });

    it('reports a frameOptions value no browser understands', () => {
      // Would otherwise validate and be stored, and the header would go out
      // carrying a value browsers ignore, which is framing left wide open by a
      // setting that reads as though it closed it.
      // Hyphenated the way the CSP directive and every other header value is
      // written, which is the shape this typo actually takes.
      const result = validateSecurityHeadersPolicy({
        frameOptions: 'SAME-ORIGIN',
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('frameOptions');
    });

    it('reports a misspelled policy field', () => {
      const result = validateSecurityHeadersPolicy({ frameOption: 'DENY' });

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('frameOption');
    });

    it('reports a misspelled HSTS field', () => {
      const result = validateSecurityHeadersPolicy({
        hsts: { maxAge: 31536000, includeSubdomains: true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('hsts.includeSubdomains');
    });

    it('reports a non-boolean where a flag belongs', () => {
      // A form post carries strings, and "false" is truthy. The flags are read
      // strictly so this cannot switch anything on, and reported so the caller
      // is not left with a setting that reads as enabled and does nothing.
      const result = validateSecurityHeadersPolicy({
        csp: { allowUnsafeInlineScript: 'false' },
        hsts: { maxAge: 31536000, preload: 'true' },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.path).sort()).toEqual([
        'csp.allowUnsafeInlineScript',
        'hsts.preload',
      ]);
    });

    it('does not pile preload complaints on a non-boolean preload', () => {
      const result = validateSecurityHeadersPolicy({
        hsts: { maxAge: 100, preload: 'yes' },
      });

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].path).toBe('hsts.preload');
    });

    it('reports a directive holding something other than sources', () => {
      const result = validateSecurityHeadersPolicy({
        csp: { scriptSrc: "'self'", imgSrc: [42] },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.path).sort()).toEqual([
        'csp.imgSrc',
        'csp.scriptSrc',
      ]);
    });

    it('reports a misspelled directive', () => {
      // Silently dropped otherwise, leaving a policy weaker than it reads.
      const result = validateSecurityHeadersPolicy({
        csp: { scripSrc: ["'self'"] },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('csp.scripSrc');
    });

    it('reports an unknown preset', () => {
      // The one mistake that used to validate cleanly and then throw per
      // request, since expanding the preset happens at serialization time.
      const result = validateSecurityHeadersPolicy({
        csp: { preset: 'strictest' },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('csp.preset');
    });

    it('hands back the policy typed once it is valid', () => {
      const result = validateSecurityHeadersPolicy({ frameOptions: 'DENY' });

      // The point of the narrowing: what comes out is usable without a cast,
      // which is what the caller came here for.
      expect(result.valid && result.policy.frameOptions).toBe('DENY');
    });
  });

  it('reports a CSP problem with a path pointing at the directive', () => {
    const result = validateSecurityHeadersPolicy({
      csp: { scriptSrc: ['self'] },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('csp.scriptSrc');
    expect(result.issues[0].message).toMatch(/must be quoted as 'self'/);
  });

  it('reports every problem rather than the first', () => {
    // The reason this exists at all. A form that reveals one error per submit
    // makes the person fixing it play twenty questions.
    const result = validateSecurityHeadersPolicy({
      csp: {
        scriptSrc: ['self'],
        imgSrc: ["'none'", "'self'"],
        reportTo: '',
      },
      hsts: { maxAge: -1 },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);

    const paths = result.issues.map((issue) => issue.path);

    expect(paths).toContain('csp.scriptSrc');
    expect(paths).toContain('csp.imgSrc');
    expect(paths).toContain('csp.reportTo');
    expect(paths).toContain('hsts.maxAge');
  });

  it('reports both preload requirements at once', () => {
    const result = validateSecurityHeadersPolicy({
      hsts: { maxAge: 100, preload: true },
    });

    expect(result.issues.map((issue) => issue.path).sort()).toEqual([
      'hsts.includeSubDomains',
      'hsts.maxAge',
    ]);
  });

  it('does not pile preload complaints on an unusable maxAge', () => {
    // The preload rules compare against maxAge, so running them on a value the
    // caller has already been told to fix is noise about the same mistake.
    const result = validateSecurityHeadersPolicy({
      hsts: { maxAge: Number.NaN, preload: true },
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe('hsts.maxAge');
  });

  describe('the framing cross-check', () => {
    it('catches the pair when both halves are in the policy', () => {
      const result = validateSecurityHeadersPolicy({
        frameOptions: 'SAMEORIGIN',
        csp: { frameAncestors: ["'none'"] },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('frameOptions');
    });

    it('leaves a report-only policy alone', () => {
      // The rollout this rule was breaking. A report-only policy blocks nothing
      // and displaces nothing, so frame-ancestors 'none' there is a question
      // being asked rather than a stricter rule the fallback undercuts, and
      // X-Frame-Options stays the only framing policy in force for everyone.
      // Rejecting it meant an operator who already had the header could not
      // report-only-test a tighter policy before enforcing it.
      const result = validateSecurityHeadersPolicy({
        frameOptions: 'SAMEORIGIN',
        csp: { frameAncestors: ["'none'"], reportOnly: true },
      });

      expect(result.valid).toBe(true);
    });

    it('catches the pair again once the policy starts enforcing', () => {
      // The other side of the same rollout: flipping reportOnly off is exactly
      // when the fallback does start undercutting the policy.
      const result = validateSecurityHeadersPolicy({
        frameOptions: 'SAMEORIGIN',
        csp: { frameAncestors: ["'none'"], reportOnly: false },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('frameOptions');
    });

    it('reads reportOnly from an inherited baseline CSP', () => {
      const result = validateSecurityHeadersPolicy(
        { frameOptions: 'SAMEORIGIN' },
        {
          baseline: {
            csp: { frameAncestors: ["'none'"], reportOnly: true },
          },
        },
      );

      expect(result.valid).toBe(true);
    });

    it('catches a CSP that undercuts the inherited frameOptions', () => {
      // The case the baseline option exists for. Each half is fine alone, and
      // the request path would reject the combination, so a validator blind to
      // the baseline would bless a policy that then 500s in production.
      const result = validateSecurityHeadersPolicy(
        { csp: { frameAncestors: ["'none'"] } },
        { baseline: { frameOptions: 'SAMEORIGIN' } },
      );

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('frameOptions');
    });

    it('catches a frameOptions that undercuts the inherited CSP', () => {
      const result = validateSecurityHeadersPolicy(
        { frameOptions: 'SAMEORIGIN' },
        { baseline: { csp: { frameAncestors: ["'none'"] } } },
      );

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('frameOptions');
    });

    it('sees frameAncestors that a preset supplied', () => {
      // The hole this closes. `preset: 'strict'` is a policy whose
      // frameAncestors is ["'none'"] even though the author never typed it, so
      // reading the unexpanded policy found no frameAncestors and blessed the
      // pair. The plugin expands the preset before its own check and threw, so
      // the tenant got a 500 on every request: the exact outcome validating a
      // stored policy early is supposed to prevent.
      const result = validateSecurityHeadersPolicy({
        frameOptions: 'SAMEORIGIN',
        csp: { preset: 'strict' },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('frameOptions');
    });

    it('sees frameAncestors that a preset supplied to the baseline', () => {
      const result = validateSecurityHeadersPolicy(
        { frameOptions: 'SAMEORIGIN' },
        { baseline: { csp: { preset: 'strict' } } },
      );

      expect(result.valid).toBe(false);
      expect(result.issues[0].path).toBe('frameOptions');
    });

    it('respects a directive written over the preset it came from', () => {
      // Per-directive replacement, so an explicit frameAncestors wins over the
      // preset's and there is no conflict left to report.
      const result = validateSecurityHeadersPolicy({
        frameOptions: 'SAMEORIGIN',
        csp: { preset: 'strict', frameAncestors: ["'self'"] },
      });

      expect(result.valid).toBe(true);
    });

    it('reports only the unknown preset when the name names nothing', () => {
      // Expansion has nothing to work with, so the cross-check has no pair to
      // judge and the caller is told the one thing that is actually wrong.
      const result = validateSecurityHeadersPolicy({
        frameOptions: 'SAMEORIGIN',
        csp: { preset: 'strictest' as 'strict' },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.path)).toEqual(['csp.preset']);
    });

    it('lets the policy override its way out of an inherited conflict', () => {
      // The baseline has the weak fallback, and this policy replaces it. Since
      // blocks replace rather than merge, the result is consistent and there is
      // nothing to report.
      const result = validateSecurityHeadersPolicy(
        { frameOptions: 'DENY', csp: { frameAncestors: ["'none'"] } },
        { baseline: { frameOptions: 'SAMEORIGIN' } },
      );

      expect(result.valid).toBe(true);
    });

    it('leaves a stricter fallback alone', () => {
      expect(
        validateSecurityHeadersPolicy({
          frameOptions: 'DENY',
          csp: { frameAncestors: ["'self'"] },
        }).valid,
      ).toBe(true);
    });

    it('leaves a deliberate partner-origin pairing alone', () => {
      expect(
        validateSecurityHeadersPolicy({
          frameOptions: 'SAMEORIGIN',
          csp: { frameAncestors: ["'self'", 'https://partner.example.com'] },
        }).valid,
      ).toBe(true);
    });
  });

  describe('agreement with the plugin', () => {
    /**
     * Whether `securityHeaders` accepts this config at startup. The whole
     * promise of the validator is that its answer matches, so the two are asked
     * the same questions rather than trusted to have been written alike.
     */
    async function pluginAccepts(
      config: SecurityHeadersConfig,
    ): Promise<boolean> {
      try {
        await securityHeaders(config)(
          fastify() as unknown as PluginHostInstance,
          createMockOptions(),
        );

        return true;
      } catch {
        return false;
      }
    }

    const cases: { name: string; config: SecurityHeadersConfig }[] = [
      { name: 'a valid policy', config: { csp: { defaultSrc: ["'self'"] } } },
      { name: 'an unquoted keyword', config: { csp: { scriptSrc: ['self'] } } },
      {
        name: "'none' with other sources",
        config: { csp: { imgSrc: ["'none'", "'self'"] } },
      },
      { name: 'an empty reportTo', config: { csp: { reportTo: '' } } },
      {
        name: 'a bad sandbox token',
        config: { csp: { sandbox: ['forms'] } },
      },
      {
        name: "'unsafe-inline' without the opt-in",
        config: { csp: { scriptSrc: ["'unsafe-inline'"] } },
      },
      { name: 'a negative maxAge', config: { hsts: { maxAge: -1 } } },
      {
        name: 'preload without includeSubDomains',
        config: { hsts: { maxAge: 31536000, preload: true } },
      },
      {
        name: 'the weak framing fallback',
        config: {
          frameOptions: 'SAMEORIGIN',
          csp: { frameAncestors: ["'none'"] },
        },
      },
      {
        // The reporting cross-check reaches a group named by a header
        // parameter, not just one named by csp.reportTo. The validator used to
        // skip that half entirely, so this config validated clean here and
        // then threw the moment a resolver handed it to the request path.
        name: 'a cross-origin reportTo group nothing defines',
        config: {
          reportingEndpoints: { csp: 'https://reports.example.com/csp' },
          crossOriginOpenerPolicyReportOnly: {
            policy: 'same-origin',
            reportTo: 'coop',
          },
        },
      },
    ];

    for (const { name, config } of cases) {
      it(`agrees with the plugin on ${name}`, async () => {
        const wasAccepted = await pluginAccepts(config);

        expect(validateSecurityHeadersPolicy(config).valid).toBe(wasAccepted);
      });
    }
  });

  it('reads a cross-origin reportTo the baseline supplied', () => {
    // The pair is assembled from both halves, so neither one alone answers the
    // question. Here the override defines endpoints and the baseline is what
    // names the group, which is the arrangement a tenant editing only their
    // endpoints produces.
    const result = validateSecurityHeadersPolicy(
      { reportingEndpoints: { csp: 'https://reports.example.com/csp' } },
      {
        baseline: {
          crossOriginOpenerPolicyReportOnly: {
            policy: 'same-origin',
            reportTo: 'coop',
          },
        },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe(
      'crossOriginOpenerPolicyReportOnly.reportTo',
    );
  });

  it('accepts a cross-origin reportTo the endpoints do define', () => {
    // The other direction, so the check above is passing for the right reason
    // rather than rejecting every cross-origin policy that carries a group.
    expect(
      validateSecurityHeadersPolicy({
        reportingEndpoints: { coop: 'https://reports.example.com/coop' },
        crossOriginOpenerPolicyReportOnly: {
          policy: 'same-origin',
          reportTo: 'coop',
        },
      }).valid,
    ).toBe(true);
  });

  it('does not report a preset directive as the author’s mistake', () => {
    // The preset's directives are unirend's, not the author's, so re-reporting
    // them would blame someone for a line they never wrote. Passing the policy
    // as written is what keeps the issue paths pointing at real fields.
    const result = validateSecurityHeadersPolicy({
      csp: { preset: 'strict' },
    });

    expect(result.valid).toBe(true);
  });

  it('does not judge whether a policy is a good one', () => {
    // Validation answers "will this work", not "is this wise". A tenant saving
    // a wide-open policy is making a choice, and refusing it here would be this
    // function inventing a rule the plugin does not have.
    expect(
      validateSecurityHeadersPolicy({ csp: { defaultSrc: ['*'] } }).valid,
    ).toBe(true);
  });
});

describe('single-value security headers', () => {
  async function headersFor(config: SecurityHeadersConfig) {
    const app = fastify({ trustProxy: true });

    await securityHeaders(config)(
      app as unknown as PluginHostInstance,
      createMockOptions(),
    );

    app.get('/t', () => ({ ok: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/t`, {
        headers: {
          'x-forwarded-host': 'app.example.com',
          'x-forwarded-proto': 'https',
        },
      });

      return response.headers;
    } finally {
      await app.close();
    }
  }

  it('sends nothing when nothing is configured', async () => {
    // Every header here is opt-in, matching frameOptions, hsts and csp. A
    // plugin that turned protections on behind your back would be a plugin
    // whose output nobody knows to look at when something breaks.
    const headers = await headersFor({});

    for (const name of [
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
      'cross-origin-opener-policy',
      'cross-origin-resource-policy',
      'cross-origin-embedder-policy',
    ]) {
      expect(headers.get(name)).toBeNull();
    }
  });

  it('sends each header exactly as configured', async () => {
    const headers = await headersFor({
      contentTypeOptions: true,
      referrerPolicy: 'strict-origin-when-cross-origin',
      crossOriginOpenerPolicy: 'same-origin-allow-popups',
      crossOriginResourcePolicy: 'same-origin',
      crossOriginEmbedderPolicy: 'credentialless',
    });

    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(headers.get('cross-origin-opener-policy')).toBe(
      'same-origin-allow-popups',
    );
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(headers.get('cross-origin-embedder-policy')).toBe('credentialless');
  });

  it('serializes Permissions-Policy in the structured-headers grammar', async () => {
    // Origins are quoted and keywords are not, and that is grammar rather than
    // style: a browser drops an item it cannot parse, and a dropped item is a
    // feature left enabled. Verified in Chrome through document.featurePolicy,
    // which reports camera disabled, geolocation allowed for self, fullscreen
    // allowed everywhere, and picture-in-picture allowed for both self and the
    // named partner origin.
    const headers = await headersFor({
      permissionsPolicy: {
        camera: [],
        geolocation: ['self'],
        'picture-in-picture': ['self', 'https://player.example.com'],
        fullscreen: ['*'],
      },
    });

    expect(headers.get('permissions-policy')).toBe(
      'camera=(), geolocation=(self), picture-in-picture=(self "https://player.example.com"), fullscreen=*',
    );
  });

  it('sends a Referrer-Policy fallback list in order', async () => {
    // The header takes a list and a browser uses the last token it
    // understands, which is how a newer policy ships with an older one behind
    // it.
    const headers = await headersFor({
      referrerPolicy: ['no-referrer', 'strict-origin-when-cross-origin'],
    });

    expect(headers.get('referrer-policy')).toBe(
      'no-referrer, strict-origin-when-cross-origin',
    );
  });

  it('lets a resolver replace one header and inherit the rest', async () => {
    const headers = await headersFor({
      contentTypeOptions: true,
      referrerPolicy: 'no-referrer',
      resolve: () => ({ referrerPolicy: 'unsafe-url' }),
    });

    expect(headers.get('referrer-policy')).toBe('unsafe-url');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects a value a browser would ignore', () => {
    // The shared failure mode: an unrecognized value means the header is
    // dropped and the browser default applies, so the config says the
    // protection is on and it is not.
    const cases: Array<[SecurityHeadersConfig, RegExp]> = [
      [
        { referrerPolicy: 'strict-origin-when-cross' as never },
        /Referrer-Policy value/,
      ],
      [
        { crossOriginOpenerPolicy: 'same-origin-allow-popup' as never },
        /crossOriginOpenerPolicy/,
      ],
      [
        { crossOriginResourcePolicy: 'same' as never },
        /crossOriginResourcePolicy/,
      ],
      [
        { crossOriginEmbedderPolicy: 'require-cors' as never },
        /crossOriginEmbedderPolicy/,
      ],
      [{ contentTypeOptions: 'nosniff' as never }, /contentTypeOptions/],
      [{ permissionsPolicy: { camera: 'self' as never } }, /must be an array/],
      [{ permissionsPolicy: { 'Camera!': [] } }, /valid feature name/],
      [
        { permissionsPolicy: { camera: ['*.example.com'] } },
        /is not an origin/,
      ],
      [
        { permissionsPolicy: { camera: ['https://a.example.com/path'] } },
        /more than an origin/,
      ],
      [{ permissionsPolicy: {} }, /is empty/],
      [{ referrerPolicy: [] }, /empty list/],
    ];

    for (const [config, pattern] of cases) {
      expect(() => securityHeaders(config)).toThrow(pattern);
    }
  });

  it('reports the new fields through validateSecurityHeadersPolicy too', () => {
    // The public validator and the plugin run the same collectors, so a stored
    // policy can be checked when it is saved rather than failing per request.
    const result = validateSecurityHeadersPolicy({
      referrerPolicy: 'nope',
      crossOriginResourcePolicy: 'nope',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path).sort()).toEqual([
      'crossOriginResourcePolicy',
      'referrerPolicy',
    ]);
  });

  it('rejects a resolver returning a misspelled new field', () => {
    // The parity guard means POLICY_KEYS covers these automatically, so a
    // typo in one of the new fields fails the same way a typo in frameOptions
    // does rather than silently inheriting the baseline.
    expect(
      validateSecurityHeadersPolicy({ referrer_policy: 'no-referrer' }).valid,
    ).toBe(false);
  });
});

describe('reportingEndpoints', () => {
  it('sends the header and pairs with csp.reportTo', async () => {
    const app = fastify({ trustProxy: true });

    await securityHeaders({
      reportingEndpoints: { csp: 'https://reports.example.com/csp' },
      csp: { defaultSrc: ["'self'"], reportTo: 'csp', reportOnly: true },
    })(app as unknown as PluginHostInstance, createMockOptions());

    app.get('/t', () => ({ ok: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/t`);

      expect(response.headers.get('reporting-endpoints')).toBe(
        'csp="https://reports.example.com/csp"',
      );
      expect(
        response.headers.get('content-security-policy-report-only'),
      ).toContain('report-to csp');
    } finally {
      await app.close();
    }
  });

  it('rejects a csp.reportTo group that reportingEndpoints does not define', () => {
    // The whole point of the pair. `report-to` names a group, a group means
    // nothing until a response defines it, and the only symptom of getting it
    // wrong is an absence: violations happen, no report arrives, and the quiet
    // is indistinguishable from having no violations.
    expect(() =>
      securityHeaders({
        reportingEndpoints: { other: 'https://reports.example.com/x' },
        csp: { defaultSrc: ["'self'"], reportTo: 'csp' },
      }),
    ).toThrow(/reportingEndpoints does not define/);
  });

  it('accepts a reportingEndpoints group nothing references', () => {
    // The header is shared with the other reporting APIs, so a group the CSP
    // does not name is not a mistake. Only the reverse is.
    expect(() =>
      securityHeaders({
        reportingEndpoints: {
          'network-errors': 'https://reports.example.com/ne',
        },
        csp: { defaultSrc: ["'self'"] },
      }),
    ).not.toThrow();
  });

  it('rejects an endpoint a browser would never deliver to', () => {
    // Both of these parse, serialize, and produce a header that looks correct.
    expect(() =>
      securityHeaders({
        reportingEndpoints: { csp: 'http://reports.example.com/csp' },
      }),
    ).toThrow(/is not https/);

    expect(() =>
      securityHeaders({ reportingEndpoints: { csp: '/csp-reports' } }),
    ).toThrow(/is not an absolute URL/);
  });

  it('allows a localhost collector, which is a trustworthy origin', () => {
    expect(() =>
      securityHeaders({
        reportingEndpoints: { csp: 'http://localhost:9000/csp' },
      }),
    ).not.toThrow();
  });

  it('does not fail startup when reportingEndpoints is absent entirely', () => {
    // The one shape this code cannot settle: the header may be coming from a
    // proxy or another hook. It warns rather than refusing to start, because
    // refusing would break a working deployment over a file it cannot see.
    expect(() =>
      securityHeaders({ csp: { defaultSrc: ["'self'"], reportTo: 'csp' } }),
    ).not.toThrow();
  });

  describe('the undefined-group warning', () => {
    /**
     * Register against a real Fastify instance with its logger replaced, since
     * the warning goes through `fastify.log` and there is nothing else to
     * observe it by: the config is accepted either way.
     */
    async function warningsFor(config: SecurityHeadersConfig) {
      const app = fastify();
      const warnings: string[] = [];

      Object.defineProperty(app, 'log', {
        value: { warn: (message: string) => warnings.push(message) },
        configurable: true,
      });

      await securityHeaders(config)(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );

      await app.close();

      return warnings;
    }

    it('warns about a group named only by a cross-origin policy', async () => {
      // The shape someone reaches for first, since report-only COOP is what
      // you run before committing to a policy. Nothing here defines "coop", so
      // the header goes out naming a group that resolves to nothing and the
      // reports it exists to collect never arrive.
      const warnings = await warningsFor({
        crossOriginOpenerPolicyReportOnly: {
          policy: 'same-origin',
          reportTo: 'coop',
        },
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('reports to nowhere');
    });

    it('warns about a group named only by csp.reportTo', async () => {
      const warnings = await warningsFor({
        csp: { defaultSrc: ["'self'"], reportTo: 'csp' },
      });

      expect(warnings).toHaveLength(1);
    });

    it('stays quiet when no group is named at all', async () => {
      // The check keys on a group being named, not on reportingEndpoints being
      // absent, or every config without reporting would warn.
      expect(
        await warningsFor({ crossOriginOpenerPolicyReportOnly: 'same-origin' }),
      ).toHaveLength(0);
    });
  });
});

describe('COOP and COEP report-only', () => {
  async function headersFor(config: SecurityHeadersConfig) {
    const app = fastify({ trustProxy: true });

    await securityHeaders(config)(
      app as unknown as PluginHostInstance,
      createMockOptions(),
    );

    app.get('/t', () => ({ ok: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      return (await fetch(`http://127.0.0.1:${port}/t`)).headers;
    } finally {
      await app.close();
    }
  }

  it('sends the enforcing and report-only headers together', async () => {
    // The usual shape mid-migration: enforce what you have, report on the
    // stricter thing you want. COOP is the header here most likely to break
    // something that works, and the flows that rely on window.opener live in
    // someone else's code, so running it against real traffic first is the
    // only way to find out.
    const headers = await headersFor({
      reportingEndpoints: { coop: 'https://reports.example.com/coop' },
      crossOriginOpenerPolicy: 'same-origin-allow-popups',
      crossOriginOpenerPolicyReportOnly: {
        policy: 'same-origin',
        reportTo: 'coop',
      },
    });

    expect(headers.get('cross-origin-opener-policy')).toBe(
      'same-origin-allow-popups',
    );
    expect(headers.get('cross-origin-opener-policy-report-only')).toBe(
      'same-origin; report-to="coop"',
    );
  });

  it('quotes the report-to parameter', async () => {
    // A structured-header parameter value is a quoted string. An unquoted one
    // is not a parse error a browser reports, it is a parameter it drops,
    // which leaves the policy enforcing and reporting nowhere. Chrome accepts
    // the quoted form with no console warning.
    const headers = await headersFor({
      reportingEndpoints: { coep: 'https://reports.example.com/coep' },
      crossOriginEmbedderPolicyReportOnly: {
        policy: 'require-corp',
        reportTo: 'coep',
      },
    });

    expect(headers.get('cross-origin-embedder-policy-report-only')).toBe(
      'require-corp; report-to="coep"',
    );
  });

  it('accepts the bare token form without a reporting group', () => {
    // Reports still reach DevTools, which is enough while you are sitting in
    // front of the browser.
    expect(() =>
      securityHeaders({ crossOriginOpenerPolicyReportOnly: 'same-origin' }),
    ).not.toThrow();
  });

  it('rejects a report-to group reportingEndpoints does not define', () => {
    // The same rule csp.reportTo gets, and it has to reach here too: a group
    // nothing defines is a policy that reports to nowhere, whether the group
    // was named by a CSP directive or a header parameter.
    expect(() =>
      securityHeaders({
        reportingEndpoints: { other: 'https://reports.example.com/x' },
        crossOriginOpenerPolicyReportOnly: {
          policy: 'same-origin',
          reportTo: 'coop',
        },
      }),
    ).toThrow(/crossOriginOpenerPolicyReportOnly\.reportTo names the group/);
  });

  it('rejects a bad policy or an unknown sub-key', () => {
    expect(() =>
      securityHeaders({
        crossOriginOpenerPolicyReportOnly: { policy: 'same-orig' as never },
      }),
    ).toThrow(/must be one of/);

    expect(() =>
      securityHeaders({
        crossOriginOpenerPolicyReportOnly: {
          policy: 'same-origin',
          reportsTo: 'coop',
        } as never,
      }),
    ).toThrow(/is not an option/);
  });

  it('lets a resolver replace the report-only header alone', async () => {
    const headers = await headersFor({
      crossOriginOpenerPolicy: 'same-origin-allow-popups',
      crossOriginOpenerPolicyReportOnly: 'same-origin',
      resolve: () => ({ crossOriginOpenerPolicyReportOnly: false }),
    });

    expect(headers.get('cross-origin-opener-policy')).toBe(
      'same-origin-allow-popups',
    );
    expect(headers.get('cross-origin-opener-policy-report-only')).toBeNull();
  });
});

describe('resolver failures on a composed response', () => {
  it('does not replace an already-sent response with the resolver error', async () => {
    // On a short-circuited response the resolver runs for the first time from
    // onSend, where the reply is already composed. A throw there does not
    // produce a clean 500: it escapes the hook and hands Fastify's error
    // handler a finished response to rewrite, which is how a database error
    // message ends up in somebody else's 403.
    const app = fastify({ trustProxy: true, logger: false });

    await domainValidation({
      enforceHTTPS: false,
      validProductionDomains: ['allowed.example.com'],
    })(app as unknown as PluginHostInstance, createMockOptions());

    await securityHeaders({
      hsts: { maxAge: 31536000 },
      resolve: () => {
        throw new Error('pg: password authentication failed for user "x"');
      },
    })(app as unknown as PluginHostInstance, createMockOptions());

    app.get('/t', () => ({ ok: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/t`, {
        headers: {
          'x-forwarded-host': 'evil.example.com',
          'x-forwarded-proto': 'https',
        },
      });

      const body = await response.text();

      expect(response.status).toBe(403);
      expect(body).not.toContain('password authentication');
      expect(body).toContain('not authorized');

      // And the header the failure is supposed to cost it is still withheld.
      expect(response.headers.get('strict-transport-security')).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('rejects a resolver that breaks the reportTo pairing', () => {
    // Startup and validateSecurityHeadersPolicy both refuse a group nothing
    // defines. The request path did not, so a resolver replacing only one half
    // of the pair produced a tenant policy reporting to nowhere.
    return expect(
      (async () => {
        const app = fastify({ trustProxy: true });

        await securityHeaders({
          reportingEndpoints: { csp: 'https://reports.example.com/csp' },
          csp: { defaultSrc: ["'self'"], reportTo: 'csp' },
          resolve: () => ({
            reportingEndpoints: { other: 'https://reports.example.com/x' },
          }),
        })(app as unknown as PluginHostInstance, createMockOptions());

        app.get('/t', () => ({ ok: true }));
        await app.listen({ port: 0, host: '127.0.0.1' });

        const address = app.server.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        try {
          return (await fetch(`http://127.0.0.1:${port}/t`)).status;
        } finally {
          await app.close();
        }
      })(),
    ).resolves.toBe(500);
  });

  it('rejects null in a single-value field rather than inheriting', async () => {
    // `??` reads null as "inherit", so a stored policy meaning "send no header"
    // was served the baseline's instead. The public validator already rejected
    // it, so the two had drifted: a policy checked at save time behaved
    // differently at serve time.
    const app = fastify({ trustProxy: true });

    await securityHeaders({
      contentTypeOptions: true,
      // @ts-expect-error the type rules this out; the check is for stored policies
      resolve: () => ({ contentTypeOptions: null }),
    })(app as unknown as PluginHostInstance, createMockOptions());

    app.get('/t', () => ({ ok: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      expect((await fetch(`http://127.0.0.1:${port}/t`)).status).toBe(500);
    } finally {
      await app.close();
    }
  });

  it('keeps one registration of a plugin value from affecting another', async () => {
    // A securityHeaders() value is long-lived and handed back to the caller by
    // setResolver, so registering one on two servers is ordinary. Holding the
    // "was the gate registered above me" answer on the factory made the last
    // registration win for all of them: a gate-less second server flipped it
    // and the first, correctly ordered, silently resumed sending HSTS for
    // unverified hosts.
    const headers = securityHeaders({ hsts: { maxAge: 31536000 } });

    const withGate = fastify({ trustProxy: true });

    await domainValidation({
      enforceHTTPS: false,
      validProductionDomains: ['allowed.example.com'],
    })(withGate as unknown as PluginHostInstance, createMockOptions());

    await headers(
      withGate as unknown as PluginHostInstance,
      createMockOptions(),
    );

    withGate.addHook('onRequest', () =>
      Promise.reject(new Error('above the gate')),
    );

    withGate.get('/t', () => ({ ok: true }));
    await withGate.listen({ port: 0, host: '127.0.0.1' });

    const address = withGate.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const probe = () =>
      fetch(`http://127.0.0.1:${port}/t`, {
        headers: {
          'x-forwarded-host': 'unchecked.example.com',
          'x-forwarded-proto': 'https',
        },
      });

    const gateLess = fastify({ trustProxy: true });

    try {
      expect(
        (await probe()).headers.get('strict-transport-security'),
      ).toBeNull();

      // Same plugin value, second server, no gate.
      await headers(
        gateLess as unknown as PluginHostInstance,
        createMockOptions(),
      );

      expect(
        (await probe()).headers.get('strict-transport-security'),
      ).toBeNull();
    } finally {
      await withGate.close();
      await gateLess.close();
    }
  });
});

describe('a disclaimed host never reaches the resolver', () => {
  async function probe(host: string) {
    let calls = 0;
    const app = fastify({ trustProxy: true });

    await domainValidation({
      enforceHTTPS: false,
      validProductionDomains: ['allowed.example.com'],
    })(app as unknown as PluginHostInstance, createMockOptions());

    await securityHeaders({
      hsts: { maxAge: 31536000 },
      contentTypeOptions: true,
      resolve: () => {
        calls++;

        return null;
      },
    })(app as unknown as PluginHostInstance, createMockOptions());

    app.get('/t', () => ({ ok: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/t`, {
        headers: {
          'x-forwarded-host': host,
          'x-forwarded-proto': 'https',
        },
      });

      return { response, calls };
    } finally {
      await app.close();
    }
  }

  it('skips the lookup for a host the server has refused', async () => {
    // There is nothing for the resolver to decide: `resolve` picks a policy for
    // a tenant, and a refused host has none. Running it anyway let anyone make
    // the server do a store lookup per request just by sending a Host header
    // naming a domain that does not exist, on requests refused before any of
    // the application's own rate limiting saw them.
    const { response, calls } = await probe('evil.example.com');

    expect(response.status).toBe(403);
    expect(calls).toBe(0);

    // The response is still dressed from the defaults, and still loses the one
    // header a disclaimed host must not receive.
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toBeNull();
  });

  it('still consults it for a host that passes', async () => {
    const { response, calls } = await probe('allowed.example.com');

    expect(response.status).toBe(200);
    expect(calls).toBe(1);
    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=31536000',
    );
  });
});
