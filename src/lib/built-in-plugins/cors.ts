import type { FastifyRequest, FastifyReply } from "fastify";
import type { ServerPlugin, PluginHostInstance } from "../types";
import {
  matchesOriginList,
  matchesCORSCredentialsList,
  validateConfigEntry,
} from "../internal/domain-utils/domain-utils";

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
 * Configuration for dynamic CORS handling
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

  /**
   * Controls the X-Frame-Options response header.
   * - false: do not send the header (default)
   * - "DENY" | "SAMEORIGIN": header value to send
   *
   * @default false
   */
  xFrameOptions?: false | "DENY" | "SAMEORIGIN";

  /**
   * Controls the Strict-Transport-Security (HSTS) response header.
   * - false: do not send the header (default)
   * - { maxAge, includeSubDomains?, preload? }: header parameters
   *
   * Note: HSTS is typically only appropriate over HTTPS in production.
   * This plugin does not inspect the connection security; enable with care.
   *
   * @default false
   */
  hsts?:
    | false
    | {
        maxAge: number; // seconds
        includeSubDomains?: boolean;
        preload?: boolean;
      };
}

/**
 * Default CORS configuration
 */
const DEFAULT_CONFIG: Required<Omit<CORSConfig, "credentials" | "origin">> & {
  origin: CORSOrigin;
  credentials: boolean;
} = {
  origin: "*",
  credentials: false,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: [],
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  allowPrivateNetwork: false,
  credentialsAllowWildcardSubdomains: false,
  allowCredentialsWithProtocolWildcard: false,
  xFrameOptions: false,
  hsts: false,
};

// Limit how many headers we reflect/allow on preflight to avoid abuse
const MAX_ALLOWED_HEADERS = 100;

// Limit the length of each reflected header name to avoid pathological values
const MAX_HEADER_LEN = 256;

/**
 * Validate credentials origins using centralized validateConfigEntry
 */
