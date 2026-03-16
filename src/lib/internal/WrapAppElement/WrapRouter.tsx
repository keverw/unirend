import type { ReactElement } from 'react';
import { RouterProvider } from 'react-router';
import type { DataRouter } from 'react-router';
import { createAppWrapper } from './CreateAppWrapper';
import type { WrapAppElementOptions } from './types';

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
): ReactElement {
  const routerElement = <RouterProvider router={router} />;
  return createAppWrapper(routerElement, options);
}
