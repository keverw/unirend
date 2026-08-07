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

/**
 * Strict-Transport-Security (HSTS) header parameters.
 *
 * Lives here rather than in the plugin, next to the rules that judge it, so
 * `collectHSTSIssues` can be written against it without the plugin and the
 * validator importing each other. Same arrangement as the CORS types in
 * `cors-validation`. The plugin re-exports it, so `HSTSConfig` is still
 * imported from where it always was.
 *
 * It used to be a structural duplicate on each side. That compiled, and it
 * quietly cost the parity guard below its meaning: `satisfies` tied the key
 * list to *this* type while the resolver's declared return type was the other
 * one, so a field added to the plugin's copy alone would have been a runtime
 * rejection of a legitimate resolver with no type error anywhere.
 */
export interface HSTSConfig {
  /** max-age in seconds */
  maxAge: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}

/**
 * The shape a `resolve` callback returns, which is the unit worth validating:
 * it is what a tenant's stored policy becomes.
 *
 * The plugin exports this as `SecurityHeadersOverride`, which is the name that
 * reads better at a `resolve` call site. One type, two names, so the validator
 * and the request path can never disagree about what a policy may contain.
 */
export interface SecurityHeadersPolicyInput {
  csp?: false | CSPConfig;
  hsts?: false | HSTSConfig;
  frameOptions?: false | 'DENY' | 'SAMEORIGIN';
  contentTypeOptions?: boolean;
  referrerPolicy?: false | ReferrerPolicyToken | ReferrerPolicyToken[];
  permissionsPolicy?: false | PermissionsPolicyConfig;
  crossOriginOpenerPolicy?: false | CrossOriginOpenerPolicySetting;
  crossOriginOpenerPolicyReportOnly?: false | CrossOriginOpenerPolicySetting;
  crossOriginResourcePolicy?: false | CrossOriginResourcePolicy;
  crossOriginEmbedderPolicy?: false | CrossOriginEmbedderPolicySetting;
  crossOriginEmbedderPolicyReportOnly?:
    false | CrossOriginEmbedderPolicySetting;
  reportingEndpoints?: false | ReportingEndpointsConfig;
}

/**
 * A cross-origin policy value, optionally with the reporting group violations
 * go to.
 *
 * The object form exists because these headers are structured headers whose
 * value takes a `report-to` parameter, and without it a report-only policy is
 * only visible in DevTools. That is fine while you are sitting in front of the
 * browser and useless for finding out whether a policy breaks somebody else's
 * OAuth popup, which is the entire reason the report-only variants exist.
 *
 * ```ts
 * crossOriginOpenerPolicyReportOnly: { policy: 'same-origin', reportTo: 'coop' },
 * reportingEndpoints: { coop: 'https://reports.example.com/coop' },
 * ```
 */
export interface CrossOriginPolicySetting<Policy extends string> {
  policy: Policy;
  reportTo?: string;
}

export type CrossOriginOpenerPolicySetting =
  CrossOriginOpenerPolicy | CrossOriginPolicySetting<CrossOriginOpenerPolicy>;

export type CrossOriginEmbedderPolicySetting =
  | CrossOriginEmbedderPolicy
  | CrossOriginPolicySetting<CrossOriginEmbedderPolicy>;

/**
 * `Reporting-Endpoints`, written as a group name to the URL reports go to.
 *
 * This is the half of `csp.reportTo` that is not the CSP header. A `report-to`
 * directive names a group, and a group means nothing until a response defines
 * it, so a policy carrying `report-to csp` and nothing else reports to nowhere:
 * violations happen, no report arrives, and the silence reads as success. That
 * is the exact failure `reportURI` is validated against, and it was wide open
 * on the newer of the two mechanisms.
 *
 * ```ts
 * reportingEndpoints: { csp: 'https://reports.example.com/csp' },
 * csp: { defaultSrc: ["'self'"], reportTo: 'csp', reportOnly: true },
 * ```
 */
export type ReportingEndpointsConfig = Record<string, string>;

/**
 * `Referrer-Policy` tokens.
 *
 * The whole list, because anything else is ignored by a browser, which then
 * falls back to its own default. That default is
 * `strict-origin-when-cross-origin` in every current browser, so a typo here
 * does not fail loudly, it silently gives you the default while your config
 * says otherwise.
 */
