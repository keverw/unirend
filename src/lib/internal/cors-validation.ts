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
 * A field name, which RFC 9110 defines as a `token`.
 *
 * Lives here rather than in the plugin because both ends of the preflight need
 * it and they must agree: this file judges the names an operator configured,
 * and `reflectRequestedHeaders` judges the names a client asked for. Two copies
 * would drift, and the direction matters, since the whole point is that a name
 * reaching `Access-Control-Allow-Headers` is one a browser can parse.
 *
 * Worth knowing that `*` satisfies this pattern: the token grammar includes it,
 * so it is a syntactically valid header name and cannot be told apart from one
 * by a shape test. Everywhere it means "the wildcard" it is matched literally,
 * before this is consulted.
 */
export const HEADER_NAME_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * What each list field holds and where its entries end up.
 *
 * All three are written into their response header verbatim, joined with
 * commas, with no filtering anywhere downstream. That is correct, since these
 * are the operator's own configuration rather than anything off the wire, and
 * it is exactly why the grammar has to be checked here: nothing later will
 * notice a name a browser cannot read.
 *
 * Method names and field names are the same production, so one check covers
 * all three. The noun differs only so the message names the thing the author
 * thought they were writing.
 */
const TOKEN_LIST_FIELDS = {
  methods: {
    noun: 'method name',
    header: 'Access-Control-Allow-Methods',
    caseNote: 'The method list is upper-cased before it is sent',
  },
  allowedHeaders: {
    noun: 'header name',
    header: 'Access-Control-Allow-Headers',
    caseNote: 'Field names are case-insensitive',
  },
  exposedHeaders: {
    noun: 'header name',
    header: 'Access-Control-Expose-Headers',
    caseNote: 'Field names are case-insensitive',
  },
} as const;

/**
 * Every entry in a list field that is not a token.
 *
 * The failure this catches is entirely silent without it. RFC 9110 gives one
 * grammar for both method names and field names, and a browser that cannot
 * parse a header value drops the whole value rather than the offending entry,
 * so a single `"Content Type"` or `"GET POST"` takes every other name in the
 * list down with it. The request then fails cross-origin under a configuration
 * that reads as though it permits exactly what was asked for.
 *
 * `*` is deliberately not special-cased away here, because it does not need to
 * be: it is a legal token character, so it satisfies the grammar on its own
 * terms. Whether a wildcard *means* anything in a given field is a separate
 * question this does not answer, and the answer differs per field. In
 * `Access-Control-Allow-Methods` and `Access-Control-Expose-Headers` a browser
 * reads it as a wildcard for a non-credentialed request and as a literal name
 * for a credentialed one, which is the Fetch specification's rule rather than
 * anything unirend decides.
 */
