/**
 * The rules a security-headers policy has to satisfy, expressed as collectors
 * rather than throws.
 *
 * Every rule lives here exactly once and is reported as a list. The plugin's
 * startup validators are thin wrappers that throw the first entry, so there is
 * no second copy of a rule or a message to drift out of step with this one.
 *
 * The split exists because two callers want opposite things from the same
 * rules. A server starting up wants to stop at the first problem, since there
 * is nobody to show a list to and the policy came from the repository. Anything
 * validating a policy a *person* is editing wants all the problems at once, and
 * wants them as data rather than as an exception.
 *
 * That second case is not hypothetical. Whatever a `resolve` callback returns
 * is validated per request, so an invalid stored policy surfaces as a 500 on
 * the next request from the tenant it belongs to: the latest possible moment,
 * and in front of the wrong audience.
 */

import { collectCSPIssues, type CSPConfig } from './csp-policy';

/** One problem with a policy, located well enough to point a form field at. */
export interface SecurityHeadersPolicyIssue {
  /**
   * Dotted path from the policy object, such as `csp.scriptSrc` or
   * `hsts.maxAge`. The framing cross-check reports `frameOptions`, since that
   * one is about a pair of fields rather than a single one.
   */
  path: string;
  /** Human-readable explanation, the same text the throwing validators use. */
  message: string;
}

export interface SecurityHeadersPolicyValidation {
  /** True when `issues` is empty. */
  valid: boolean;
  /** Every problem found, not just the first. */
  issues: SecurityHeadersPolicyIssue[];
}

/** Structural duplicate of the plugin's `HSTSConfig`, kept here to avoid a cycle. */
interface HSTSShape {
  maxAge: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}

/**
 * The shape a `resolve` callback returns, which is the unit worth validating:
 * it is what a tenant's stored policy becomes.
 */
export interface SecurityHeadersPolicyInput {
  csp?: false | CSPConfig;
  hsts?: false | HSTSShape;
  frameOptions?: false | 'DENY' | 'SAMEORIGIN';
}

/**
 * What the policy is layered on top of, for the checks that span both.
 *
 * Needed because each block replaces rather than merges, so an override that
 * omits a block inherits the baseline's. Judging the override alone would miss
 * a combination assembled from two halves that are each fine on their own. That
 * is reachable in the running server, so a validator blind to it would bless a
 * policy the request path then rejects, which is the one outcome this function
 * exists to prevent.
 */
export interface SecurityHeadersPolicyBaseline {
  csp?: false | CSPConfig;
  frameOptions?: false | 'DENY' | 'SAMEORIGIN';
}

/**
 * Every problem with an HSTS block, rather than the first.
 */
export function collectHSTSIssues(
  cfg: HSTSShape,
): SecurityHeadersPolicyIssue[] {
  const issues: SecurityHeadersPolicyIssue[] = [];

  if (
    typeof cfg.maxAge !== 'number' ||
    !Number.isFinite(cfg.maxAge) ||
    cfg.maxAge < 0
  ) {
    issues.push({
      path: 'hsts.maxAge',
      message:
        'Invalid securityHeaders config: hsts.maxAge must be a non-negative number (seconds)',
    });

    // The preload rules below compare against maxAge, so running them on a
    // value that is not a usable number would pile consequences on top of a
    // mistake the caller has already been told about.
    return issues;
  }

  // Chrome's preload list requires at least a year and includeSubDomains, and
  // a submission missing either is rejected there rather than here.
  if (cfg.preload) {
    if (cfg.maxAge < 31536000) {
      issues.push({
        path: 'hsts.maxAge',
        message:
          'Invalid securityHeaders config: HSTS preload requires maxAge >= 31536000 (1 year)',
      });
    }

    if (!cfg.includeSubDomains) {
      issues.push({
        path: 'hsts.includeSubDomains',
        message:
          'Invalid securityHeaders config: HSTS preload requires includeSubDomains: true',
      });
    }
  }

  return issues;
}

