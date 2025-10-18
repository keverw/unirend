/**
 * Client-only exports for unirend
 *
 * This entry point only includes functions and types that are safe to use
 * in client-side code. It excludes server-only functionality like SSR servers,
 * file system operations, and server-side rendering utilities.
 *
 * Import from 'unirend/client' in your client-side code:
 *
 * ```typescript
 * import { mountApp, useIsSSR, useIsSSG, useIsClient, useIsDevelopment } from 'unirend/client';
 * import { routes } from './routes';
 *
 * mountApp('root', routes);
 * ```
 */

// Client-safe types
export type { MountAppOptions, MountAppResult } from "./lib/mountApp";
export type {
  UnirendContextValue,
  UnirendRenderMode,
  RequestContextManager,
} from "./lib/internal/UnirendContext";

// Client-safe functions
export { mountApp } from "./lib/mountApp";

// Unirend context hooks
export {
  useIsSSR,
  useIsSSG,
  useIsClient,
  useRenderMode,
  useIsDevelopment,
  useIsServer,
  useFrontendAppConfig,
  useRequestContext,
  useRequestContextValue,
  useRequestContextObjectRaw,
} from "./lib/internal/UnirendContext";
