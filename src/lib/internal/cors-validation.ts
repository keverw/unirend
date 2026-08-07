/**
 * The rules a CORS block has to satisfy, expressed as collectors rather than
 * throws, plus the types and defaults the block is made of.
 *
 * Same arrangement as `security-headers-validation`, and for the same reason:
 * a server starting up wants to stop at the first problem, and anything
 * checking a policy a *person* is editing wants every problem at once, as data
 * rather than as an exception. Keeping both views on one copy of the rules is
 * what stops the two from drifting.
 *
 * The types live here rather than in the plugin so the collectors can be
 * written against them without the plugin and the validator importing each
 * other. The plugin re-exports them, so `CORSConfig` is still imported from
 * where it always was.
 *
 * One thing this does that the security-headers collectors do not: it returns
 * a normalized config alongside the issues. CORS validation and CORS
 * normalization read the same fields and answer the same questions, so
 * splitting them into two passes would mean deciding twice what
 * `origin: '*'` next to a credentials allowlist means, which is exactly the
 * kind of duplicated judgment this file exists to prevent.
 */

import type { FastifyRequest } from 'fastify';
import { validateConfigEntry } from 'lifecycleion/domain-utils';
import { describeValue, isPlainObject, mergeOverDefaults } from './csp-policy';
import type { SecurityHeadersPolicyIssue } from './security-headers-validation';

/**
 * CORS origin configuration - can be a string, array, or function
 */
export type CORSOrigin =
  | string
  | string[]
  | ((
      origin: string | undefined,
      request: FastifyRequest,
    ) => boolean | Promise<boolean>);

/**
 * Configuration for dynamic CORS handling.
 *
 * These options are negotiated per-origin. The non-negotiated headers that
 * apply to every response regardless of origin live on
 * `SecurityHeadersConfig` alongside this block.
 */
export interface CORSConfig {
  /**
   * Allowed origins for CORS requests
   * - false: send no CORS headers at all (default)
   * - string: Single origin (e.g., "https://example.com")
   * - string[]: Multiple origins with wildcard support
   * - function: Dynamic origin validation
   * - "*": Allow all origins (not recommended with credentials)
   *
   * **A wildcard has to be written.** This defaults to `false`, meaning no
   * `Access-Control-Allow-Origin` is sent and cross-origin reads are blocked by
   * the browser, exactly as they are on a server with no CORS support at all.
   * Same-origin requests are unaffected, since they never needed the header.
   *
   * That matches every other field here, where `false` means "send no header",
   * and it is the only default that can be right for a plugin people register
   * for `csp` or `hsts` without thinking about CORS. A `'*'` default meant
   * `securityHeaders({ frameOptions: 'DENY' })` echoed
   * `Access-Control-Allow-Origin` back to any site that asked, so every response
   * that plugin touched became cross-origin readable, including the ones behind
   * a bearer token, since a manually attached `Authorization` header needs no
   * credentials mode. Opening that up should take saying so.
   *
   * Wildcard patterns supported:
   * - "*.example.com": Direct subdomains only (api.example.com ✅, app.api.example.com ❌)
   * - "**.example.com": All subdomains including nested (api.example.com ✅, app.api.example.com ✅)
   * - "https://*": Any domain with HTTPS protocol
   * - "http://*": Any domain with HTTP protocol
   * - "https://*.example.com": HTTPS subdomains only
   * - "http://**.example.com": HTTP subdomains including nested
   *
   * Note: "null" origins (from sandboxed documents, file:// URLs) are treated as regular string values.
   * Include "null" in your origin array or handle it in your validation function if needed.
   *
   * @default false
   */
  origin?: CORSOrigin | false;

  /**
   * Origins that are allowed to send credentials (cookies, auth headers)
   * This enables more granular control than standard CORS libraries
   *
   * - string[]: List of trusted origins that can send credentials
   * - function: Dynamic credential validation based on origin
   * - true: Allow credentials for all allowed origins (same as @fastify/cors)
   * - false: Never allow credentials
   *
   * @default false
   */
  credentials?:
    | boolean
    | string[]
    | ((
        origin: string | undefined,
        request: FastifyRequest,
      ) => boolean | Promise<boolean>);

  /**
   * Allowed HTTP methods
   * @default ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
   */
  methods?: string[];

