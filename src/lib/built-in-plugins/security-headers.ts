import type { FastifyRequest, FastifyReply } from 'fastify';
import type {
  ServerPlugin,
  PluginHostInstance,
  UnirendServerMode,
} from '../types';
import {
  matchesOriginList,
  matchesCORSCredentialsList,
  matchesDomainList,
  normalizeDomain,
  validateConfigEntry,
} from 'lifecycleion/domain-utils';
import { LRUCache } from 'lifecycleion/lru-cache';
import { addToVaryHeader } from '../internal/http-header-utils';
import {
  cspHeaderName,
  serializeCSP,
  validateCSPConfig,
  applyCSPPreset,
  type CSPConfig,
} from '../internal/csp-policy';
import { UNIREND_ERROR_PAGE_STYLE_HASHES } from '../internal/error-page-utils';
import { UNIREND_BOOTSTRAP_SCRIPT_HASH } from '../internal/html-utils/context-data-block';
import type { InlineAttributeFinding } from '../internal/html-utils/format';

export type { CSPConfig } from '../internal/csp-policy';

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
 * {@link SecurityHeadersConfig} alongside this block.
 */
export interface CORSConfig {
  /**
   * Allowed origins for CORS requests
   * - string: Single origin (e.g., "https://example.com")
   * - string[]: Multiple origins with wildcard support
   * - function: Dynamic origin validation
   * - "*": Allow all origins (not recommended with credentials)
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
   * @default "*"
   */
  origin?: CORSOrigin;

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

/**
 * Strict-Transport-Security (HSTS) header parameters.
 */
export interface HSTSConfig {
  /** max-age in seconds */
  maxAge: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}

/**
 * A per-request override of the non-negotiated headers.
 *
 * Each key replaces that block outright rather than merging into it. A partial
 * merge would mean `hsts: { maxAge: 86400 }` silently keeping the baseline's
 * `includeSubDomains`, which is the exact combination a custom-domain override
 * exists to avoid.
 *
 * CORS is deliberately absent. `cors.origin` and `cors.credentials` already
 * take request-aware functions, so it has been per-request since before this
 * existed, and giving it a second mechanism would mean two places to look when
 * an origin decision surprises someone.
 */
export interface SecurityHeadersOverride {
  csp?: false | CSPConfig;
  hsts?: false | HSTSConfig;
  frameOptions?: false | 'DENY' | 'SAMEORIGIN';
}

/**
 * Decides the policy for one request, given the validated defaults.
 *
 * Return `null` to use the defaults unchanged, which is the common path and
 * should be the fast one.
 *
 * May be async, since the lookup this exists for is usually a store hit.
 */
export type SecurityHeadersResolver = (
  request: FastifyRequest,
) => SecurityHeadersOverride | null | Promise<SecurityHeadersOverride | null>;

/**
 * The plugin, plus a way to install its resolver after registration.
 *
 * A plain `ServerPlugin` everywhere it is used as one; the extra method exists
 * for the late-bound case, where the resolver needs a dependency that is not
 * ready at config time.
 */
export type SecurityHeadersPlugin = ServerPlugin<UnirendServerMode> & {
  setResolver: (resolver: SecurityHeadersResolver | undefined) => void;
};

/**
 * Browser security header configuration.
 *
 * Every field is a default. When `resolve` is supplied, its return value is
 * merged over these per request, which is how a multi-tenant deployment varies
 * policy by domain without giving up config-time validation of the defaults.
 */
export interface SecurityHeadersConfig {
  /**
   * Cross-Origin Resource Sharing policy, negotiated per-origin.
   */
  cors?: CORSConfig;

  /**
   * Controls the X-Frame-Options response header.
   * - false: do not send the header (default)
   * - "DENY" | "SAMEORIGIN": header value to send
   *
   * @default false
   */
  frameOptions?: false | 'DENY' | 'SAMEORIGIN';

  /**
   * Content-Security-Policy, the header a browser enforces against the page
   * itself rather than against who may read it.
   *
   * Each source-list directive takes sources written as they appear in the
   * header, keywords with their quotes and hosts without:
   *
   * ```ts
   * csp: {
   *   defaultSrc: ["'self'"],
   *   imgSrc: ["'self'", 'data:', 'https://cdn.example.com'],
   *   frameAncestors: ["'none'"],
   *   reportOnly: true,
   * }
   * ```
   *
   * Unirend adds its own hashes to `scriptSrc` and `styleSrc` for the inline
   * content it emits, so its error pages and injected globals keep working
   * without `'unsafe-inline'`. It only adds to a directive you have set, since
   * creating one you did not ask for would override `defaultSrc` and block
   * whatever you expected `defaultSrc` to cover.
   *
   * Start with `reportOnly: true` on a live site. Violations are reported and
   * nothing is blocked, so you find what breaks without breaking it.
   *
   * @default false
   */
  csp?: false | CSPConfig;

  /**
   * Controls the Strict-Transport-Security (HSTS) response header.
   * - false: do not send the header (default)
   * - { maxAge, includeSubDomains?, preload? }: header parameters
   *
   * The header is only sent when the request arrived over a secure transport,
   * per RFC 6797 section 7.2, which forbids sending it over plain HTTP. Behind
   * a TLS-terminating proxy that means `fastifyOptions.trustProxy` must be set,
   * otherwise Fastify sees plain HTTP and no HSTS header is sent.
   *
   * Take particular care with `includeSubDomains` on a domain you do not
   * control, such as a customer's custom domain. It forces HTTPS across every
   * other subdomain of that domain, and browsers honor it for the full
   * `maxAge`, so shipping a fix later does not revoke it. Use `resolve` to send
   * a narrower policy for those domains.
   *
   * @default false
   */
  hsts?: false | HSTSConfig;

  /**
   * Vary the non-negotiated headers per request.
   *
   * The case this exists for: customers mapping their own domains. A single
   * static `hsts` applies to all of them, and `includeSubDomains` on a domain
   * you do not own forces HTTPS across every other subdomain that customer has,
   * honored for the full `maxAge` with no way to revoke it. A domain you do not
   * control needs a shorter `maxAge` and no `includeSubDomains` or `preload`.
   *
   * ```ts
   * securityHeaders({
   *   hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
   *   frameOptions: 'DENY',
   *
   *   resolve: async (request) => {
   *     const tenant = await lookupTenant(request.domainInfo.hostname);
   *     if (!tenant?.isCustomDomain) return null; // defaults unchanged
   *     return { hsts: { maxAge: 86400 }, frameOptions: false };
   *   },
   * });
   * ```
   *
   * Each returned block replaces the default outright rather than merging into
   * it, so `hsts: { maxAge: 86400 }` sends exactly that and nothing else.
   *
   * The result is validated per request with the same rules as the defaults, so
   * a resolver cannot produce a policy the config would have rejected.
   *
   * **A resolver that throws behaves like any other middleware that throws:**
   * it propagates and becomes a 500. There is no bespoke fallback, because
   * unlike an allow-or-deny callback there is no obviously correct answer to
   * substitute. If you would rather degrade than fail, catch it yourself and
   * return `null`, where you can tell "no override needed" from "the store is
   * down". Either way the error response carries the defaults and **no HSTS**,
   * since a domain whose policy could not be resolved is not one to bind.
   *
   * Called at most once per request; the result is reused for the rest of the
   * lifecycle, including the error path.
   */
  resolve?: SecurityHeadersResolver;

