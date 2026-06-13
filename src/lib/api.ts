import { APIServer } from './internal/api-server';
import type { APIServerOptions, PlainServerOptions } from './types';

export type PlainServer = Omit<
  APIServer,
  'APIResponseHelpersClass' | 'api' | 'pageDataHandler'
>;

/**
 * Create an API server instance
 *
 * This creates a JSON API server with plugin support and full wildcard route flexibility.
 * Unlike SSR servers, this allows plugins to register any wildcard routes including root wildcards.
 * Returns an APIServer instance that you can then start with .listen(port, host).
 *
 * @param options Configuration options for the API server
 * @returns APIServer instance ready to be started
 *
 * @example
 * ```typescript
 * import { serveAPI } from 'unirend/server';
 *
 * const server = serveAPI({
 *   plugins: [
 *     async (fastify, options) => {
 *       // Full wildcard support - even root wildcards are allowed.
 *       // Like Fastify, handlers can return the payload synchronously...
 *       fastify.get('/api/*', (request, reply) => {
 *         return { message: 'API wildcard route' };
 *       });
 *
 *       // ...or be async when you need to await something.
 *       fastify.get('*', async (request, reply) => {
 *         return { message: 'Catch-all route' };
 *       });
 *     }
 *   ],
 *   errorHandler: (request, error, isDev) => ({
 *     error: true,
 *     message: error.message,
 *     path: request.url,
 *     timestamp: new Date().toISOString()
 *   })
 * });
 *
 * // Start the server
 * await server.listen(3001, 'localhost');
 * ```
 */
export function serveAPI(options: APIServerOptions = {}): APIServer {
  return new APIServer(options);
}

/**
 * Create a plain web server instance.
 *
 * This is a small wrapper around APIServer with API/page-data routing disabled.
 * Use plugins and raw `pluginHost.get/post/...` routes for content. Function-form
 * error, not-found, and closing handlers return `WebResponse`.
 *
 * Note: disabling envelope routing only affects HTTP routes. WebSocket upgrade
 * rejection is a separate, mode-independent concern, so
 * `registerWebSocketHandler()` still rejects with an `APIResponseEnvelope`
 * (and accepts the optional `<M>` meta type) even on a plain server.
 *
 * @param options Configuration options for the plain web server
 * @returns PlainServer instance ready to be started
 */
export function servePlain(options: PlainServerOptions = {}): PlainServer {
  return new APIServer({
    ...options,
    apiEndpoints: { apiEndpointPrefix: false },
  });
}

export { APIServer } from './internal/api-server';
