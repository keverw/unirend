import React, { createContext, useContext, type ReactNode } from "react";

/**
 * Render mode type - SSR, SSG, or Client
 * - "ssr": Server-Side Rendering (runtime server rendering)
 * - "ssg": Static Site Generation (build-time server rendering)
 * - "client": Client-side execution (SPA or after a SSG build/SSR page hydration occurs)
 */
export type UnirendRenderMode = "ssr" | "ssg" | "client";

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
  renderMode: "client", // Default to client-only (SSR/SSG override this)
  isDevelopment: false, // Default to production
  fetchRequest: undefined,
  frontendAppConfig: undefined, // mountApp() reads from window.__FRONTEND_APP_CONFIG__
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
 * Hook to access the full Unirend context
 *
 * @returns The complete Unirend context value
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { renderMode, isDevelopment, fetchRequest } = useUnirendContext();
 *
 *   return (
 *     <div>
 *       <p>Render Mode: {renderMode}</p>
 *       <p>Development: {isDevelopment ? 'Yes' : 'No'}</p>
 *       {fetchRequest && <p>Request URL: {fetchRequest.url}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useUnirendContext(): UnirendContextValue {
  return useContext(UnirendContext);
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
  return renderMode === "ssr";
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
  return renderMode === "ssg";
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
  return renderMode === "client";
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
  return fetchRequest !== undefined && "SSRHelper" in fetchRequest;
}

/**
 * Hook to access the Fetch API Request object
 * Available during SSR and SSG generation, undefined on client after hydration
 *
 * @returns The Request object if during SSR/SSG, undefined if on client
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const request = useFetchRequest();
 *
 *   if (!request) {
 *     return <div>Client-side rendering</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <p>Request URL: {request.url}</p>
 *       <p>Request Method: {request.method}</p>
 *       <p>Headers: {request.headers.get('user-agent')}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useFetchRequest(): Request | undefined {
  const { fetchRequest } = useContext(UnirendContext);
  return fetchRequest;
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
