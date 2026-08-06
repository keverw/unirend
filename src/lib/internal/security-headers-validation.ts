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

import {
  applyCSPPreset,
  collectCSPIssues,
  describeValue,
  isPlainObject,
  type CSPConfig,
} from './csp-policy';

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

export type SecurityHeadersPolicyValidation =
  | {
      /** True when `issues` is empty. */
      valid: true;
      /** Empty, since the policy is valid. */
      issues: SecurityHeadersPolicyIssue[];
      /**
       * The policy, now typed.
       *
       * The same object that was passed in, not a copy or a cleaned-up version.
       * It is here because the input is `unknown`, so without it every caller
       * would need a cast to store what was just validated, and a cast is the
       * one thing checking the shape was supposed to remove.
       */
      policy: SecurityHeadersPolicyInput;
    }
  | {
      valid: false;
      /** Every problem found, not just the first. */
      issues: SecurityHeadersPolicyIssue[];
      policy?: undefined;
    };

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
 * Every field a policy may carry.
 *
 * Reported when something else turns up, because a misspelled `frameOption` is
 * ignored in silence otherwise: the form saves, the page says it worked, and
 * the header never changes. `satisfies` ties this to the type, so a field added
 * to the input without being added here is a type error rather than a validator
 * that quietly rejects the new field.
 */
const POLICY_KEYS = {
  csp: true,
  hsts: true,
  frameOptions: true,
} satisfies Record<keyof SecurityHeadersPolicyInput, true>;

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

/** Every key an HSTS block may carry, for reporting a misspelled one. */
const HSTS_KEYS = {
  maxAge: true,
  includeSubDomains: true,
  preload: true,
} satisfies Record<keyof HSTSShape, true>;

/**
 * Every problem with an HSTS block, rather than the first.
 *
 * Treats its argument as unknown whatever the parameter type says, for the same
 * reason `collectCSPIssues` does: this runs on stored policies as well as on
 * ones written in the repository, and throwing on a malformed one would defeat
 * the point of a collector.
 */