/**
 * The one framing pair where the fallback is weaker than the policy.
 *
 * `frame-ancestors` supersedes `X-Frame-Options` wherever CSP is supported,
 * which is everywhere that matters, so `frameOptions` is a fallback for
 * browsers that would otherwise get no framing policy at all.
 *
 * A fallback being *stricter* than the policy it backs up is fine and common:
 * `'DENY'` alongside `frame-ancestors 'self'` means an old browser refuses
 * framing a new one permits, which is the safe direction to be wrong in. The
 * reverse is not. `'SAMEORIGIN'` alongside `frame-ancestors 'none'` means an
 * old browser permits same-origin framing the policy exists to forbid, and the
 * author almost certainly believes they have forbidden it everywhere.
 *
 * Only that one combination is reported. Anything else, including a deliberate
 * "modern browsers get the nuance, old ones get the blunt fallback" pairing
 * such as `'SAMEORIGIN'` with a partner origin listed, is left alone: it is a
 * real pattern and not this code's business to second-guess.
 *
 * Takes the two halves separately because the pair it judges can be assembled
 * from two places, so neither half is enough on its own to ask the question.
 *
 * @param frameOptions The effective X-Frame-Options value, if any
 * @param csp The effective CSP config, already expanded from its preset
 */
export function collectFramingIssues(
  frameOptions: false | 'DENY' | 'SAMEORIGIN' | undefined,
  csp: CSPConfig | false | undefined,
): SecurityHeadersPolicyIssue[] {
  if (!csp || frameOptions !== 'SAMEORIGIN') {
    return [];
  }

  const isFramingDenied =
    Array.isArray(csp.frameAncestors) &&
    csp.frameAncestors.length === 1 &&
    csp.frameAncestors[0] === "'none'";

  if (!isFramingDenied) {
    return [];
  }

  return [
    {
      path: 'frameOptions',
      message:
        "Invalid securityHeaders config: csp.frameAncestors is [\"'none'\"] but frameOptions is 'SAMEORIGIN'. frame-ancestors supersedes X-Frame-Options where CSP is supported, so the weaker X-Frame-Options would still let a browser without CSP support frame this page from the same origin. Use frameOptions: 'DENY' to match, or drop frameOptions entirely.",
    },
  ];
}

/**
 * Validate a security-headers policy and report everything wrong with it.
 *
 * Applies exactly the rules the plugin applies, because it is the same code, so
 * a policy this accepts is one `securityHeaders` will accept, whether it is
 * passed at startup or returned from a `resolve` callback.
 *
 * ```typescript
 * import { validateSecurityHeadersPolicy } from 'unirend/server';
 *
 * const result = validateSecurityHeadersPolicy(submitted, {
 *   baseline: { frameOptions: 'DENY', csp: defaultPolicy },
 * });
 *
 * if (!result.valid) {
 *   return reply.status(422).send({ errors: result.issues });
 * }
 *
 * await saveTenantPolicy(tenantID, submitted);
 * ```
 *
 * Two things it deliberately does not do. It does not expand `csp.preset`, so
 * pass the policy as it was written and the preset's own directives are not
 * re-reported as the author's mistakes. And it says nothing about whether a
 * policy is a *good* one, only whether it is valid: a tenant is perfectly able
 * to save `defaultSrc: ['*']` and this will accept it.
 *
 * @param policy The policy to check, in the shape a `resolve` callback returns
 * @param options.baseline What this policy layers over, for the checks that
 *   span both blocks. Omit when validating a complete standalone config.
 */
export function validateSecurityHeadersPolicy(
  policy: SecurityHeadersPolicyInput,
  options: { baseline?: SecurityHeadersPolicyBaseline } = {},
): SecurityHeadersPolicyValidation {
  const issues: SecurityHeadersPolicyIssue[] = [];

  if (policy.csp !== undefined && policy.csp !== false) {
    issues.push(...collectCSPIssues(policy.csp));
  }

  if (policy.hsts !== undefined && policy.hsts !== false) {
    issues.push(...collectHSTSIssues(policy.hsts));
  }

  // Resolved the way the request path resolves it: a block the policy omits
  // comes from the baseline.
  issues.push(
    ...collectFramingIssues(
      policy.frameOptions ?? options.baseline?.frameOptions,
      policy.csp ?? options.baseline?.csp,
    ),
  );

  return { valid: issues.length === 0, issues };
}