function validateCredentialsOrigins(
  creds: string[],
  allowWildcard: boolean,
): void {
  for (const o of creds) {
    // Never allow credentials for the special "null" origin
    if (o === "null") {
      throw new Error(
        "Invalid CORS config: credentials cannot be enabled for the 'null' origin. Remove 'null' from the credentials list.",
      );
    }

    // Use validateConfigEntry to get comprehensive validation
    const verdict = validateConfigEntry(o, "origin", {
      allowGlobalWildcard: false, // Never allow global wildcard in credentials
      allowProtocolWildcard: false, // Never allow protocol wildcards in credentials
    });

    if (!verdict.valid) {
      throw new Error(
        `Invalid CORS credentials origin "${o}"${verdict.info ? ": " + verdict.info : ""}`,
      );
    }

    // Use wildcardKind from validateConfigEntry to determine policy
    if (verdict.wildcardKind === "global") {
      throw new Error(
        `Global wildcard "${o}" is not allowed in credentials. Use specific origins or subdomain patterns like "*.example.com".`,
      );
    }

    if (verdict.wildcardKind === "protocol") {
      throw new Error(
        `Protocol wildcard "${o}" is not allowed in credentials. Use domain patterns like "*.example.com" or "**.example.com".`,
      );
    }

    if (verdict.wildcardKind === "subdomain" && !allowWildcard) {
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
  if (typeof originConfig === "string") {
    // Delegate to list matcher for uniform handling (exact, wildcard, protocol wildcard, and "*")
    return matchesOriginList(origin, [originConfig]);
  }

  if (Array.isArray(originConfig)) {
    return matchesOriginList(origin, originConfig);
  }

  if (typeof originConfig === "function") {
    return await originConfig(origin, request);
  }

  return false;
}

/**
 * Check if credentials are allowed for an origin
 */
async function areCredentialsAllowed(
  origin: string | undefined,
  credentialsConfig: CORSConfig["credentials"],
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

  if (typeof credentialsConfig === "function") {
    return await credentialsConfig(origin, request);
  }

  return false;
}

/**
 * Helper to add values to Vary header without duplicates
 */
// addToVaryHeader: safer header read
function addToVaryHeader(reply: FastifyReply, ...values: string[]): void {
  const existing = reply.getHeader("Vary");
  const current = Array.isArray(existing)
    ? existing.join(", ")
    : ((existing ?? "") as string);

  const vary = new Set(
    current
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  );

  for (const v of values) {
    vary.add(v);
  }

  reply.header("Vary", Array.from(vary).join(", "));
}

/**
 * Dynamic CORS plugin for Unirend
 *
 * Provides more flexible CORS handling than @fastify/cors, specifically:
 * - Dynamic credentials based on origin
 * - Function-based origin validation
 * - Separate credential and origin policies
 *
 * @example
 * ```typescript
 * // Allow public API access but only credentials for trusted origins
 * cors({
 *   origin: "*", // Allow any origin for public API
 *   credentials: ["https://myapp.com", "https://admin.myapp.com"], // Only these can send cookies
 *   methods: ["GET", "POST"],
 * })
 *
 * // Handle "null" origins from sandboxed documents or file:// URLs
 * cors({
 *   origin: ["https://app.com", "null"], // Explicitly allow null origins
 *   credentials: ["https://app.com"], // Credentials not allowed for null origins
 * })
 *
 * // Dynamic validation based on request
 * cors({
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
export function cors(config: CORSConfig = {}): ServerPlugin {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };

  // Config-time validations:
  // - Origin '*' special handling:
  //   - Disallow credentials: true (spec prohibits ACA-C: true with ACA-O: *)
  //   - Disallow dynamic credentials function (avoid reflect+creds footgun)
  //   - If credentials is a string[] allowlist, validate and upgrade origin to that list
  // - Origin arrays are validated using validateConfigEntry (domain-utils) plus policy:
  //   - Allow at most one wildcard token ('*' or a protocol wildcard)
  //   - If a wildcard token is present, the only other allowed entry is 'null' string literal
  // Credentials policy highlights:
  //   - Never allow credentials for the literal 'null' origin
  //   - Disallow global/protocol wildcards in credentials allowlists
  //   - Allow subdomain wildcards in credentials only when credentialsAllowWildcardSubdomains: true

  if (resolvedConfig.origin === "*" && resolvedConfig.credentials === true) {
    throw new Error(
      "Cannot use credentials: true with origin: '*'. The CORS specification prohibits Access-Control-Allow-Credentials: true with Access-Control-Allow-Origin: *. Use specific origins instead.",
    );
  }

  // Guard: credentials: true with protocol wildcard (e.g., https://*) is high risk.
  // Require explicit opt-in via allowCredentialsWithProtocolWildcard: true
  if (resolvedConfig.credentials === true) {
    const hasProtocolWildcard = (value: CORSOrigin): boolean => {
      if (typeof value === "string") {
        return value === "https://*" || value === "http://*";
      }

      if (Array.isArray(value)) {
        return value.some((v) => v === "https://*" || v === "http://*");
      }

      return false; // functions are evaluated per-request; not considered a blanket wildcard here
    };

    if (
      hasProtocolWildcard(resolvedConfig.origin) &&
      !resolvedConfig.allowCredentialsWithProtocolWildcard
    ) {
      throw new Error(
        "Cannot use credentials: true with protocol wildcard origins unless allowCredentialsWithProtocolWildcard: true. Use specific origins instead.",
      );
    }
  }

  // Additional guard: prevent reflect+creds when origin is '*'
  if (resolvedConfig.origin === "*") {
    // Dynamic function with '*' would enable reflecting arbitrary origins with creds
    if (typeof resolvedConfig.credentials === "function") {
      throw new Error(
        "Unsafe CORS: cannot combine origin '*' with dynamic credentials. Use a concrete origin list when enabling credentials.",
      );
    }

    // If credentials is an allowlist, validate and upgrade origin to that list
    if (Array.isArray(resolvedConfig.credentials)) {
      validateCredentialsOrigins(
        resolvedConfig.credentials,
        resolvedConfig.credentialsAllowWildcardSubdomains,
      );

      const allowlist = Array.from(new Set(resolvedConfig.credentials));
      if (allowlist.length === 0) {
        throw new Error(
          "Invalid CORS config: credentials list is empty; cannot combine origin '*' with credentials.",
        );
      }
      // Upgrade: stop using '*' and switch to a concrete allowlist for origin
      resolvedConfig.origin = allowlist;
      // Keep origin and credentials aligned to reduce misconfiguration
      resolvedConfig.credentials = allowlist;
    }
  }

  // Validate credentials wildcard patterns
  if (Array.isArray(resolvedConfig.credentials)) {
    validateCredentialsOrigins(
      resolvedConfig.credentials,
      resolvedConfig.credentialsAllowWildcardSubdomains,
    );
  }

  // Validate origin entries using centralized validator with appropriate wildcard policies
  if (typeof resolvedConfig.origin === "string") {
    if (resolvedConfig.origin !== "*") {
      const verdict = validateConfigEntry(resolvedConfig.origin, "origin", {
        allowGlobalWildcard: false, // Global wildcard handled separately above
        allowProtocolWildcard: true, // Allow protocol wildcards in origin
      });

      if (!verdict.valid) {
        throw new Error(
          `Invalid CORS origin "${resolvedConfig.origin}"${verdict.info ? ": " + verdict.info : ""}`,
        );
      }
    }
  } else if (Array.isArray(resolvedConfig.origin)) {
    const entries = resolvedConfig.origin as string[];
    // Normalize ["*"] to "*"
    const unique = Array.from(new Set(entries));
    if (unique.length === 1 && unique[0] === "*") {
      resolvedConfig.origin = "*";
    } else {
      // Special policy: '*' inside an array is only allowed when paired solely with 'null'
      if (entries.includes("*")) {
        const onlyStarAndNull = entries.every((e) => e === "*" || e === "null");
        if (!onlyStarAndNull) {
          throw new Error(
            "Invalid CORS config: Do not include '*' inside an origin array. Use origin: '*' (string) to allow all, or list specific origins.",
          );
        }
      }

      let wildcardKindSeen: "none" | "global" | "protocol" = "none";
      const wildcardTokensSeen: string[] = [];

      for (const o of entries) {
        // Use centralized validator to classify
        const verdict = validateConfigEntry(o, "origin", {
          allowGlobalWildcard: true,
          allowProtocolWildcard: true,
        });
        if (!verdict.valid) {
          throw new Error(
            `Invalid CORS origin "${o}"${verdict.info ? ": " + verdict.info : ""}`,
          );
        }
        if (
          verdict.wildcardKind === "global" ||
          verdict.wildcardKind === "protocol"
        ) {
          const token = verdict.wildcardKind === "global" ? "*" : o;
          if (wildcardTokensSeen.length > 0) {
            if (wildcardTokensSeen.includes(token)) {
              // Duplicate of the same wildcard token
              throw new Error(
                "Invalid CORS config: only one of '*', 'https://*', or 'http://*' may be specified in origin.",
              );
            }
            // Multiple distinct wildcard tokens – include exact list in error
            const foundList = wildcardTokensSeen.concat(token).join(", ");
            throw new Error(
              `Invalid CORS config: only one of '*', 'https://*', or 'http://*' may be specified in origin. Found: ${foundList}`,
            );
          }

          wildcardTokensSeen.push(token);
          wildcardKindSeen = verdict.wildcardKind;
          continue;
        }

        if (o === "null") {
          continue;
        }

        // Non-wildcard, non-null entries
        if (wildcardKindSeen !== "none") {
          throw new Error(
            "Invalid CORS config: when a wildcard token is present, the only other allowed entry is the literal 'null'.",
          );
        }
      }

      // Additional safety: if a global '*' token is present inside the origin array,
      // disallow credentials: true and dynamic credentials function to avoid
      // reflecting arbitrary origins with credentials.
      if (entries.includes("*")) {
        if (resolvedConfig.credentials === true) {
          throw new Error(
            "Cannot use credentials: true when origin array contains '*'. Use specific origins instead or remove credentials: true.",
          );
        }
        if (typeof resolvedConfig.credentials === "function") {
          throw new Error(
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
    Array.isArray(resolvedConfig.credentials) &&
    Array.isArray(resolvedConfig.origin)
  ) {
    // Merge credentials origins into origin list to ensure they're allowed for CORS
    const credentialsOrigins = resolvedConfig.credentials;
    const existingOrigins = resolvedConfig.origin;
    const mergedOrigins = [
      ...new Set([...existingOrigins, ...credentialsOrigins]),
    ];
    resolvedConfig.origin = mergedOrigins;
  } else if (
    Array.isArray(resolvedConfig.credentials) &&
    typeof resolvedConfig.origin === "string" &&
    resolvedConfig.origin !== "*"
  ) {
    // Convert single origin to array and merge with credentials origins
    const credentialsOrigins = resolvedConfig.credentials;
    const mergedOrigins = [
      ...new Set([resolvedConfig.origin, ...credentialsOrigins]),
    ];
    resolvedConfig.origin = mergedOrigins;
  }

  // Validate security header options at config-time
  if (resolvedConfig.hsts) {
    const cfg = resolvedConfig.hsts;

    if (
      typeof cfg.maxAge !== "number" ||
      !Number.isFinite(cfg.maxAge) ||
      cfg.maxAge < 0
    ) {
      throw new Error(
        "Invalid CORS config: hsts.maxAge must be a non-negative number (seconds)",
      );
    }

    // When requesting HSTS preload, enforce Chrome preload list requirements:
    // - max-age must be at least 31536000 (1 year)
    // - includeSubDomains must be present
    if (cfg.preload) {
      if (cfg.maxAge < 31536000) {
        throw new Error(
          "Invalid CORS config: HSTS preload requires maxAge >= 31536000 (1 year)",
        );
      }

      if (!cfg.includeSubDomains) {
        throw new Error(
          "Invalid CORS config: HSTS preload requires includeSubDomains: true",
        );
      }
    }
  }

  return async (fastify: PluginHostInstance) => {
    // Handle preflight OPTIONS requests
    fastify.addHook(
      "onRequest",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const origin = request.headers.origin;
        const method = request.method;

        // Always add Vary: Origin when we might echo an origin
        addToVaryHeader(reply, "Origin");

        // Security headers (applied for all requests early in lifecycle)
        if (resolvedConfig.xFrameOptions) {
          reply.header("X-Frame-Options", resolvedConfig.xFrameOptions);
        }

        if (resolvedConfig.hsts) {
          const parts = [`max-age=${Math.floor(resolvedConfig.hsts.maxAge)}`];

          if (resolvedConfig.hsts.includeSubDomains) {
            parts.push("includeSubDomains");
          }

          if (resolvedConfig.hsts.preload) {
            parts.push("preload");
          }

          reply.header("Strict-Transport-Security", parts.join("; "));
        }

        // Check if origin is allowed and cache result on request
        const originAllowed = await isOriginAllowed(
          origin,
          resolvedConfig.origin,
          request,
        );

        // Cache the result to avoid recomputing in onSend hook
        (
          request as FastifyRequest & { corsOriginAllowed?: boolean }
        ).corsOriginAllowed = originAllowed;

        // Handle preflight OPTIONS requests
        if (method === "OPTIONS") {
          // Add Vary headers for preflight caching
          addToVaryHeader(
            reply,
            "Access-Control-Request-Headers",
            "Access-Control-Request-Method",
            "Access-Control-Request-Private-Network",
          );

          // Return 403 for disallowed origins on preflight
          if (!originAllowed && origin) {
            reply.code(403).header("Cache-Control", "no-store");
            return reply.send({ error: "Origin not allowed by CORS policy" });
          }

          // Get requested headers from preflight
          const requestedHeaders = request.headers[
            "access-control-request-headers"
          ] as string;

          // Build allowed methods using Set for deduplication and normalize to uppercase
          const methodSet = new Set(
            resolvedConfig.methods.map((m) => m.toUpperCase()),
          );

          const allowedMethods = Array.from(methodSet);

          // Build allowed headers (merge requested headers with configured ones)
          let allowedHeaders: string[];

          if (resolvedConfig.allowedHeaders.includes("*")) {
            if (requestedHeaders) {
              // Reflect exactly what was requested (case-insensitive dedupe + cap)
              const requested = requestedHeaders
                .split(",")
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
              allowedHeaders = resolvedConfig.allowedHeaders.filter(
                (h) => h !== "*",
              );
            }
          } else {
            // Start with configured headers
            allowedHeaders = [...resolvedConfig.allowedHeaders];

            if (requestedHeaders) {
              // Merge requested headers that are in our allowed list
              const requested = requestedHeaders
                .split(",")
                .map((h) => h.trim())
                .filter(Boolean);

              const configuredLower = resolvedConfig.allowedHeaders.map((h) =>
                h.toLowerCase(),
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
                  const configuredHeader = resolvedConfig.allowedHeaders.find(
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
            "Access-Control-Allow-Methods",
            allowedMethods.join(", "),
          );

          // Only set Access-Control-Allow-Headers if we have headers to send
          if (allowedHeaders.length > 0) {
            reply.header(
              "Access-Control-Allow-Headers",
              allowedHeaders.join(", "),
            );
          }

          reply.header(
            "Access-Control-Max-Age",
            resolvedConfig.maxAge.toString(),
          );

          // Handle private network requests (Chrome feature)
          const requestPrivateNetwork =
            request.headers["access-control-request-private-network"];

          if (
            requestPrivateNetwork === "true" &&
            resolvedConfig.allowPrivateNetwork
          ) {
            reply.header("Access-Control-Allow-Private-Network", "true");
          }

          if (resolvedConfig.preflightContinue) {
            // Continue to route handler but set CORS headers first
            if (origin && originAllowed) {
              reply.header("Access-Control-Allow-Origin", origin);
              const credentialsAllowed = await areCredentialsAllowed(
                origin,
                resolvedConfig.credentials,
                request,
                resolvedConfig.credentialsAllowWildcardSubdomains,
              );

              if (credentialsAllowed) {
                // Never send credentials for the special 'null' origin
                if (origin !== "null") {
                  reply.header("Access-Control-Allow-Credentials", "true");
                }
              }
            } else if (!origin && resolvedConfig.origin === "*") {
              reply.header("Access-Control-Allow-Origin", "*");
            }
            return;
          } else {
            // Handle preflight completely here
            if (origin && originAllowed) {
              reply.header("Access-Control-Allow-Origin", origin);
              const credentialsAllowed = await areCredentialsAllowed(
                origin,
                resolvedConfig.credentials,
                request,
                resolvedConfig.credentialsAllowWildcardSubdomains,
              );
              if (credentialsAllowed) {
                // Never send credentials for the special 'null' origin
                if (origin !== "null") {
                  reply.header("Access-Control-Allow-Credentials", "true");
                }
              }
            } else if (!origin && resolvedConfig.origin === "*") {
              reply.header("Access-Control-Allow-Origin", "*");
            }

            reply.code(resolvedConfig.optionsSuccessStatus);
            return reply.send();
          }
        }

        // For non-preflight requests, let them proceed without CORS headers if origin not allowed
        // This allows same-origin requests to work while cross-origin fails in the browser
        if (!originAllowed && origin) {
          // Don't set CORS headers, let browser handle the CORS failure
          return;
        }

        // Set Access-Control-Allow-Origin header for actual requests
        if (origin && originAllowed) {
          // Echo the specific origin that was validated (not the full list)
          reply.header("Access-Control-Allow-Origin", origin);

          // Only set credentials when origin is present and allowed
          const credentialsAllowed = await areCredentialsAllowed(
            origin,
            resolvedConfig.credentials,
            request,
            resolvedConfig.credentialsAllowWildcardSubdomains,
          );
          if (credentialsAllowed) {
            // Never send credentials for the special 'null' origin
            if (origin !== "null") {
              reply.header("Access-Control-Allow-Credentials", "true");
            }
          }
        } else if (!origin && resolvedConfig.origin === "*") {
          // No origin header and wildcard allowed - set * but never credentials
          reply.header("Access-Control-Allow-Origin", "*");
          // Never set credentials with * origin
        }
      },
    );

    // Add exposed headers to actual responses
    if (resolvedConfig.exposedHeaders.length > 0) {
      fastify.addHook(
        "onSend",
        async (request: FastifyRequest, reply: FastifyReply) => {
          const origin = request.headers.origin;
          // Use cached result from onRequest hook to avoid recomputing
          const originAllowed =
            (request as FastifyRequest & { corsOriginAllowed?: boolean })
              .corsOriginAllowed ??
            (await isOriginAllowed(origin, resolvedConfig.origin, request));

          // Only add exposed headers if origin is allowed and present
          if (origin && originAllowed) {
            // Ensure Vary: Origin is set for non-preflight responses too
            addToVaryHeader(reply, "Origin");

            reply.header(
              "Access-Control-Expose-Headers",
              resolvedConfig.exposedHeaders.join(", "),
            );
          }
        },
      );
    }
  };
}
