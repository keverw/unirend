import { APIServer } from './api-server';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  normalizeDomain,
  matchesDomainList,
  validateConfigEntry,
  parseHostHeader,
} from 'lifecycleion/domain-utils';
import type {
  UnirendLoggingOptions,
  FastifyServerOptions,
  AccessLogConfig,
  ResponseTimeHeaderOptions,
  WebClosingHandlerFn,
} from '../types';
import type { ClientInfoConfig } from './client-info-resolution';

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
   * Ignored if targetPort is set.
   * @default false
   */
  preservePort?: boolean;

  /**
   * Override the port in the redirect URL
   * Useful when HTTP and HTTPS servers run on different non-standard ports
   * - example: targetPort: 8443 → http://host:8080 redirects to https://host:8443
   * Takes precedence over preservePort when set.
   */
  targetPort?: number;

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
   * Label for this server instance, used in error log messages and access log templates.
   * @default 'Redirect'
   * @example 'Redirect:http'
   */
  serverLabel?: string;

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
   * First-party access logging configuration
   * Controls request/response logging without needing a custom plugin
   */
  accessLog?: AccessLogConfig;

  /**
   * Optional response-time header emitted on completed responses.
   * Passed through to the underlying APIServer.
   * @default false
   */
  responseTimeHeader?: boolean | ResponseTimeHeaderOptions;

  /**
   * Custom connection IP resolver.
   * When set, called once per request to populate `request.connectionIP` (the
   * peer, and the base for `request.clientIP`). When not set, falls back to
   * `request.ip` (which reflects Fastify proxy handling when
   * `fastifyOptions.trustProxy` is configured). Available as the access-log
   * `{{connectionIP}}` variable.
   *
   * Use this when behind Cloudflare, AWS ALB, or other CDNs that carry the
   * connecting IP in a custom header.
   */
  getConnectionIP?: (request: FastifyRequest) => string | Promise<string>;
  /**
   * Client-identity resolution config (real end-user IP + `clientInfo`).
   * On by default; pass `false` to disable (then `request.clientIP` equals
   * `request.connectionIP`). See [ssr.md](../../docs/ssr.md).
   */
  clientInfo?: ClientInfoConfig | false;

  /**
   * Custom request ID generator.
   * Called once per request to populate `request.requestID`, available in
   * access-log templates (`{{requestID}}`) and hooks. When not set, the framework
   * generates a ULID. Return a non-empty string to set it; `undefined` or an
   * empty string opts out.
   */
  getRequestID?: (
    request: FastifyRequest,
  ) => string | undefined | Promise<string | undefined>;

  /**
   * Custom handler for requests that arrive while the redirect server is shutting down.
   * If omitted, Unirend returns a default 503 HTML page.
   */
  closingHandler?: WebClosingHandlerFn;

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
    targetPort?: number;
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
      targetPort: options.targetPort,
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
      serverLabel: options.serverLabel ?? 'Redirect', // Pass through server label with redirect default
      logging: options.logging, // Pass through logging config
      fastifyOptions: options.fastifyOptions, // Pass through Fastify options
      accessLog: options.accessLog, // Pass through access log config
      responseTimeHeader: options.responseTimeHeader, // Pass through response-time header config
      closingHandler: options.closingHandler
        ? { web: options.closingHandler }
        : undefined,
      getConnectionIP: options.getConnectionIP, // Pass through connection IP resolver
      getRequestID: options.getRequestID, // Pass through request ID generator
      clientInfo: options.clientInfo, // Pass through client-info resolution config
      plugins: [
        (pluginHost) => {
          // Register redirect logic as an onRequest hook
          pluginHost.addHook('onRequest', (request, reply) => {
            return this.handleRedirect(request, reply);
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
   * Force-close all open connections, including those actively serving requests.
   * See BaseServer.closeAllConnections() for full details.
   */
  public closeAllConnections(): void {
    this.apiServer.closeAllConnections();
  }

  /**
   * Merges the provided keys into the current access log config at runtime.
   * Access logging is on by default (finish events, default template). Use
   * `events: 'none'` to disable logging while keeping hooks active.
   * Omitted keys stay unchanged. Pass `undefined` for a hook callback to remove it.
   *
   * Changes take effect on the next request — no restart required.
   */
  public updateAccessLoggingConfig(partial: Partial<AccessLogConfig>): void {
    this.apiServer.updateAccessLoggingConfig(partial);
  }

  /**
   * Handle the redirect logic
   * @private
   */
  private handleRedirect(
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply {
    // Parse host header (supports IPv6 brackets)
    const host = request.headers.host || '';
    const { domain, port } = parseHostHeader(host);

    // Normalize domain for validation
    const normalizedDomain = normalizeDomain(domain);

    // Reject empty domains (missing/malformed Host header)
    if (!normalizedDomain) {
      return reply
        .code(400)
        .header('Cache-Control', 'no-store')
        .type('text/plain')
        .send('Bad Request: Missing or invalid Host header');
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
          return reply
            .code(403)
            .header('Cache-Control', 'no-store')
            .type('application/json')
            .send(response.content);
        } else if (response.contentType === 'html') {
          return reply
            .code(403)
            .header('Cache-Control', 'no-store')
            .type('text/html')
            .send(response.content);
        } else {
          return reply
            .code(403)
            .header('Cache-Control', 'no-store')
            .type('text/plain')
            .send(response.content);
        }
      }
    }

    // Build redirect URL
    const protocol = this.config.targetProtocol;
    let targetHost = normalizedDomain;

    // Handle IPv6 bracketing
    if (targetHost.includes(':') && !targetHost.startsWith('[')) {
      targetHost = `[${targetHost}]`;
    }

    // Add port: targetPort overrides, then preservePort, then strip
    // Skip port 443 — it's the default for HTTPS and shouldn't appear in the URL
    const portPart =
      this.config.targetPort !== null &&
      this.config.targetPort !== undefined &&
      this.config.targetPort !== 443
        ? `:${this.config.targetPort}`
        : this.config.preservePort && port
          ? `:${port}`
          : '';

    // Build final redirect URL
    const redirectURL = `${protocol}://${targetHost}${portPart}${request.url}`;

    // Perform redirect
    return reply.code(this.config.statusCode).redirect(redirectURL);
  }
}
