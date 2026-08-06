import { describe, it, expect } from 'bun:test';
import fastify from 'fastify';
import { validateSecurityHeadersPolicy } from './security-headers-validation';
import { securityHeaders } from '../built-in-plugins/security-headers';
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
    ];

    for (const { name, config } of cases) {
      it(`agrees with the plugin on ${name}`, async () => {
        const wasAccepted = await pluginAccepts(config);

        expect(validateSecurityHeadersPolicy(config).valid).toBe(wasAccepted);
      });
    }
  });

  it('does not expand a preset', () => {
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
