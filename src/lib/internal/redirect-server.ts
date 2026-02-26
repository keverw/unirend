import { APIServer } from './api-server';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  normalizeDomain,
  matchesDomainList,
  validateConfigEntry,
  parseHostHeader,
} from './domain-utils/domain-utils';
import type { UnirendLoggingOptions, FastifyServerOptions } from '../types';

/**
 * Response configuration for invalid domain handler
 * Matches the pattern from domain-validation plugin for consistency
 */
export interface InvalidDomainResponse {
  contentType: 'json' | 'text' | 'html';
  content: string | object;
}

/**
 * Configuration options for the RedirectServer
 */
export interface RedirectServerOptions {
  /**
   * Target protocol to redirect to
   * Currently only 'https' is supported
   * @default 'https'
   */
  targetProtocol?: 'https';

  /**
   * HTTP status code to use for redirects
   * - 301: Permanent redirect
   * - 302: Temporary redirect
   * - 307: Temporary redirect (preserves method)
   * - 308: Permanent redirect (preserves method)
   * @default 301
   */
  statusCode?: 301 | 302 | 307 | 308;

  /**
   * Optional list of allowed domains with wildcard support
   * If provided, only requests to these domains will be redirected
   * Requests to other domains will receive a 403 error
   *
   * Wildcard patterns supported:
   * - "example.com" - allows exact match only
   * - "*.example.com" - allows direct subdomains only (api.example.com ✅, app.api.example.com ❌)
   * - "**.example.com" - allows all subdomains including nested (api.example.com ✅, app.api.example.com ✅)
   *
   * Security: This prevents Host header attacks by rejecting unexpected domains
   *
   * @example
   * allowedDomains: ['example.com', '*.example.com']
   */
  allowedDomains?: string | string[];

  /**
   * Whether to preserve port numbers in redirects
   * - true: example.com:8080 → https://example.com:8080
   * - false: example.com:8080 → https://example.com (strip port)
   * @default false
   */
  preservePort?: boolean;

  /**
   * Custom handler for invalid domain responses
   * If not provided, returns a default 403 plain text response
   * Matches the pattern from domain-validation plugin for consistency
   *
   * @param request - The Fastify request object
   * @param domain - The domain that was not allowed
   * @returns Response configuration with contentType and content
   */
  invalidDomainHandler?: (
    request: FastifyRequest,
    domain: string,
  ) => InvalidDomainResponse;

  /**
   * Whether to automatically log errors via the server logger
   * When enabled, all errors are logged before custom error handlers run
   * @default true
   */
  logErrors?: boolean;

  /**
   * Framework-level logging options adapted to Fastify under the hood
   * Same as APIServer and SSRServer logging configuration
   */
  logging?: UnirendLoggingOptions;

  /**
   * Curated Fastify options for redirect server configuration
   * Only exposes safe options that won't conflict with server setup
   */
  fastifyOptions?: FastifyServerOptions;

  /**
   * HTTPS server configuration for the redirect server itself
   * Typically not needed (redirect servers usually run on HTTP port 80)
   */
  https?: never; // Explicitly prevent HTTPS on redirect server
}

/**
 * Dedicated HTTP → HTTPS redirect server
 *
 * Lightweight server specifically designed for HTTP → HTTPS redirects.
 * Wraps APIServer with built-in redirect logic and optional domain validation.
 *
 * Common use case: Run on port 80 to redirect all HTTP traffic to HTTPS (port 443)
 *
 * @example Basic usage
 * ```ts
 * import { RedirectServer } from 'unirend/server';
 *
 * const redirectServer = new RedirectServer({
 *   targetProtocol: 'https',
 *   statusCode: 301,
 * });
 *
 * await redirectServer.listen(80);
 * ```
 *
 * @example With domain validation
 * ```ts
 * const redirectServer = new RedirectServer({
 *   targetProtocol: 'https',
 *   allowedDomains: ['example.com', '*.example.com'],
 * });
 *
 * await redirectServer.listen(80);
 * ```
 */
export class RedirectServer {
  private apiServer: APIServer;
  private config: {
    targetProtocol: 'https';
    statusCode: 301 | 302 | 307 | 308;
    allowedDomains?: string | string[];
    preservePort: boolean;
    invalidDomainHandler?: (
      request: FastifyRequest,
      domain: string,
    ) => InvalidDomainResponse;
  };

