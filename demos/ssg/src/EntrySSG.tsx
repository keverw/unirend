import { unirendBaseRender } from '../../../src/server';
import type { RenderRequest } from '../../../src/server';

// Import shared routes
import { routes } from './Routes';

// Import theme provider
import { ThemeProvider } from './components/theme/ThemeProvider';

/**
 * SSG entry point for static site generation
 *
 * This function is called by the Unirend SSG generator to render each page
 * at build time. It accepts a render request object and passes the routes
 * to the base render function to handle all router creation and wrapping.
 *
 * @param renderRequest - The render request containing type and other options
 * @returns RenderResult with the rendered HTML and metadata
 */

export async function render(renderRequest: RenderRequest) {
  // Use the base render function - it handles router creation internally
  // including static handler/router creation, UnirendProvider, UnirendHeadProvider, StrictMode, and StaticRouterProvider

  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true,
    // Sits above the router — good for themes, modals, toast containers, etc.
    // Keep it stable — errors here bypass React Router's errorElement (SSR: server failure, SSG: page render fails)
    rootProviders: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
  });
}