export function collectHSTSIssues(
  cfg: HSTSShape,
): SecurityHeadersPolicyIssue[] {
  if (!isPlainObject(cfg)) {
    return [
      {
        path: 'hsts',
        message: `Invalid securityHeaders config: hsts must be an object with a maxAge, received ${describeValue(cfg)}`,
      },
    ];
  }

  const issues: SecurityHeadersPolicyIssue[] = [];

  for (const key of Object.keys(cfg)) {
    if (!Object.hasOwn(HSTS_KEYS, key)) {
      issues.push({
        path: `hsts.${key}`,
        message: `Invalid securityHeaders config: hsts.${key} is not an HSTS option. Expected ${Object.keys(HSTS_KEYS).join(', ')}.`,
      });
    }
  }

  for (const key of ['includeSubDomains', 'preload'] as const) {
    const value: unknown = cfg[key];

    if (value !== undefined && typeof value !== 'boolean') {
      issues.push({
        path: `hsts.${key}`,
        message: `Invalid securityHeaders config: hsts.${key} must be a boolean, received ${describeValue(value)}`,
      });
    }
  }

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
  // Compared against `true` rather than read as truthy, so a preload flag that
  // is not a boolean produces one issue about its type instead of that plus the
  // two consequences of a value nobody should be acting on yet.
  if (cfg.preload === true) {
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
 * Every problem with a frameOptions value, rather than the first.
 *
 * A collector for a field with three legal values looks like overkill until you
 * notice what the alternative costs. The value goes onto the wire verbatim, and
 * a browser silently ignores an X-Frame-Options it does not recognize, so
 * `'ALLOWALL'` from a resolver is a page that frames anywhere while the config
 * says framing is controlled. Nothing downstream would report it.
 *
 * `null` is rejected rather than read as "not set", for the same reason the
 * policy validator rejects it elsewhere: it is what an empty form field or a
 * JSON column produces, and the two plausible readings (inherit the baseline,
 * or send no header) are far enough apart to be worth an answer instead of a
 * guess.
 */
export function collectFrameOptionsIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  if (
    value === undefined ||
    value === false ||
    value === 'DENY' ||
    value === 'SAMEORIGIN'
  ) {
    return [];
  }

  return [
    {
      path: 'frameOptions',
      message: `Invalid securityHeaders config: frameOptions must be 'DENY', 'SAMEORIGIN', or false to send no header, received ${describeValue(value)}`,
    },
  ];
}

/**
 * The policy as the plugin will read it, for the checks that span directives a
 * preset supplies.
 *
 * The directive-level rules deliberately run on the policy as written, so a
 * preset's own directives are never reported back as the author's mistakes.
 * The framing cross-check is the one rule that cannot work that way: it asks
 * about `frameAncestors`, and `preset: 'strict'` is a policy whose
 * `frameAncestors` is `["'none'"]` even though the author never typed it.
 * Reading the unexpanded policy there saw no `frameAncestors` at all, so
 * `{ csp: { preset: 'strict' }, frameOptions: 'SAMEORIGIN' }` validated clean
 * here and then threw per request once the plugin expanded it, which is the
 * failure this whole module exists to prevent.
 *
 * An unknown preset name comes back unexpanded rather than throwing.
 * `collectCSPIssues` has already reported it, and a name that names no preset
 * has no directives to cross-check against.
 */
function withPresetExpanded(
  csp: CSPConfig | false | undefined,
): CSPConfig | false | undefined {
  if (!csp) {
    return csp;
  }

  try {
    return applyCSPPreset(csp);
  } catch {
    return csp;
  }
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
 * Takes `unknown`, because the input worth validating is one nobody has vouched
 * for: a request body, a database row, a JSON file. Nothing is assumed about
 * its shape, so a string, an array, or `{ csp: null }` comes back as an issue
 * rather than as a thrown `TypeError`. On the way out, `result.policy` is the
 * same object with a type on it, which is what lets a caller store what was
 * just checked without a cast asserting the very thing they came here to ask.
 *
 * ```typescript
 * import { validateSecurityHeadersPolicy } from 'unirend/server';
 *
 * const result = validateSecurityHeadersPolicy(request.body, {
 *   baseline: { frameOptions: 'DENY', csp: defaultPolicy },
 * });
 *
 * if (!result.valid) {
 *   return reply.status(422).send({ errors: result.issues });
 * }
 *
 * await saveTenantPolicy(tenantID, result.policy);
 * ```
 *
 * Two things it deliberately does not do. It does not report a `csp.preset`'s
 * own directives as the author's mistakes, so pass the policy as it was
 * written. The framing cross-check is the exception, and has to be: it asks
 * about `frameAncestors`, which a preset supplies, so it reads the expanded
 * policy the plugin will actually serve rather than blessing a pair that then
 * fails per request. And it says nothing about whether a policy is a *good*
 * one, only whether it is valid: a tenant is perfectly able to save
 * `defaultSrc: ['*']` and this will accept it.
 *
 * @param policy The policy to check, in the shape a `resolve` callback returns
 * @param options.baseline What this policy layers over, for the checks that
 *   span both blocks. Omit when validating a complete standalone config.
 */
export function validateSecurityHeadersPolicy(
  policy: unknown,
  options: { baseline?: SecurityHeadersPolicyBaseline } = {},
): SecurityHeadersPolicyValidation {
  // Nothing about the argument is assumed, because the whole point is to run on
  // a value that just came off the wire or out of a table. A signature saying
  // `SecurityHeadersPolicyInput` would be a promise the caller cannot keep: a
  // Fastify body is `unknown`, so they would have had to cast it to call this,
  // and the cast would assert exactly what they came here to find out.
  if (!isPlainObject(policy)) {
    return {
      valid: false,
      issues: [
        {
          path: '',
          message: `Invalid securityHeaders policy: expected an object with csp, hsts, or frameOptions, received ${describeValue(policy)}`,
        },
      ],
    };
  }

  const issues: SecurityHeadersPolicyIssue[] = [];

  for (const key of Object.keys(policy)) {
    if (!Object.hasOwn(POLICY_KEYS, key)) {
      issues.push({
        path: key,
        message: `Invalid securityHeaders policy: ${key} is not a policy field. Expected ${Object.keys(POLICY_KEYS).join(', ')}.`,
      });
    }
  }

  // `null` is rejected rather than read as "not set". It is what a JSON column
  // or a form serializer produces for an empty field, so it is worth an answer
  // rather than a guess, and the two plausible guesses are far apart: inherit
  // the baseline, or send no header at all. `false` says the second one out
  // loud, and omitting the key says the first.
  let csp: CSPConfig | false | undefined;

  if (policy.csp !== undefined) {
    if (policy.csp === false) {
      csp = false;
    } else if (!isPlainObject(policy.csp)) {
      issues.push({
        path: 'csp',
        message: `Invalid securityHeaders policy: csp must be an object of directives, false to send no policy, or absent to inherit, received ${describeValue(policy.csp)}`,
      });
    } else {
      csp = policy.csp;
      issues.push(...collectCSPIssues(csp));
    }
  }

  if (policy.hsts !== undefined && policy.hsts !== false) {
    if (!isPlainObject(policy.hsts)) {
      issues.push({
        path: 'hsts',
        message: `Invalid securityHeaders policy: hsts must be an object with a maxAge, false to send no header, or absent to inherit, received ${describeValue(policy.hsts)}`,
      });
    } else {
      issues.push(...collectHSTSIssues(policy.hsts as unknown as HSTSShape));
    }
  }

  const frameOptionsIssues = collectFrameOptionsIssues(policy.frameOptions);
  const hasUsableFrameOptions = frameOptionsIssues.length === 0;

  issues.push(...frameOptionsIssues);

  // Skipped when either half failed its own check, since the cross-check is
  // about a combination and there is no combination to judge yet. Reporting it
  // anyway would be a second complaint about the first mistake.
  if (hasUsableFrameOptions) {
    const frameOptions = policy.frameOptions as
      false | 'DENY' | 'SAMEORIGIN' | undefined;

    // Resolved the way the request path resolves it: a block the policy omits
    // comes from the baseline.
    issues.push(
      ...collectFramingIssues(
        frameOptions ?? options.baseline?.frameOptions,
        withPresetExpanded(csp ?? options.baseline?.csp),
      ),
    );
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return { valid: true, issues, policy };
}
