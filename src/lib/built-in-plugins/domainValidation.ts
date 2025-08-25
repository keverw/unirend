import type { PluginHostInstance, PluginOptions, ServerPlugin } from "../types";
import type { FastifyRequest } from "fastify";
import { getDomain, getSubdomain } from "tldts";
import { toASCII } from "punycode";

/**
 * Response configuration for invalid domain handler
 */
export interface InvalidDomainResponse {
  contentType: "json" | "text" | "html";
  content: string | object;
}

/**
 * Configuration options for the domainValidation plugin
 */
export interface DomainValidationConfig {
  /**
   * Valid production domains that are allowed to access this server
   *
   * Can be a single domain string or array of domain strings (without protocol)
   * Examples:
   * - "example.com" - allows exact match only
   * - "*.example.com" - allows any subdomain of example.com
   * - ["example.com", "www.example.com", "api.example.com"] - specific domains
   * - ["*.example.com", "example.com"] - apex + all subdomains
   *
   * If not specified, domain validation is skipped
   */
  validProductionDomains?: string | string[];

  /**
   * Optional canonical domain to redirect to if the request domain doesn't match
   * Should be defined without www prefix or protocol (use wwwHandling to control www)
   * If specified, requests to valid domains will be redirected to this canonical domain
   * If not specified, valid domains are allowed without redirection
   * Example: "example.com"
   */
  canonicalDomain?: string;

  /**
   * Whether to enforce HTTPS by redirecting HTTP requests
   * @default true
   */
  enforceHttps?: boolean;

  /**
   * How to handle www prefix normalization for apex domains only
   * - "remove": Strip www prefix (www.example.com → example.com)
   * - "add": Add www prefix (example.com → www.example.com)
   * - "preserve": Don't modify www, only validate canonical domain matches
   * Note: Only applies to apex domains, not subdomains (api.example.com stays unchanged)
   * @default "preserve"
   */
  wwwHandling?: "remove" | "add" | "preserve";

  /**
   * HTTP status code to use for redirects
   * @default 301 (permanent redirect)
   */
  redirectStatusCode?: 301 | 302 | 307 | 308;

  /**
   * Whether to preserve port numbers in canonical domain redirects
   * - true: example.com:3000 → canonical.com:3000
   * - false: example.com:3000 → canonical.com (strip port)
   * @default false
   */
  preservePort?: boolean;

  /**
   * Whether to skip all checks in development mode
   * @default true
   */
  skipInDevelopment?: boolean;

  /**
   * Optional custom handler for invalid domain responses
   * If not provided, returns a default 403 plain text or JSON error response
   * based on if detected as an API endpoint
   */
  invalidDomainHandler?: (
    request: FastifyRequest,
    domain: string,
    isDevelopment: boolean,
    isAPI: boolean,
  ) => InvalidDomainResponse;
}

/**
 * Helper function to determine if a request URL is for an API endpoint
 */
function checkIfAPIEndpoint(url: string, options: PluginOptions): boolean {
  // API server: all requests are API endpoints
  if (options.serverType === "api") {
    return true;
  }

  // SSR server: check if URL matches API prefix with proper boundary
  let apiPrefix = options.apiEndpoints?.apiEndpointPrefix ?? "/api";

  // Normalize apiPrefix to start with "/" to prevent false positives
  if (!apiPrefix.startsWith("/")) {
    apiPrefix = "/" + apiPrefix;
  }

  // Extract pathname (before query string) and normalize
  const pathname = url.split("?")[0];

  // Exact match or followed by "/"
  return pathname === apiPrefix || pathname.startsWith(apiPrefix + "/");
}

/**
 * Helper function to safely extract protocol from headers
 */
function getProtocol(request: FastifyRequest): string {
  const forwardedProto = request.headers["x-forwarded-proto"];

  if (forwardedProto) {
    // Handle comma-separated list, take first value
    const proto = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto.split(",")[0].trim();

    return proto.toLowerCase();
  }

  // Fallback to request.protocol (only accurate with trustProxy)
  return (request.protocol || "http").toLowerCase();
}

