import type { PluginHostInstance, PluginOptions, ServerPlugin } from '../types';
import type { FastifyRequest } from 'fastify';
import { getDomain, getSubdomain } from 'tldts';
import {
  normalizeDomain,
  matchesDomainList,
  validateConfigEntry,
} from '../internal/domain-utils/domain-utils';
import {
  classifyRequest,
  normalizeAPIPrefix,
  normalizePageDataEndpoint,
} from '../internal/server-utils';

/**
 * Response configuration for invalid domain handler
 */
export interface InvalidDomainResponse {
  contentType: 'json' | 'text' | 'html';
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
   * Wildcard patterns supported:
   * - "example.com" - allows exact match only
   * - "*.example.com" - allows direct subdomains only (api.example.com ✅, app.api.example.com ❌)
   * - "**.example.com" - allows all subdomains including nested (api.example.com ✅, app.api.example.com ✅)
   *
   * Examples:
   * - ["example.com", "www.example.com", "api.example.com"] - specific domains
   * - ["**.example.com", "example.com"] - apex + all subdomains (including nested)
   * - ["*.example.com", "example.com"] - apex + direct subdomains only
   *
   * Note: Domain validation is protocol-agnostic (ignores http/https)
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
  wwwHandling?: 'remove' | 'add' | 'preserve';

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
   * Whether to trust proxy headers (x-forwarded-host/proto) when determining
   * the original host and protocol. Only enable this when running behind a
   * trusted proxy/load balancer that sets these headers.
   * @default false
   */
  trustProxyHeaders?: boolean;

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
 * Helper function to determine if a request URL is for an API endpoint.
 * Uses the same classifyRequest logic as the servers for consistency.
 */
function checkIfAPIEndpoint(url: string, options: PluginOptions): boolean {
  // Normalize the API prefix (handles null/undefined/empty → default, false → false)
  const apiPrefix = normalizeAPIPrefix(options.apiEndpoints?.apiEndpointPrefix);

  // If API is disabled (prefix is false), nothing is an API endpoint
  if (apiPrefix === false) {
    return false;
  }

  // Normalize the page data endpoint (for completeness, though we only need isAPI here)
  const pageDataEndpoint = normalizePageDataEndpoint(
    options.apiEndpoints?.pageDataEndpoint,
  );

  // Use the shared classifier - it handles all cases including "/" prefix
  // and strips query strings internally
  const { isAPI } = classifyRequest(url, apiPrefix, pageDataEndpoint);
  return isAPI;
}

/**
 * Helper function to safely extract protocol from headers
 */
function getProtocol(
  request: FastifyRequest,
  shouldTrustProxyHeaders: boolean,
): string {
  if (shouldTrustProxyHeaders) {
    const forwardedProto = request.headers['x-forwarded-proto'];

    if (forwardedProto) {
      // Handle comma-separated list, take first value
      const proto = Array.isArray(forwardedProto)
        ? forwardedProto[0]
        : forwardedProto.split(',')[0].trim();

      return proto.toLowerCase();
    }
  }

  // Fallback to request.protocol (accurate when Fastify trustProxy is enabled)
  return (request.protocol || 'http').toLowerCase();
}

/**
 * Helper function to safely extract host from headers (proxy-aware)
 */
function getHost(
  request: FastifyRequest,
  shouldTrustProxyHeaders: boolean,
): string {
  // Prefer x-forwarded-host only when explicitly trusted
  if (shouldTrustProxyHeaders) {
    const forwardedHost = request.headers['x-forwarded-host'];

    if (forwardedHost) {
      // Handle comma-separated list, take first value
      const host = Array.isArray(forwardedHost)
        ? forwardedHost[0]
        : forwardedHost.split(',')[0].trim();
      return host;
    }
  }

  // Fallback to standard host header
  return request.headers.host || '';
}

/**
 * Helper to parse the Host header into domain and optional port.
 * Supports bracketed IPv6 literals with optional port (e.g., "[::1]:3000").
 */
function parseHostHeader(host: string): { domain: string; port: string } {
  if (!host) {
    return { domain: '', port: '' };
  }

  if (host.startsWith('[')) {
    const end = host.indexOf(']');

    if (end !== -1) {
      const domain = host.slice(0, end + 1); // keep brackets
      const rest = host.slice(end + 1);

      if (rest.startsWith(':')) {
        return { domain, port: rest.slice(1) };
      }

      return { domain, port: '' };
    }

    // Malformed bracket - fall back to whole string as domain
    return { domain: host, port: '' };
  }

  const idx = host.indexOf(':');

  if (idx === -1) {
    return { domain: host, port: '' };
  }

  return { domain: host.slice(0, idx), port: host.slice(idx + 1) };
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
 * Domain security plugin that handles:
 * - Domain validation and canonical domain redirects
 * - HTTPS enforcement (HTTP to HTTPS redirects)
 * - WWW prefix normalization (add or remove www)
 *
 * This plugin is a no-op in development mode by default.
 */
export function domainValidation(config: DomainValidationConfig): ServerPlugin {
  return async (pluginHost: PluginHostInstance, options: PluginOptions) => {
    // Early config validation for validProductionDomains using centralized validator
    if (config.validProductionDomains) {
      const entries = Array.isArray(config.validProductionDomains)
        ? config.validProductionDomains
        : [config.validProductionDomains];

      for (const entry of entries) {
        const verdict = validateConfigEntry(entry, 'domain');

        if (!verdict.valid) {
          throw new Error(
            `Invalid domainValidation validProductionDomains entry "${entry}"${verdict.info ? ': ' + verdict.info : ''}`,
          );
        }
      }
    }

    // Register onRequest hook for domain security checks
    pluginHost.addHook('onRequest', async (request, reply) => {
      // Normalize config defaults
      const shouldSkipInDev = config.skipInDevelopment ?? true;
      const shouldEnforceHttps = config.enforceHttps ?? true;

      if (options.isDevelopment && shouldSkipInDev) {
        return; // Skip in development mode, continue to next handler
      }

      const isAPIEndpoint = checkIfAPIEndpoint(request.url, options);
      const shouldTrustProxyHeaders = !!config.trustProxyHeaders;
      const host = getHost(request, shouldTrustProxyHeaders);
      const parsed = parseHostHeader(host);
      const originalDomain = parsed.domain; // Keep original for error messages
      const domain = normalizeDomain(originalDomain);
      const port = parsed.port;
      const protocol = getProtocol(request, shouldTrustProxyHeaders);

      // Skip all validation and redirects for localhost (including IPv4/IPv6)
      if (
        domain === 'localhost' ||
        domain === '127.0.0.1' ||
        domain === '::1'
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
        const isAllowedDomain = matchesDomainList(domain, validDomains);

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
                  contentType: 'json' as const,
                  content: {
                    error: 'invalid_domain',
                    message:
                      'This domain is not authorized to access this server',
                  },
                }
              : {
                  contentType: 'text' as const,
                  content:
                    'Access denied: This domain is not authorized to access this server',
                };

          // Set appropriate content type and send response (do not cache)
          if (response.contentType === 'json') {
            reply
              .code(403)
              .header('Cache-Control', 'no-store')
              .type('application/json')
              .send(response.content);
          } else if (response.contentType === 'html') {
            reply
              .code(403)
              .header('Cache-Control', 'no-store')
              .type('text/html')
              .send(response.content);
          } else if (response.contentType === 'text') {
            reply
              .code(403)
              .header('Cache-Control', 'no-store')
              .type('text/plain')
              .send(response.content);
          }
          return;
        }
      }

      // Single redirect logic - construct final target URL once
      let shouldRedirect = false;
      let finalProtocol = protocol;
      // Build redirect host from normalized domain by default (avoid reflecting raw headers)
      let finalHost = domain; // For URL construction (may add port below)
      let finalDomain = domain; // For logic decisions (never includes port)
      let hasProtocolChanged = false;
      // Track a port part to append at assembly time (avoid mixing IPv6 colons)
      let finalPortPart = '';

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
        shouldRedirect = true;
      }

      // 2. Apply HTTPS enforcement
      if (shouldEnforceHttps && protocol === 'http') {
        finalProtocol = 'https';
        hasProtocolChanged = true;
        shouldRedirect = true;
      }

      // 3. Apply WWW handling (only for apex domains)
      const wwwMode = config.wwwHandling || 'preserve';
      if (wwwMode !== 'preserve' && isApexDomain(finalDomain)) {
        const hasWww = finalHost.startsWith('www.');
        if (wwwMode === 'add' && !hasWww) {
          finalHost = `www.${finalHost}`;
          finalDomain = `www.${finalDomain}`; // keep in sync
          shouldRedirect = true;
        } else if (wwwMode === 'remove' && hasWww) {
          finalHost = finalHost.substring(4);
          finalDomain = finalDomain.substring(4); // keep in sync
          shouldRedirect = true;
        }
      }

      // 4. Handle port preservation/stripping
      if (shouldRedirect) {
        // Always strip port if protocol changed (HTTP->HTTPS)
        // Otherwise, only preserve port if explicitly configured
        const shouldPreservePort =
          !hasProtocolChanged && config.preservePort && port;

        finalPortPart = shouldPreservePort ? `:${port}` : '';
      }

      // Perform single redirect if needed
      if (shouldRedirect) {
        // Bracket IPv6 literals in the host component; append preserved port if any
        let hostForUrl = finalHost;

        if (hostForUrl.includes(':') && !hostForUrl.startsWith('[')) {
          hostForUrl = `[${hostForUrl}]`;
        }

        const redirectUrl = `${finalProtocol}://${hostForUrl}${finalPortPart}${request.url}`;
        const statusCode = config.redirectStatusCode || 301;

        reply.code(statusCode).redirect(redirectUrl);
        return;
      }

      // Continue to next handler - no redirects needed
      return;
    });

    return Promise.resolve();
  };
}
