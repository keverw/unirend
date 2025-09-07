import type { PluginHostInstance, PluginOptions, ServerPlugin } from "../types";
import type { FastifyRequest } from "fastify";
import { ulid, isValid as isValidULID } from "ulid";
import { isPrivateIP } from "range_check";

export interface ClientInfo {
  requestID: string; // Unique ID for this specific request
  correlationID: string | null; // ID for tracing requests across services (can be null)
  /** True when request came from SSR layer with trusted forwarded headers */
  isFromSSRServerAPICall: boolean;
  IPAddress: string;
  userAgent: string;
  isIPFromHeader: boolean;
  isUserAgentFromHeader: boolean;
}

// Extend FastifyRequest to include client info
declare module "fastify" {
  interface FastifyRequest {
    /** Optional unique request ID used by response helpers */
    requestID?: string;
    clientInfo?: ClientInfo;
  }
}

/**
 * Configuration options for the clientInfo plugin
 */
export interface ClientInfoLoggingOptions {
  /** Log each request with its generated request ID. Default: false */
  requestReceived?: boolean;
  /** Log decision/details when trusting forwarded client info. Default: false */
  forwardedClientInfo?: boolean;
  /** Warn when SSR/forwarded headers are present from untrusted source. Default: false */
  rejectedForwardedHeaders?: boolean;
}

export interface ClientInfoConfig {
  /** Custom function to generate request IDs. Defaults to ulid() */
  requestIDGenerator?: () => string;
  /** Custom validator for request/correlation IDs. Defaults to ULID validation */
  requestIDValidator?: (id: string) => boolean;
  /** If true, set X-Request-ID and X-Correlation-ID response headers. Default: true */
  setResponseHeaders?: boolean;
  /** Predicate to decide if forwarded headers are trusted. Default: private IP check of request.ip */
  trustForwardedHeaders?: (request: FastifyRequest) => boolean;
  /** Optional logging configuration */
  logging?: boolean | ClientInfoLoggingOptions;
}

/**
 * Client Info plugin to extract and normalize client information and handle request IDs
 *
 * This middleware:
 * 1. Generates or forwards request IDs
 * 2. Handles client info from both direct requests and SSR-forwarded requests
 * 3. Validates SSR requests come from private IP ranges
 */

