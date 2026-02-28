import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { APIResponseEnvelope } from '../api-envelope/api-envelope-types';
import { APIResponseHelpers } from '../api-envelope/response-helpers';
import type { APIResponseHelpersClass, WebSocketOptions } from '../types';

/**
 * Internal Fastify WebSocket plugin options interface
 * Maps our WebSocketOptions to @fastify/websocket configuration
 */
interface FastifyWebSocketPluginOptions {
  options: {
    clientTracking: boolean;
    perMessageDeflate: boolean;
    maxPayload: number;
  };
  preClose?: (done: () => void) => void;
}

/**
 * Parameters passed to WebSocket handlers with extracted routing context
 *
 * Similar to page data and API handlers, this provides pre-extracted routing
 * information while keeping the raw request available for cookies/headers/IP.
 */
export interface WebSocketHandlerParams {
  /** Request path (from Fastify, without query string) */
  path: string;
  /** Original URL (from Fastify, with query string) */
  originalURL: string;
  /** Query params (from Fastify) */
  queryParams: Record<string, unknown>;
  /** Route params (from Fastify, for parameterized paths) */
  routeParams: Record<string, unknown>;
}

/**
 * Extract WebSocket handler params from Fastify request
 * Pure helper function with defensive fallbacks
 */
function extractWebSocketParams(
  request: FastifyRequest,
): WebSocketHandlerParams {
  const routeParams = (request.params || {}) as Record<string, unknown>;
  const queryParams = (request.query || {}) as Record<string, unknown>;
  const originalURL = request.url;
  const path = originalURL.split('?')[0] || originalURL;

  return {
    path,
    originalURL,
    queryParams,
    routeParams,
  };
}

/**
 * WebSocket preValidation result - discriminated union
 */
export type WebSocketPreValidationResult =
  | {
      /** Allow WebSocket upgrade */
      action: 'upgrade';
      /** Optional data to pass to the WebSocket handler */
      data?: Record<string, unknown>;
    }
  | {
      /** Reject WebSocket upgrade with API envelope response */
      action: 'reject';
      /** API envelope response to send when rejecting */
      envelope: APIResponseEnvelope;
    };

/**
 * WebSocket upgrade validation information stored on request
 */
export interface WebSocketUpgradeInfo {
  /** Whether the request path matches a registered WebSocket handler */
  validPath: boolean;
  /** Whether the handler has a preValidation function */
  hasPreValidator: boolean;
  /** The result from the preValidation handler, if called */
  upgradeResult: WebSocketPreValidationResult | null;
  /** Any error that occurred during preValidation */
  error: Error | null;
}

/**
 * WebSocket handler configuration
 */
export interface WebSocketHandlerConfig {
  /** The WebSocket endpoint path */
  path: string;
  /** Optional preValidation function that returns upgrade/reject decision with optional envelope */
  preValidate?: (
    request: FastifyRequest,
    params: WebSocketHandlerParams,
  ) => Promise<WebSocketPreValidationResult> | WebSocketPreValidationResult;
  /** WebSocket connection handler */
  handler: (
    socket: WebSocket,
    request: FastifyRequest,
    params: WebSocketHandlerParams,
    upgradeData?: Record<string, unknown>,
  ) => Promise<void> | void;
}

export class WebSocketServerHelpers {
  private readonly APIResponseHelpersClass: APIResponseHelpersClass;
  private readonly webSocketOptions: WebSocketOptions;
  private handlersByPath = new Map<string, WebSocketHandlerConfig>();

  constructor(
    APIResponseHelpersClass: APIResponseHelpersClass,
    webSocketOptions: WebSocketOptions = {},
  ) {
    // Initialize handlers storage
    this.APIResponseHelpersClass = APIResponseHelpersClass;
    this.webSocketOptions = webSocketOptions;
  }

