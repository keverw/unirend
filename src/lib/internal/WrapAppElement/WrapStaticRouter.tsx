import React from 'react';
import { StaticRouterProvider } from 'react-router';
import type { StaticHandlerContext } from 'react-router';
import type { HeadCollector } from '../UnirendHead';
import { createAppWrapper } from './CreateAppWrapper';
import type { WrapAppElementOptions } from './types';

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