  /**
   * Hosts this deployment owns, for deciding what a failed `resolve` may still
   * send.
   *
   * Without it, a resolver that throws costs the response its HSTS, always.
   * That is never wrong, but it is blunt: a store outage then drops HSTS for
   * first-party traffic too, on domains the operator plainly does own and had
   * every intention of binding.
   *
   * With it, a failed resolve keeps the baseline HSTS when the request's host
   * matches, and still sends nothing when it does not. The distinction is the
   * whole point: binding a domain for a year is safe when you own it and
   * permanent when you do not, and only you can say which is which.
   *
   * Accepts the same patterns as `domainValidation.validProductionDomains`:
   * exact hosts, `*.example.com` for direct subdomains, `**.example.com` for
   * any depth. List only what you genuinely control. A customer's mapped domain
   * does not belong here even though you serve it.
   *
   * @example
   * ownDomains: ['example.com', '**.example.com']
   */
  ownDomains?: string | string[];
}

/**
 * Default CORS configuration
 */
const DEFAULT_CORS_CONFIG: Required<
  Omit<CORSConfig, 'credentials' | 'origin'>
> & {
  origin: CORSOrigin;
  credentials: boolean;
} = {
  origin: '*',
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

// Limit how many headers we reflect/allow on preflight to avoid abuse
const MAX_ALLOWED_HEADERS = 100;

// Limit the length of each reflected header name to avoid pathological values
const MAX_HEADER_LEN = 256;

type ResolvedCORSConfig = Required<
  Omit<CORSConfig, 'credentials' | 'origin'>
> & {
  origin: CORSOrigin;
  credentials:
    | boolean
    | string[]
    | ((
        origin: string | undefined,
        request: FastifyRequest,
      ) => boolean | Promise<boolean>);
};

/**
 * A validated policy, the header it belongs in, and the serialized value.
 *
 * `config` is kept rather than discarded because the serialized value is not
 * always final. An SSR request contributes the active template's hashes partway
 * through, and folding those in means serializing this policy again, with more
 * sources. Keeping the config next to the value is what lets that work for a
 * policy a resolver produced, and not just for the one configured at startup.
 */
type CompiledCSP = {
  headerName: string;
  value: string;
  config: CSPConfig;
};

type ResolvedSecurityHeadersConfig = {
  cors: ResolvedCORSConfig;
  frameOptions: false | 'DENY' | 'SAMEORIGIN';
  hsts: false | HSTSConfig;
  /**
   * The policy in force, compiled. On the base config this is computed once at
   * startup. On a config a resolver produced it is computed for that request,
   * which is the only time its inputs are known.
   */
  csp: false | CompiledCSP;
  /**
   * Present only on the base config, and only when a `resolve` is configured.
   *
   * Carrying it here rather than threading a resolver argument through every
   * apply path means the config object knows how to become the effective one,
   * and the effective one it returns does not carry it, so there is nothing to
   * recurse into.
   */
  resolveEffective?: (
    request: FastifyRequest,
  ) => Promise<ResolvedSecurityHeadersConfig>;
};

/**
 * The policy in force for this request: the resolver's, if there is one, and
 * the validated defaults otherwise.
 */
async function effectiveConfigFor(
  request: FastifyRequest,
  config: ResolvedSecurityHeadersConfig,
): Promise<ResolvedSecurityHeadersConfig> {
  return config.resolveEffective ? config.resolveEffective(request) : config;
}

/**
 * Validate credentials origins using centralized validateConfigEntry
 */
function validateCredentialsOrigins(
  credentials: string[],
  allowWildcard: boolean,
): void {
  for (const o of credentials) {
    // Never allow credentials for the special "null" origin
    if (o === 'null') {
      throw new Error(
        "Invalid CORS config: credentials cannot be enabled for the 'null' origin. Remove 'null' from the credentials list.",
      );
    }

    // Use validateConfigEntry to get comprehensive validation
    const verdict = validateConfigEntry(o, 'origin', {
      allowGlobalWildcard: false, // Never allow global wildcard in credentials
      allowProtocolWildcard: false, // Never allow protocol wildcards in credentials
    });

    if (!verdict.valid) {
      throw new Error(
        `Invalid CORS credentials origin "${o}"${verdict.info ? ': ' + verdict.info : ''}`,
      );
    }

    // Use wildcardKind from validateConfigEntry to determine policy
    if (verdict.wildcardKind === 'global') {
      throw new Error(
        `Global wildcard "${o}" is not allowed in credentials. Use specific origins or subdomain patterns like "*.example.com".`,
      );
    }

    if (verdict.wildcardKind === 'protocol') {
      throw new Error(
        `Protocol wildcard "${o}" is not allowed in credentials. Use domain patterns like "*.example.com" or "**.example.com".`,
      );
    }

    if (verdict.wildcardKind === 'subdomain' && !allowWildcard) {
      throw new Error(
        `Wildcard pattern "${o}" in credentials requires credentialsAllowWildcardSubdomains: true or use explicit origins.`,
      );
    }
  }
}

/**
 * Check if an origin is allowed based on the origin configuration
 */
async function isOriginAllowed(
  origin: string | undefined,
  originConfig: CORSOrigin,
  request: FastifyRequest,
): Promise<boolean> {
  if (typeof originConfig === 'string') {
    // Delegate to list matcher for uniform handling (exact, wildcard, protocol wildcard, and "*")
    return matchesOriginList(origin, [originConfig]);
  }

  if (Array.isArray(originConfig)) {
    return matchesOriginList(origin, originConfig);
  }

  if (typeof originConfig === 'function') {
    return await originConfig(origin, request);
  }

  return false;
}

/**
 * Check if credentials are allowed for an origin
 */
async function areCredentialsAllowed(
  origin: string | undefined,
  credentialsConfig: CORSConfig['credentials'],
  request: FastifyRequest,
  allowWildcardSubdomains: boolean,
): Promise<boolean> {
  if (credentialsConfig === false || credentialsConfig === undefined) {
    return false;
  }

  if (credentialsConfig === true) {
    return true;
  }

  if (Array.isArray(credentialsConfig)) {
    return matchesCORSCredentialsList(origin, credentialsConfig, {
      allowWildcardSubdomains: allowWildcardSubdomains,
    });
  }

  if (typeof credentialsConfig === 'function') {
    return await credentialsConfig(origin, request);
  }

  return false;
}

/**
 * Per-request cache of the two origin-negotiated decisions.
 *
 * Both are computed at most once per request and reused everywhere else in the
 * lifecycle. That is partly to avoid paying for a user callback several times,
 * and partly because a callback that throws must not be given a second chance
 * to throw from the error path that is already handling the first throw.
 */
interface CORSDecisionCache {
  corsOriginAllowed?: boolean;
  corsCredentialsAllowed?: boolean;
}

/**
 * Report a user callback that threw.
 *
 * Read defensively because this runs on paths that predate the request having a
 * logger, and a failure to log must never become the thing that breaks the
 * response we are in the middle of rescuing.
 */
function logCallbackError(
  request: FastifyRequest,
  error: unknown,
  message: string,
): void {
  const log = (request as Partial<FastifyRequest>).log;
  log?.error({ err: error }, `[securityHeaders] ${message}`);
}

/**
 * Decide whether this request's origin is allowed, once per request.
 *
 * A callback that throws denies rather than 500s. The request itself is fine,
 * it is the policy that could not be evaluated, and the safe reading of an
 * unevaluated policy is that the origin is not on it. Denying costs a
 * cross-origin caller its response; 500ing costs everyone theirs, including
 * same-origin traffic that was never subject to the callback in the first
 * place.
 */
async function resolveOriginAllowed(
  request: FastifyRequest,
  cors: ResolvedCORSConfig,
  isOriginAllowedResult?: boolean,
): Promise<boolean> {
  if (isOriginAllowedResult !== undefined) {
    return isOriginAllowedResult;
  }

  const cache = request as FastifyRequest & CORSDecisionCache;

  if (cache.corsOriginAllowed !== undefined) {
    return cache.corsOriginAllowed;
  }

  let isAllowed: boolean;

  try {
    isAllowed = await isOriginAllowed(
      request.headers.origin,
      cors.origin,
      request,
    );
  } catch (error) {
    logCallbackError(
      request,
      error,
      'origin callback threw, denying the origin for this request',
    );
    isAllowed = false;
  }

  // Cached even when the callback threw. Without this the 500 the throw would
  // otherwise produce runs the error path, the error path applies security
  // headers, and the callback is invoked a second time from inside the handler
  // dealing with the first failure.
  cache.corsOriginAllowed = isAllowed;

  return isAllowed;
}

/**
 * Decide whether this request's origin may send credentials, once per request.
 *
 * Same fail-closed rule as the origin decision, and the stakes are higher: the
 * header this gates is what lets a cross-origin caller read a response made
 * with the user's cookies.
 */
async function resolveCredentialsAllowed(
  request: FastifyRequest,
  cors: ResolvedCORSConfig,
): Promise<boolean> {
  const cache = request as FastifyRequest & CORSDecisionCache;

  if (cache.corsCredentialsAllowed !== undefined) {
    return cache.corsCredentialsAllowed;
  }

  let isAllowed: boolean;

  try {
    isAllowed = await areCredentialsAllowed(
      request.headers.origin,
      cors.credentials,
      request,
      cors.credentialsAllowWildcardSubdomains,
    );
  } catch (error) {
    logCallbackError(
      request,
      error,
      'credentials callback threw, withholding Access-Control-Allow-Credentials',
    );
    isAllowed = false;
  }

  cache.corsCredentialsAllowed = isAllowed;

  return isAllowed;
}

/**
 * How a header write should treat a value that is already on the reply.
 *
 * - `'apply'`: set it, which is what the early `onRequest` pass does since
 *   nothing has run yet
 * - `'fill'`: leave an existing value alone, which is what the `onSend`
 *   backstop does so a handler that deliberately set its own value wins
 */
type HeaderWriteMode = 'apply' | 'fill';

function writeSecurityHeader(
  reply: FastifyReply,
  mode: HeaderWriteMode,
  name: string,
  value: string,
): void {
  if (mode === 'fill' && reply.hasHeader(name)) {
    return;
  }

  reply.header(name, value);
}

/**
 * True when `domainValidation` determined this request's host is not one the
 * server claims, either because it failed the allow list or because the Host
 * header was missing or unparseable.
 */
function isHostDisclaimed(request: FastifyRequest): boolean {
  return request.domainValidationRejected === true;
}

/**
 * Check an HSTS block.
 *
 * Extracted so the defaults and a resolver's override are held to the same
 * rules. A resolver returning something the config would have rejected is a
 * bug worth surfacing, not a way around validation.
 */
function validateHSTSConfig(cfg: HSTSConfig): void {
  if (
    typeof cfg.maxAge !== 'number' ||
    !Number.isFinite(cfg.maxAge) ||
    cfg.maxAge < 0
  ) {
    throw new Error(
      'Invalid securityHeaders config: hsts.maxAge must be a non-negative number (seconds)',
    );
  }

  // When requesting HSTS preload, enforce Chrome preload list requirements:
  // - max-age must be at least 31536000 (1 year)
  // - includeSubDomains must be present
  if (cfg.preload) {
    if (cfg.maxAge < 31536000) {
      throw new Error(
        'Invalid securityHeaders config: HSTS preload requires maxAge >= 31536000 (1 year)',
      );
    }

    if (!cfg.includeSubDomains) {
      throw new Error(
        'Invalid securityHeaders config: HSTS preload requires includeSubDomains: true',
      );
    }
  }
}

/**
 * The directive a browser would actually consult for an inline attribute.
 *
 * CSP fallback stops at the first directive that is set, it does not union the
 * chain. `script-src-attr` wins over `script-src`, which wins over
 * `default-src`, and once one of them is present the rest are not consulted at
 * all. An empty array counts as absent because it serializes to nothing, so the
 * browser falls through it too.
 *
 * Returns undefined when nothing in the chain is set, meaning no directive
 * restricts the attribute.
 */
function effectiveAttributeSources(
  policy: CSPConfig,
  kind: 'script' | 'style',
): readonly string[] | undefined {
  const chain =
    kind === 'script'
      ? [policy.scriptSrcAttr, policy.scriptSrc, policy.defaultSrc]
      : [policy.styleSrcAttr, policy.styleSrc, policy.defaultSrc];

  return chain.find((sources) => sources !== undefined && sources.length > 0);
}

/**
 * Whether the policy would actually let this inline attribute run.
 *
 * The check exists because warning unconditionally would be noise: someone who
 * has deliberately set 'unsafe-hashes' or 'unsafe-inline' has already decided,
 * and telling them again on every startup is how a warning gets tuned out. The
 * detection lives in the template pipeline, which cannot see the policy, and
 * the policy lives here, which cannot see the template. Reporting from there
 * and deciding here is what lets the warning be accurate.
 *
 * Accuracy is the whole point, so the decision follows one chain rather than
 * scanning every directive for an opt-in. Asking "did anything anywhere say
 * 'unsafe-inline'" gets it wrong in both directions: a permissive `style-src`
 * would excuse an `onclick=` that has nothing to do with styles, and a
 * `script-src-attr: ["'none'"]` sitting above a permissive `script-src` would
 * excuse a handler that the more specific directive is specifically blocking.
 *
 * The two opt-ins are not equivalent, which is the other thing this gets right.
 * 'unsafe-inline' permits the attribute outright. 'unsafe-hashes' does not
 * permit anything by itself: it only makes hash sources eligible to match an
 * attribute, so a directive carrying it still blocks every attribute whose
 * exact value is not also listed as a hash. Verified against Chrome, which
 * runs `onclick` under `script-src-attr 'unsafe-hashes' 'sha256-<value>'` and
 * blocks it under `script-src-attr 'unsafe-hashes'` alone.
 */
function permitsInlineAttribute(
  policy: CSPConfig,
  finding: InlineAttributeFinding,
): boolean {
  const sources = effectiveAttributeSources(policy, finding.kind);

  // Nothing in the chain is set, so nothing blocks the attribute and there is
  // nothing to warn about.
  if (!sources) {
    return true;
  }

  if (sources.includes("'unsafe-inline'")) {
    return true;
  }

  // 'unsafe-hashes' is a modifier rather than a permission, so it takes the
  // hash of this specific attribute's value alongside it. A policy carrying the
  // keyword and a hash for some *other* attribute still blocks this one, which
  // is exactly the case a keyword-only check would wave through.
  return sources.includes("'unsafe-hashes'") && sources.includes(finding.hash);
}

/**
 * Reject the one framing pair where the fallback is weaker than the policy.
 *
 * frame-ancestors supersedes X-Frame-Options wherever CSP is supported, which
 * is everywhere that matters, so X-Frame-Options is a fallback for browsers
 * that would otherwise get no framing policy at all.
 *
 * A fallback being *stricter* than the policy it backs up is fine and common:
 * frameOptions 'DENY' alongside frame-ancestors 'self' means an old browser
 * refuses framing a new one permits, which is the safe direction to be wrong
 * in. The reverse is not. 'SAMEORIGIN' alongside frame-ancestors 'none' means
 * an old browser permits same-origin framing that the policy exists to forbid,
 * and the author almost certainly believes they have forbidden it everywhere.
 *
 * Only that one combination is rejected. Anything else, including a deliberate
 * "modern browsers get the nuance, old ones get the blunt fallback" pairing
 * such as 'SAMEORIGIN' with a partner origin listed, is left alone: it is a
 * real pattern and not this code's business to second-guess.
 *
 * Takes the two halves separately rather than a whole config because the pair
 * it judges can be assembled from two places. A resolver overriding one half
 * inherits the other from the baseline, so the invalid combination is
 * reachable without either half being invalid on its own, and checking only
 * what the resolver returned would miss it entirely.
 *
 * @param frameOptions The effective X-Frame-Options value, if any
 * @param csp The effective CSP config, already expanded from its preset
 */
function validateFramingFallback(
  frameOptions: SecurityHeadersConfig['frameOptions'],
  csp: CSPConfig | false | undefined,
): void {
  if (!csp) {
    return;
  }

  const isFramingDenied =
    Array.isArray(csp.frameAncestors) &&
    csp.frameAncestors.length === 1 &&
    csp.frameAncestors[0] === "'none'";

  if (isFramingDenied && frameOptions === 'SAMEORIGIN') {
    throw new Error(
      "Invalid securityHeaders config: csp.frameAncestors is [\"'none'\"] but frameOptions is 'SAMEORIGIN'. frame-ancestors supersedes X-Frame-Options where CSP is supported, so the weaker X-Frame-Options would still let a browser without CSP support frame this page from the same origin. Use frameOptions: 'DENY' to match, or drop frameOptions entirely.",
    );
  }
}

/**
 * Build the effective policy for a request, running `resolve` at most once.
 *
 * The cached verdict is what keeps a throwing resolver from throwing twice. It
 * propagates the first time and Fastify turns that into a 500; the error path
 * then applies security headers, reaches this, and finds an answer already
 * waiting rather than calling the resolver that just failed. Same double-fault
 * shape the CORS callbacks needed solving, same solution.
 */
async function resolveEffectiveConfig(
  request: FastifyRequest,
  baseConfig: ResolvedSecurityHeadersConfig,
  resolve: SecurityHeadersResolver | undefined,
  serializePolicy: (csp: CSPConfig) => false | CompiledCSP,
  ownDomains: string[] | undefined,
): Promise<ResolvedSecurityHeadersConfig> {
  if (!resolve) {
    return baseConfig;
  }

  const cache = request as FastifyRequest & {
    securityHeadersEffective?: ResolvedSecurityHeadersConfig;
  };

  if (cache.securityHeadersEffective) {
    return cache.securityHeadersEffective;
  }

  // Stored before awaiting, so the error path has something to use even though
  // the throw below never lets execution reach the assignment at the end.
  //
  // HSTS is dropped from it, and that is not a preference. The baseline is
  // whatever suits the domains the operator owns, typically a long max-age with
  // includeSubDomains, and the whole reason a resolver exists is to send
  // something narrower on a domain they do not own. Falling back to the
  // baseline on a customer domain would bind it for a year with no way to
  // revoke, which is worse than the 500 that prompted it. Everything else is
  // safe to fall back on: too strict at worst, and the effect ends with the
  // response.
  //
  // Unless the operator has said which hosts are theirs, in which case the
  // question has an answer for this request and blanket suppression is just
  // imprecision. Binding a domain for a year is safe when you own it, so a
  // store outage need not cost first-party traffic its HSTS as well.
  const isOwnHost =
    ownDomains !== undefined &&
    ownDomains.length > 0 &&
    matchesDomainList(normalizeDomain(request.hostname ?? ''), ownDomains);

  cache.securityHeadersEffective = isOwnHost
    ? baseConfig
    : { ...baseConfig, hsts: false };

  const override = await resolve(request);

  if (!override) {
    cache.securityHeadersEffective = baseConfig;

    return baseConfig;
  }

  // Validated with the same rules as the defaults, so a resolver cannot produce
  // a policy the config would have rejected. A throw here propagates like any
  // other resolver failure, which is right: returning something invalid is a
  // bug in the same place with the same consequences as throwing.
  if (override.hsts !== undefined && override.hsts !== false) {
    validateHSTSConfig(override.hsts);
  }

  let csp = baseConfig.csp;

  if (override.csp !== undefined) {
    if (override.csp === false) {
      csp = false;
    } else {
      validateCSPConfig(override.csp);
      csp = serializePolicy(override.csp);
    }
  }

  // Each block replaces rather than merges. A partial merge would let
  // `hsts: { maxAge: 86400 }` silently keep the baseline's includeSubDomains,
  // which is the exact combination the override exists to avoid.
  const effective: ResolvedSecurityHeadersConfig = {
    cors: baseConfig.cors,
    frameOptions: override.frameOptions ?? baseConfig.frameOptions,
    hsts: override.hsts ?? baseConfig.hsts,
    csp,
  };

  // Checked on the merged pair, not on what the resolver returned, because the
  // two halves come from different places. Overriding just the CSP while
  // inheriting `frameOptions: 'SAMEORIGIN'` from the baseline, or the reverse,
  // assembles the rejected combination out of two halves that are each fine on
  // their own. Validating only the override would let a resolver produce a
  // policy the static config would have refused at startup.
  validateFramingFallback(
    effective.frameOptions,
    effective.csp ? effective.csp.config : effective.csp,
  );

  cache.securityHeadersEffective = effective;

  return effective;
}

function applyUnconditionalSecurityHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  resolvedConfig: ResolvedSecurityHeadersConfig,
  mode: HeaderWriteMode = 'apply',
): void {
  // These headers are not negotiated per-origin. They are safe to apply even
  // on requests that will ultimately receive no Access-Control-Allow-Origin
  // header, so we keep them separate from the origin-dependent CORS logic.

  // Set Vary: Origin unconditionally so CDN caches don't serve a cached
  // non-CORS response (which lacks Access-Control-Allow-Origin) to a
  // later CORS request for the same URL.
  addToVaryHeader(reply, 'Origin');

  // Sits here rather than anywhere else so it inherits everything this function
  // already gets: the early onRequest pass, the onSend backstop that covers
  // responses which short-circuited before it, and applySecurityHeaders() for
  // hijacked paths. A 403 from domainValidation and a static file served by
  // reply.hijack() both carry the policy without any of them knowing about CSP.
  if (resolvedConfig.csp) {
    writeSecurityHeader(
      reply,
      mode,
      resolvedConfig.csp.headerName,
      resolvedConfig.csp.value,
    );
  }

  // Security headers (applied for all requests early in lifecycle)
  if (resolvedConfig.frameOptions) {
    writeSecurityHeader(
      reply,
      mode,
      'X-Frame-Options',
      resolvedConfig.frameOptions,
    );
  }

  // RFC 6797 section 7.2: a host MUST NOT send Strict-Transport-Security over
  // a non-secure transport, and user agents MUST ignore it when they receive
  // it that way. So the header is only meaningful on an HTTPS response.
  //
  // `request.protocol` is Fastify's resolution, which reads x-forwarded-proto
  // only when `fastifyOptions.trustProxy` says the peer may be believed. That
  // matters for the common TLS-terminating-proxy deployment: without
  // trustProxy the app sees plain HTTP and sends no HSTS at all.
  //
  // Secure transport is necessary but not sufficient. HSTS also has to be a
  // header this host is entitled to send, and a host `domainValidation` just
  // disclaimed is not: setting an HTTPS policy for a domain the operator says
  // is not theirs binds the browser for the full max-age with no way to revoke
  // it. Keyed on the rejection rather than on the 403 status, so an ordinary
  // application authorization failure on a domain we do serve keeps its HSTS.
  if (
    resolvedConfig.hsts &&
    request.protocol === 'https' &&
    !isHostDisclaimed(request)
  ) {
    const parts = [`max-age=${Math.floor(resolvedConfig.hsts.maxAge)}`];

    if (resolvedConfig.hsts.includeSubDomains) {
      parts.push('includeSubDomains');
    }

    if (resolvedConfig.hsts.preload) {
      parts.push('preload');
    }

    writeSecurityHeader(
      reply,
      mode,
      'Strict-Transport-Security',
      parts.join('; '),
    );
  }
}

async function applyCORSActualResponseHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  resolvedConfig: ResolvedSecurityHeadersConfig,
  isOriginAllowedResult?: boolean,
  mode: HeaderWriteMode = 'apply',
): Promise<void> {
  const cors = resolvedConfig.cors;
  const origin = request.headers.origin;
  const isAllowed = await resolveOriginAllowed(
    request,
    cors,
    isOriginAllowedResult,
  );

  // Apply the unconditional security/Vary headers first, then layer the
  // origin-negotiated CORS headers on top if this request is allowed.
  //
  // The unconditional set is whatever `resolve` decided for this request, which
  // is why it is looked up here rather than closed over: every path that
  // applies headers goes through this function, so resolving here covers the
  // early hook, the onSend backstop, and the hijacked-response helper at once.
  applyUnconditionalSecurityHeaders(
    request,
    reply,
    await effectiveConfigFor(request, resolvedConfig),
    mode,
  );

  // For non-preflight requests, let them proceed without CORS headers if the
  // origin is not allowed. Same-origin requests still work; browsers enforce
  // the cross-origin failure client-side.
  if (!isAllowed && origin) {
    return;
  }

  if (origin && isAllowed) {
    // For allowed cross-origin requests we echo the specific origin rather than
    // using '*' so credentials/exposed-headers semantics stay correct.
    writeSecurityHeader(reply, mode, 'Access-Control-Allow-Origin', origin);

    const isCredentialsAllowed = await resolveCredentialsAllowed(request, cors);

    // Never send credentials for the special 'null' origin
    if (isCredentialsAllowed && origin !== 'null') {
      writeSecurityHeader(
        reply,
        mode,
        'Access-Control-Allow-Credentials',
        'true',
      );
    }

    if (cors.exposedHeaders.length > 0) {
      writeSecurityHeader(
        reply,
        mode,
        'Access-Control-Expose-Headers',
        cors.exposedHeaders.join(', '),
      );
    }
  } else if (!origin && cors.origin === '*') {
    // Requests without an Origin header are non-browser/same-origin style
    // traffic. When policy is fully wildcard, keep the public wildcard signal.
    writeSecurityHeader(reply, mode, 'Access-Control-Allow-Origin', '*');
  }
}