  /**
   * Register the @fastify/websocket plugin with the Fastify instance
   *
   * @param fastify The Fastify instance to register the WebSocket plugin with
   */
  public async registerWebSocketPlugin(
    fastify: FastifyInstance,
  ): Promise<void> {
    const pluginOptions: FastifyWebSocketPluginOptions = {
      options: {
        clientTracking: true,
        perMessageDeflate: this.webSocketOptions.perMessageDeflate ?? false,
        maxPayload: this.webSocketOptions.maxPayload ?? 100 * 1024 * 1024, // 100MB default
      },
    };

    // Add preClose handler if provided
    if (this.webSocketOptions.preClose) {
      const userPreCloseHandler = this.webSocketOptions.preClose;
      pluginOptions.preClose = (done) => {
        // Get the WebSocket server clients
        const websocketServer = (
          fastify as unknown as { websocketServer?: { clients: Set<unknown> } }
        ).websocketServer;
        const clients = websocketServer?.clients || new Set();

        // Call user's preClose handler with clients and handle both sync throws
        // and async rejections (Promise.resolve wraps sync throws into a rejection)
        Promise.resolve()
          .then(() => userPreCloseHandler(clients))
          .then(() => done())
          .catch((error) => {
            fastify.log.error(
              { err: error },
              'WebSocket preClose handler error:',
            );
            done(); // Still call done to prevent hanging
          });
      };
    }

    await fastify.register(websocket, pluginOptions);
  }

  /**
   * Register a WebSocket handler for a specific path
   *
   * @param config WebSocket handler configuration
   */
  public registerWebSocketHandler(config: WebSocketHandlerConfig): void {
    // Last registration wins for the same path (consistent with other helpers)
    this.handlersByPath.set(config.path, config);
  }

  /**
   * Register WebSocket routes and handlers with the Fastify instance
   */
  public registerRoutes(fastify: FastifyInstance): void {
    // Register all stored WebSocket handlers
    for (const [path, config] of this.handlersByPath) {
      fastify.register(function (fastify) {
        fastify.get(path, { websocket: true }, (socket, request) => {
          // Check upgrade validation info from preValidation hook
          const upgradeInfo = (
            request as unknown as { wsUpgradeInfo?: WebSocketUpgradeInfo }
          ).wsUpgradeInfo;

          // Disconnect immediately if path was not valid
          if (!upgradeInfo || !upgradeInfo.validPath) {
            socket.close(1008, 'Invalid WebSocket path');
            return;
          }

          // Fallback check: ensure upgrade was actually allowed if preValidator exists
          if (upgradeInfo.hasPreValidator) {
            if (
              !upgradeInfo.upgradeResult ||
              upgradeInfo.upgradeResult.action !== 'upgrade'
            ) {
              socket.close(1008, 'WebSocket upgrade not allowed');
              return;
            }
          }

          // Get upgrade data from request if available
          const upgradeData = (
            request as unknown as { wsUpgradeData?: Record<string, unknown> }
          ).wsUpgradeData;

          // Extract params from request
          const params = extractWebSocketParams(request);

          // Call the handler with socket, request, params, and upgrade data
          return config.handler(socket, request, params, upgradeData);
        });
      });
    }
  }