const REFERRER_POLICY_TOKENS = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

export type ReferrerPolicyToken =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

/**
 * `Cross-Origin-Opener-Policy` values.
 *
 * `noopener-allow-popups` is the newest and is not everywhere yet, which costs
 * nothing: a browser that does not know it ignores the header and behaves as
 * `unsafe-none`, the same as sending nothing.
 */
export type CrossOriginOpenerPolicy =
  | 'unsafe-none'
  | 'same-origin'
  | 'same-origin-allow-popups'
  | 'noopener-allow-popups';

/** `Cross-Origin-Resource-Policy` values. */
export type CrossOriginResourcePolicy =
  'same-site' | 'same-origin' | 'cross-origin';

/** `Cross-Origin-Embedder-Policy` values. */
export type CrossOriginEmbedderPolicy =
  'unsafe-none' | 'require-corp' | 'credentialless';

/**
 * `Permissions-Policy`, written as a feature to its allowlist.
 *
 * An empty array is the common and most useful case: it serializes to
 * `feature=()`, which disables the feature for everyone including this
 * document. `['self']` allows it same-origin, `['*']` allows it everywhere, and
 * an origin is written as it appears in the header without quotes here, since
 * quoting is this module's job.
 *
 * ```ts
 * permissionsPolicy: {
 *   camera: [],
 *   microphone: [],
 *   geolocation: ['self'],
 *   'picture-in-picture': ['self', 'https://player.example.com'],
 * }
 * ```
 */
export type PermissionsPolicyConfig = Record<string, string[]>;

/**
 * Every field a policy may carry.
 *
 * Reported when something else turns up, because a misspelled `frameOption` is
 * ignored in silence otherwise: the form saves, the page says it worked, and
 * the header never changes. `satisfies` ties this to the type, so a field added
 * to the input without being added here is a type error rather than a validator
 * that quietly rejects the new field.
 *
 * That guard only means something because the plugin's resolver type is this
 * same type rather than a look-alike. See `HSTSConfig` above.
 */
const POLICY_KEYS = {
  csp: true,
  hsts: true,
  frameOptions: true,
  contentTypeOptions: true,
  referrerPolicy: true,
  permissionsPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginOpenerPolicyReportOnly: true,
  crossOriginResourcePolicy: true,
  crossOriginEmbedderPolicy: true,
  crossOriginEmbedderPolicyReportOnly: true,
  reportingEndpoints: true,
} satisfies Record<keyof SecurityHeadersPolicyInput, true>;

/**
 * A reporting group name, which the structured-headers grammar limits to a
 * token. The same characters `csp.reportTo` already accepts.
 */
const REPORTING_GROUP = /^[a-z*][a-z0-9!#$%&'*+\-.^_`|~]*$/i;

/**
 * Every problem with a `Reporting-Endpoints` block.
 *
 * The URL rules are the Reporting API's rather than a URL parser's. An endpoint
 * has to be absolute, because there is no base to resolve it against by the
 * time a browser queues a report, and it has to be a secure transport, because
 * a browser will not deliver reports over plain HTTP from a secure page. Both
 * failures are invisible: the header parses, the group exists, and nothing
 * arrives.
 */
export function collectReportingEndpointsIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  if (value === undefined || value === false) {
    return [];
  }

  if (!isPlainObject(value)) {
    return [
      {
        path: 'reportingEndpoints',
        message: `Invalid securityHeaders config: reportingEndpoints must be an object of group names to URLs, or false to send no header, received ${describeValue(value)}`,
      },
    ];
  }

  const groups = Object.keys(value);

  if (groups.length === 0) {
    return [
      {
        path: 'reportingEndpoints',
        message:
          'Invalid securityHeaders config: reportingEndpoints is empty, which serializes to an empty header. Use false to send no header.',
      },
    ];
  }

  const issues: SecurityHeadersPolicyIssue[] = [];

  for (const group of groups) {
    if (!REPORTING_GROUP.test(group)) {
      issues.push({
        path: `reportingEndpoints.${group}`,
        message: `Invalid securityHeaders config: reportingEndpoints group "${group}" is not a usable group name`,
      });

      continue;
    }

    const endpoint: unknown = value[group];

    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
      issues.push({
        path: `reportingEndpoints.${group}`,
        message: `Invalid securityHeaders config: reportingEndpoints.${group} must be an absolute URL, received ${describeValue(endpoint)}`,
      });

      continue;
    }

    let parsed: URL;

    try {
      parsed = new URL(endpoint);
    } catch {
      issues.push({
        path: `reportingEndpoints.${group}`,
        message: `Invalid securityHeaders config: reportingEndpoints.${group} "${endpoint}" is not an absolute URL. A browser has no base to resolve a relative endpoint against when it queues a report.`,
      });

      continue;
    }

    // `http://localhost` is a potentially trustworthy origin, which is what the
    // rule is actually about, so a local collector during development is fine.
    const isLocal =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '::1';

    if (parsed.protocol !== 'https:' && !isLocal) {
      issues.push({
        path: `reportingEndpoints.${group}`,
        message: `Invalid securityHeaders config: reportingEndpoints.${group} "${endpoint}" is not https. A browser does not deliver reports over an insecure transport, so this endpoint would receive nothing.`,
      });
    }
  }

  return issues;
}

