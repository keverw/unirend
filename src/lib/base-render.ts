import { IRenderRequest, IRenderResult } from './types';
import { type ReactNode } from 'react';
import {
  createStaticRouter,
  createStaticHandler,
  type RouteObject,
  StaticHandlerContext,
} from 'react-router';
import { wrapStaticRouter } from './internal/WrapAppElement';
import { renderToString } from 'react-dom/server';
import { type HelmetServerState } from 'react-helmet-async';

// Debug flag to enable/disable logging in the base renderer
const DEBUG_BASE_RENDER = false; // Set to false in a production release

/**
 * Options for base rendering, simplified API
 */
export type BaseRenderOptions = {
  /**
   * Whether to wrap the app element with React.StrictMode
   * @default true
   */
  strictMode?: boolean;
  /**
   * Optional custom wrapper component for additional providers
   * Applied after HelmetProvider but before StrictMode (StrictMode is always outermost)
   * Must be a React component that accepts children
   */
  wrapProviders?: React.ComponentType<{ children: ReactNode }>;
};

/**
 * Base render function that handles React Router wrapping and rendering.
 *
 * This function takes routes and handles all the router creation and wrapping logic
 * internally, including helmet context creation for SSR/SSG scenarios.
 *
 * @param renderRequest - The render request containing type, URL, and other options
 * @param routes - The React Router routes configuration
 * @param options - Optional configuration for rendering behavior
 * @returns IRenderResult with the rendered HTML and metadata
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = unirendBaseRender({ type: "ssg", url: "/" }, routes);
 *
 * // With custom wrapper
 * const customWrapper = (node) => <ThemeProvider>{node}</ThemeProvider>;
 * const result = unirendBaseRender(
 *   { type: "ssg", url: "/about" },
 *   routes,
 *   { wrapApp: customWrapper }
 * );
 *
 * // Without StrictMode
 * const result = unirendBaseRender(
 *   { type: "ssr", url: "/contact" },
 *   routes,
 *   { strictMode: false }
 * );
 * ```
 */