/**
 * Browser security headers plugin for Unirend
 *
 * Owns the response headers a browser enforces policy from: CORS negotiation
 * plus the non-negotiated headers such as X-Frame-Options and HSTS.
 *
 * Provides more flexible CORS handling than @fastify/cors, specifically:
 * - Dynamic credentials based on origin
 * - Function-based origin validation
 * - Separate credential and origin policies
 *
 * @example
 * ```typescript
 * // Allow public API access but only credentials for trusted origins
 * securityHeaders({
 *   origin: "*", // Allow any origin for public API
 *   credentials: ["https://myapp.com", "https://admin.myapp.com"], // Only these can send cookies
 *   methods: ["GET", "POST"],
 * })
 *
 * // Handle "null" origins from sandboxed documents or file:// URLs
 * securityHeaders({
 *   origin: ["https://app.com", "null"], // Explicitly allow null origins
 *   credentials: ["https://app.com"], // Credentials not allowed for null origins
 * })
 *
 * // Dynamic validation based on request
 * securityHeaders({
 *   origin: (origin, request) => {
 *     // Allow any origin for public endpoints
 *     if (request.url?.startsWith('/api/public/')) return true;
 *     // Restrict private endpoints
 *     return origin === 'https://myapp.com';
 *   },
 *   credentials: (origin, request) => {
 *     // Only allow credentials for authenticated endpoints from trusted origins
 *     return request.url?.startsWith('/api/auth/') && origin === 'https://myapp.com';
 *   }
 * })
 * ```
 */