function collectTokenListIssues(
  key: keyof typeof TOKEN_LIST_FIELDS,
  values: readonly string[],
): CORSPolicyIssue[] {
  const { noun, header, caseNote } = TOKEN_LIST_FIELDS[key];
  const issues: CORSPolicyIssue[] = [];

  // First spelling of each name, keyed case-insensitively. Both kinds of name
  // here compare that way by the time they reach a browser: field names are
  // case-insensitive outright, and the method list is upper-cased before it is
  // sent, so `get` and `GET` are one entry either way.
  const seen = new Map<string, string>();
  const reportedDuplicates = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();

    // Padding around an otherwise fine name gets its own message, because the
    // general one below would be a lie about it. A list element may carry
    // optional whitespace in HTTP, so `Content-Type , X-Ok` is a header every
    // browser reads exactly as intended: nothing is dropped and nothing fails.
    //
    // It is refused anyway, and deliberately not trimmed, which is the same
    // call `validateSource` makes for a CSP source expression. Trimming would
    // silently rewrite what the operator wrote, so the config and the header no
    // longer say the same thing and the next reader has to know this happened
    // to predict what ships. Refusing costs one clear message at boot, and the
    // realistic way to arrive here, splitting an environment variable on commas
    // without trimming, is worth being told about rather than absorbed.
    //
    // Only when the trimmed value is otherwise valid. `" bad name "` has a real
    // problem that survives trimming, and reporting the padding would point at
    // the wrong half of it.
    if (value !== trimmed && HEADER_NAME_TOKEN.test(trimmed)) {
      issues.push({
        path: key,
        message: `Invalid CORS config: ${key} entry "${value}" has leading or trailing whitespace. Write it as "${trimmed}". The list is written into ${header} as given rather than tidied up, so a padded entry is refused here instead of being quietly rewritten into something the configuration does not say.`,
      });

      continue;
    }

    if (!HEADER_NAME_TOKEN.test(value)) {
      issues.push({
        path: key,
        message: `Invalid CORS config: ${key} entry "${value}" is not a valid ${noun}. The configured list goes into ${header} verbatim, and a browser drops a value it cannot parse, so a single bad entry takes the whole header with it and every request relying on it fails, under a policy that reads as though it permits exactly what was asked for. A ${noun} is an RFC 9110 token: letters, digits, and any of !#$%&'*+.^_\`|~- with no spaces.`,
      });

      continue;
    }

    // A repeat, checked only on entries the grammar already accepted, so a
    // name that is wrong twice is reported as wrong rather than as wrong and
    // then repeated.
    //
    // Reported rather than collapsed, which is the same call the rest of this
    // module makes about anything that reads as a rule and is not one. A second
    // copy of a name adds nothing to the header, so it is not a policy someone
    // meant: it is a list assembled from two places, or a wildcard written
    // twice, and being told beats having it quietly absorbed. It costs one
    // message at boot and the fix is to delete a word.
    const fold = value.toLowerCase();
    const first = seen.get(fold);

    if (first !== undefined) {
      // Once per repeated name, however many times it repeats.
      if (!reportedDuplicates.has(fold)) {
        reportedDuplicates.add(fold);

        issues.push({
          path: key,
          message: `Invalid CORS config: ${key} lists "${value}" more than once${first === value ? '' : ` (as "${first}" and "${value}")`}. ${caseNote}, so these are one entry however they are spelled, and the repeat adds nothing to ${header}. Remove it.`,
        });
      }

      continue;
    }

    seen.set(fold, value);
  }

  return issues;
}

/**
 * Every problem with an `allowedHeaders` list, on top of the grammar.
 *
 * The one rule here that is `allowedHeaders`-specific, because the wildcard
 * behaves differently in this field than in the other two: unirend reads it
 * itself, before the header is built, as "reflect whatever this request asked
 * for". That makes mixing it with named headers a contradiction rather than
 * merely redundant.
 *
 * An empty list is deliberately allowed and is not checked here. It sends no
 * header at all, which leaves a browser permitting the CORS-safelisted request
 * headers and nothing else, and that is a real policy someone may want. It is
 * not the same shape as `origin: []`, which is rejected: that one switches CORS
 * on and then refuses every origin, so it can only ever be a mistake, and
 * `cors: false` is there to say it on purpose. There is no second spelling of
 * "safelisted headers only", so refusing this one would remove the only way to
 * ask for it.
 */
