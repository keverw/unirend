import { APIServer } from './internal/APIServer';
import type { APIServerOptions } from './types';

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
 *   isDevelopment: true,
 *   plugins: [
 *     async (fastify, options) => {
 *       // Full wildcard support - even root wildcards are allowed
 *       fastify.get('/api/*', async (request, reply) => {
 *         return { message: 'API wildcard route' };
 *       });
 *
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

export { APIServer } from './internal/APIServer';
