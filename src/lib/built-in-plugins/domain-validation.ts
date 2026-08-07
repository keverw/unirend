import type {
  PluginHostInstance,
  PluginOptions,
  ServerPlugin,
  UnirendServerMode,
} from '../types';
import type { FastifyRequest } from 'fastify';
import {
  normalizeDomain,
  matchesDomainList,
  isApexDomain,
  validateConfigEntry,
  parseHostHeader,
} from 'lifecycleion/domain-utils';
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
 * Domain validation configuration - can be a string, array, or function
 */
export type ValidProductionDomains =
  | string
  | string[]
  | ((domain: string, request: FastifyRequest) => boolean | Promise<boolean>);

/**
 * Configuration options for the domainValidation plugin
 */
export interface DomainValidationConfig {
  /**
   * Valid production domains that are allowed to access this server
   *
   * Can be a single domain string, array of domain strings (without protocol),
   * or a function for request-aware domain validation.
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
  validProductionDomains?: ValidProductionDomains;

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
  enforceHTTPS?: boolean;

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
function checkIfAPIEndpoint(
  url: string,
  options: PluginOptions<UnirendServerMode>,
): boolean {
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
 * Report a user callback that threw.
 *
 * Read defensively because a failure to log must never become the thing that
 * breaks the response we are in the middle of rescuing.
 */
function logCallbackError(
  request: FastifyRequest,
  error: unknown,
  message: string,
): void {
  const log = (request as Partial<FastifyRequest>).log;
  log?.error({ err: error }, `[domainValidation] ${message}`);
}

/**
 * Publish on the request that this host is not one the server claims.
 *
 * Set when the host fails the allow list, and also when the Host header is
 * missing or unparseable, where the host is unknown rather than merely wrong.
 * Only this plugin can know that, so it states the fact and leaves the
 * consequences to whoever cares. `securityHeaders` reads it to suppress HSTS,
 * since promising a browser that a domain is HTTPS-only right after declaring
 * the domain is not ours binds it for the full max-age with no way back.
 *
 * Deliberately not keyed on the 403 status: an application's own authorization
 * failure, on a domain the server does serve, is a different thing entirely and
 * should keep every header a normal response gets.
 */
function markHostDisclaimed(request: FastifyRequest): void {
  request.domainValidationRejected = true;
}

/**
 * Domain security plugin that handles:
 * - Domain validation and canonical domain redirects
 * - HTTPS enforcement (HTTP to HTTPS redirects)
 * - WWW prefix normalization (add or remove www)
 *
 * This plugin is a no-op in development mode by default.
 */
export function domainValidation(
  config: DomainValidationConfig,
): ServerPlugin<UnirendServerMode> {
  return async (
    pluginHost: PluginHostInstance<UnirendServerMode>,
    options: PluginOptions<UnirendServerMode>,
  ) => {
    // Early config validation for validProductionDomains using centralized validator
    if (
      config.validProductionDomains &&
      typeof config.validProductionDomains !== 'function'
    ) {
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

    // Published at registration so an unset `domainValidationChecked` can be
    // read for what it is. On its own that flag cannot distinguish "this server
    // does not validate hosts" from "it does, and the request died before the
    // check", which are opposite situations for anything deciding how much to
    // reveal on an error page.
    pluginHost.decorate('domainValidationRegistered', true);

    // Register onRequest hook for domain security checks
    pluginHost.addHook('onRequest', async (request, reply) => {
      // Every path that answers the request returns `reply`, and in an async
      // hook that is not a stylistic choice. Fastify advances the lifecycle
      // when an async hook resolves, and it only stops early if the resolved
      // value is the reply, so returning `undefined` after `reply.send()` sent
      // the response *and then carried on running the remaining onRequest
      // hooks*. A gate that does not gate is the one thing this plugin must
      // not be: every hook registered below it still ran on a request that had
      // already been refused, doing whatever work they do, and the first of
      // them to touch the reply produced an ERR_HTTP_HEADERS_SENT deep in
      // Fastify's error handling rather than anywhere that named this plugin.
      //
      // First statement in the hook, deliberately. This records that the host
      // was examined, not what the examination found, so it stays true for a
      // pass, a rejection, a redirect, and a validator that failed. Anything
      // that ends the request before this point leaves it unset, which is the
      // signal that the host reaching a later handler was never checked.
      request.domainValidationChecked = true;

      // Normalize config defaults
      const shouldSkipInDev = config.skipInDevelopment ?? true;
      const shouldEnforceHTTPS = config.enforceHTTPS ?? true;

      if (options.isDevelopment && shouldSkipInDev) {
        return; // Skip in development mode, continue to next handler
      }

      const isAPIEndpoint = checkIfAPIEndpoint(request.url, options);

      // `request.host` and `request.protocol` are Fastify's own resolution.
      // They consult x-forwarded-host / x-forwarded-proto only when
      // `fastifyOptions.trustProxy` vouches for the peer that sent them, and
      // they read the last comma-separated entry, which is the one the trusted
      // proxy appended rather than anything the client supplied. Proxy trust is
      // therefore configured once, at the server, for every plugin at once.
      const parsed = parseHostHeader(request.host);
      const originalDomain = parsed.domain; // Keep original for error messages
      const domain = normalizeDomain(originalDomain);
      const port = parsed.port;
      const protocol = (request.protocol || 'http').toLowerCase();

      // Reject requests with a missing or unparseable Host header before any
      // redirect logic runs — an empty domain would otherwise produce a
      // malformed redirect URL (e.g. "https:///path").
      if (!domain) {
        markHostDisclaimed(request);

        if (isAPIEndpoint) {
          reply
            .code(400)
            .header('Cache-Control', 'no-store')
            .type('application/json')
            .send({
              error: 'bad_request',
              message: 'Missing or invalid Host header',
            });
        } else {
          reply
            .code(400)
            .header('Cache-Control', 'no-store')
            .type('text/plain')
            .send('Bad Request: Missing or invalid Host header');
        }

        return reply;
      }

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
        let isAllowedDomain: boolean;

        if (typeof config.validProductionDomains === 'function') {
          try {
            // Let callers make request-aware validation decisions, matching the
            // function-based CORS API style.
            isAllowedDomain = await config.validProductionDomains(
              domain,
              request,
            );
          } catch (error) {
            // Fail closed on access, but not by reusing the rejection. A
            // validator that cannot answer has not said this domain is ours,
            // and treating "the tenant lookup timed out" as "welcome in" is how
            // a host-header attack gets through on a bad day for the database.
            // So the request still stops here.
            //
            // It stops as a server error rather than a 403 because those mean
            // different things. A 403 is a statement about the caller, that
            // they were understood and refused, and a lookup that never
            // completed established nothing about them at all. Sending one
            // anyway puts an outage in the logs as an authorization failure and
            // points anyone reading it at credentials rather than at the store
            // that is down.
            //
            // Thrown rather than sent from here, so this failure behaves like
            // any other server-side failure: it reaches the application's error
            // handler, and therefore its error reporting, its logging, and its
            // own 500. Sending a canned response from inside the plugin would
            // route around all of that, and a store outage is exactly the thing
            // an operator needs to see in the tooling they already watch.
            //
            // What makes that safe is that the host is disclaimed first, and
            // `domainValidationChecked` is already set. An error page can
            // therefore tell it apart from an ordinary failure and withhold
            // whatever it would rather not show an unconfirmed domain. See
            // `isHostUnverified` in unirend/server.
            markHostDisclaimed(request);

            throw new Error(
              `domainValidation could not verify the host "${domain}": validProductionDomains threw`,
              { cause: error },
            );
          }
        } else {
          // Normalize validProductionDomains to array
          const validDomains = Array.isArray(config.validProductionDomains)
            ? config.validProductionDomains
            : [config.validProductionDomains];

          // Validate domain using secure check
          isAllowedDomain = matchesDomainList(domain, validDomains);
        }

        if (!isAllowedDomain) {
          markHostDisclaimed(request);

          // Built first so it is available as the fallback below, rather than
          // only as the other arm of a conditional.
          const defaultResponse: InvalidDomainResponse = isAPIEndpoint
            ? {
                contentType: 'json',
                content: {
                  error: 'invalid_domain',
                  // Pass original domain for human-friendly messages
                  message: `Domain "${originalDomain}" is not authorized to access this server`,
                },
              }
            : {
                contentType: 'text',
                content: `Access denied: Domain "${originalDomain}" is not authorized`,
              };

          let response = defaultResponse;

          if (config.invalidDomainHandler) {
            try {
              response = config.invalidDomainHandler(
                request,
                originalDomain,
                options.isDevelopment,
                isAPIEndpoint,
              );
            } catch (error) {
              // The rejection itself already happened and is not in question.
              // All the handler was asked to do is phrase it, so a throw there
              // costs the custom wording and nothing else.
              logCallbackError(
                request,
                error,
                'invalidDomainHandler threw, sending the default rejection response',
              );
              response = defaultResponse;
            }
          }

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
          } else {
            // A handler that returned an unrecognized contentType used to match
            // none of the branches above, so nothing was ever sent and the
            // request hung until the client gave up. TypeScript rules this out
            // for a typed caller, which is exactly why it needs a runtime arm:
            // the handlers that reach here untyped are the ones that get it
            // wrong.
            logCallbackError(
              request,
              new Error(
                `invalidDomainHandler returned an unsupported contentType: ${String(
                  response.contentType,
                )}`,
              ),
              'invalidDomainHandler returned an unsupported contentType, sending the default rejection response',
            );

            reply
              .code(403)
              .header('Cache-Control', 'no-store')
              .type(isAPIEndpoint ? 'application/json' : 'text/plain')
              .send(defaultResponse.content);
          }

          return reply;
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
      if (shouldEnforceHTTPS && protocol === 'http') {
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
        let hostForURL = finalHost;

        if (hostForURL.includes(':') && !hostForURL.startsWith('[')) {
          hostForURL = `[${hostForURL}]`;
        }

        const redirectURL = `${finalProtocol}://${hostForURL}${finalPortPart}${request.url}`;
        const statusCode = config.redirectStatusCode || 301;

        reply.code(statusCode).redirect(redirectURL);

        return reply;
      }

      // Continue to next handler - no redirects needed
      return;
    });

    return Promise.resolve();
  };
}