function collectAllowedHeadersIssues(
  allowedHeaders: readonly string[],
): CORSPolicyIssue[] {
  const named = allowedHeaders.filter((header) => header !== '*');

  // `*` short circuits the whole decision, so the named entries are consulted
  // only for a preflight that asked for no headers at all, which is the one
  // request whose answer cannot matter. Everywhere it counts they do nothing,
  // while reading as the allowlist someone believed they were writing.
  //
  // Keyed on whether any *named* header is present rather than on the list's
  // length, which is not the same question when the wildcard is written twice.
  // `['*', '*']` is one policy spelled redundantly, and it used to reach the
  // message below with an empty list of offenders: a startup failure naming no
  // header and advising exactly what the author already wrote.
  if (!allowedHeaders.includes('*') || named.length === 0) {
    return [];
  }

  return [
    {
      path: 'allowedHeaders',
      message: `Invalid CORS config: allowedHeaders combines "*" with named headers (${named.join(', ')}). "*" already reflects whatever a request asks for, so the named entries are consulted only for a preflight that requested no headers at all, and do nothing on every request where the answer matters. Use allowedHeaders: ["*"] to reflect what is requested, or list the headers you mean to permit without the "*".`,
    },
  ];
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
  }

  // An origin list that lists nothing.
  //
  // Every entry a browser could send is checked against this and none of them
  // match, so it is CORS switched on and refusing everyone, which is what `off`
  // already does without the `Vary: Origin` and the preflight handling. Nobody
  // writes that on purpose: it is what `origin: allowedOrigins` looks like when
  // the environment variable behind it came back empty, and the symptom is
  // every cross-origin request failing with a policy that reads as an allowlist.
  if (Array.isArray(cors.origin) && cors.origin.length === 0) {
    issues.push({
      path: 'origin',
      message:
        'Invalid CORS config: origin is an empty list, which allows no origin at all. Use cors: false, or cors.origin: false, to send no CORS headers, or list the origins you mean to allow.',
    });
  }

  for (const key of STRING_LIST_KEYS) {
    const value: unknown = cors[key];

    if (value !== undefined && !isStringArray(value)) {
      issues.push({
        path: key,
        message: `Invalid CORS config: ${key} must be an array of strings, received ${describeValue(value)}`,
      });

      // Nothing below can read the entries of something that is not a list of
      // strings, so move on rather than describing one mistake twice. Same rule
      // the relational checks further down follow.
      continue;
    }

    if (value !== undefined) {
      issues.push(...collectTokenListIssues(key, value));
    }
  }

  if (isStringArray(cors.allowedHeaders)) {
    issues.push(...collectAllowedHeadersIssues(cors.allowedHeaders));
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

  // Whole seconds, not merely a non-negative number. `Access-Control-Max-Age`
  // carries `delta-seconds`, which RFC 9111 defines as `1*DIGIT`, so `1.5` is
  // not a small value, it is a value a browser cannot parse: it drops the
  // header and falls back to its own preflight cache default, a few seconds in
  // every current browser. Preflight requests then fire orders of magnitude more often
  // than the configuration says, with nothing anywhere reporting it, which is
  // the silence every rule in this file exists to break.
  //
  // Refused rather than rounded, for the reason a padded header name is
  // refused rather than trimmed: rounding decides on the operator's behalf what
  // `3600.5` meant, and the configuration stops predicting the header. The fix
  // is theirs to write, and it is usually a `Math.round` around whatever
  // arithmetic produced it.
  if (
    maxAge !== undefined &&
    (typeof maxAge !== 'number' || !Number.isInteger(maxAge) || maxAge < 0)
  ) {
    issues.push({
      path: 'maxAge',
      message: `Invalid CORS config: maxAge must be a whole, non-negative number of seconds, received ${describeValue(maxAge)}. Access-Control-Max-Age takes delta-seconds, a run of digits, so a fraction is a header value a browser cannot parse: it drops the header and falls back to its own preflight cache default of a few seconds, and preflight requests start firing far more often than this configuration says.`,
    });
  }

  const status: unknown = cors.optionsSuccessStatus;

  // A 2xx, not merely a legal status. The value is written straight onto the
  // preflight response, and this field names the status of a *successful*
  // preflight, so anything else is a contradiction rather than a customization.
  //
  // The range used to run to 599, which let a 4xx or 5xx through. That does not
  // give a preflight an interesting status: a browser treats any non-2xx
  // preflight as a failed one, so it stops every cross-origin request that
  // needs a preflight, on a configuration that reads as though CORS is set up
  // and merely tuned. A 3xx is no better, since a preflight is not followed
  // through a redirect.
  if (
    status !== undefined &&
    (typeof status !== 'number' ||
      !Number.isInteger(status) ||
      status < 200 ||
      status > 299)
  ) {
    issues.push({
      path: 'optionsSuccessStatus',
      message: `Invalid CORS config: optionsSuccessStatus must be a 2xx status, received ${describeValue(status)}. It is the status of a successful preflight, and a browser reads any non-2xx preflight as a failed one, so a value outside this range does not customize the response, it stops every cross-origin request that needs a preflight. 204 is the default and the usual choice.`,
    });
  }

  return issues;
}

