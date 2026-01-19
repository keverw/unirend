import type React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { wrapRouter } from './internal/WrapAppElement';
import type { UnirendContextValue } from './internal/UnirendContext';

/**
 * Result type indicating how the app was mounted
 * - "hydrated": App was hydrated over existing SSR/SSG content
 * - "rendered": App was rendered fresh (SPA mode)
 * - "not_found": Container element was not found in the DOM
 */
export type MountAppResult = 'hydrated' | 'rendered' | 'not_found';

/**
 * Options for mounting the app
 */
export type MountAppOptions = {
  /**
   * Whether to wrap the app element with React.StrictMode
   * @default true
   */
  strictMode?: boolean;
  /**
   * Optional custom wrapper component for additional providers
   * Applied after HelmetProvider but before StrictMode (StrictMode is always outermost)
   * Must be a React component that accepts children
   */
  wrapProviders?: React.ComponentType<{ children: React.ReactNode }>;
};

/**
 * Intelligently mounts a React Router-based app by detecting whether to hydrate or render.
 *
 * This is the primary function for client-side mounting in unirend. It provides a unified,
 * opinionated API that works seamlessly across different rendering contexts:
 * - SSR/SSG: Hydrates pre-rendered HTML content
 * - SPA: Creates a fresh root and renders the app
 *
 * The detection is based on whether the container already has child elements,
 * which indicates pre-rendered content that should be hydrated rather than replaced.
 *
 * @param containerID - The ID of the root DOM element (e.g., "root", "app")
 * @param routes - Your React Router routes configuration
 * @param options - Optional configuration for mounting behavior
 * @returns MountAppResult indicating the mounting strategy used or if it failed
 *
 * @example
 * ```typescript
 * import { mountApp } from 'unirend';
 * import { routes } from './routes';
 *
 * const result = mountApp('root', routes);
 *
 * // With custom providers
 * const customWrapper = (node) => (
 *   <ThemeProvider>
 *     <StateProvider>
 *       {node}
 *     </StateProvider>
 *   </ThemeProvider>
 * );
 *
 * const result = mountApp('root', routes, { wrapApp: customWrapper });
 *
 * if (result === 'hydrated') {
 *   console.log('Hydrated SSR content');
 * } else if (result === 'rendered') {
 *   console.log('Rendered as SPA');
 * } else {
 *   console.error('Failed to mount app');
 * }
 * ```
 */
export function mountApp(
  containerID: string,
  routes: RouteObject[],
  options: MountAppOptions = {},
): MountAppResult {
  // Attempt to find the container element in the DOM
  const container = document.getElementById(containerID);

  // Early return if container doesn't exist
  if (!container) {
    return 'not_found';
  }

  // Create browser router from routes
  const router = createBrowserRouter(routes);

  // Read frontend app config from injected global (if available)
  // The server injects this via window.__FRONTEND_APP_CONFIG__ during SSR/SSG
  // Clone it to prevent mutations from affecting the global or other consumers
  const globalConfig =
    typeof window !== 'undefined'
      ? (
          window as unknown as {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            __FRONTEND_APP_CONFIG__?: Record<string, unknown>;
          }
        ).__FRONTEND_APP_CONFIG__
      : undefined;

  const frontendAppConfig = globalConfig
    ? structuredClone(globalConfig)
    : undefined;

  // Provide default Unirend context for client-side
  // Note: When hydrating SSR/SSG content, the server provides the correct context values
  // This default is only used for pure client-side SPA scenarios (no SSR/SSG)
  const unirendContext: UnirendContextValue = {
    renderMode: 'client', // Pure client-side (server overrides to "ssr" or "ssg" during server rendering)
    isDevelopment: Boolean(import.meta.env.DEV), // Vite sets this: true in dev, false in production build
    fetchRequest: undefined, // No server request on client
    frontendAppConfig, // Config injected by server (SSR/SSG) or undefined (pure SPA)
    requestContextRevision: '0-0', // Initial revision for client-side
  };

  // Wrap the router with configured options
  const wrappedAppElement = wrapRouter(router, {
    ...options,
    unirendContext,
  });

  // Check if container has existing content (indicates SSR/SSG)
  // firstElementChild is more reliable than innerHTML for detecting pre-rendered content
  if (container.firstElementChild) {
    // Container has existing elements - this is likely SSR/SSG content
    // Use hydrateRoot to preserve the existing DOM and attach React event handlers
    hydrateRoot(container, wrappedAppElement);

    return 'hydrated';
  } else {
    // Container is empty - this is SPA mode or development
    // Use createRoot to render the app from scratch
    const root = createRoot(container);
    root.render(wrappedAppElement);

    return 'rendered';
  }
}
