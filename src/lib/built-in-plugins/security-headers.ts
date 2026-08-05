import type { FastifyRequest, FastifyReply } from 'fastify';
import type {
  ServerPlugin,
  PluginHostInstance,
  UnirendServerMode,
} from '../types';
import {
  matchesOriginList,
  matchesCORSCredentialsList,
  validateConfigEntry,
} from 'lifecycleion/domain-utils';
import { addToVaryHeader } from '../internal/http-header-utils';

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

type ResolvedSecurityHeadersConfig = {
  cors: ResolvedCORSConfig;
  frameOptions: false | 'DENY' | 'SAMEORIGIN';
  hsts: false | HSTSConfig;
};

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
  const isAllowed =
    isOriginAllowedResult ??
    (await isOriginAllowed(origin, cors.origin, request));

  // Apply the unconditional security/Vary headers first, then layer the
  // origin-negotiated CORS headers on top if this request is allowed.
  applyUnconditionalSecurityHeaders(request, reply, resolvedConfig, mode);

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

    const isCredentialsAllowed = await areCredentialsAllowed(
      origin,
      cors.credentials,
      request,
      cors.credentialsAllowWildcardSubdomains,
    );

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
): ServerPlugin<UnirendServerMode> {
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
    const cfg = config.hsts;

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

  // Assemble the validated blocks into the shape the request-time helpers read.
  // Keeping CORS in its own block means a future per-request override can
  // replace one block without touching the others.
  const resolvedConfig: ResolvedSecurityHeadersConfig = {
    cors: corsConfig,
    frameOptions: config.frameOptions ?? false,
    hsts: config.hsts ?? false,
  };

  return async (fastify: PluginHostInstance<UnirendServerMode>) => {
    fastify.decorateRequest(
      'applySecurityHeaders',
      async function applySecurityHeaders(
        this: FastifyRequest,
        reply: FastifyReply,
      ) {
        const isOriginAllowedCached = (
          this as FastifyRequest & { corsOriginAllowed?: boolean }
        ).corsOriginAllowed;

        await applyCORSActualResponseHeaders(
          this,
          reply,
          resolvedConfig,
          isOriginAllowedCached,
        );
      },
    );

    // Handle preflight OPTIONS requests
    fastify.addHook(
      'onRequest',
      async (request: FastifyRequest, reply: FastifyReply) => {
        // origin is undefined for same-origin and non-browser requests; all
        // branches below guard with `origin &&` or `!origin` checks accordingly.
        const origin = request.headers.origin;
        const method = request.method;

        applyUnconditionalSecurityHeaders(request, reply, resolvedConfig);

        // Check if origin is allowed and cache result on request
        const isOriginAllowedResult = await isOriginAllowed(
          origin,
          resolvedConfig.cors.origin,
          request,
        );

        // Cache the result to avoid recomputing in onSend hook
        (
          request as FastifyRequest & { corsOriginAllowed?: boolean }
        ).corsOriginAllowed = isOriginAllowedResult;

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

        const requestWithMarkers = request as FastifyRequest & {
          securityHeadersApplied?: boolean;
          corsOriginAllowed?: boolean;
        };

        if (!requestWithMarkers.securityHeadersApplied) {
          await applyCORSActualResponseHeaders(
            request,
            reply,
            resolvedConfig,
            requestWithMarkers.corsOriginAllowed,
            'fill',
          );
        }

        return payload;
      },
    );

    return Promise.resolve();
  };
}