/**
 * The fields that do nothing because CORS is off.
 *
 * A block carrying `methods` or `credentials` with no `origin` reads as a
 * configured CORS policy and is not one: nothing is allowed, so no
 * `Access-Control-Allow-Origin` is sent, no preflight is answered, and every
 * other field is describing a negotiation that never happens.
 *
 * Reported rather than ignored, which is the same call this module makes for a
 * `csp.reportTo` naming a group nothing defines, and made for the same reason.
 * The distinction drawn everywhere here is whether the contradiction is
 * provable from the config alone: a missing `Reporting-Endpoints` header might
 * be arriving from a proxy, so that warns, while a group the configured
 * endpoints demonstrably do not define throws. Nothing outside this block can
 * supply an `origin`, so this is the provable kind.
 *
 * Every field rather than only `credentials`, which is where this started.
 * Singling out the security-relevant one left `methods` and `maxAge` silently
 * inert beside it under a rule that could not be stated in a sentence. One rule
 * is easier to trust than a list of exceptions, and the fix is identical in
 * every case: name an origin, or say `cors: false` and mean it.
 *
 * Read from the block as written rather than from the merged config, which by
 * this point holds every key with a default filled in and so could not tell a
 * field the caller set from one it inherited.
 */
/**
 * Whether this value is the one the field would have had anyway.
 *
 * Compared structurally rather than by reference, since a caller writing out
 * `methods: ['GET', 'POST', ...]` by hand has set nothing, however many array
 * literals are involved. A function never matches, which is correct: a
 * `credentials` callback is a decision procedure, and one that can never be
 * consulted is exactly what this is looking for.
 */
function isDefaultCORSValue(key: string, value: unknown): boolean {
  if (!Object.hasOwn(DEFAULT_CORS_CONFIG, key)) {
    return false;
  }

  const fallback = (DEFAULT_CORS_CONFIG as Record<string, unknown>)[key];

  return (
    value === fallback || JSON.stringify(value) === JSON.stringify(fallback)
  );
}

