import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

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
function hasSSRRequestContext(request: Request): request is Request & {
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
function hasSSGRequestContext(request: Request): request is Request & {
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
function hasWindowRequestContext(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const ctx = (window as Window & { __FRONTEND_REQUEST_CONTEXT__?: unknown })
    .__FRONTEND_REQUEST_CONTEXT__;

  return '__FRONTEND_REQUEST_CONTEXT__' in window && typeof ctx === 'object';
}

/**
 * Helper to get a value from request context storage
 * Works across SSR, SSG, and client environments
 */
function getRequestContextValue(
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
function setRequestContextValue(
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
        __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
      }
    ).__FRONTEND_REQUEST_CONTEXT__[key] = value;
    incrementContextRevision(context);
  } else {
    // No context available - create one on window for client-side
    if (typeof window !== 'undefined') {
      (
        window as unknown as {
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
function incrementContextRevision(context: UnirendContextValue): void {
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
const UnirendContext = createContext<UnirendContextValue>(defaultContextValue);

/**
 * Provider props
 */
export interface UnirendProviderProps {
  children: ReactNode;
  value: UnirendContextValue;
}

/**
 * UnirendProvider component that provides context to the app
 *
 * @example
 * ```tsx
 * <UnirendProvider value={{ renderMode: 'ssr', isDevelopment: true }}>
 *   <App />
 * </UnirendProvider>
 * ```
 */
export function UnirendProvider({ children, value }: UnirendProviderProps) {
  return (
    <UnirendContext.Provider value={value}>{children}</UnirendContext.Provider>
  );
}

/**
 * Hook to check if the app is rendering in SSR mode
 *
 * @returns true if rendering mode is 'ssr', false if 'ssg'
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isSSR = useIsSSR();
 *
 *   return <div>{isSSR ? 'Server-Side Rendered' : 'Static Generated'}</div>;
 * }
 * ```
 */
export function useIsSSR(): boolean {
  const { renderMode } = useContext(UnirendContext);
  return renderMode === 'ssr';
}

/**
 * Hook to check if the app is rendering in SSG mode
 *
 * @returns true if rendering mode is 'ssg', false otherwise
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isSSG = useIsSSG();
 *
 *   return <div>{isSSG ? 'Static Generated' : 'Not SSG'}</div>;
 * }
 * ```
 */
export function useIsSSG(): boolean {
  const { renderMode } = useContext(UnirendContext);
  return renderMode === 'ssg';
}

/**
 * Hook to check if the app is in client mode
 * Returns true for SPAs or after SSG build/SSR page hydration occurs
 *
 * @returns true if rendering mode is 'client', false otherwise
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isClient = useIsClient();
 *
 *   return <div>{isClient ? 'Client Mode' : 'Server Rendering'}</div>;
 * }
 * ```
 */
export function useIsClient(): boolean {
  const { renderMode } = useContext(UnirendContext);
  return renderMode === 'client';
}

/**
 * Hook to get the render mode
 *
 * @returns The current render mode ('ssr', 'ssg', or 'client')
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const renderMode = useRenderMode();
 *
 *   return <div>Render Mode: {renderMode}</div>;
 * }
 * ```
 */
export function useRenderMode(): UnirendRenderMode {
  const { renderMode } = useContext(UnirendContext);
  return renderMode;
}

/**
 * Hook to check if the app is running in development mode
 *
 * @returns true if in development mode, false if in production
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isDev = useIsDevelopment();
 *
 *   return (
 *     <div>
 *       {isDev && <div>Development Mode - Debug Info</div>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useIsDevelopment(): boolean {
  const { isDevelopment } = useContext(UnirendContext);
  return isDevelopment;
}

/**
 * Hook to check if the code is running on the server (SSR)
 * This checks if fetchRequest has the SSRHelper property attached
 *
 * @returns true if on SSR server (has SSRHelper), false if on client or SSG
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isServer = useIsServer();
 *
 *   return (
 *     <div>
 *       {isServer ? 'Running on SSR server' : 'Running on client or SSG'}
 *     </div>
 *   );
 * }
 * ```
 */
export function useIsServer(): boolean {
  const { fetchRequest } = useContext(UnirendContext);
  return fetchRequest !== undefined && 'SSRHelper' in fetchRequest;
}

/**
 * Hook to access the frontend application configuration
 * This is a frozen (immutable) copy of the config passed to the server
 * Available on both server and client
 *
 * @returns The frontend app config object, or undefined if not provided
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const config = useFrontendAppConfig();
 *
 *   if (!config) {
 *     return <div>No config available</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <p>API URL: {config.apiUrl}</p>
 *       <p>App Name: {config.appName}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useFrontendAppConfig(): Record<string, unknown> | undefined {
  const { frontendAppConfig } = useContext(UnirendContext);
  return frontendAppConfig;
}

/**
 * Helper to get the entire request context object
 * Works across SSR, SSG, and client environments
 */
function getRequestContextObject(
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
        __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
      }
    ).__FRONTEND_REQUEST_CONTEXT__;
  } else {
    // No context available
    return undefined;
  }
}

/**
 * Hook to get the raw request context object for debugging purposes.
 * Returns a cloned, immutable copy of the entire request context.
 *
 * **Note:** This is primarily for debugging. Use `useRequestContextValue()`
 * or `useRequestContext()` for production code.
 *
 * @returns A cloned copy of the request context object, or undefined if not populated
 *
 * @example
 * ```tsx
 * function DebugPanel() {
 *   const rawContext = useRequestContextObjectRaw();
 *
 *   if (!rawContext) {
 *     return <div>Request context not populated</div>;
 *   }
 *
 *   return (
 *     <pre>{JSON.stringify(rawContext, null, 2)}</pre>
 *   );
 * }
 * ```
 */
export function useRequestContextObjectRaw():
  | Record<string, unknown>
  | undefined {
  const context = useContext(UnirendContext);
  const [rawContext, setRawContext] = useState<
    Record<string, unknown> | undefined
  >(() => {
    // Get initial value on server
    const contextObj = getRequestContextObject(context);
    return contextObj ? Object.freeze(structuredClone(contextObj)) : undefined;
  });

  useEffect(() => {
    // Update when context changes (reactive to modifications)
    const contextObj = getRequestContextObject(context);

    if (contextObj) {
      // Create a cloned, immutable copy
      const cloned = structuredClone(contextObj);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronizing with external state (request context) tracked by revision counter
      setRawContext(Object.freeze(cloned));
    } else {
      setRawContext(undefined);
    }
  }, [context.requestContextRevision, context]);

  return rawContext;
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
 * Hook to access and manage the request context
 *
 * Returns an object with methods to get, set, check, delete, and inspect
 * the request context. The returned methods can be safely called in callbacks,
 * effects, or event handlers.
 *
 * @returns RequestContextManager object with context management methods
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const requestContext = useRequestContext();
 *
 *   const handleThemeChange = (theme: string) => {
 *     requestContext.set('theme', theme);
 *   };
 *
 *   const userID = requestContext.get('userID');
 *   const hasTheme = requestContext.has('theme');
 *   const allKeys = requestContext.keys();
 *
 *   return (
 *     <div>
 *       <p>User ID: {userID}</p>
 *       <p>Has theme: {hasTheme ? 'Yes' : 'No'}</p>
 *       <p>Total entries: {requestContext.size()}</p>
 *       <button onClick={() => handleThemeChange('dark')}>Dark Theme</button>
 *       <button onClick={() => requestContext.clear()}>Clear All</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useRequestContext(): RequestContextManager {
  const context = useContext(UnirendContext);

  return {
    get: (key: string): unknown => {
      return getRequestContextValue(context, key);
    },
    set: (key: string, value: unknown): void => {
      setRequestContextValue(context, key, value);
    },
    has: (key: string): boolean => {
      // Try SSR first - check if we have SSR helpers with request context
      if (context.fetchRequest && hasSSRRequestContext(context.fetchRequest)) {
        // SSR: Check if key exists in fastify request context
        return (
          key in context.fetchRequest.SSRHelpers.fastifyRequest.requestContext
        );
      } else if (
        // Try SSG - check if we have SSG helpers with request context
        context.fetchRequest &&
        hasSSGRequestContext(context.fetchRequest)
      ) {
        // SSG: Check if key exists in SSG request context
        return key in context.fetchRequest.SSGHelpers.requestContext;
      } else if (hasWindowRequestContext()) {
        // Client: Check if key exists in window global
        return (
          key in
          (
            window as unknown as {
              __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
            }
          ).__FRONTEND_REQUEST_CONTEXT__
        );
      } else {
        // No context available
        return false;
      }
    },
    delete: (key: string): boolean => {
      let didExist = false;

      // Try SSR first - check if we have SSR helpers with request context
      if (context.fetchRequest && hasSSRRequestContext(context.fetchRequest)) {
        // SSR: Delete from fastify request context
        didExist =
          key in context.fetchRequest.SSRHelpers.fastifyRequest.requestContext;

        // eslint-disable-next-line react-hooks/immutability -- requestContext is intentionally mutable (context itself is not modified)
        delete context.fetchRequest.SSRHelpers.fastifyRequest.requestContext[
          key
        ];
      } else if (
        // Try SSG - check if we have SSG helpers with request context
        context.fetchRequest &&
        hasSSGRequestContext(context.fetchRequest)
      ) {
        // SSG: Delete from SSG request context
        didExist = key in context.fetchRequest.SSGHelpers.requestContext;
        delete context.fetchRequest.SSGHelpers.requestContext[key];
      } else if (hasWindowRequestContext()) {
        // Client: Delete from window global
        const ctx = (
          window as unknown as {
            __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
          }
        ).__FRONTEND_REQUEST_CONTEXT__;

        didExist = key in ctx;
        delete ctx[key];
      }

      // Increment revision to trigger re-renders if key existed
      if (didExist) {
        incrementContextRevision(context);
      }

      return didExist;
    },
    clear: (): number => {
      let count = 0;

      // Try SSR first - check if we have SSR helpers with request context
      if (context.fetchRequest && hasSSRRequestContext(context.fetchRequest)) {
        // SSR: Clear all keys from fastify request context
        const ctx =
          context.fetchRequest.SSRHelpers.fastifyRequest.requestContext;
        const keys = Object.keys(ctx);
        count = keys.length;

        // Delete each key individually to preserve object reference
        for (const key of keys) {
          // eslint-disable-next-line react-hooks/immutability -- requestContext is intentionally mutable (context itself is not modified)
          delete ctx[key];
        }
      } else if (
        // Try SSG - check if we have SSG helpers with request context
        context.fetchRequest &&
        hasSSGRequestContext(context.fetchRequest)
      ) {
        // SSG: Clear all keys from SSG request context
        const ctx = context.fetchRequest.SSGHelpers.requestContext;
        const keys = Object.keys(ctx);
        count = keys.length;

        // Delete each key individually to preserve object reference
        for (const key of keys) {
          delete ctx[key];
        }
      } else if (hasWindowRequestContext()) {
        // Client: Clear all keys from window global
        const ctx = (
          window as unknown as {
            __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
          }
        ).__FRONTEND_REQUEST_CONTEXT__;

        const keys = Object.keys(ctx);
        count = keys.length;

        // Delete each key individually to preserve object reference
        for (const key of keys) {
          delete ctx[key];
        }
      }

      // Increment revision to trigger re-renders if any keys were cleared
      if (count > 0) {
        incrementContextRevision(context);
      }

      return count;
    },
    keys: (): string[] => {
      // Try SSR first - check if we have SSR helpers with request context
      if (context.fetchRequest && hasSSRRequestContext(context.fetchRequest)) {
        // SSR: Return keys from fastify request context
        return Object.keys(
          context.fetchRequest.SSRHelpers.fastifyRequest.requestContext,
        );
      } else if (
        // Try SSG - check if we have SSG helpers with request context
        context.fetchRequest &&
        hasSSGRequestContext(context.fetchRequest)
      ) {
        // SSG: Return keys from SSG request context
        return Object.keys(context.fetchRequest.SSGHelpers.requestContext);
      } else if (hasWindowRequestContext()) {
        // Client: Return keys from window global
        return Object.keys(
          (
            window as unknown as {
              __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
            }
          ).__FRONTEND_REQUEST_CONTEXT__,
        );
      } else {
        // No context available - return empty array
        return [];
      }
    },
    size: (): number => {
      // Try SSR first - check if we have SSR helpers with request context
      if (context.fetchRequest && hasSSRRequestContext(context.fetchRequest)) {
        // SSR: Return count of keys from fastify request context
        return Object.keys(
          context.fetchRequest.SSRHelpers.fastifyRequest.requestContext,
        ).length;
      } else if (
        // Try SSG - check if we have SSG helpers with request context
        context.fetchRequest &&
        hasSSGRequestContext(context.fetchRequest)
      ) {
        // SSG: Return count of keys from SSG request context
        return Object.keys(context.fetchRequest.SSGHelpers.requestContext)
          .length;
      } else if (hasWindowRequestContext()) {
        // Client: Return count of keys from window global
        return Object.keys(
          (
            window as unknown as {
              __FRONTEND_REQUEST_CONTEXT__: Record<string, unknown>;
            }
          ).__FRONTEND_REQUEST_CONTEXT__,
        ).length;
      } else {
        // No context available - return 0
        return 0;
      }
    },
  };
}

/**
 * Hook to access and reactively update a single request context value
 *
 * Similar to useState, this hook returns a tuple of [value, setValue] and will
 * cause the component to re-render when the value changes.
 *
 * @param key - The key to track in the request context
 * @returns A tuple of [value, setValue] similar to useState
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const [theme, setTheme] = useRequestContextValue<string>('theme');
 *
 *   return (
 *     <div>
 *       <p>Current theme: {theme || 'default'}</p>
 *       <button onClick={() => setTheme('dark')}>Dark</button>
 *       <button onClick={() => setTheme('light')}>Light</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useRequestContextValue<T = unknown>(
  key: string,
): [T | undefined, (value: T) => void] {
  const context = useContext(UnirendContext);

  // State to track the current value
  const [value, setValue] = useState<T | undefined>(
    () => getRequestContextValue(context, key) as T | undefined,
  );

  // Effect to sync value when requestContextRevision changes (from other components)
  // We intentionally only depend on requestContextRevision, not key
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronizing with external state (request context) tracked by revision counter
    setValue(getRequestContextValue(context, key) as T | undefined);
  }, [context.requestContextRevision, context, key]);

  // Setter function that updates storage and increments revision
  const setContextValue = (newValue: T): void => {
    setRequestContextValue(context, key, newValue);
    // Update local state immediately for this component
    setValue(newValue);
  };

  return [value, setContextValue];
}
