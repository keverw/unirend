import { unirendBaseRender, type IRenderRequest } from "../../../src";
import { routes } from "./routes";

/**
 * SSG entry point for static site generation
 *
 * This function is called by the unirend SSG generator to render each page
 * at build time. It accepts a render request object and passes the routes
 * to the base render function to handle all router creation and wrapping.
 *
 * @param renderRequest - The render request containing type and other options
 * @returns IRenderResult with the rendered HTML and metadata
 */
export async function render(renderRequest: IRenderRequest) {
  // Use the base render function - it handles router creation internally
  // including static handler/router creation, helmet context, StrictMode, and RouterProvider
  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true, // Enable StrictMode for SSG
    // wrapApp: (node) => <CustomProvider>{node}</CustomProvider>, // Optional custom wrapper
  });
}