function collectInertFieldIssues(input: unknown): CORSPolicyIssue[] {
  if (!isPlainObject(input)) {
    return [];
  }

  const origin: unknown = input.origin;

  if (origin !== undefined && origin !== false) {
    return [];
  }

  // A field is only "set" if it says something the default did not.
  //
  // Undefined is skipped for the same reason it inherits rather than deletes: a
  // key written as undefined is a key that was not set. A field written at its
  // own default is skipped for a different reason, and it is the one that keeps
  // this rule honest rather than merely strict. `credentials: false` next to no
  // origin is not a contradiction, it is someone saying "definitely no
  // credentials" about a block that is already sending none, which agrees with
  // CORS being off instead of claiming something it cannot deliver. Refusing
  // that would be refusing a config for being explicit.
  const configured = Object.keys(input).filter(
    (key) =>
      key !== 'origin' &&
      input[key] !== undefined &&
      !isDefaultCORSValue(key, input[key]),
  );

  if (configured.length === 0) {
    return [];
  }

  const isPlural = configured.length > 1;

  return [
    {
      // Pointed at `credentials` when it is one of them, since that is the
      // field a reader most needs taken to.
      path: configured.includes('credentials') ? 'credentials' : configured[0],
      message: `Invalid CORS config: ${configured.map((key) => `cors.${key}`).join(', ')} ${isPlural ? 'are' : 'is'} set but cors.origin is not, so no CORS headers are sent and ${isPlural ? 'they do' : 'it does'} nothing.${configured.includes('credentials') ? ' No browser attaches credentials to a request it was never told it could make.' : ''} Set cors.origin to the origins you mean to allow, or cors: false if you meant to send none.`,
    },
  ];
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

  // Only once the shapes are right, for the same reason the relational rules
  // below stop on a bad origin. A field that is the wrong type, or misspelled,
  // is one mistake, and adding "and it does nothing without an origin" on top
  // describes that same mistake a second way. Fix the shape and this speaks up
  // on the next run.
  //
  // Reads the block as written, which the merged config above can no longer do:
  // every key is present there whether the caller set it or not.
  if (issues.length === 0) {
    issues.push(...collectInertFieldIssues(input));
  }

  // The rules below all read origin or credentials, so a bad one of either
  // leaves nothing worth asking. Returning here is what keeps a single mistake
  // from being reported once as itself and again as each of its consequences.
  if (issues.some((i) => i.path === 'origin' || i.path === 'credentials')) {
    return { issues, normalized: cors };
  }

  // One spelling before any rule reads it.
  //
  // `['*']` and `'*'` are the same policy, and every rule below tests the
  // string, so collapsing afterwards meant the array spelling walked past all
  // of them. That was not cosmetic: `origin: ['*']` with `credentials: true`
  // reached the response builder and sent `Access-Control-Allow-Origin:
  // <the caller's origin>` together with `Access-Control-Allow-Credentials:
  // true`, which is the combination the CORS specification forbids and the one
  // the `'*'` spelling has always refused at startup. Any site could read an
  // authenticated response with the user's cookies attached.
  //
  // The array branch further down used to do this collapse, and its guard for a
  // `'*'` sitting *inside* a longer list lives in the branch a one-element array
  // never reached, so nothing anywhere covered exactly `['*']`.
  if (
    Array.isArray(cors.origin) &&
    cors.origin.length === 1 &&
    cors.origin[0] === '*'
  ) {
    cors.origin = '*';
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
  }

  // A credentials allowlist alongside `origin: '*'` is left alone, which is the
  // whole point of the two being separate lists rather than one.
  //
  // It used to replace the origin with the credentials list, on the reasoning
  // that `'*'` and credentials do not belong together. They do not, and nothing
  // here sends them together: `Access-Control-Allow-Credentials` is only ever
  // written for an origin on this list, and the literal `*` only goes out on a
  // request that carried no `Origin` at all, which never carries the
  // credentials header. The guarantee comes from the response builder, not from
  // rewriting the config.
  //
  // What the rewrite did cost was the shape the two lists exist for: an API
  // readable by anyone, with cookies for your own domains only. Replacing the
  // origin with the credentials list turned that into an API readable by
  // nobody else, silently, on a config whose plain reading says otherwise. The
  // `['*']` spelling skipped the rewrite and behaved as documented, so the two
  // spellings disagreed about what the same policy meant.
  //
  // The dangerous pairings are still refused above, and they are the ones where
  // the set of credentialed origins is unbounded: `credentials: true`, and a
  // credentials function, both of which would hand `'*'` to something that
  // answers for every origin.

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
    // `['*']` was collapsed to `'*'` before any rule ran, so anything still an
    // array here has more than a bare wildcard in it. The collapse used to live
    // at this point, which is what let a one-element array skip every rule above
    // including the credentials guards. See the note beside it.
    {
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
  //
  // Skipped when the origin already carries a wildcard token, since every
  // credentialed origin is allowed by it already. Appending anyway produced a
  // normalized `['*', 'null', 'https://app.example']`, which allows exactly what
  // `['*', 'null']` allowed while reading as though the third entry were doing
  // something, and which the origin rules just above would have refused outright
  // had anyone written it by hand: a wildcard token may only be paired with
  // 'null'.
  //
  // Asked of the value however it is spelled, because a wildcard means the same
  // thing as a bare string as it does alone in an array. Checking only the array
  // left `origin: 'https://*'` merging into `['https://*', 'https://app.example']`
  // while `origin: ['https://*']` stayed put, two spellings of one policy
  // normalizing differently, which is the disagreement the `'*'` collapse further
  // up exists to end.
  //
  // Only the tokens that cover everything. A subdomain pattern such as
  // `*.example.com` matches some hosts and not others, so a credentialed origin
  // beside one still needs merging in, which is the mistake this exists to fix.
  const hasWildcardToken =
    cors.origin === '*' ||
    (Array.isArray(cors.origin) && cors.origin.includes('*')) ||
    hasProtocolWildcard(cors.origin);

  if (Array.isArray(cors.credentials) && !hasWildcardToken) {
    if (Array.isArray(cors.origin)) {
      // Merge credentials origins into origin list to ensure they're allowed for CORS
      cors.origin = [...new Set([...cors.origin, ...cors.credentials])];
    } else if (typeof cors.origin === 'string') {
      // Convert single origin to array and merge with credentials origins
      cors.origin = [...new Set([cors.origin, ...cors.credentials])];
    }
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