  /**
   * Allowed request headers
   * - string[]: List of specific headers (e.g., ["Content-Type", "Authorization"])
   * - ["*"]: Reflect exactly what the browser requests (useful for public APIs)
   * @default ["Content-Type", "Authorization", "X-Requested-With"]
   */
  allowedHeaders?: string[];

  /**
   * Headers exposed to the client
   * @default []
   */
  exposedHeaders?: string[];

  /**
   * Max age for preflight cache (in seconds)
   * @default 86400 (24 hours)
   */
  maxAge?: number;

  /**
   * Whether to pass control to next handler on preflight OPTIONS requests
   * @default false
   */
  preflightContinue?: boolean;

  /**
   * Status code for successful preflight responses
   * @default 204
   */
  optionsSuccessStatus?: number;

  /**
   * Whether to allow private network requests (Chrome feature)
   * When true, responds to Access-Control-Request-Private-Network with Access-Control-Allow-Private-Network
   * @default false
   */
  allowPrivateNetwork?: boolean;

  /**
   * Opt-in: allow wildcard subdomain patterns (e.g., "*.example.com") in `credentials` array
   * When true, patterns like "*.example.com", "**.example.com", "*.*.example.com" are permitted.
   * Apex domains are NOT matched by wildcard patterns; include the apex explicitly if needed.
   * Invalid patterns (bare "*", protocol wildcards like "https://*") are rejected.
   *
   * @default false
   */
  credentialsAllowWildcardSubdomains?: boolean;

  /**
   * Opt-in: allow credentials: true when origin includes a protocol wildcard (e.g., "https://*")
   * By default this is disallowed for safety because it enables credentials for any origin
   * on that protocol.
   *
   * @default false
   */
  allowCredentialsWithProtocolWildcard?: boolean;
}

/** A CORS block with every default filled in, which is what the plugin reads. */
export type ResolvedCORSConfig = Required<
  Omit<CORSConfig, 'credentials' | 'origin'>
> & {
  origin: CORSOrigin | false;
  credentials:
    | boolean
    | string[]
    | ((
        origin: string | undefined,
        request: FastifyRequest,
      ) => boolean | Promise<boolean>);
};

/**
 * Whether this block does any CORS at all.
 *
 * One question asked in one place, because "off" has to mean off everywhere or
 * it means nothing: no `Access-Control-Allow-Origin`, no `Vary: Origin`, and no
 * preflight handling, so the plugin leaves `OPTIONS` to the route table exactly
 * as it would if it were not registered.
 */
export function isCORSEnabled(cors: ResolvedCORSConfig): boolean {
  return cors.origin !== false;
}

/**
 * Default CORS configuration
 */
export const DEFAULT_CORS_CONFIG: Required<
  Omit<CORSConfig, 'credentials' | 'origin'>
> & {
  origin: CORSOrigin | false;
  credentials: boolean;
} = {
  // Off, like every other header this plugin owns. See `CORSConfig.origin`.
  origin: false,
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: [],
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  allowPrivateNetwork: false,
  credentialsAllowWildcardSubdomains: false,
  allowCredentialsWithProtocolWildcard: false,
};

/**
 * A problem with a CORS block.
 *
 * The shared issue shape plus one flag, which exists only so the plugin's
 * startup path can keep throwing the exact error classes it always threw. Two
 * of these rules are about a value being the wrong *kind* of thing, a function
 * where a concrete list belongs, and those have been `TypeError`s since before
 * the rules moved here. Recording it as a field is what lets the collector stay
 * class-free while the throwing view stays unchanged.
 */
export interface CORSPolicyIssue extends SecurityHeadersPolicyIssue {
  /** True when the throwing view should raise a `TypeError` rather than an `Error`. */
  typeError?: boolean;
}

export type CORSPolicyValidation =
  | {
      /** True when `issues` is empty. */
      valid: true;
      /** Empty, since the block is valid. */
      issues: CORSPolicyIssue[];
      /**
       * The block, now typed.
       *
       * The same object that was passed in, not the normalized form. What a
       * caller stores should be what they wrote, and normalization is the
       * plugin's business at registration: it fills in defaults and folds a
       * credentials allowlist into the origin list, neither of which anyone
       * wants written back into their saved configuration.
       *
       * `false` carries through as `false` for that same reason. It is a valid
       * block meaning "no CORS", and flattening it to `{}` would hand back
       * something that reads as "nothing configured yet" to an admin form
       * rebuilding its fields, losing the one thing the operator said.
       */
      policy: false | CORSConfig;
    }
  | {
      valid: false;
      /** Every problem found, not just the first. */
      issues: CORSPolicyIssue[];
      policy?: undefined;
    };

