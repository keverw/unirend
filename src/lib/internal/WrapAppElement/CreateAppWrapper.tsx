import type { ReactElement } from 'react';
import type { HeadCollector } from '../UnirendHead';
import { UnirendProvider } from '../UnirendContext';
import {
  ConditionalStrictMode,
  UnirendHeadWrapper,
  CustomWrapper,
} from './Wrappers';
import type { WrapAppElementOptions } from './types';

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

export function createAppWrapper(
  routerElement: ReactElement,
  options: WrapAppElementOptions,
  headCollector?: HeadCollector,
): ReactElement {
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