  /**
   * Register preValidation hook for WebSocket handling
   *
   * This hook checks if the request path matches any registered WebSocket handlers
   * and runs their preValidation logic to determine upgrade/reject decisions.
   *
   * @param fastify The Fastify instance to register the hook with
   */
  public registerPreValidationHook(fastify: FastifyInstance): void {
    fastify.addHook('preValidation', async (request, reply) => {
      // Only act on WebSocket upgrade attempts - check both headers and Fastify's ws flag
      const upgrade = request.headers['upgrade'];

      if (
        !request.ws ||
        !upgrade ||
        typeof upgrade !== 'string' ||
        upgrade.toLowerCase() !== 'websocket'
      ) {
        return;
      }

      // Optional sanity-check for Connection: upgrade
      const connHeader = Array.isArray(request.headers.connection)
        ? request.headers.connection.join(',')
        : String(request.headers.connection ?? '');

      if (!/\bupgrade\b/i.test(connHeader)) {
        // Early bail if invalid upgrade attempt
        await reply
          .code(400)
          .header('Cache-Control', 'no-store')
          .send({ error: 'Invalid Connection header for upgrade' });
        return;
      }

      // Initialize upgrade info object
      const upgradeInfo: WebSocketUpgradeInfo = {
        validPath: false,
        hasPreValidator: false,
        upgradeResult: null,
        error: null,
      };

      // Store upgrade info on request for handler access
      (
        request as unknown as { wsUpgradeInfo?: WebSocketUpgradeInfo }
      ).wsUpgradeInfo = upgradeInfo;

      // Find matching WebSocket handler for this path
      const path = request.url.split('?')[0];
      const matchingHandler = this.handlersByPath.get(path);

      if (!matchingHandler) {
        // No handler found - reject with 404 error
        upgradeInfo.validPath = false;
        upgradeInfo.hasPreValidator = false;

        const notFoundEnvelope = this.createNotFoundEnvelope(request, path);

        if (notFoundEnvelope.status_code >= 400) {
          reply.header('Cache-Control', 'no-store');
        }

        reply.code(notFoundEnvelope.status_code).send(notFoundEnvelope);
        return;
      }

      // Handler found - mark as valid path
      upgradeInfo.validPath = true;

      if (!matchingHandler.preValidate) {
        // No preValidation function - allow upgrade
        upgradeInfo.hasPreValidator = false;
        return;
      }

      // PreValidation handler exists - call it
      upgradeInfo.hasPreValidator = true;

      try {
        // Extract params from request
        const params = extractWebSocketParams(request);

        // Run the preValidation function
        const result = await matchingHandler.preValidate(request, params);
        upgradeInfo.upgradeResult = result;

        if (result.action === 'reject') {
          // Send API envelope response and prevent WebSocket upgrade
          const envelope = result.envelope;

          // Validate the envelope before sending
          if (!APIResponseHelpers.isValidEnvelope(envelope)) {
            const error = new Error(
              `WebSocket preValidation handler returned invalid envelope for path: ${path}`,
            );
            (error as unknown as { path: string }).path = path;
            (error as unknown as { handlerResponse: unknown }).handlerResponse =
              envelope;
            (error as unknown as { errorCode: string }).errorCode =
              'websocket_invalid_prevalidation_envelope';
            throw error;
          }

          if (envelope.status_code >= 400) {
            reply.header('Cache-Control', 'no-store');
          }

          reply.code(envelope.status_code).send(envelope);
          return;
        }

        // Action is "upgrade" - allow WebSocket upgrade to proceed
        // Store any upgrade data on the request for handler access
        if (result.action === 'upgrade' && result.data !== undefined) {
          (
            request as unknown as { wsUpgradeData?: Record<string, unknown> }
          ).wsUpgradeData = result.data;
        }
      } catch (error) {
        // PreValidation function threw an error - store error and reject with 500
        upgradeInfo.error =
          error instanceof Error ? error : new Error(String(error));
        const errorEnvelope = this.createErrorEnvelope(request, error);

        if (errorEnvelope.status_code >= 400) {
          reply.header('Cache-Control', 'no-store');
        }

        reply.code(errorEnvelope.status_code).send(errorEnvelope);
      }
    });
  }

  /**
   * Create not found envelope for unregistered WebSocket paths
   * @private
   */
  private createNotFoundEnvelope(
    request: FastifyRequest,
    path: string,
  ): APIResponseEnvelope {
    return this.APIResponseHelpersClass.createAPIErrorResponse({
      request,
      statusCode: 404,
      errorCode: 'websocket_handler_not_found',
      errorMessage: `No WebSocket handler registered for path: ${path}`,
      errorDetails: {
        path,
      },
      meta: {
        page: {
          title: 'WebSocket Handler Not Found',
          description: 'No WebSocket handler registered for this path',
        },
      },
    });
  }

  /**
   * Create error envelope for preValidation exceptions
   * @private
   */
  private createErrorEnvelope(
    request: FastifyRequest,
    error: unknown,
  ): APIResponseEnvelope {
    return this.APIResponseHelpersClass.createAPIErrorResponse({
      request,
      statusCode: 500,
      errorCode: 'websocket_validation_error',
      errorMessage:
        error instanceof Error ? error.message : 'Unknown validation error',
      errorDetails: {
        error: error instanceof Error ? error.message : String(error),
      },
      meta: {
        page: {
          title: 'WebSocket Validation Error',
          description: 'An error occurred during WebSocket validation',
        },
      },
    });
  }
}