export function clientInfo(config: ClientInfoConfig = {}): ServerPlugin {
  return async (pluginHost: PluginHostInstance, _options: PluginOptions) => {
    // Set default values for the clientInfo property
    pluginHost.decorateRequest("clientInfo", null);
    // Ensure requestID is a known property on FastifyRequest
    pluginHost.decorateRequest("requestID", null);

    const generateRequestID =
      typeof config.requestIDGenerator === "function"
        ? config.requestIDGenerator
        : () => ulid();

    const validateRequestID =
      typeof config.requestIDValidator === "function"
        ? config.requestIDValidator
        : (id: string) => isValidULID(id);

    pluginHost.addHook("onRequest", async (request, reply) => {
      const loggingConfig = config.logging;
      const logAll = loggingConfig === true;
      const logNone =
        loggingConfig === false || typeof loggingConfig === "undefined";
      const loggingObject: ClientInfoLoggingOptions | undefined =
        typeof loggingConfig === "object" && loggingConfig !== null
          ? (loggingConfig as ClientInfoLoggingOptions)
          : undefined;

      const logRequestReceived =
        logAll || (!logNone && loggingObject?.requestReceived === true);
      const logForwardedClientInfo =
        logAll || (!logNone && loggingObject?.forwardedClientInfo === true);
      const logRejectedForwardedHeaders =
        logAll ||
        (!logNone && loggingObject?.rejectedForwardedHeaders === true);

      // Generate a request ID for each request
      const requestID = generateRequestID();

      // The request ID also serves as the correlation ID for the entire request chain
      // This will be forwarded to the API server

      // Optionally log the request with its ID
      if (logRequestReceived) {
        request.log?.info?.(
          { requestID },
          `Request received: ${request.method} ${request.url}`,
        );
      }

      // Initialize clientInfo for this request with default values
      request.clientInfo = {
        requestID: requestID,
        correlationID: null,
        isFromSSRServerAPICall: false,
        IPAddress: "",
        userAgent: "",
        isIPFromHeader: false,
        isUserAgentFromHeader: false,
      };

      // Also set request.requestID for envelope helpers and SSR forwarding
      request.requestID = requestID;

      // Default values from the request
      let IPAddress = request.ip;
      let isIPFromHeader = false;

      // Handle User-Agent header safely
      const uaHeader = request.headers["user-agent"];
      let userAgent = typeof uaHeader === "string" ? uaHeader : "";
      let isUserAgentFromHeader = false;

      let isFromSSRServerAPICall = false;

      // We'll determine the correlation ID after validating the source
      // Correlation ID is used for tracing requests across services
      let correlationID: string | null = null;

      // isFromSSRServerAPICall is only set when forwarded headers are trusted

      // Decide whether to trust forwarded headers using config or default private IP check
      const shouldTrustForwarded =
        (typeof config.trustForwardedHeaders === "function"
          ? config.trustForwardedHeaders(request)
          : isPrivateIP(request.ip)) === true;

      if (shouldTrustForwarded) {
        // keep going
        // Safely check if x-ssr-request header is 'true'
        const ssrHeader = request.headers["x-ssr-request"];
        const isSSRRequest =
          typeof ssrHeader === "string" && ssrHeader === "true";

        // Check if we have any forwarded client info headers
        const hasForwardedClientInfo =
          isSSRRequest ||
          request.headers["x-original-ip"] ||
          request.headers["x-forwarded-user-agent"] ||
          request.headers["x-correlation-id"];

        // Set SSR flag only if the x-ssr-request header is explicitly true
        if (isSSRRequest) {
          isFromSSRServerAPICall = true;
        }

        if (hasForwardedClientInfo) {
          // Use X-Original-IP if provided
          const originalIPHeader = request.headers["x-original-ip"];

          if (typeof originalIPHeader === "string") {
            IPAddress = originalIPHeader;
            isIPFromHeader = true;
          }

          // Use X-Forwarded-User-Agent if provided
          const forwardedUserAgentHeader =
            request.headers["x-forwarded-user-agent"];

          if (typeof forwardedUserAgentHeader === "string") {
            userAgent = forwardedUserAgentHeader;
            isUserAgentFromHeader = true;
          }

          // Use X-Correlation-ID from SSR if it's valid
          const correlationHeader = request.headers["x-correlation-id"];

          if (
            typeof correlationHeader === "string" &&
            validateRequestID(correlationHeader)
          ) {
            correlationID = correlationHeader;
          }

          if (logForwardedClientInfo) {
            request.log?.debug?.(
              {
                requestID,
                correlationID,
                originalIP: IPAddress,
                ssrIP: request.ip,
                isFromSSRServerAPICall,
              },
              "Using forwarded client info from trusted source",
            );
          }
        }
      } else if (
        (typeof request.headers["x-ssr-request"] === "string" &&
          request.headers["x-ssr-request"] === "true") ||
        request.headers["x-original-ip"] ||
        request.headers["x-forwarded-user-agent"] ||
        request.headers["x-correlation-id"]
      ) {
        // Log a warning if SSR headers are present but from a non-private IP
        // As someone might be trying to spoof the request?
        if (logRejectedForwardedHeaders) {
          request.log?.warn?.(
            {
              requestID,
              ip: request.ip,
            },
            "Rejected SSR headers from untrusted source",
          );
        }
      }

      // For direct API requests, use the request ID as correlation ID
      // if a correlation ID hasn't been set through X-Correlation-ID
      if (!correlationID) {
        correlationID = requestID;
      }

      // -- Set the headers and request.clientInfo --
      // Optionally add the request ID and correlation ID to response headers for client-side tracking after we've validated the source
      if (config.setResponseHeaders !== false) {
        reply.header("X-Request-ID", requestID);
        reply.header("X-Correlation-ID", correlationID);
      }

      // Log the request with its IDs (optional)
      if (logRequestReceived) {
        request.log?.info?.(
          {
            requestID,
            correlationID: correlationID || undefined,
          },
          `Request received: ${request.method} ${request.url}`,
        );
      }

      // Set the client info on the request
      request.clientInfo.requestID = requestID;
      request.clientInfo.correlationID = correlationID;
      request.clientInfo.isFromSSRServerAPICall = isFromSSRServerAPICall;
      request.clientInfo.IPAddress = IPAddress;
      request.clientInfo.userAgent = userAgent;
      request.clientInfo.isIPFromHeader = isIPFromHeader;
      request.clientInfo.isUserAgentFromHeader = isUserAgentFromHeader;

      // Freeze the clientInfo object to make it read-only
      Object.freeze(request.clientInfo);
    });

    return {
      name: "client-info",
    };
  };
}
