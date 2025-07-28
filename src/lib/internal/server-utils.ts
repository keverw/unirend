import {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyPluginCallback,
  type FastifyReply,
  type FastifyRequest,
  type RouteHandler,
} from "fastify";
import {
  type ControlledFastifyInstance,
  type FastifyHookName,
  type SafeRouteOptions,
} from "../types";

/**
 * Creates a controlled wrapper around the Fastify instance
 * This prevents plugins from accessing dangerous methods
 * @param fastifyInstance The real Fastify instance
 * @param disableRootWildcard Whether to disable root wildcard routes (e.g., "*" or "/*")
 * @returns Controlled interface for plugins
 */

export function createControlledInstance(
  fastifyInstance: FastifyInstance,
  disableRootWildcard: boolean,
): ControlledFastifyInstance {
  return {
    register: <Options extends Record<string, unknown> = Record<string, never>>(
      plugin: FastifyPluginAsync<Options> | FastifyPluginCallback<Options>,
      opts?: Options,
    ) => {
      // Note: Fastify's register method has complex overloads that don't align perfectly
      // with our simplified generic constraints. These casts are necessary for compatibility.
      return fastifyInstance.register(
        plugin as Parameters<typeof fastifyInstance.register>[0],
        opts as Parameters<typeof fastifyInstance.register>[1],
      ) as unknown as Promise<void>;
    },
    addHook: (
      hookName: FastifyHookName,
      handler: (
        request: FastifyRequest,
        reply: FastifyReply,
        ...args: unknown[]
      ) => Promise<unknown> | unknown,
    ) => {
      // Prevent plugins from overriding critical hooks
      if (hookName === "onRoute" || hookName.includes("*")) {
        throw new Error(
          "Plugins cannot register catch-all route hooks that would conflict with SSR",
        );
      }
      // Note: Fastify's addHook has complex overloads for different hook types.
      // These casts align our simplified interface with Fastify's internal expectations.
      return fastifyInstance.addHook(
        hookName as Parameters<typeof fastifyInstance.addHook>[0],
        handler as Parameters<typeof fastifyInstance.addHook>[1],
      );
    },
    decorate: (property: string, value: unknown) =>
      fastifyInstance.decorate(property, value),
    decorateRequest: (property: string, value: unknown) =>
      fastifyInstance.decorateRequest(property, value),
    decorateReply: (property: string, value: unknown) =>
      fastifyInstance.decorateReply(property, value),
    route: (opts: SafeRouteOptions) => {
      // Prevent catch-all routes that would conflict with SSR
      if (opts.url === "*" || opts.url.includes("*")) {
        throw new Error(
          "Plugins cannot register catch-all routes that would conflict with SSR rendering",
        );
      }
      // Note: SafeRouteOptions may not perfectly match Fastify's RouteOptions interface.
      // This cast ensures compatibility with Fastify's internal route registration.
      return fastifyInstance.route(
        opts as Parameters<typeof fastifyInstance.route>[0],
      );
    },
    get: (path: string, handler: RouteHandler) => {
      if (disableRootWildcard && (path === "*" || path === "/*")) {
        throw new Error(
          "Plugins cannot register root wildcard GET routes that would conflict with SSR rendering",
        );
      }
      return fastifyInstance.get(path, handler);
    },
    post: (path: string, handler: RouteHandler) =>
      fastifyInstance.post(path, handler),
    put: (path: string, handler: RouteHandler) =>
      fastifyInstance.put(path, handler),
    delete: (path: string, handler: RouteHandler) =>
      fastifyInstance.delete(path, handler),
    patch: (path: string, handler: RouteHandler) =>
      fastifyInstance.patch(path, handler),
  };
}
