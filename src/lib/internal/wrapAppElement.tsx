import React, { type ReactNode } from 'react';
import { HelmetProvider, type HelmetServerState } from 'react-helmet-async';
import {
  type DataRouter,
  RouterProvider,
  StaticRouterProvider,
  type StaticHandlerContext,
} from 'react-router';
import { UnirendProvider, type UnirendContextValue } from './UnirendContext';

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
  helmetContext?: unknown;
  /**
   * Optional custom wrapper component for additional providers
   * Applied after HelmetProvider but before StrictMode (StrictMode is always outermost)
   * Must be a React component that accepts children
   */
  wrapProviders?: React.ComponentType<{ children: ReactNode }>;
  /**
   * Unirend context value to provide to the app
   * Contains render mode, development status, and server request info
   * Always provided by mountApp, SSRServer, or SSG
   */
  unirendContext: UnirendContextValue;
};

/**
 * Conditional StrictMode wrapper component
 */
function ConditionalStrictMode({
  isEnabled,
  children,
}: {
  isEnabled: boolean;
  children: ReactNode;
}) {
  if (isEnabled) {
    return <React.StrictMode>{children}</React.StrictMode>;
  }

  return <>{children}</>;
}

/**
 * Helmet wrapper component that handles both client and server cases
 */
function HelmetWrapper({
  context,
  children,
}: {
  context?: { helmet?: HelmetServerState };
  children: ReactNode;
}) {
  return <HelmetProvider context={context}>{children}</HelmetProvider>;
}

/**
 * Custom wrapper component handler
 */
function CustomWrapper({
  WrapComponent,
  children,
}: {
  WrapComponent?: React.ComponentType<{ children: ReactNode }>;
  children: ReactNode;
}) {
  if (WrapComponent) {
    return <WrapComponent>{children}</WrapComponent>;
  }

  return <>{children}</>;
}

/**
 * Core unified wrapper function that applies the standard app wrapper chain
 * This ensures EXACTLY the same wrapping order between client and server:
 * StrictMode (outermost) > UnirendProvider > HelmetProvider (BOTH) > wrapProviders > RouterElement (innermost)
 *
 * The key insight is that client and server should render identically:
 * - Router type (RouterProvider vs StaticRouterProvider) - different
 * - HelmetProvider - SAME on both, but server gets context, client gets undefined
 * - UnirendProvider - SAME on both, provides render mode and server context
 *
 * @param routerElement - The router element (RouterProvider or StaticRouterProvider)
 * @param options - Configuration options for wrapping
 * @param helmetContext - Optional Helmet context for server-side rendering
 * @returns The wrapped React element
 */

function createAppWrapper(
  routerElement: React.ReactElement,
  options: WrapAppElementOptions,
  helmetContext?: { helmet?: HelmetServerState },
): React.ReactElement {
  const {
    strictMode: isStrictMode = true,
    wrapProviders,
    unirendContext,
  } = options;

  return (
    <ConditionalStrictMode isEnabled={isStrictMode}>
      <UnirendProvider value={unirendContext}>
        <HelmetWrapper context={helmetContext}>
          <CustomWrapper WrapComponent={wrapProviders}>
            {routerElement}
          </CustomWrapper>
        </HelmetWrapper>
      </UnirendProvider>
    </ConditionalStrictMode>
  );
}

/**
 * CLIENT-SIDE: Wraps a Browser Router with the standard app wrappers
 * Uses RouterProvider with HelmetProvider (no context)
 *
 * @param router - The Browser Router instance
 * @param options - Configuration options for wrapping
 * @returns The wrapped RouterProvider element
 */

export function wrapRouter(
  router: DataRouter,
  options: WrapAppElementOptions,
): React.ReactElement {
  const routerElement = <RouterProvider router={router} />;
  return createAppWrapper(routerElement, options);
}

/**
 * SERVER-SIDE: Wraps a Static Router with the standard app wrappers
 * Uses StaticRouterProvider with HelmetProvider (with context)
 *
 * @param router - The Static Router instance
 * @param context - The static router context
 * @param options - Configuration options for wrapping
 * @param helmetContext - Helmet context for server-side rendering
 * @returns The wrapped StaticRouterProvider element
 */

export function wrapStaticRouter(
  router: Parameters<typeof StaticRouterProvider>[0]['router'],
  context: StaticHandlerContext,
  options: WrapAppElementOptions,
  helmetContext?: { helmet?: HelmetServerState },
): React.ReactElement {
  const routerElement = (
    <StaticRouterProvider router={router} context={context} />
  );

  // Pass helmetContext = server-side (includes HelmetProvider)
  return createAppWrapper(routerElement, options, helmetContext);
}