/**
 * The one cross-check between a CSP and the reporting configuration.
 *
 * `report-to` names a group, and a group that nothing defines is a policy that
 * reports to nowhere. Nothing downstream notices: the header is well formed,
 * the browser parses it, and the absence of reports looks exactly like the
 * absence of violations.
 *
 * Only reported when `reportingEndpoints` is configured and does not define the
 * group. When it is absent entirely the answer is genuinely unknown, since the
 * header may be coming from a reverse proxy or a hook of the caller's own, so
 * that case is a startup warning rather than a failure. Turning it into one
 * would break a working deployment to complain about a file this code cannot
 * see.
 *
 * @param csp The effective CSP config, already expanded from its preset
 * @param reportingEndpoints The effective reporting endpoints, if any
 */
export function collectReportingIssues(
  csp: CSPConfig | false | undefined,
  reportingEndpoints: false | ReportingEndpointsConfig | undefined,
  /**
   * The other places a reporting group can be named, as `path -> group`.
   *
   * The cross-origin policies carry theirs as a header parameter rather than a
   * directive, so they reach this the same way and fail the same way: a group
   * nothing defines is a policy that reports to nowhere.
   */
  extraGroups: ReadonlyArray<readonly [path: string, group: string]> = [],
): SecurityHeadersPolicyIssue[] {
  if (!reportingEndpoints || !isPlainObject(reportingEndpoints)) {
    return [];
  }

  const named: Array<readonly [string, string]> = [...extraGroups];

  if (csp && typeof csp.reportTo === 'string' && csp.reportTo.trim() !== '') {
    named.unshift(['csp.reportTo', csp.reportTo]);
  }

  const issues: SecurityHeadersPolicyIssue[] = [];

  for (const [path, group] of named) {
    if (Object.hasOwn(reportingEndpoints, group)) {
      continue;
    }

    issues.push({
      path,
      message: `Invalid securityHeaders config: ${path} names the group "${group}", which reportingEndpoints does not define. A browser resolves a reporting group through the Reporting-Endpoints header, so this policy would report to nowhere: violations happen, nothing arrives, and the quiet reads as success. Defined groups: ${Object.keys(reportingEndpoints).join(', ')}.`,
    });
  }

  return issues;
}

/**
 * Every reporting group a policy's cross-origin headers name, for the
 * cross-check above.
 */
export function crossOriginReportGroups(
  policy: SecurityHeadersPolicyInput,
): Array<readonly [path: string, group: string]> {
  const fields = [
    'crossOriginOpenerPolicy',
    'crossOriginOpenerPolicyReportOnly',
    'crossOriginEmbedderPolicy',
    'crossOriginEmbedderPolicyReportOnly',
  ] as const;

  const groups: Array<readonly [string, string]> = [];

  for (const field of fields) {
    const group = crossOriginPolicyReportGroup(policy[field]);

    if (group !== undefined) {
      groups.push([`${field}.reportTo`, group]);
    }
  }

  return groups;
}