export function securityHeaders(
  config: SecurityHeadersConfig = {},
): SecurityHeadersPlugin {
  const corsConfig = { ...DEFAULT_CORS_CONFIG, ...(config.cors ?? {}) };

  // Config-time validations:
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

  if (corsConfig.origin === '*' && corsConfig.credentials === true) {
    throw new Error(
      "Cannot use credentials: true with origin: '*'. The CORS specification prohibits Access-Control-Allow-Credentials: true with Access-Control-Allow-Origin: *. Use specific origins instead.",
    );
  }

  // Guard: credentials: true with protocol wildcard (e.g., https://*) is high risk.
  // Require explicit opt-in via allowCredentialsWithProtocolWildcard: true
  if (corsConfig.credentials === true) {
    const hasProtocolWildcard = (value: CORSOrigin): boolean => {
      if (typeof value === 'string') {
        return value === 'https://*' || value === 'http://*';
      }

      if (Array.isArray(value)) {
        return value.some((v) => v === 'https://*' || v === 'http://*');
      }

      return false; // functions are evaluated per-request; not considered a blanket wildcard here
    };

    if (
      hasProtocolWildcard(corsConfig.origin) &&
      !corsConfig.allowCredentialsWithProtocolWildcard
    ) {
      throw new Error(
        'Cannot use credentials: true with protocol wildcard origins unless allowCredentialsWithProtocolWildcard: true. Use specific origins instead.',
      );
    }
  }

  // Additional guard: prevent reflect+credentials when origin is '*'
  if (corsConfig.origin === '*') {
    // Dynamic function with '*' would enable reflecting arbitrary origins with credentials
    if (typeof corsConfig.credentials === 'function') {
      throw new TypeError(
        "Unsafe CORS: cannot combine origin '*' with dynamic credentials. Use a concrete origin list when enabling credentials.",
      );
    }

    // If credentials is an allowlist, validate and upgrade origin to that list
    if (Array.isArray(corsConfig.credentials)) {
      validateCredentialsOrigins(
        corsConfig.credentials,
        corsConfig.credentialsAllowWildcardSubdomains,
      );

      const allowlist = Array.from(new Set(corsConfig.credentials));
      if (allowlist.length === 0) {
        throw new Error(
          "Invalid CORS config: credentials list is empty; cannot combine origin '*' with credentials.",
        );
      }
      // Upgrade: stop using '*' and switch to a concrete allowlist for origin
      corsConfig.origin = allowlist;
      // Keep origin and credentials aligned to reduce misconfiguration
      corsConfig.credentials = allowlist;
    }
  }

  // Validate credentials wildcard patterns
  if (Array.isArray(corsConfig.credentials)) {
    validateCredentialsOrigins(
      corsConfig.credentials,
      corsConfig.credentialsAllowWildcardSubdomains,
    );
  }

  // Validate origin entries using centralized validator with appropriate wildcard policies
  if (typeof corsConfig.origin === 'string') {
    if (corsConfig.origin !== '*') {
      const verdict = validateConfigEntry(corsConfig.origin, 'origin', {
        allowGlobalWildcard: false, // Global wildcard handled separately above
        allowProtocolWildcard: true, // Allow protocol wildcards in origin
      });

      if (!verdict.valid) {
        throw new Error(
          `Invalid CORS origin "${corsConfig.origin}"${verdict.info ? ': ' + verdict.info : ''}`,
        );
      }
    }
  } else if (Array.isArray(corsConfig.origin)) {
    const entries = corsConfig.origin;
    // Normalize ["*"] to "*"
    const unique = Array.from(new Set(entries));
    if (unique.length === 1 && unique[0] === '*') {
      corsConfig.origin = '*';
    } else {
      // Special policy: '*' inside an array is only allowed when paired solely with 'null'
      if (entries.includes('*')) {
        const isOnlyStarAndNull = entries.every(
          (e) => e === '*' || e === 'null',
        );

        if (!isOnlyStarAndNull) {
          throw new Error(
            "Invalid CORS config: Do not include '*' inside an origin array. Use origin: '*' (string) to allow all, or list specific origins.",
          );
        }
      }

      let wildcardKindSeen: 'none' | 'global' | 'protocol' = 'none';
      const wildcardTokensSeen: string[] = [];

      for (const o of entries) {
        // Use centralized validator to classify
        const verdict = validateConfigEntry(o, 'origin', {
          allowGlobalWildcard: true,
          allowProtocolWildcard: true,
        });
        if (!verdict.valid) {
          throw new Error(
            `Invalid CORS origin "${o}"${verdict.info ? ': ' + verdict.info : ''}`,
          );
        }
        if (
          verdict.wildcardKind === 'global' ||
          verdict.wildcardKind === 'protocol'
        ) {
          const token = verdict.wildcardKind === 'global' ? '*' : o;
          if (wildcardTokensSeen.length > 0) {
            if (wildcardTokensSeen.includes(token)) {
              // Duplicate of the same wildcard token
              throw new Error(
                "Invalid CORS config: only one of '*', 'https://*', or 'http://*' may be specified in origin.",
              );
            }
            // Multiple distinct wildcard tokens – include exact list in error
            const foundList = wildcardTokensSeen.concat(token).join(', ');
            throw new Error(
              `Invalid CORS config: only one of '*', 'https://*', or 'http://*' may be specified in origin. Found: ${foundList}`,
            );
          }

          wildcardTokensSeen.push(token);
          wildcardKindSeen = verdict.wildcardKind;
          continue;
        }

        if (o === 'null') {
          continue;
        }

        // Non-wildcard, non-null entries
        if (wildcardKindSeen !== 'none') {
          throw new Error(
            "Invalid CORS config: when a wildcard token is present, the only other allowed entry is the literal 'null'.",
          );
        }
      }

      // Additional safety: if a global '*' token is present inside the origin array,
      // disallow credentials: true and dynamic credentials function to avoid
      // reflecting arbitrary origins with credentials.
      if (entries.includes('*')) {
        if (corsConfig.credentials === true) {
          throw new Error(
            "Cannot use credentials: true when origin array contains '*'. Use specific origins instead or remove credentials: true.",
          );
        }
        if (typeof corsConfig.credentials === 'function') {
          throw new TypeError(
            "Unsafe CORS: cannot combine an origin array containing '*' with dynamic credentials. Use a concrete origin list when enabling credentials.",
          );
        }
      }

      // Validation complete; configuration is acceptable at this point
    }
  }

  // Auto-merge credentials origins into origin list for safety
  // This prevents common configuration mistakes where credentials origins aren't included in the origin list
  // Note: credentials controls Access-Control-Allow-Credentials header, which tells browsers
  // whether to include cookies/auth headers in requests - it doesn't automatically allow cookies
  if (
    Array.isArray(corsConfig.credentials) &&
    Array.isArray(corsConfig.origin)
  ) {
    // Merge credentials origins into origin list to ensure they're allowed for CORS
    const credentialsOrigins = corsConfig.credentials;
    const existingOrigins = corsConfig.origin;
    const mergedOrigins = [
      ...new Set([...existingOrigins, ...credentialsOrigins]),
    ];
    corsConfig.origin = mergedOrigins;
  } else if (
    Array.isArray(corsConfig.credentials) &&
    typeof corsConfig.origin === 'string' &&
    corsConfig.origin !== '*'
  ) {
    // Convert single origin to array and merge with credentials origins
    const credentialsOrigins = corsConfig.credentials;
    const mergedOrigins = [
      ...new Set([corsConfig.origin, ...credentialsOrigins]),
    ];
    corsConfig.origin = mergedOrigins;
  }

  // Validate security header options at config-time
  if (config.hsts) {
    validateHSTSConfig(config.hsts);
  }

  // Assemble the validated blocks into the shape the request-time helpers read.
  // Keeping CORS in its own block means a future per-request override can
  // replace one block without touching the others.
  // Validate and serialize the startup policy once. A resolver can replace it
  // per request, but for everyone not using one the value is fixed for the life
  // of the process.
  let resolvedCSP: false | CompiledCSP = false;

  // Rebuilt policies, keyed by the policy they came from and the extra sources
  // folded into it.
  //
  // Worth being precise about what makes this a cache rather than a leak. The
  // sources half of the key is derived from a *template's* hashes, and a
  // template is per app and fixed for the life of the process, so one app means
  // one entry computed on its first request and reused forever. The policy half
  // is the serialized base policy, so a per-tenant resolver adds one entry per
  // distinct policy rather than one per request: tenants sharing a policy share
  // an entry. Neither half is keyed on anything that varies per request, which
  // would be the unbounded-growth mistake this plan already rejected once, for
  // the resolver's own cache key.
  //
  // LRU rather than a plain Map for the case where that assumption does not
  // hold. Development recomputes hashes per request, because Vite may add
  // inline content after unirend is done with the template, so a Vite plugin
  // injecting something request-varying would mint a new key every time. A
  // resolver that mints a genuinely distinct policy per tenant behaves the same
  // way at scale. An eviction policy degrades gracefully there, where a hard
  // cap that stopped storing would leave the steady-state apps permanently
  // uncached behind whatever churned in first. Same LRUCache the static content
  // cache uses.
  // Unirend contributes hashes for the inline content it emits itself: the
  // bootstrap that assigns the injected globals, and the styles on its error
  // pages. The framework is the only thing that knows what it emitted, so
  // asking the caller to list these would be asking them to track bytes they
  // never see.
  // Quoted here. hashInlineContentForCSP returns the bare expression, since a
  // source list has unquoted members too and quoting is the assembler's job.
  // Getting this wrong is quiet: an unquoted sha256-... is read as a host
  // name, matches nothing, and the inline content it was meant to allow is
  // blocked with no clue as to why.
  const quote = (hash: string) => `'${hash}'`;

  const ownScriptSources = [quote(UNIREND_BOOTSTRAP_SCRIPT_HASH)];
  const ownStyleSources = UNIREND_ERROR_PAGE_STYLE_HASHES.map(quote);

  const policyBySources = new LRUCache<string, string>(64);

  /**
   * Validate a policy and serialize it with unirend's own inline hashes folded
   * in, producing the value that goes on the wire.
   *
   * Used for the configured policy at startup and for whatever a resolver
   * returns per request, so both arrive downstream in the same shape and both
   * can have request sources folded in later. Returns `false` for a policy that
   * serializes to nothing, which is how "no CSP" is expressed.
   */
  function compileCSP(policy: CSPConfig): false | CompiledCSP {
    const value = serializeCSP(policy, {
      scriptSrc: ownScriptSources,
      styleSrc: ownStyleSources,
    });

    if (!value) {
      return false;
    }

    return { headerName: cspHeaderName(policy), value, config: policy };
  }

  /**
   * The policy with a request's own sources folded in, which for SSR is the
   * active template's inline hashes.
   *
   * Takes the compiled policy rather than closing over the configured one. That
   * is the whole point: a resolver can hand a tenant a different policy, and
   * the hashes for the template that tenant is about to be served have to end
   * up in *that* policy, not in the one the server started with.
   */
  function buildPolicyWithSources(
    compiled: CompiledCSP,
    extra: { scriptSrc?: readonly string[]; styleSrc?: readonly string[] },
  ): string {
    const scriptSrc = [...ownScriptSources, ...(extra.scriptSrc ?? [])];
    const styleSrc = [...ownStyleSources, ...(extra.styleSrc ?? [])];
    const key = `${compiled.value}|${scriptSrc.join(' ')}|${styleSrc.join(' ')}`;

    let policy = policyBySources.get(key);

    if (policy === undefined) {
      policy = serializeCSP(compiled.config, { scriptSrc, styleSrc });
      policyBySources.set(key, policy);
    }

    return policy;
  }

  // Expanded once, here, so everything downstream (validation, serialization,
  // the frameAncestors check below) sees the finished policy rather than each
  // having to remember to expand it.
  const cspConfig = config.csp ? applyCSPPreset(config.csp) : config.csp;

  if (cspConfig) {
    validateCSPConfig(cspConfig);

    validateFramingFallback(config.frameOptions, cspConfig);

    resolvedCSP = compileCSP(cspConfig);
  }

  // One message per distinct finding for the life of the process. These come
  // from templates, which are per app and fixed, so repeating per request would
  // say nothing new.
  const reportedInlineAttributes = new Set<string>();

  const reportInlineAttributes = (
    request: FastifyRequest,
    findings: readonly InlineAttributeFinding[] | undefined,
  ): void => {
    if (!findings?.length) {
      return;
    }

    const fresh = findings.filter(
      (finding) => !reportedInlineAttributes.has(finding.description),
    );

    if (!fresh.length) {
      return;
    }

    for (const finding of fresh) {
      reportedInlineAttributes.add(finding.description);
    }

    const log = (request as Partial<FastifyRequest>).log;

    // The hash goes in the log because it is the one piece of this that cannot
    // be worked out by hand later: it covers the attribute value exactly as
    // parsed, and the value is only in hand while the template is being
    // scanned. Someone who decides to take the 'unsafe-hashes' route can paste
    // it rather than reverse-engineer it.
    log?.warn(
      {
        inlineAttributes: fresh.map((finding) => ({
          attribute: finding.description,
          directive:
            finding.kind === 'script' ? 'script-src-attr' : 'style-src-attr',
          hash: finding.hash,
        })),
      },
      "[securityHeaders] Template content carries inline attributes that this policy blocks. A hash source alone never matches an attribute: it takes 'unsafe-hashes' plus the hash of that attribute's exact value, listed above. Better fixes first: move an on* handler to an addEventListener in a script unirend already hashes, and a style=\"\" attribute into a <style> block or a class.",
    );
  };

  // Mutable so a resolver can be installed after registration. A resolver that
  // needs a database cannot run at config time, but the plugin has to register
  // early so its onRequest beats anything that might short-circuit. Keeping the
  // two separate is what lets both be true: register with a validated static
  // baseline that does no I/O, and install the real resolver once whatever it
  // depends on is ready. Requests served in between get the defaults rather
  // than an error.
  let activeResolver: SecurityHeadersResolver | undefined = config.resolve;

  // Kept exactly as written, not normalized. normalizeDomain answers "what host
  // is this", and a pattern is not a host: it turns `**.example.com` into an
  // empty string, which then matches nothing. Normalizing here cost the
  // documented `['example.com', '**.example.com']` its entire subdomain half,
  // silently, so a failed resolve on api.example.com dropped HSTS for a domain
  // the operator had just said they own. matchesDomainList takes patterns and
  // is case-insensitive on both sides, so there is nothing to do to them first.
  //
  // The request's hostname is still normalized before matching, which is the
  // side of the comparison that genuinely is a host.
  const ownDomains =
    config.ownDomains === undefined
      ? undefined
      : Array.isArray(config.ownDomains)
        ? config.ownDomains
        : [config.ownDomains];

  // Validated at startup rather than left to fail quietly at match time. An
  // entry that matches nothing is invisible in exactly the situation this
  // option exists for: the resolver is already failing, and the only symptom is
  // an HSTS header missing from a response nobody is looking at.
  if (ownDomains) {
    for (const entry of ownDomains) {
      const verdict = validateConfigEntry(entry, 'domain');

      if (!verdict.valid) {
        throw new Error(
          `Invalid securityHeaders ownDomains entry "${entry}"${verdict.info ? ': ' + verdict.info : ''}`,
        );
      }
    }
  }

  const resolvedConfig: ResolvedSecurityHeadersConfig = {
    cors: corsConfig,
    frameOptions: config.frameOptions ?? false,
    hsts: config.hsts ?? false,
    csp: resolvedCSP,
    resolveEffective: (request) =>
      resolveEffectiveConfig(
        request,
        resolvedConfig,
        activeResolver,
        // A preset is expanded first, so a resolver can return one, and then the
        // same compile step the configured policy went through runs on it. That
        // shared step is what puts unirend's own inline hashes in a resolver's
        // policy as well, and what lets a request's template hashes be folded
        // into it later.
        (csp) => compileCSP(applyCSPPreset(csp)),
        ownDomains,
      ),
  };

  const plugin = async (fastify: PluginHostInstance<UnirendServerMode>) => {
    fastify.decorateRequest(
      'applySecurityHeaders',
      async function applySecurityHeaders(
        this: FastifyRequest,
        reply: FastifyReply,
      ) {
        // Pass nothing for the origin verdict: applyCORSActualResponseHeaders
        // reads the per-request cache itself, and computes it fail-closed if
        // this raw path is the first thing to ask.
        await applyCORSActualResponseHeaders(this, reply, resolvedConfig);
      },
    );

    // Declared unconditionally, assigned per request, and left undefined when
    // the request's policy has nothing to add to.
    //
    // Its absence is a signal rather than a missing convenience: it tells the
    // SSR renderer there is no reason to hash a template's inline content,
    // which in development is real work on every request. That signal has to be
    // per request, not per server. A resolver can introduce a CSP on a server
    // configured without one, and deciding this at registration would leave
    // exactly those tenants' templates without hashes, under a policy strict enough
    // to block the very content the hashes were for.
    fastify.decorateRequest('addCSPSources', undefined);

    // Handle preflight OPTIONS requests
    fastify.addHook(
      'onRequest',
      async (request: FastifyRequest, reply: FastifyReply) => {
        // origin is undefined for same-origin and non-browser requests; all
        // branches below guard with `origin &&` or `!origin` checks accordingly.
        const origin = request.headers.origin;
        const method = request.method;

        // Resolved before anything is written, so a resolver that throws does
        // so with no headers on the reply yet, and the 500 that follows is the
        // ordinary error path rather than a half-headed response.
        const effective = await effectiveConfigFor(request, resolvedConfig);

        applyUnconditionalSecurityHeaders(request, reply, effective);

        // Installed only when this request has a policy, and bound to that
        // policy. A per-request closure rather than a shared one because the
        // policy it has to reason about is this request's, which a resolver may
        // have replaced.
        if (effective.csp) {
          const policy = effective.csp.config;

          (
            request as FastifyRequest & {
              addCSPSources?: (sources: {
                scriptSrc?: readonly string[];
                styleSrc?: readonly string[];
                inlineAttributes?: readonly InlineAttributeFinding[];
              }) => void;
              cspExtraSources?: { scriptSrc: string[]; styleSrc: string[] };
            }
          ).addCSPSources = function addCSPSources(sources) {
            const target = request as FastifyRequest & {
              cspExtraSources?: { scriptSrc: string[]; styleSrc: string[] };
            };

            target.cspExtraSources ??= { scriptSrc: [], styleSrc: [] };
            target.cspExtraSources.scriptSrc.push(...(sources.scriptSrc ?? []));
            target.cspExtraSources.styleSrc.push(...(sources.styleSrc ?? []));

            // Checked against this request's policy, not the configured one, so
            // a resolver that relaxed or tightened inline handling for a tenant
            // is what decides whether the warning is useful for them.
            //
            // Filtered per finding rather than gated as a group, because a
            // single template can report both an `onclick=` and a `style=`, and
            // a policy can easily permit one while blocking the other. Judging
            // the group by any one of them would either hide a real finding or
            // invent one.
            reportInlineAttributes(
              request,
              sources.inlineAttributes?.filter(
                (finding) => !permitsInlineAttribute(policy, finding),
              ),
            );
          };
        }

        // Decide the origin once. resolveOriginAllowed caches it on the request
        // for the onSend backstop, the hijacked-response helper, and the error
        // path, and denies rather than throwing if the callback throws.
        const isOriginAllowedResult = await resolveOriginAllowed(
          request,
          resolvedConfig.cors,
        );

        // Record that this hook reached the negotiation, so the onSend backstop
        // below knows it has nothing left to do. Anything that short-circuited
        // before this point leaves the marker unset.
        (
          request as FastifyRequest & { securityHeadersApplied?: boolean }
        ).securityHeadersApplied = true;

        // Handle preflight OPTIONS requests
        if (method === 'OPTIONS') {
          // Add Vary headers for preflight caching
          addToVaryHeader(
            reply,
            'Access-Control-Request-Headers',
            'Access-Control-Request-Method',
            'Access-Control-Request-Private-Network',
          );

          // Return 403 for disallowed origins on preflight
          if (!isOriginAllowedResult && origin) {
            reply.code(403).header('Cache-Control', 'no-store');
            return reply.send({ error: 'Origin not allowed by CORS policy' });
          }

          // Get requested headers from preflight
          const requestedHeaders = request.headers[
            'access-control-request-headers'
          ] as string;

          // Build allowed methods using Set for deduplication and normalize to uppercase
          const methodSet = new Set(
            resolvedConfig.cors.methods.map((m) => m.toUpperCase()),
          );

          const allowedMethods = Array.from(methodSet);

          // Build allowed headers (merge requested headers with configured ones)
          let allowedHeaders: string[];

          if (resolvedConfig.cors.allowedHeaders.includes('*')) {
            if (requestedHeaders) {
              // Reflect exactly what was requested (case-insensitive dedupe + cap)
              const requested = requestedHeaders
                .split(',')
                .map((h) => h.trim())
                .filter(Boolean);

              const seen = new Set<string>();
              const reflected: string[] = [];
              // RFC 7230 token validation for header names
              const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

              for (const h of requested) {
                // Enforce a maximum header token length to prevent abuse
                if (h.length > MAX_HEADER_LEN) {
                  continue;
                }

                // Only reflect syntactically valid header names
                if (!token.test(h)) {
                  continue;
                }

                const key = h.toLowerCase();

                if (!seen.has(key)) {
                  seen.add(key);
                  reflected.push(h);
                  if (reflected.length >= MAX_ALLOWED_HEADERS) {
                    break;
                  }
                }
              }

              allowedHeaders = reflected;
            } else {
              // Fallback to configured list without the '*'
              allowedHeaders = resolvedConfig.cors.allowedHeaders.filter(
                (h) => h !== '*',
              );
            }
          } else {
            // Start with configured headers
            allowedHeaders = [...resolvedConfig.cors.allowedHeaders];

            if (requestedHeaders) {
              // Merge requested headers that are in our allowed list
              const requested = requestedHeaders
                .split(',')
                .map((h) => h.trim())
                .filter(Boolean);

              const configuredLower = resolvedConfig.cors.allowedHeaders.map(
                (h) => h.toLowerCase(),
              );

              const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

              for (const requestedHeader of requested) {
                // Skip invalid header names up front
                if (
                  requestedHeader.length > MAX_HEADER_LEN ||
                  !token.test(requestedHeader)
                ) {
                  continue;
                }

                const requestedLower = requestedHeader.toLowerCase();
                if (
                  configuredLower.includes(requestedLower) &&
                  !allowedHeaders.some(
                    (h) => h.toLowerCase() === requestedLower,
                  )
                ) {
                  // Find the original configured header to preserve casing
                  const configuredHeader =
                    resolvedConfig.cors.allowedHeaders.find(
                      (h) => h.toLowerCase() === requestedLower,
                    );

                  allowedHeaders.push(configuredHeader || requestedHeader);
                }
              }
            }
          }

          // Cap to avoid sending excessive header lists
          if (allowedHeaders.length > MAX_ALLOWED_HEADERS) {
            allowedHeaders = allowedHeaders.slice(0, MAX_ALLOWED_HEADERS);
          }

          // Set preflight response headers
          reply.header(
            'Access-Control-Allow-Methods',
            allowedMethods.join(', '),
          );

          // Only set Access-Control-Allow-Headers if we have headers to send
          if (allowedHeaders.length > 0) {
            reply.header(
              'Access-Control-Allow-Headers',
              allowedHeaders.join(', '),
            );
          }

          reply.header(
            'Access-Control-Max-Age',
            resolvedConfig.cors.maxAge.toString(),
          );

          // Handle private network requests (Chrome feature)
          const requestPrivateNetwork =
            request.headers['access-control-request-private-network'];

          if (
            requestPrivateNetwork === 'true' &&
            resolvedConfig.cors.allowPrivateNetwork
          ) {
            reply.header('Access-Control-Allow-Private-Network', 'true');
          }

          if (resolvedConfig.cors.preflightContinue) {
            // Continue to route handler but set CORS headers first
            await applyCORSActualResponseHeaders(
              request,
              reply,
              resolvedConfig,
              isOriginAllowedResult,
            );

            return;
          } else {
            // Handle preflight completely here
            await applyCORSActualResponseHeaders(
              request,
              reply,
              resolvedConfig,
              isOriginAllowedResult,
            );

            reply.code(resolvedConfig.cors.optionsSuccessStatus);
            return reply.send();
          }
        }

        await applyCORSActualResponseHeaders(
          request,
          reply,
          resolvedConfig,
          isOriginAllowedResult,
        );
      },
    );

    // Backstop for responses that never reached the hook above.
    //
    // An `onRequest` hook only covers what runs after it, so a plugin listed
    // earlier in the array that ends the request produced a response with no
    // security headers at all. That covers `domainValidation`'s 403, its 400
    // for an unparseable Host, its canonical/www redirects, and any gate an
    // application registers of its own. Which responses were covered therefore
    // depended silently on the order of the plugins array.
    //
    // `onSend` runs for every reply Fastify sends, whoever sent it and whenever
    // they registered, so it makes the header set order-independent. Writes are
    // fill-if-absent, so a route that deliberately set its own value keeps it.
    // Hijacked responses bypass `onSend` entirely and are covered instead by
    // `request.applySecurityHeaders()`.
    fastify.addHook(
      'onSend',
      async (request: FastifyRequest, reply: FastifyReply, ...args) => {
        const payload = args[0];

        // The hook above may have run before `domainValidation` rejected the
        // host, in which case HSTS is already on the reply and has to come off.
        if (isHostDisclaimed(request)) {
          reply.removeHeader('Strict-Transport-Security');
        }

        // Fold in any sources contributed during the request, which for SSR is
        // the active app's template hashes. The app is chosen per request, so
        // this cannot be known at config time the way the rest of the policy is.
        const extra = (
          request as FastifyRequest & {
            cspExtraSources?: { scriptSrc: string[]; styleSrc: string[] };
          }
        ).cspExtraSources;

        if (extra) {
          // The policy in force for *this* request, which is not necessarily
          // the one configured at startup. Comparing against the startup policy
          // was the bug here: a resolver that returned its own CSP left the
          // header holding a value this check did not recognize, so the fold-in
          // was skipped and the tenant's page went out under a policy missing
          // the hashes for the very template it was about to render.
          const effective = await effectiveConfigFor(request, resolvedConfig);

          if (effective.csp) {
            // Overwrite rather than fill-if-absent, since the header is already
            // there from the early pass and the whole point is to replace it.
            // But only when it still holds the value this plugin put there: a
            // route that deliberately set its own policy keeps it, same rule as
            // everywhere else.
            if (
              reply.getHeader(effective.csp.headerName) === effective.csp.value
            ) {
              reply.header(
                effective.csp.headerName,
                buildPolicyWithSources(effective.csp, extra),
              );
            }
          }
        }

        const hasRunEarly = (
          request as FastifyRequest & { securityHeadersApplied?: boolean }
        ).securityHeadersApplied;

        if (!hasRunEarly) {
          // No verdict argument: the per-request cache is consulted inside, so
          // a decision the early hook did reach is reused rather than recomputed
          // and a callback is never invoked twice for one request.
          await applyCORSActualResponseHeaders(
            request,
            reply,
            resolvedConfig,
            undefined,
            'fill',
          );
        }

        return payload;
      },
    );

    return Promise.resolve();
  };

  /**
   * Install or replace the resolver after registration.
   *
   * The handle is the plugin value itself, which the caller already holds from
   * passing it to `plugins`, so there is nothing extra to keep track of:
   *
   * ```ts
   * const headers = securityHeaders({ hsts: { maxAge: 31536000 } });
   * const server = serveSSRBuilt(buildDir, { plugins: [headers] });
   *
   * await db.connect();
   * headers.setResolver(async (request) => lookupTenantPolicy(request));
   * ```
   */
  plugin.setResolver = (resolver: SecurityHeadersResolver | undefined) => {
    activeResolver = resolver;
  };

  return plugin;
}