export async function unirendBaseRender(
  renderRequest: IRenderRequest,
  routes: RouteObject[],
  options: BaseRenderOptions = {},
): Promise<IRenderResult> {
  // Create new instances per request for isolation
  const helmetContext: { helmet?: HelmetServerState } = {}; // Object to hold Helmet data

  // Create a Static Handler
  // The handler examines the routes and prepares data for rendering
  const handler = createStaticHandler(routes);

  // Pass the Fetch Request and Query the Handler
  // Pass the request to the handler to get a rendering context
  let context: StaticHandlerContext | Response;

  try {
    context = await handler.query(renderRequest.fetchRequest);
  } catch (e) {
    if (DEBUG_BASE_RENDER) {
      // eslint-disable-next-line no-console
      console.error('Error querying static handler:', e);
    }

    // Return error result instead of generic 500 response
    return {
      resultType: 'render-error',
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }

  // Handle Redirects and Other Responses
  // If the handler returns a Response, it's a redirect or error, pass it along
  if (context instanceof Response) {
    // Log redirects for debugging
    if (DEBUG_BASE_RENDER && context.status >= 300 && context.status < 400) {
      // eslint-disable-next-line no-console
      console.log(`Redirecting to: ${context.headers.get('Location')}`);
    }

    // Note: We return the response here. The server framework (Express)
    // needs to catch this and handle the response accordingly (e.g., res.redirect).
    return {
      resultType: 'response',
      response: context,
    };
  }

  // Ensure context is not undefined or null before proceeding
  if (!context) {
    if (DEBUG_BASE_RENDER) {
      // eslint-disable-next-line no-console
      console.error(
        'Static handler query returned undefined context for request:',
        renderRequest.fetchRequest.url,
      );
    }

    // When throwing here, it won't return RenderResult, but the catch block
    // in server.ts handles this. This throw is correct.
    return {
      resultType: 'response',
      response: new Response('Not Found', { status: 404 }),
    };
  }

  // 5. Create Static Router
  // Use the context from the handler to create the router instance
  const router = createStaticRouter(handler.dataRoutes, context);

  // ---> Get the status code from the context BEFORE rendering
  let statusCode = context.statusCode || 200; // Default to 200 if no error/response
  let errorDetails: Error | undefined = undefined;

  const ssOnlyData: Record<string, unknown> = {};

  // Check for __ssOnly data, extract it and remove it from the context
  for (const key in context.loaderData) {
    const data = context.loaderData[key] as Record<string, unknown> | undefined;

    if (
      data &&
      typeof data === 'object' &&
      '__ssOnly' in data &&
      data.__ssOnly
    ) {
      // Clone the __ssOnly data to avoid modifying the original
      Object.assign(ssOnlyData, structuredClone(data.__ssOnly));

      // remove __ssOnly from the data since it doesn't need to be sent to the client
      // and will not appear in the window.__staticRouterHydrationData object
      delete data.__ssOnly;
    }
  }

  // Check for React Router context.errors first (the status code will default if error boundary is hit)
  if (context.errors && statusCode === 500) {
    for (const key in context.errors) {
      const error = context.errors[key] as Error & { status?: number };

      // Extract status code if available
      if (error.status && typeof error.status === 'number') {
        statusCode = error.status;
      }

      // Use the error object directly
      errorDetails = error;

      break; // Handle the first error we find
    }
  }
  // Check if any loaders returned a status code or error following our API envelope
  else if (context?.loaderData) {
    for (const key in context.loaderData) {
      const data = context.loaderData[key] as
        | {
            status_code?: number;
            error?: {
              message?: string;
              details?: { stacktrace?: string };
            };
          }
        | undefined;

      let hasDataInThisEntry = false;

      // Check for our API envelope status_code if a custom status code is not already set
      if (
        data?.status_code &&
        typeof data.status_code === 'number' &&
        statusCode === 200
      ) {
        statusCode = data.status_code;
        hasDataInThisEntry = true;
      }

      // Check for our API envelope error object
      if (data?.error && typeof data.error === 'object') {
        // Create Error object from the envelope
        const errorMessage =
          typeof data.error.message === 'string'
            ? data.error.message
            : 'Unknown error';
        const errorObj = new Error(errorMessage);

        // Add stack trace if available
        if (
          data.error.details &&
          typeof data.error.details === 'object' &&
          typeof data.error.details.stacktrace === 'string'
        ) {
          errorObj.stack = data.error.details.stacktrace;
        }

        // Mark this as an API envelope error
        (errorObj as Error & { source?: string }).source = 'api-envelope';

        errorDetails = errorObj;
        hasDataInThisEntry = true;
      }

      // If we found relevant data in this entry, we can break
      if (hasDataInThisEntry) {
        break;
      }
    }
  }

  // Render the App HTML
  const wrappedElement = wrapStaticRouter(
    router,
    context,
    {
      strictMode: options.strictMode,
      wrapProviders: options.wrapProviders,
      unirendContext: renderRequest.unirendContext, // unirendContext is always provided in renderRequest by SSRServer or SSG Generation
    },
    helmetContext,
  );

  const appHtml = renderToString(wrappedElement);

  // Extract helmet data AFTER rendering
  const { helmet } = helmetContext;

  // TODO: Inject Preload Links (using ssrManifest)
  // This part requires logic to parse the ssrManifest and context.modules
  // to generate <link rel="modulepreload"> tags.
  // Most likely only want the main entry, not the chunks
  const preloadLinks = ''; // Placeholder

  return {
    resultType: 'page',
    html: appHtml,
    preloadLinks: preloadLinks,
    helmet,
    statusCode: statusCode,
    errorDetails: errorDetails,
    ssOnlyData: ssOnlyData,
  };
}