/**
 * Whether a policy names a reporting group with nothing anywhere to define it.
 *
 * Separate from the collector above because the answer is a warning rather than
 * an issue: `Reporting-Endpoints` may legitimately be set by a proxy or another
 * hook, which this code cannot see.
 *
 * Reads the cross-origin policies' `report-to` parameters as well as
 * `csp.reportTo`, since a group is a group wherever it was named. A config that
 * sets only `crossOriginOpenerPolicyReportOnly` with a `reportTo` and no CSP is
 * the shape someone reaches for first, and it fails exactly the same way: the
 * header goes out naming a group nothing defines, no report ever arrives, and
 * the quiet reads as "the policy would not break anything", which is the one
 * conclusion a report-only header exists to rule out.
 */
export function isReportingGroupUndefined(
  csp: CSPConfig | false | undefined,
  reportingEndpoints: false | ReportingEndpointsConfig | undefined,
  extraGroups: ReadonlyArray<readonly [path: string, group: string]> = [],
): boolean {
  if (reportingEndpoints) {
    return false;
  }

  const hasCSPGroup =
    csp && typeof csp.reportTo === 'string' && csp.reportTo.trim() !== '';

  return Boolean(hasCSPGroup) || extraGroups.length > 0;
}

/**
 * Serialize a `Reporting-Endpoints` block to its header value.
 *
 * The URL is a structured-headers string, so it is quoted. An unquoted one is
 * not a parse error a browser reports, it is an item it drops.
 */
export function serializeReportingEndpoints(
  config: ReportingEndpointsConfig,
): string {
  return Object.entries(config)
    .map(([group, endpoint]) => `${group}="${endpoint}"`)
    .join(', ');
}

/**
 * Check a header whose value is one of a fixed set of tokens.
 *
 * Every one of these headers fails the same way when it is wrong: a browser
 * that does not recognize the value ignores the header entirely and falls back
 * to its own default, so a typo leaves the protection off while the config says
 * it is on. That is the same reasoning behind checking `frameOptions` and the
 * `sandbox` tokens, applied once rather than five times.
 *
 * `false` means "send no header" and is always allowed. `undefined` means the
 * field was not set, which is the same thing at this layer.
 */
function collectTokenHeaderIssues(
  path: string,
  headerName: string,
  value: unknown,
  allowed: ReadonlySet<string>,
): SecurityHeadersPolicyIssue[] {
  if (value === undefined || value === false) {
    return [];
  }

  if (typeof value === 'string' && allowed.has(value)) {
    return [];
  }

  return [
    {
      path,
      message: `Invalid securityHeaders config: ${path} must be one of ${[...allowed].map((token) => `'${token}'`).join(', ')}, or false to send no ${headerName} header, received ${describeValue(value)}`,
    },
  ];
}

const COOP_VALUES = new Set<string>([
  'unsafe-none',
  'same-origin',
  'same-origin-allow-popups',
  'noopener-allow-popups',
]);

const CORP_VALUES = new Set<string>([
  'same-site',
  'same-origin',
  'cross-origin',
]);

const COEP_VALUES = new Set<string>([
  'unsafe-none',
  'require-corp',
  'credentialless',
]);

/**
 * Every problem with a `Referrer-Policy` value.
 *
 * A list is allowed because the header takes one: a browser uses the last token
 * it understands, which is how a newer policy is deployed with an older one
 * behind it as a fallback. Every token still has to be a real one, since an
 * unknown token is skipped and a list of nothing but unknown tokens leaves the
 * browser default in force.
 */
export function collectReferrerPolicyIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  if (value === undefined || value === false) {
    return [];
  }

  const tokens = Array.isArray(value) ? value : [value];

  if (tokens.length === 0) {
    return [
      {
        path: 'referrerPolicy',
        message:
          'Invalid securityHeaders config: referrerPolicy is an empty list, which serializes to an empty header a browser ignores. Use false to send no header.',
      },
    ];
  }

  const issues: SecurityHeadersPolicyIssue[] = [];

  for (const token of tokens) {
    if (typeof token !== 'string' || !REFERRER_POLICY_TOKENS.has(token)) {
      issues.push({
        path: 'referrerPolicy',
        message: `Invalid securityHeaders config: referrerPolicy token ${describeValue(token)} is not a Referrer-Policy value. A browser ignores one it does not know and falls back to its own default, so this would leave a policy other than the one configured. Valid: ${[...REFERRER_POLICY_TOKENS].join(', ')}.`,
      });
    }
  }

  return issues;
}

