import { unirendBaseRender } from '../../../src/server';
import type { RenderRequest } from '../../../src/server';
import { routes } from './routes';

/**
 * SSR entry point for server-side rendering
 *
 * This function is called by the unirend SSR server to render each page
 * at runtime. It accepts a render request object and passes the routes
 * to the base render function to handle all router creation and wrapping.
 *
 * @param renderRequest - The render request containing type and other options
 * @returns RenderResult with the rendered HTML and metadata
 */
export async function render(renderRequest: RenderRequest) {
  // Use the base render function - it handles router creation internally
  // including static handler/router creation, helmet context, StrictMode, and RouterProvider
  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true, // Enable StrictMode for SSR
    // wrapProviders: ({ children }) => <CustomProvider>{children}</CustomProvider>, // Optional custom wrapper
  });
}
