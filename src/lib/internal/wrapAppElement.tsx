import React from "react";
import { HelmetProvider } from "react-helmet-async";
import { RouterProvider } from "react-router";

/**
 * Options for wrapping app elements with various React wrappers
 */
export type WrapAppElementOptions = {
  /**
   * Whether to wrap the app element with React.StrictMode
   * @default true
   */
  strictMode?: boolean;
  /**
   * Optional helmet context for SSR scenarios
   * When provided, will be passed to HelmetProvider
   * @default undefined (creates new context automatically)
   */
  helmetContext?: any;
  /**
   * Optional custom wrapper function for additional providers
   * Applied after HelmetProvider but before StrictMode (StrictMode is always outermost)
   */
  wrapApp?: (node: React.ReactNode) => React.ReactElement;
};

/**
 * Generic function to wrap a React element with various wrappers based on options.
 * This function can be extended to support additional wrappers in the future.
 *
 * @param appElement - The React element to wrap
 * @param options - Configuration options for wrapping
 * @returns The wrapped React element
 *
 * @example
 * ```tsx
 * import { wrapAppElement } from 'unirend';
 * import App from './App';
 *
 * // With StrictMode (default) and automatic HelmetProvider
 * const wrappedApp = wrapAppElement(<App />, { strictMode: true });
 *
 * // Without StrictMode but with HelmetProvider
 * const unwrappedApp = wrapAppElement(<App />, { strictMode: false });
 *
 * // With custom helmet context for SSR
 * const helmetContext = {};
 * const ssrApp = wrapAppElement(<App />, { helmetContext });
 *
 * // With custom wrapper for additional providers
 * const customWrapper = (node) => <MyProvider>{node}</MyProvider>;
 * const wrappedApp = wrapAppElement(<App />, { wrapApp: customWrapper });
 * ```
 */
export function wrapAppElement(
  appElement: React.ReactElement,
  options: WrapAppElementOptions = {},
): React.ReactElement {
  const { strictMode = true, helmetContext, wrapApp } = options;

  let wrappedElement = appElement;

  // Always wrap with HelmetProvider (required for helmet functionality)
  // If helmetContext is provided (SSR), use it; otherwise let HelmetProvider create its own (when it's undefined client-side)
  if (helmetContext) {
    wrappedElement = (
      <HelmetProvider context={helmetContext}>{wrappedElement}</HelmetProvider>
    );
  } else {
    wrappedElement = <HelmetProvider>{wrappedElement}</HelmetProvider>;
  }

  // Apply custom wrapper if provided (after HelmetProvider, before StrictMode)
  // StrictMode should always be the outermost wrapper
  if (wrapApp) {
    wrappedElement = wrapApp(wrappedElement);
  }

  // Apply StrictMode wrapper if enabled (outermost wrapper)
  if (strictMode) {
    wrappedElement = <React.StrictMode>{wrappedElement}</React.StrictMode>;
  }

  return wrappedElement;
}

/**
 * Wraps a React Router instance with the standard app wrappers
 * This is a convenience function for router-based apps
 *
 * @param router - The React Router instance
 * @param options - Configuration options for wrapping
 * @returns The wrapped RouterProvider element
 *
 * @example
 * ```tsx
 * import { wrapRouter } from 'unirend';
 * import { createBrowserRouter } from 'react-router';
 *
 * const router = createBrowserRouter(routes);
 * const wrappedApp = wrapRouter(router);
 *
 * // With custom providers
 * const customWrapper = (node) => <MyProvider>{node}</MyProvider>;
 * const wrappedApp = wrapRouter(router, { wrapApp: customWrapper });
 * ```
 */
export function wrapRouter(
  router: any, // Using any to avoid importing specific router types
  options: WrapAppElementOptions = {},
): React.ReactElement {
  const routerElement = <RouterProvider router={router} />;
  return wrapAppElement(routerElement, options);
}