/**
 * A `Permissions-Policy` allowlist item that is a keyword rather than an origin.
 *
 * `src` is only meaningful in an iframe's `allow` attribute, not in the header,
 * so it is deliberately absent.
 */
const PERMISSIONS_POLICY_KEYWORDS = new Set(['self', '*']);

/**
 * A feature name, which the structured-headers grammar limits to a token.
 *
 * Checked because the failure is silent in the direction that matters: a
 * browser drops a policy item it cannot parse, so a feature with a stray
 * character disables nothing while reading as though it disables everything.
 */
const PERMISSIONS_POLICY_FEATURE = /^[a-z][a-z0-9-]*$/;

/**
 * Every problem with a `Permissions-Policy` block.
 */
export function collectPermissionsPolicyIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  if (value === undefined || value === false) {
    return [];
  }

  if (!isPlainObject(value)) {
    return [
      {
        path: 'permissionsPolicy',
        message: `Invalid securityHeaders config: permissionsPolicy must be an object of features to allowlists, or false to send no header, received ${describeValue(value)}`,
      },
    ];
  }

  const features = Object.keys(value);

  if (features.length === 0) {
    return [
      {
        path: 'permissionsPolicy',
        message:
          'Invalid securityHeaders config: permissionsPolicy is empty, which serializes to an empty header. Use false to send no header.',
      },
    ];
  }

  const issues: SecurityHeadersPolicyIssue[] = [];

  for (const feature of features) {
    if (!PERMISSIONS_POLICY_FEATURE.test(feature)) {
      issues.push({
        path: `permissionsPolicy.${feature}`,
        message: `Invalid securityHeaders config: permissionsPolicy feature "${feature}" is not a valid feature name. Expected lowercase letters, digits and hyphens, such as "camera" or "picture-in-picture".`,
      });

      continue;
    }

    const allowlist: unknown = value[feature];

    if (!Array.isArray(allowlist)) {
      issues.push({
        path: `permissionsPolicy.${feature}`,
        message: `Invalid securityHeaders config: permissionsPolicy.${feature} must be an array of origins or keywords. Use an empty array to disable the feature entirely.`,
      });

      continue;
    }

    for (const item of allowlist) {
      if (typeof item !== 'string' || item.trim() === '') {
        issues.push({
          path: `permissionsPolicy.${feature}`,
          message: `Invalid securityHeaders config: permissionsPolicy.${feature} contains ${describeValue(item)}, which is not an origin or a keyword`,
        });

        continue;
      }

      if (PERMISSIONS_POLICY_KEYWORDS.has(item)) {
        continue;
      }

      // Anything else has to be an origin, and a serialized one at that: the
      // header's grammar takes a quoted origin, not a host pattern, so no
      // wildcard belongs in one. Parsed rather than pattern-matched so a value
      // that cannot name an origin is caught rather than quoted and shipped.
      let parsed: URL;

      try {
        parsed = new URL(item);
      } catch {
        issues.push({
          path: `permissionsPolicy.${feature}`,
          message: `Invalid securityHeaders config: permissionsPolicy.${feature} entry "${item}" is not an origin. Use a full origin such as "https://example.com", or the keyword "self" or "*".`,
        });

        continue;
      }

      if (parsed.origin !== item.replace(/\/$/, '')) {
        issues.push({
          path: `permissionsPolicy.${feature}`,
          message: `Invalid securityHeaders config: permissionsPolicy.${feature} entry "${item}" carries more than an origin. Write it as "${parsed.origin}".`,
        });
      }
    }
  }

  return issues;
}

