import { createContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Render mode type - SSR, SSG, or Client
 * - "ssr": Server-Side Rendering (runtime server rendering)
 * - "ssg": Static Site Generation (build-time server rendering)
 * - "client": Client-side execution (SPA or after a SSG build/SSR page hydration occurs)
 */
export type UnirendRenderMode = 'ssr' | 'ssg' | 'client';

/**
 * Type guard to check if request has SSR helpers with request context
 */
export function hasSSRRequestContext(request: Request): request is Request & {
  SSRHelpers: {
    fastifyRequest: { requestContext: Record<string, unknown> };
  };
} {
  if (!('SSRHelpers' in request)) {
    return false;
  }

  const helpers = (request as Request & { SSRHelpers: unknown }).SSRHelpers;

  if (typeof helpers !== 'object' || helpers === null) {
    return false;
  }

  if (!('fastifyRequest' in helpers)) {
    return false;
  }

  const fastifyReq = (helpers as { fastifyRequest: unknown }).fastifyRequest;

  if (typeof fastifyReq !== 'object' || fastifyReq === null) {
    return false;
  }

  if (!('requestContext' in fastifyReq)) {
    return false;
  }

  const reqCtx = (fastifyReq as { requestContext: unknown }).requestContext;
  return typeof reqCtx === 'object' && reqCtx !== null;
}

/**
 * Type guard to check if request has SSG helpers with request context
 */
export function hasSSGRequestContext(request: Request): request is Request & {
  SSGHelpers: { requestContext: Record<string, unknown> };
} {
  if (!('SSGHelpers' in request)) {
    return false;
  }

  const helpers = (request as Request & { SSGHelpers: unknown }).SSGHelpers;
  if (typeof helpers !== 'object' || helpers === null) {
    return false;
  }

  if (!('requestContext' in helpers)) {
    return false;
  }

  const reqCtx = (helpers as { requestContext: unknown }).requestContext;
  return typeof reqCtx === 'object' && reqCtx !== null;
}

/**
 * Type guard to check if window has request context
 */
export function hasWindowRequestContext(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const ctx = (window as Window & { __FRONTEND_REQUEST_CONTEXT__?: unknown })
    .__FRONTEND_REQUEST_CONTEXT__;

  return '__FRONTEND_REQUEST_CONTEXT__' in window && typeof ctx === 'object';
}

/**
 * Helper to get a value from request context storage
 * Works across SSR, SSG, and client environments
 */
export function getRequestContextValue(
  context: UnirendContextValue,
  key: string,
): unknown {
  if (context.fetchRequest && hasSSRRequestContext(context.fetchRequest)) {
    // SSR: Read from fastify request context
    return context.fetchRequest.SSRHelpers.fastifyRequest.requestContext[key];
  } else if (
    context.fetchRequest &&
    hasSSGRequestContext(context.fetchRequest)
  ) {
    // SSG: Read from SSG request context
    return context.fetchRequest.SSGHelpers.requestContext[key];
  } else if (hasWindowRequestContext()) {
    // Client: Read from window global
    return (
      window as unknown as {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
      }
    ).__FRONTEND_REQUEST_CONTEXT__[key];
  } else {
    // No context available
    return undefined;
  }
}

/**
 * Helper to set a value in request context storage
 * Works across SSR, SSG, and client environments
 * Automatically increments the revision counter to trigger reactivity
 */
export function setRequestContextValue(
  context: UnirendContextValue,
  key: string,
  value: unknown,
): void {
  if (context.fetchRequest && hasSSRRequestContext(context.fetchRequest)) {
    // SSR: Write to fastify request context
    context.fetchRequest.SSRHelpers.fastifyRequest.requestContext[key] = value;
    incrementContextRevision(context);
  } else if (
    context.fetchRequest &&
    hasSSGRequestContext(context.fetchRequest)
  ) {
    // SSG: Write to SSG request context
    context.fetchRequest.SSGHelpers.requestContext[key] = value;
    incrementContextRevision(context);
  } else if (hasWindowRequestContext()) {
    // Client: Write to window global
    (
      window as unknown as {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
      }
    ).__FRONTEND_REQUEST_CONTEXT__[key] = value;
    incrementContextRevision(context);
  } else {
    // No context available - create one on window for client-side
    if (typeof window !== 'undefined') {
      (
        window as unknown as {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          __FRONTEND_REQUEST_CONTEXT__?: Record<string, unknown>;
        }
      ).__FRONTEND_REQUEST_CONTEXT__ = { [key]: value };
      incrementContextRevision(context);
    } else {
      // Server-side with no context - this shouldn't happen in normal usage
      throw new TypeError(
        'Cannot set request context: no context available (server-side without SSR/SSG helpers)',
      );
    }
  }
}

/**
 * Helper to increment the request context revision counter
 * Reads the current revision from context, parses it, and generates a new unique revision
 * Format: `${timestamp}-${counter}` (e.g., "1729123456789-0", "1729123456789-1")
 */
export function incrementContextRevision(context: UnirendContextValue): void {
  const currentRevision = context.requestContextRevision || '0-0';
  const [timestampStr, counterStr] = currentRevision.split('-');
  const lastTimestamp = parseInt(timestampStr, 10);
  const lastCounter = parseInt(counterStr, 10);

  const now = Date.now();

  // If we're in a new millisecond, reset counter to 0
  // Otherwise, increment the counter
  if (now !== lastTimestamp) {
    context.requestContextRevision = `${now}-0`;
  } else {
    context.requestContextRevision = `${now}-${lastCounter + 1}`;
  }
}

/**
 * Domain information computed server-side from the request hostname.
 * - `hostname`: the bare requested hostname (port stripped), e.g. `'app.example.com'`
 * - `rootDomain`: the apex domain without a leading dot, e.g. `'example.com'`.
 *   Empty string for localhost / IP addresses.
 *   Prepend `.` when using as a cookie `domain` attribute to span subdomains:
 *   ```ts
 *   document.cookie = [
 *     'theme=dark',
 *     'path=/',
 *     'max-age=31536000',
 *     domainInfo?.rootDomain ? `domain=.${domainInfo.rootDomain}` : null,
 *   ].filter(Boolean).join('; ');
 *   ```
 *
 * Available during SSR (computed per-request) and SSG when a `hostname` option is provided.
 * `null` when hostname is not known (SSG without hostname configured, or pure SPA).
 */
export interface DomainInfo {
  hostname: string;
  rootDomain: string;
}

/**
 * Unirend context value type
 */
export interface UnirendContextValue {
  /**
   * The render mode:
   * - 'ssr': Server-Side Rendering
   * - 'ssg': Static Site Generation
   * - 'client': Client-side execution (SPA or after a SSG build/SSR page hydration occurs)
   */
  renderMode: UnirendRenderMode;

  /**
   * Whether the app is running in development mode
   */
  isDevelopment: boolean;

  /**
   * The Fetch API Request object (available during SSR/SSG rendering)
   * Undefined on client-side after hydration
   */
  fetchRequest?: Request;

  /**
   * Frontend application configuration
   * This is a frozen (immutable) copy of the config passed to the server
   * Available on both server and client (injected into HTML during SSR/SSG)
   */
  frontendAppConfig?: Record<string, unknown>;

  /**
   * CDN base URL for asset serving (e.g. 'https://cdn.example.com')
   * Available on both server (from app config or per-request override) and client
   * (read from window.__CDN_BASE_URL__ injected into HTML by the server)
   * Empty string when no CDN is configured
   */
  cdnBaseURL?: string;

  /**
   * Domain information computed server-side from the request hostname.
   * Available during SSR (computed per-request) and SSG when a `hostname` option is
   * provided at build time. `null` when hostname is not known (SSG without hostname
   * configured, or pure SPA — no server to compute it via the public suffix list).
   */
  domainInfo?: DomainInfo | null;

  /**
   * Request context revision counter for reactivity
   * Format: `${timestamp}-${counter}` (e.g., "1729123456789-0", "1729123456789-1")
   * Increments whenever request context is modified to trigger re-renders
   * @internal
   */
  requestContextRevision?: string;
}

/**
 * Default context value (React requirement for createContext)
 *
 * In practice, this default is rarely used because:
 * - Server (SSR/SSG): Provides proper context values during rendering
 * - Client: mountApp() reads window.__FRONTEND_APP_CONFIG__ and provides proper values
 *
 * This default only applies if context is accessed outside of proper providers,
 * which shouldn't happen in normal usage.
 */
const defaultContextValue: UnirendContextValue = {
  renderMode: 'client', // Default to client-only (SSR/SSG override this)
  isDevelopment: false, // Default to production
  fetchRequest: undefined,
  frontendAppConfig: undefined, // mountApp() reads from window.__FRONTEND_APP_CONFIG__
  requestContextRevision: '0-0', // Initial revision
};

/**
 * React context for Unirend
 */
export const UnirendContext =
  createContext<UnirendContextValue>(defaultContextValue);

/**
 * Provider props
 */
export interface UnirendProviderProps {
  children: ReactNode;
  value: UnirendContextValue;
}

/**
 * Request context management interface
 */
export interface RequestContextManager {
  /**
   * Get a value from the request context
   * @param key - The key to retrieve
   * @returns The value associated with the key, or undefined if not found
   */
  get: (key: string) => unknown;

  /**
   * Set a value in the request context
   * @param key - The key to set
   * @param value - The value to associate with the key
   */
  set: (key: string, value: unknown) => void;

  /**
   * Check if a key exists in the request context
   * @param key - The key to check
   * @returns true if the key exists, false otherwise
   */
  has: (key: string) => boolean;

  /**
   * Delete a value from the request context
   * @param key - The key to delete
   * @returns true if the key existed and was deleted, false if it didn't exist
   */
  delete: (key: string) => boolean;

  /**
   * Clear all values from the request context
   * @returns The number of keys that were cleared
   */
  clear: () => number;

  /**
   * Get all keys from the request context
   * @returns An array of all keys
   */
  keys: () => string[];

  /**
   * Get the number of entries in the request context
   * @returns The number of key-value pairs
   */
  size: () => number;
}

/**
 * Helper to get the entire request context object
 * Works across SSR, SSG, and client environments
 */
export function getRequestContextObject(
  context: UnirendContextValue,
): Record<string, unknown> | undefined {
  if (context.fetchRequest && hasSSRRequestContext(context.fetchRequest)) {
    // SSR: Read from fastify request context
    return context.fetchRequest.SSRHelpers.fastifyRequest.requestContext;
  } else if (
    context.fetchRequest &&
    hasSSGRequestContext(context.fetchRequest)
  ) {
    // SSG: Read from SSG request context
    return context.fetchRequest.SSGHelpers.requestContext;
  } else if (hasWindowRequestContext()) {
    // Client: Read from window global
    return (
      window as unknown as {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
      }
    ).__FRONTEND_REQUEST_CONTEXT__;
  } else {
    // No context available
    return undefined;
  }
}