/**
 * Helper function to normalize domain names for consistent comparison
 * Handles trim, lowercase, and punycode conversion for IDN safety
 */
function normalizeDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase();

  try {
    // Convert IDN to ASCII using punycode for safe comparison
    return toASCII(trimmed);
  } catch {
    // If punycode conversion fails, return the trimmed/lowercased version
    return trimmed;
  }
}

/**
 * Helper function to safely extract host from headers (proxy-aware)
 */
function getHost(request: FastifyRequest): string {
  // Prefer x-forwarded-host for proxy environments
  const forwardedHost = request.headers["x-forwarded-host"];

  if (forwardedHost) {
    // Handle comma-separated list, take first value
    const host = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost.split(",")[0].trim();
    return host;
  }

  // Fallback to standard host header
  return request.headers.host || "";
}

/**
 * Helper function to check if domain is apex (no subdomain)
 * Uses tldts to properly handle multi-part TLDs like .co.uk
 */
function isApexDomain(domain: string): boolean {
  // Use tldts to properly detect apex domains vs subdomains
  // This correctly handles multi-part TLDs like .co.uk, .com.au, etc.
  const parsedDomain = getDomain(domain);
  const subdomain = getSubdomain(domain);

  // Guard against null returns from tldts for invalid hosts
  if (!parsedDomain) {
    return false;
  }

  // Domain is apex if it matches the parsed domain and has no subdomain
  return parsedDomain === domain && !subdomain;
}

/**
 * Helper function for secure domain validation
 * Supports exact matches and wildcard subdomains (*.example.com)
 * Case insensitive with whitespace normalization
 */
function isDomainAllowed(domain: string, allowedDomains: string[]): boolean {
  // Normalize request domain
  const normalizedDomain = normalizeDomain(domain);

  return allowedDomains.some((allowed) => {
    // Normalize allowed domain
    const normalizedAllowed = normalizeDomain(allowed);

    // Exact match
    if (normalizedDomain === normalizedAllowed) {
      return true;
    }

    // Wildcard subdomain match (*.example.com)
    if (normalizedAllowed.startsWith("*.")) {
      const baseDomain = normalizedAllowed.substring(2); // Remove "*."
      return normalizedDomain.endsWith("." + baseDomain);
    }

    // No implicit subdomain matching for non-wildcard entries
    return false;
  });
}

/**
 * Domain security plugin that handles:
 * - Domain validation and canonical domain redirects
 * - HTTPS enforcement (HTTP to HTTPS redirects)
 * - WWW prefix normalization (add or remove www)
 *
 * This plugin is a no-op in development mode by default.
 */