/** Every problem with a `X-Content-Type-Options` setting. */
export function collectContentTypeOptionsIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  if (value === undefined || typeof value === 'boolean') {
    return [];
  }

  return [
    {
      path: 'contentTypeOptions',
      message: `Invalid securityHeaders config: contentTypeOptions must be true to send "X-Content-Type-Options: nosniff" or false to send no header, received ${describeValue(value)}`,
    },
  ];
}

/**
 * Every problem with a cross-origin policy that may carry a reporting group.
 *
 * Handles both spellings: the bare token, and the object form that names where
 * violations go. The group itself is cross-checked against `reportingEndpoints`
 * by `collectReportingIssues`, for the same reason `csp.reportTo` is: a group
 * nothing defines is a policy that reports to nowhere.
 */
function collectCrossOriginPolicyIssues(
  path: string,
  headerName: string,
  value: unknown,
  allowed: ReadonlySet<string>,
): SecurityHeadersPolicyIssue[] {
  if (value === undefined || value === false) {
    return [];
  }

  if (typeof value === 'string') {
    return collectTokenHeaderIssues(path, headerName, value, allowed);
  }

  if (!isPlainObject(value)) {
    return [
      {
        path,
        message: `Invalid securityHeaders config: ${path} must be a policy token, or an object with a policy and an optional reportTo, received ${describeValue(value)}`,
      },
    ];
  }

  const issues = collectTokenHeaderIssues(
    path,
    headerName,
    value.policy,
    allowed,
  );

  for (const key of Object.keys(value)) {
    if (key !== 'policy' && key !== 'reportTo') {
      issues.push({
        path: `${path}.${key}`,
        message: `Invalid securityHeaders config: ${path}.${key} is not an option. Expected policy, reportTo.`,
      });
    }
  }

  const reportTo: unknown = value.reportTo;

  if (
    reportTo !== undefined &&
    (typeof reportTo !== 'string' ||
      reportTo.trim() === '' ||
      !REPORTING_GROUP.test(reportTo))
  ) {
    issues.push({
      path: `${path}.reportTo`,
      message: `Invalid securityHeaders config: ${path}.reportTo must be a reporting group name, received ${describeValue(reportTo)}`,
    });
  }

  return issues;
}

/** Every problem with a `Cross-Origin-Opener-Policy` value. */
export function collectCOOPIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  return collectCrossOriginPolicyIssues(
    'crossOriginOpenerPolicy',
    'Cross-Origin-Opener-Policy',
    value,
    COOP_VALUES,
  );
}

/** Every problem with a `Cross-Origin-Opener-Policy-Report-Only` value. */
export function collectCOOPReportOnlyIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  return collectCrossOriginPolicyIssues(
    'crossOriginOpenerPolicyReportOnly',
    'Cross-Origin-Opener-Policy-Report-Only',
    value,
    COOP_VALUES,
  );
}

/** Every problem with a `Cross-Origin-Embedder-Policy-Report-Only` value. */
export function collectCOEPReportOnlyIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  return collectCrossOriginPolicyIssues(
    'crossOriginEmbedderPolicyReportOnly',
    'Cross-Origin-Embedder-Policy-Report-Only',
    value,
    COEP_VALUES,
  );
}

/** Every problem with a `Cross-Origin-Resource-Policy` value. */
export function collectCORPIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  return collectTokenHeaderIssues(
    'crossOriginResourcePolicy',
    'Cross-Origin-Resource-Policy',
    value,
    CORP_VALUES,
  );
}

/** Every problem with a `Cross-Origin-Embedder-Policy` value. */
export function collectCOEPIssues(
  value: unknown,
): SecurityHeadersPolicyIssue[] {
  return collectCrossOriginPolicyIssues(
    'crossOriginEmbedderPolicy',
    'Cross-Origin-Embedder-Policy',
    value,
    COEP_VALUES,
  );
}

/**
 * Serialize a cross-origin policy value, with its reporting group when it has
 * one.
 *
 * `report-to` is a structured-header parameter, so its value is quoted. An
 * unquoted one is not a parse error a browser reports, it is a parameter it
 * drops, which leaves the policy enforcing and reporting nowhere.
 */
export function serializeCrossOriginPolicy(
  value: CrossOriginOpenerPolicySetting | CrossOriginEmbedderPolicySetting,
): string {
  if (typeof value === 'string') {
    return value;
  }

  return value.reportTo
    ? `${value.policy}; report-to="${value.reportTo}"`
    : value.policy;
}

