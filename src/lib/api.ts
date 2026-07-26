import { APIServer } from './internal/api-server';
import type {
  APIResponseHelpersClass,
  APIServerAPIOptions,
  APIServerOptions,
  APIServerWebOptions,
  PlainServerOptions,
} from './types';

export type PlainServer = Omit<
  APIServer,
  'APIResponseHelpersClass' | 'api' | 'pageDataHandler'
>;

/**
 * Create an API server instance
 *
 * This creates a JSON API server with plugin support and full wildcard route flexibility.
 * Unlike SSR servers, this allows plugins to register any wildcard routes including root wildcards.
 * Returns an APIServer instance that you can then start with .listen(port, host)
 * or .listen({ path }) for Unix socket sidecar/internal deployments.
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
 * // Start the server over TCP
 * await server.listen(3001, 'localhost');
 *
 * // Or listen on a Unix socket for same-host sidecar/internal traffic:
 * // await server.listen({ path: '/tmp/my-api.sock' });
 * ```
 */
// Overloaded on the two modes rather than taking the `APIServerOptions` union
// directly. TypeScript does not contextually type a function nested inside a
// union-typed object literal, so the union form left `pluginHost` implicitly
// `any` for a plugin written inline in `plugins: [...]`. Each overload has a
// single non-union parameter type, which restores that contextual typing.
//
// Each mode is then split again into a generic form that requires
// `APIResponseHelpersClass` and a plain form that takes no type parameter.
// That keeps an explicitly-supplied `H` honest: `serveAPI<typeof CustomHelpers>()`
// with no class to back it would otherwise type handlers against a class the
// server never installs, and fail at runtime on the first custom method.
// Inference is unaffected, since passing the class satisfies the generic form.
export function serveAPI<H extends APIResponseHelpersClass>(
  options: APIServerAPIOptions<H>,
): APIServer<H>;
export function serveAPI<H extends APIResponseHelpersClass>(
  options: APIServerWebOptions<H>,
): APIServer<H>;
export function serveAPI(options?: APIServerAPIOptions): APIServer;
export function serveAPI(options: APIServerWebOptions): APIServer;
// Kept last so the per-mode overloads above still win for an inline object
// literal. Overload signatures hide the implementation signature, so without
// these a caller holding config as the exported `APIServerOptions` union (built
// elsewhere, or returned from a factory) would no longer be able to call at all.
// `APIServerOptions<H>` requires the class value itself once `H` is custom, so
// this needs no extra guard: a union config that omits it fails to typecheck
// where it is declared, which is a better place to see the error than here.
export function serveAPI<
  H extends APIResponseHelpersClass = APIResponseHelpersClass,
>(options: APIServerOptions<H>): APIServer<H>;
// Implementation signature, not part of the public surface. It takes the raw
// mode union rather than `APIServerOptions<H>` so the no-argument default is
// expressible: the exported union requires the helpers class once `H` is
// custom, and an empty literal cannot satisfy that.
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