  constructor(options: RedirectServerOptions = {}) {
    // Set defaults
    this.config = {
      targetProtocol: options.targetProtocol || 'https',
      statusCode: options.statusCode || 301,
      allowedDomains: options.allowedDomains,
      preservePort: options.preservePort ?? false,
      invalidDomainHandler: options.invalidDomainHandler,
    };

    // Validate allowedDomains if provided
    if (this.config.allowedDomains) {
      const domains = Array.isArray(this.config.allowedDomains)
        ? this.config.allowedDomains
        : [this.config.allowedDomains];

      for (const domain of domains) {
        const verdict = validateConfigEntry(domain, 'domain');

        if (!verdict.valid) {
          throw new Error(
            `Invalid domain in allowedDomains: "${domain}"${verdict.info ? ': ' + verdict.info : ''}`,
          );
        }
      }
    }

    // Create APIServer with API handling disabled (plain web server mode)
    // Register redirect logic via plugin
    this.apiServer = new APIServer({
      apiEndpoints: {
        apiEndpointPrefix: false, // Disable API handling
      },
      isDevelopment: false,
      logErrors: options.logErrors, // Pass through error logging config
      logging: options.logging, // Pass through logging config
      fastifyOptions: options.fastifyOptions, // Pass through Fastify options
      plugins: [
        (pluginHost) => {
          // Register redirect logic as an onRequest hook
          pluginHost.addHook('onRequest', (request, reply) => {
            this.handleRedirect(request, reply);
          });
        },
      ],
    });
  }

  /**
   * Start the redirect server
   * @param port Port to listen on (typically 80 for HTTP)
   * @param host Host to bind to (default: 'localhost')
   */
  public async listen(
    port: number = 80,
    host: string = 'localhost',
  ): Promise<void> {
    await this.apiServer.listen(port, host);
  }

  /**
   * Stop the redirect server
   */
  public async stop(): Promise<void> {
    await this.apiServer.stop();
  }

  /**
   * Check if the server is currently listening
   */
  public isListening(): boolean {
    return this.apiServer.isListening();
  }

  /**
   * Handle the redirect logic
   * @private
   */
  private handleRedirect(request: FastifyRequest, reply: FastifyReply): void {
    // Parse host header (supports IPv6 brackets)
    const host = request.headers.host || '';
    const { domain, port } = parseHostHeader(host);

    // Normalize domain for validation
    const normalizedDomain = normalizeDomain(domain);

    // Reject empty domains (missing/malformed Host header)
    if (!normalizedDomain) {
      reply
        .code(400)
        .header('Cache-Control', 'no-store')
        .type('text/plain')
        .send('Bad Request: Missing or invalid Host header');
      return;
    }

    // Domain validation if allowedDomains is configured
    if (this.config.allowedDomains) {
      const allowedDomains = Array.isArray(this.config.allowedDomains)
        ? this.config.allowedDomains
        : [this.config.allowedDomains];

      const isAllowed = matchesDomainList(normalizedDomain, allowedDomains);

      if (!isAllowed) {
        // Domain not allowed - return 403
        const response = this.config.invalidDomainHandler
          ? this.config.invalidDomainHandler(request, domain)
          : {
              contentType: 'text' as const,
              content: `Access denied: Domain "${domain}" is not authorized`,
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
        } else {
          reply
            .code(403)
            .header('Cache-Control', 'no-store')
            .type('text/plain')
            .send(response.content);
        }

        return;
      }
    }

    // Build redirect URL
    const protocol = this.config.targetProtocol;
    let targetHost = normalizedDomain;

    // Handle IPv6 bracketing
    if (targetHost.includes(':') && !targetHost.startsWith('[')) {
      targetHost = `[${targetHost}]`;
    }

    // Add port if preservePort is enabled
    const portPart = this.config.preservePort && port ? `:${port}` : '';

    // Build final redirect URL
    const redirectURL = `${protocol}://${targetHost}${portPart}${request.url}`;

    // Perform redirect
    reply.code(this.config.statusCode).redirect(redirectURL);
  }
}