/** The reporting groups a cross-origin policy names, for the cross-check. */
export function crossOriginPolicyReportGroup(
  value: unknown,
): string | undefined {
  return isPlainObject(value) && typeof value.reportTo === 'string'
    ? value.reportTo
    : undefined;
}

/**
 * Serialize a `Permissions-Policy` block to its header value.
 *
 * Origins are quoted and keywords are not, which is the structured-headers
 * grammar rather than a style choice: `self` unquoted is the keyword, and
 * `"https://a.example"` quoted is an origin. Getting it backwards produces an
 * item a browser drops, and a dropped item is a feature left enabled.
 */
export function serializePermissionsPolicy(
  config: PermissionsPolicyConfig,
): string {
  return Object.entries(config)
    .map(([feature, allowlist]) => {
      const items = allowlist.map((item) =>
        PERMISSIONS_POLICY_KEYWORDS.has(item) ? item : `"${item}"`,
      );

      // `*` is written bare rather than inside the parentheses, and it is the
      // one item that cannot be combined with others.
      if (items.includes('*')) {
        return `${feature}=*`;
      }

      return `${feature}=(${items.join(' ')})`;
    })
    .join(', ');
}

/**
 * Every key on a policy object that is not a policy field.
 *
 * Exported so the request path can hold a `resolve` callback to the same rule
 * this validator applies, which is the whole point of the pair existing. A
 * resolver returning `{ frameOption: 'DENY' }` has written a policy that does
 * nothing: the misspelled key is dropped, the block it meant to set is absent,
 * and an absent block inherits the baseline. So the tenant silently gets the
 * default framing policy, on a resolver whose author has every reason to
 * believe they overrode it. There is nothing downstream to catch that, because
 * inheriting a block is also what a correct resolver does.
 */
export function unknownPolicyKeys(policy: Record<string, unknown>): string[] {
  return Object.keys(policy).filter((key) => !Object.hasOwn(POLICY_KEYS, key));
}

/** The policy fields, for a message that says what was expected. */
export const SECURITY_HEADERS_POLICY_KEYS: readonly string[] =
  Object.keys(POLICY_KEYS);

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
  reportingEndpoints?: false | ReportingEndpointsConfig;
  /**
   * The cross-origin policies, which take part in the reporting cross-check
   * through their `report-to` parameter exactly as `csp.reportTo` does. Present
   * here for the same reason the other blocks are: an override that omits one
   * inherits the baseline's, so judging the override alone would miss a pair
   * assembled from both.
   */
  crossOriginOpenerPolicy?: false | CrossOriginOpenerPolicySetting;
  crossOriginOpenerPolicyReportOnly?: false | CrossOriginOpenerPolicySetting;
  crossOriginEmbedderPolicy?: false | CrossOriginEmbedderPolicySetting;
  crossOriginEmbedderPolicyReportOnly?:
    false | CrossOriginEmbedderPolicySetting;
}

/** Every key an HSTS block may carry, for reporting a misspelled one. */
const HSTS_KEYS = {
  maxAge: true,
  includeSubDomains: true,
  preload: true,
} satisfies Record<keyof HSTSConfig, true>;

/**
 * Every problem with an HSTS block, rather than the first.
 *
 * Treats its argument as unknown whatever the parameter type says, for the same
 * reason `collectCSPIssues` does: this runs on stored policies as well as on
 * ones written in the repository, and throwing on a malformed one would defeat
 * the point of a collector.
 */