/**
 * Every field a CORS block may carry.
 *
 * Reported when something else turns up, for the reason a misspelling always
 * deserves an answer: `allowedHeader` saves without complaint, reads as though
 * it took effect, and changes nothing. `satisfies` ties this to the type, so a
 * field added to `CORSConfig` without being added here is a type error rather
 * than a validator that quietly rejects the new field.
 */
const CORS_KEYS = {
  origin: true,
  credentials: true,
  methods: true,
  allowedHeaders: true,
  exposedHeaders: true,
  maxAge: true,
  preflightContinue: true,
  optionsSuccessStatus: true,
  allowPrivateNetwork: true,
  credentialsAllowWildcardSubdomains: true,
  allowCredentialsWithProtocolWildcard: true,
} satisfies Record<keyof CORSConfig, true>;

/** The fields that are plain booleans, checked as a group. */
const BOOLEAN_KEYS = [
  'preflightContinue',
  'allowPrivateNetwork',
  'credentialsAllowWildcardSubdomains',
  'allowCredentialsWithProtocolWildcard',
] as const;

/** The fields that are lists of header or method names, checked as a group. */
const STRING_LIST_KEYS = [
  'methods',
  'allowedHeaders',
  'exposedHeaders',
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Whether the origin config carries a bare protocol wildcard.
 *
 * Functions are evaluated per request, so they are not a blanket wildcard here
 * whatever they may decide later.
 */
function hasProtocolWildcard(value: CORSOrigin | false): boolean {
  if (typeof value === 'string') {
    return value === 'https://*' || value === 'http://*';
  }

  if (Array.isArray(value)) {
    return value.some((v) => v === 'https://*' || v === 'http://*');
  }

  return false; // functions are evaluated per-request; not considered a blanket wildcard here
}

/**
 * Every problem with a credentials allowlist.
 *
 * The rules are stricter than the ones origin entries get, and deliberately so.
 * An origin on this list may send cookies and Authorization headers, so a
 * pattern matching more than the author pictured is a session handed to
 * whoever registered the domain that also matches.
 */
export function collectCredentialsOriginIssues(
  credentials: readonly string[],
  allowWildcard: boolean,
): CORSPolicyIssue[] {
  const issues: CORSPolicyIssue[] = [];

  for (const o of credentials) {
    // Never allow credentials for the special "null" origin
    if (o === 'null') {
      issues.push({
        path: 'credentials',
        message:
          "Invalid CORS config: credentials cannot be enabled for the 'null' origin. Remove 'null' from the credentials list.",
      });

      continue;
    }

    // Use validateConfigEntry to get comprehensive validation
    const verdict = validateConfigEntry(o, 'origin', {
      allowGlobalWildcard: false, // Never allow global wildcard in credentials
      allowProtocolWildcard: false, // Never allow protocol wildcards in credentials
    });

    if (!verdict.valid) {
      issues.push({
        path: 'credentials',
        message: `Invalid CORS credentials origin "${o}"${verdict.info ? ': ' + verdict.info : ''}`,
      });

      continue;
    }

    // Use wildcardKind from validateConfigEntry to determine policy
    if (verdict.wildcardKind === 'global') {
      issues.push({
        path: 'credentials',
        message: `Global wildcard "${o}" is not allowed in credentials. Use specific origins or subdomain patterns like "*.example.com".`,
      });

      continue;
    }

    if (verdict.wildcardKind === 'protocol') {
      issues.push({
        path: 'credentials',
        message: `Protocol wildcard "${o}" is not allowed in credentials. Use domain patterns like "*.example.com" or "**.example.com".`,
      });

      continue;
    }

    if (verdict.wildcardKind === 'subdomain' && !allowWildcard) {
      issues.push({
        path: 'credentials',
        message: `Wildcard pattern "${o}" in credentials requires credentialsAllowWildcardSubdomains: true or use explicit origins.`,
      });
    }
  }

  return issues;
}

/**
 * Every problem with the shape of a CORS block, before any rule reads a field.
 *
 * Split out because the rules below it are about what a *combination* of values
 * means, and asking what `origin: 42` means next to a credentials list is a
 * question with no useful answer. Anything this reports stops the relational
 * checks on the field it names, so a caller gets one complaint per mistake.
 */
function collectShapeIssues(cors: CORSConfig): CORSPolicyIssue[] {
  const issues: CORSPolicyIssue[] = [];

  for (const key of Object.keys(cors)) {
    if (!Object.hasOwn(CORS_KEYS, key)) {
      issues.push({
        path: key,
        message: `Invalid CORS config: ${key} is not a CORS option. Expected ${Object.keys(CORS_KEYS).join(', ')}.`,
      });
    }
  }

  const origin: unknown = cors.origin;

  if (
    origin !== undefined &&
    origin !== false &&
    typeof origin !== 'string' &&
    typeof origin !== 'function' &&
    !isStringArray(origin)
  ) {
    issues.push({
      path: 'origin',
      message: `Invalid CORS config: origin must be a string, an array of strings, a function, or false to send no CORS headers, received ${describeValue(origin)}`,
    });
  }

  const credentials: unknown = cors.credentials;

  const isCredentialsShapeValid =
    credentials === undefined ||
    typeof credentials === 'boolean' ||
    typeof credentials === 'function' ||
    isStringArray(credentials);

  if (!isCredentialsShapeValid) {
    issues.push({
      path: 'credentials',
      message: `Invalid CORS config: credentials must be a boolean, an array of origins, or a function, received ${describeValue(credentials)}`,
    });
  } else if (
    (origin === false || origin === undefined) &&
    credentials !== undefined &&
    credentials !== false
  ) {
    // Credentials without an origin is a block that reads as though it allows
    // something and allows nothing. With CORS off no
    // `Access-Control-Allow-Origin` is sent, so no browser will ever attach
    // credentials whatever this says, and the folding below that would normally
    // pull a credentials allowlist into the origin list has nothing to fold
    // into.
    //
    // Reported rather than quietly ignored, because this is the one inert
    // combination whose plain reading is a security decision: someone wrote
    // down a list of origins they trust with cookies, and nothing is trusting
    // them with anything.
    //
    // Only once the value is a credentials value at all, hence the `else`. A
    // `credentials: 'yes'` is one mistake, and saying both "that is not a
    // credentials value" and "it does nothing without an origin" describes it
    // twice, which reads as two problems and is the noise every other rule in
    // this file is arranged to avoid.
    issues.push({
      path: 'credentials',
      message:
        'Invalid CORS config: credentials is set but origin is not, so no CORS headers are sent and no browser will ever attach credentials. Set cors.origin to the origins you mean to allow.',
    });
  }

  for (const key of STRING_LIST_KEYS) {
    const value: unknown = cors[key];

    if (value !== undefined && !isStringArray(value)) {
      issues.push({
        path: key,
        message: `Invalid CORS config: ${key} must be an array of strings, received ${describeValue(value)}`,
      });
    }
  }

  for (const key of BOOLEAN_KEYS) {
    const value: unknown = cors[key];

    if (value !== undefined && typeof value !== 'boolean') {
      issues.push({
        path: key,
        message: `Invalid CORS config: ${key} must be a boolean, received ${describeValue(value)}`,
      });
    }
  }

  const maxAge: unknown = cors.maxAge;

  if (
    maxAge !== undefined &&
    (typeof maxAge !== 'number' || !Number.isFinite(maxAge) || maxAge < 0)
  ) {
    issues.push({
      path: 'maxAge',
      message:
        'Invalid CORS config: maxAge must be a non-negative number (seconds)',
    });
  }

  const status: unknown = cors.optionsSuccessStatus;

  // Bounded rather than merely numeric because the value is written straight to
  // the preflight response, and a status outside the range is either a thrown
  // error deep in the HTTP layer or a response no browser will accept as a
  // successful preflight.
  if (
    status !== undefined &&
    (typeof status !== 'number' ||
      !Number.isInteger(status) ||
      status < 200 ||
      status > 599)
  ) {
    issues.push({
      path: 'optionsSuccessStatus',
      message: `Invalid CORS config: optionsSuccessStatus must be an integer HTTP status between 200 and 599, received ${describeValue(status)}`,
    });
  }

  return issues;
}

/**
 * Every problem with a CORS block, plus the block the plugin should actually
 * use.
 *
 * The normalized config is only meaningful when `issues` is empty. It carries
 * the defaults filled in and two rewrites the plugin has always done: `['*']`
 * collapses to `'*'`, and a credentials allowlist is folded into the origin
 * list so an origin trusted with cookies is never left out of the list that
 * decides whether it is allowed at all. That second one is the fix for the
 * mistake this configuration invites most often.
 *
 * @param input The CORS block, from a config object or from a stored policy
 */
export function collectCORSIssues(input: unknown): {
  issues: CORSPolicyIssue[];
  normalized: ResolvedCORSConfig;
} {
  // `false` is the explicit spelling of the default, so it needs no rules of its
  // own: the defaults it falls through to already say "no CORS". It reads the
  // way `hsts: false` and `csp: false` read, which is the point of accepting it.
  if (input !== undefined && input !== false && !isPlainObject(input)) {
    return {
      issues: [
        {
          path: '',
          message: `Invalid CORS config: expected an object of CORS options, or false to send no CORS headers, received ${describeValue(input)}`,
        },
      ],
      normalized: { ...DEFAULT_CORS_CONFIG },
    };
  }

  // The rules below, in summary:
  // - Origin '*' special handling:
  //   - Disallow credentials: true (spec prohibits ACA-C: true with ACA-O: *)
  //   - Disallow dynamic credentials function (avoid reflect+credentials footgun)
  //   - If credentials is a string[] allowlist, validate and upgrade origin to that list
  // - Origin arrays are validated using validateConfigEntry (domain-utils) plus policy:
  //   - Allow at most one wildcard token ('*' or a protocol wildcard)
  //   - If a wildcard token is present, the only other allowed entry is 'null' string literal
  // Credentials policy highlights:
  //   - Never allow credentials for the literal 'null' origin
  //   - Disallow global/protocol wildcards in credentials allowlists
  //   - Allow subdomain wildcards in credentials only when credentialsAllowWildcardSubdomains: true
  // Merged rather than spread, so a field written as `undefined` inherits its
  // default instead of deleting it. A key that is not a default still comes
  // through undefined and all, which is what keeps `collectShapeIssues` able to
  // name a misspelling whose value happened to be undefined.
  const cors: ResolvedCORSConfig = mergeOverDefaults(
    DEFAULT_CORS_CONFIG,
    input,
  );

  const issues = collectShapeIssues(cors);

  // The rules below all read origin or credentials, so a bad one of either
  // leaves nothing worth asking. Returning here is what keeps a single mistake
  // from being reported once as itself and again as each of its consequences.
  if (issues.some((i) => i.path === 'origin' || i.path === 'credentials')) {
    return { issues, normalized: cors };
  }

  if (cors.origin === '*' && cors.credentials === true) {
    issues.push({
      path: 'credentials',
      message:
        "Cannot use credentials: true with origin: '*'. The CORS specification prohibits Access-Control-Allow-Credentials: true with Access-Control-Allow-Origin: *. Use specific origins instead.",
    });
  }

  // Guard: credentials: true with protocol wildcard (e.g., https://*) is high risk.
  // Require explicit opt-in via allowCredentialsWithProtocolWildcard: true
  if (
    cors.credentials === true &&
    hasProtocolWildcard(cors.origin) &&
    !cors.allowCredentialsWithProtocolWildcard
  ) {
    issues.push({
      path: 'credentials',
      message:
        'Cannot use credentials: true with protocol wildcard origins unless allowCredentialsWithProtocolWildcard: true. Use specific origins instead.',
    });
  }

  // Checked once even though two paths below want the answer, so an allowlist
  // that is bad in two ways is still reported once per way rather than twice.
  let hasCheckedCredentials = false;

  const checkCredentialsList = (list: string[]) => {
    if (hasCheckedCredentials) {
      return;
    }

    hasCheckedCredentials = true;
    issues.push(
      ...collectCredentialsOriginIssues(
        list,
        cors.credentialsAllowWildcardSubdomains,
      ),
    );
  };

  // Additional guard: prevent reflect+credentials when origin is '*'
  if (cors.origin === '*') {
    // Dynamic function with '*' would enable reflecting arbitrary origins with credentials
    if (typeof cors.credentials === 'function') {
      issues.push({
        path: 'credentials',
        typeError: true,
        message:
          "Unsafe CORS: cannot combine origin '*' with dynamic credentials. Use a concrete origin list when enabling credentials.",
      });
    }

    // If credentials is an allowlist, validate and upgrade origin to that list
    if (Array.isArray(cors.credentials)) {
      checkCredentialsList(cors.credentials);

      const allowlist = Array.from(new Set(cors.credentials));

      if (allowlist.length === 0) {
        issues.push({
          path: 'credentials',
          message:
            "Invalid CORS config: credentials list is empty; cannot combine origin '*' with credentials.",
        });
      } else {
        // Upgrade: stop using '*' and switch to a concrete allowlist for origin
        cors.origin = allowlist;
        // Keep origin and credentials aligned to reduce misconfiguration
        cors.credentials = allowlist;
      }
    }
  }

  // Validate credentials wildcard patterns
  if (Array.isArray(cors.credentials)) {
    checkCredentialsList(cors.credentials);
  }

  // Validate origin entries using centralized validator with appropriate wildcard policies
  if (typeof cors.origin === 'string') {
    if (cors.origin !== '*') {
      const verdict = validateConfigEntry(cors.origin, 'origin', {
        allowGlobalWildcard: false, // Global wildcard handled separately above
        allowProtocolWildcard: true, // Allow protocol wildcards in origin
      });

      if (!verdict.valid) {
        issues.push({
          path: 'origin',
          message: `Invalid CORS origin "${cors.origin}"${verdict.info ? ': ' + verdict.info : ''}`,
        });
      }
    }
  } else if (Array.isArray(cors.origin)) {
    const entries = cors.origin;
    // Normalize ["*"] to "*"
    const unique = Array.from(new Set(entries));

    if (unique.length === 1 && unique[0] === '*') {
      cors.origin = '*';
    } else {
      // Special policy: '*' inside an array is only allowed when paired solely with 'null'
      if (entries.includes('*')) {
        const isOnlyStarAndNull = entries.every(
          (e) => e === '*' || e === 'null',
        );

        if (!isOnlyStarAndNull) {
          issues.push({
            path: 'origin',
            message:
              "Invalid CORS config: Do not include '*' inside an origin array. Use origin: '*' (string) to allow all, or list specific origins.",
          });
        }
      }

      let wildcardKindSeen: 'none' | 'global' | 'protocol' = 'none';
      const wildcardTokensSeen: string[] = [];
      // One complaint per kind of mistake in the list. Without this, a list
      // with three stray entries after a wildcard says the same sentence three
      // times, which reads as three problems.
      let hasReportedWildcardPairing = false;
      let hasReportedMultipleWildcards = false;

      for (const o of entries) {
        // Use centralized validator to classify
        const verdict = validateConfigEntry(o, 'origin', {
          allowGlobalWildcard: true,
          allowProtocolWildcard: true,
        });

        if (!verdict.valid) {
          issues.push({
            path: 'origin',
            message: `Invalid CORS origin "${o}"${verdict.info ? ': ' + verdict.info : ''}`,
          });

          continue;
        }

        if (
          verdict.wildcardKind === 'global' ||
          verdict.wildcardKind === 'protocol'
        ) {
          const token = verdict.wildcardKind === 'global' ? '*' : o;

          if (wildcardTokensSeen.length > 0) {
            if (!hasReportedMultipleWildcards) {
              hasReportedMultipleWildcards = true;

              if (wildcardTokensSeen.includes(token)) {
                // Duplicate of the same wildcard token
                issues.push({
                  path: 'origin',
                  message:
                    "Invalid CORS config: only one of '*', 'https://*', or 'http://*' may be specified in origin.",
                });
              } else {
                // Multiple distinct wildcard tokens – include exact list in error
                const foundList = wildcardTokensSeen.concat(token).join(', ');

                issues.push({
                  path: 'origin',
                  message: `Invalid CORS config: only one of '*', 'https://*', or 'http://*' may be specified in origin. Found: ${foundList}`,
                });
              }
            }

            continue;
          }

          wildcardTokensSeen.push(token);
          wildcardKindSeen = verdict.wildcardKind;
          continue;
        }

        if (o === 'null') {
          continue;
        }

        // Non-wildcard, non-null entries
        if (wildcardKindSeen !== 'none' && !hasReportedWildcardPairing) {
          hasReportedWildcardPairing = true;

          issues.push({
            path: 'origin',
            message:
              "Invalid CORS config: when a wildcard token is present, the only other allowed entry is the literal 'null'.",
          });
        }
      }

      // Additional safety: if a global '*' token is present inside the origin array,
      // disallow credentials: true and dynamic credentials function to avoid
      // reflecting arbitrary origins with credentials.
      if (entries.includes('*')) {
        if (cors.credentials === true) {
          issues.push({
            path: 'credentials',
            message:
              "Cannot use credentials: true when origin array contains '*'. Use specific origins instead or remove credentials: true.",
          });
        }

        if (typeof cors.credentials === 'function') {
          issues.push({
            path: 'credentials',
            typeError: true,
            message:
              "Unsafe CORS: cannot combine an origin array containing '*' with dynamic credentials. Use a concrete origin list when enabling credentials.",
          });
        }
      }
    }
  }

  // Auto-merge credentials origins into origin list for safety
  // This prevents common configuration mistakes where credentials origins aren't included in the origin list
  // Note: credentials controls Access-Control-Allow-Credentials header, which tells browsers
  // whether to include cookies/auth headers in requests - it doesn't automatically allow cookies
  if (Array.isArray(cors.credentials) && Array.isArray(cors.origin)) {
    // Merge credentials origins into origin list to ensure they're allowed for CORS
    cors.origin = [...new Set([...cors.origin, ...cors.credentials])];
  } else if (
    Array.isArray(cors.credentials) &&
    typeof cors.origin === 'string' &&
    cors.origin !== '*'
  ) {
    // Convert single origin to array and merge with credentials origins
    cors.origin = [...new Set([cors.origin, ...cors.credentials])];
  }

  return { issues, normalized: cors };
}

/**
 * Validate a CORS block and report everything wrong with it.
 *
 * Applies exactly the rules `securityHeaders` applies to its `cors` option,
 * because it is the same code, so a block this accepts is one the plugin will
 * accept. The companion to `validateSecurityHeadersPolicy`, for the half of the
 * configuration that policy does not cover.
 *
 * Takes `unknown`, because the input worth validating is one nobody has vouched
 * for: an admin form, a config file, a row in a table. A string, an array, or
 * `{ origin: 42 }` comes back as an issue rather than as a thrown `TypeError`.
 * On the way out, `result.policy` is the same object with a type on it.
 *
 * ```typescript
 * import { validateCORSPolicy } from 'unirend/server';
 *
 * const result = validateCORSPolicy(request.body);
 *
 * if (!result.valid) {
 *   return reply.status(422).send({ errors: result.issues });
 * }
 * ```
 *
 * Worth knowing: unlike the security-headers policy, CORS is not something a
 * `resolve` callback can replace per request, so a block validated here is one
 * to feed back into `securityHeaders({ cors })` at startup rather than to store
 * per tenant. `cors.origin` and `cors.credentials` already take request-aware
 * functions, which is how CORS varies per request. And as with the policy
 * validator, this says only whether a block is valid, not whether it is a good
 * idea: `origin: '*'` is perfectly valid.
 *
 * `issues` reports paths relative to the block itself, such as `origin` or
 * `credentials`, so a form editing a CORS block can point at the field.
 *
 * @param cors The CORS block to check, in the shape `securityHeaders` takes
 */
export function validateCORSPolicy(cors: unknown): CORSPolicyValidation {
  const { issues } = collectCORSIssues(cors);

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    issues,
    // `?? {}` rather than a cast: an absent block is a valid one, and every
    // field is optional, so an empty object is the honest typed form of it.
    // `??` is nullish-only, so an explicit `false` passes through as itself
    // rather than being flattened into that empty object, which is what the
    // return type now says and what a caller storing the result needs.
    policy: (cors ?? {}) as false | CORSConfig,
  };
}
