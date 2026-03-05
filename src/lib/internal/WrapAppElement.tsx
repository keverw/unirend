import React from 'react';
import type { ReactNode } from 'react';
import { UnirendHeadProvider } from './UnirendHead';
import type { HeadCollector } from './UnirendHead';
import { RouterProvider, StaticRouterProvider } from 'react-router';
import type { DataRouter, StaticHandlerContext } from 'react-router';
import { UnirendProvider } from './UnirendContext';
import type { UnirendContextValue } from './UnirendContext';
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
   * Optional custom wrapper component for additional providers
   * Applied after UnirendHeadProvider but before StrictMode (StrictMode is always outermost)
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
 * UnirendHead wrapper — on server passes the collector, on client passes null
 */
function UnirendHeadWrapper({
  collector,
  children,
}: {
  collector?: HeadCollector;
  children: ReactNode;
}) {
  return (
    <UnirendHeadProvider collector={collector ?? null}>
      {children}
    </UnirendHeadProvider>
  );
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
 * StrictMode (outermost) > UnirendProvider > UnirendHeadProvider > wrapProviders > RouterElement (innermost)
 *
 * The key insight is that client and server should render identically:
 * - Router type (RouterProvider vs StaticRouterProvider) - different
 * - UnirendHeadProvider - SAME on both, but server gets a collector, client gets null
 * - UnirendProvider - SAME on both, provides render mode and server context
 *
 * @param routerElement - The router element (RouterProvider or StaticRouterProvider)
 * @param options - Configuration options for wrapping
 * @param headCollector - Head data collector for server-side rendering (null on client)
 * @returns The wrapped React element
 */

function createAppWrapper(
  routerElement: React.ReactElement,
  options: WrapAppElementOptions,
  headCollector?: HeadCollector,
): React.ReactElement {
  const {
    strictMode: isStrictMode = true,
    wrapProviders,
    unirendContext,
  } = options;

  return (
    <ConditionalStrictMode isEnabled={isStrictMode}>
      <UnirendProvider value={unirendContext}>
        <UnirendHeadWrapper collector={headCollector}>
          <CustomWrapper WrapComponent={wrapProviders}>
            {routerElement}
          </CustomWrapper>
        </UnirendHeadWrapper>
      </UnirendProvider>
    </ConditionalStrictMode>
  );
}

/**
 * CLIENT-SIDE: Wraps a Browser Router with the standard app wrappers
 * Uses RouterProvider with UnirendHeadProvider (null collector — React 19 hoists natively)
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
 * Uses StaticRouterProvider with UnirendHeadProvider (collector captures head data)
 *
 * @param router - The Static Router instance
 * @param context - The static router context
 * @param options - Configuration options for wrapping
 * @param headCollector - Head data collector for server-side rendering
 * @returns The wrapped StaticRouterProvider element
 */

export function wrapStaticRouter(
  router: Parameters<typeof StaticRouterProvider>[0]['router'],
  context: StaticHandlerContext,
  options: WrapAppElementOptions,
  headCollector?: HeadCollector,
): React.ReactElement {
  const routerElement = (
    <StaticRouterProvider router={router} context={context} />
  );

  return createAppWrapper(routerElement, options, headCollector);
}