export function collectHSTSIssues(
  cfg: HSTSConfig,
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
 * A report-only policy is left alone as well, and that one is about the word
 * "supersedes". `X-Frame-Options` is ignored only in the presence of a
 * `frame-ancestors` directive whose disposition is *enforce*. A report-only
 * policy blocks nothing and displaces nothing, so `frame-ancestors 'none'`
 * there is not a stricter rule the fallback is undercutting, it is a question
 * being asked, and `'SAMEORIGIN'` remains the only framing policy actually in
 * force for every browser alike. Reporting it turned the documented rollout,
 * running a candidate policy in report-only until the violations go quiet, into
 * a startup failure for anyone who already had an `X-Frame-Options` header,
 * which is exactly the population most likely to be tightening framing.
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
  // `reportOnly` is read as truthy rather than compared against `true`, unlike
  // the opt-in flags elsewhere. The direction of the mistake is what differs: a
  // non-boolean there would switch a protection off, while here it only
  // withholds a warning about a pairing that is already reported as a type
  // error by `collectCSPIssues`. Piling a second complaint on top of the first
  // would just be describing one mistake twice.
  if (!csp || frameOptions !== 'SAMEORIGIN' || csp.reportOnly) {
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

  for (const key of unknownPolicyKeys(policy)) {
    issues.push({
      path: key,
      message: `Invalid securityHeaders policy: ${key} is not a policy field. Expected ${SECURITY_HEADERS_POLICY_KEYS.join(', ')}.`,
    });
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
      issues.push(...collectHSTSIssues(policy.hsts as unknown as HSTSConfig));
    }
  }

  const frameOptionsIssues = collectFrameOptionsIssues(policy.frameOptions);
  const hasUsableFrameOptions = frameOptionsIssues.length === 0;

  issues.push(...frameOptionsIssues);

  // The single-value headers, each judged by the same rule the plugin applies
  // at startup. None of them takes part in a cross-check, so they are a flat
  // list rather than the staged handling `csp` and `frameOptions` need.
  issues.push(
    ...collectContentTypeOptionsIssues(policy.contentTypeOptions),
    ...collectReferrerPolicyIssues(policy.referrerPolicy),
    ...collectPermissionsPolicyIssues(policy.permissionsPolicy),
    ...collectCOOPIssues(policy.crossOriginOpenerPolicy),
    ...collectCOOPReportOnlyIssues(policy.crossOriginOpenerPolicyReportOnly),
    ...collectCORPIssues(policy.crossOriginResourcePolicy),
    ...collectCOEPIssues(policy.crossOriginEmbedderPolicy),
    ...collectCOEPReportOnlyIssues(policy.crossOriginEmbedderPolicyReportOnly),
    ...collectReportingEndpointsIssues(policy.reportingEndpoints),
  );

  // Resolved the way the request path resolves it, so a policy that overrides
  // only one of the pair is judged on the combination it will actually serve.
  //
  // The cross-origin policies are part of that pair too, and leaving them out
  // is not a smaller check, it is a different verdict from the one the plugin
  // reaches. `resolveEffectiveConfig` passes `crossOriginReportGroups` to this
  // same collector, so a policy naming a group only through a `report-to`
  // parameter validated clean here and then threw per request, which is the one
  // outcome this module exists to prevent.
  const effectiveCrossOrigin: SecurityHeadersPolicyInput = {
    crossOriginOpenerPolicy: (policy.crossOriginOpenerPolicy ??
      options.baseline
        ?.crossOriginOpenerPolicy) as SecurityHeadersPolicyInput['crossOriginOpenerPolicy'],
    crossOriginOpenerPolicyReportOnly:
      (policy.crossOriginOpenerPolicyReportOnly ??
        options.baseline
          ?.crossOriginOpenerPolicyReportOnly) as SecurityHeadersPolicyInput['crossOriginOpenerPolicyReportOnly'],
    crossOriginEmbedderPolicy: (policy.crossOriginEmbedderPolicy ??
      options.baseline
        ?.crossOriginEmbedderPolicy) as SecurityHeadersPolicyInput['crossOriginEmbedderPolicy'],
    crossOriginEmbedderPolicyReportOnly:
      (policy.crossOriginEmbedderPolicyReportOnly ??
        options.baseline
          ?.crossOriginEmbedderPolicyReportOnly) as SecurityHeadersPolicyInput['crossOriginEmbedderPolicyReportOnly'],
  };

  issues.push(
    ...collectReportingIssues(
      withPresetExpanded(csp ?? options.baseline?.csp),
      (policy.reportingEndpoints ?? options.baseline?.reportingEndpoints) as
        false | ReportingEndpointsConfig | undefined,
      crossOriginReportGroups(effectiveCrossOrigin),
    ),
  );

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
