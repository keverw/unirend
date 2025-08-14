/**
 * Router utilities exports for unirend
 *
 * This entry point includes shared functionality that can be used in both
 * client-side and server-side code, particularly for routing and data loading.
 * It's designed to work seamlessly in both environments.
 *
 * Import from 'unirend/router-utils' in your code
 */

// Error boundary components
export { default as RouteErrorBoundary } from "./lib/router-utils/RouteErrorBoundary";
export type { RouteErrorBoundaryProps } from "./lib/router-utils/RouteErrorBoundary";
export { useDataloaderEnvelopeError } from "./lib/router-utils/useDataLoaderEnvelopeError";
export {
  createPageLoader,
  createDefaultPageLoaderConfig,
} from "./lib/router-utils/pageDataLoader";
export {
  type PageLoaderConfig,
  type ErrorDefaults,
  type BaseErrorDefinition,
  type FullErrorDefinition,
  type CustomStatusCodeHandler,
} from "./lib/router-utils/pageDataLoader-types";