export function domainValidation(config: DomainValidationConfig): ServerPlugin {
  return async (pluginHost: PluginHostInstance, options: PluginOptions) => {
    // Register onRequest hook for domain security checks
    pluginHost.addHook("onRequest", async (request, reply) => {
      // Normalize config defaults
      const skipInDev = config.skipInDevelopment ?? true;
      const enforceHttps = config.enforceHttps ?? true;

      if (options.isDevelopment && skipInDev) {
        return; // Skip in development mode, continue to next handler
      }

      const isAPIEndpoint = checkIfAPIEndpoint(request.url, options);
      const host = getHost(request);
      const originalDomain = host.split(":")[0]; // Keep original for error messages
      const domain = normalizeDomain(originalDomain);
      const port = host.includes(":") ? host.split(":")[1] : "";
      const protocol = getProtocol(request);

      // Skip all validation and redirects for localhost (including IPv4/IPv6)
      if (
        domain === "localhost" ||
        domain === "127.0.0.1" ||
        domain === "::1"
      ) {
        return;
      }

      // Domain validation check (only if validProductionDomains is configured)
      if (config.validProductionDomains) {
        // Normalize validProductionDomains to array
        const validDomains = Array.isArray(config.validProductionDomains)
          ? config.validProductionDomains
          : [config.validProductionDomains];

        // Validate domain using secure check
        const isAllowedDomain = isDomainAllowed(domain, validDomains);

        if (!isAllowedDomain) {
          // Use custom handler if provided, otherwise use default response
          const response = config.invalidDomainHandler
            ? config.invalidDomainHandler(
                request,
                originalDomain, // Pass original domain for human-friendly messages
                options.isDevelopment,
                isAPIEndpoint,
              )
            : isAPIEndpoint
              ? {
                  contentType: "json" as const,
                  content: {
                    error: "invalid_domain",
                    message:
                      "This domain is not authorized to access this server",
                  },
                }
              : {
                  contentType: "text" as const,
                  content:
                    "Access denied: This domain is not authorized to access this server",
                };

          // Set appropriate content type and send response
          if (response.contentType === "json") {
            reply.code(403).type("application/json").send(response.content);
          } else if (response.contentType === "html") {
            reply.code(403).type("text/html").send(response.content);
          } else if (response.contentType === "text") {
            reply.code(403).type("text/plain").send(response.content);
          }
          return;
        }
      }

      // Single redirect logic - construct final target URL once
      let needsRedirect = false;
      let finalProtocol = protocol;
      let finalHost = host; // For URL construction (can include port)
      let finalDomain = domain; // For logic decisions (never includes port)
      let protocolChanged = false;

      // Note: We maintain both finalHost and finalDomain separately because:
      // - finalHost: Used for final URL construction, may include port
      // - finalDomain: Used for logic decisions (apex detection), never has port
      // Memory is cheap compared to CPU - avoiding repeated string splitting/parsing

      // 1. Check if we need canonical domain redirect
      const normalizedCanonical = config.canonicalDomain
        ? normalizeDomain(config.canonicalDomain)
        : undefined;
      if (normalizedCanonical && domain !== normalizedCanonical) {
        finalDomain = normalizedCanonical;
        finalHost = normalizedCanonical;
        needsRedirect = true;
      }

      // 2. Apply HTTPS enforcement
      if (enforceHttps && protocol === "http") {
        finalProtocol = "https";
        protocolChanged = true;
        needsRedirect = true;
      }

      // 3. Apply WWW handling (only for apex domains)
      const wwwMode = config.wwwHandling || "preserve";
      if (wwwMode !== "preserve" && isApexDomain(finalDomain)) {
        const hasWww = finalHost.startsWith("www.");
        if (wwwMode === "add" && !hasWww) {
          finalHost = `www.${finalHost}`;
          finalDomain = `www.${finalDomain}`; // keep in sync
          needsRedirect = true;
        } else if (wwwMode === "remove" && hasWww) {
          finalHost = finalHost.substring(4);
          finalDomain = finalDomain.substring(4); // keep in sync
          needsRedirect = true;
        }
      }

      // 4. Handle port preservation/stripping
      if (needsRedirect) {
        // Always strip port if protocol changed (HTTP->HTTPS)
        // Otherwise, only preserve port if explicitly configured
        const shouldPreservePort =
          !protocolChanged && config.preservePort && port;

        if (shouldPreservePort) {
          finalHost = finalHost.includes(":")
            ? finalHost
            : `${finalHost}:${port}`;
        } else {
          // Strip port - ensure finalHost doesn't have one
          finalHost = finalHost.split(":")[0];
        }
      }

      // Perform single redirect if needed
      if (needsRedirect) {
        const redirectUrl = `${finalProtocol}://${finalHost}${request.url}`;
        const statusCode = config.redirectStatusCode || 301;

        reply.code(statusCode).redirect(redirectUrl);
        return;
      }

      // Continue to next handler - no redirects needed
      return;
    });
  };
}
