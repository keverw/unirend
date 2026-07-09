import { unirendBaseRender } from '../../src/server';
import type { RenderRequest } from '../../src/server';

// Import shared routes
import { routes } from './Routes';

/**
 * SSR entry point for server-side rendering.
 *
 * Called by the Unirend SSR server to render each page at runtime. It passes
 * the routes to the base render function, which handles router creation and
 * wrapping (UnirendProvider, head provider, StrictMode, StaticRouterProvider).
 */
export async function render(renderRequest: RenderRequest) {
  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true,
  });
}
