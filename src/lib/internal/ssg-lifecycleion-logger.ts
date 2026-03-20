/**
 * Lifecycleion logger integration for the SSG generator.
 *
 * For the server-side (SSR/API) Lifecycleion adapter, see
 * {@link ./lifecycleion-logger-adaptor}.
 */

import type { Logger } from 'lifecycleion/logger';
import type { SSGLogger } from '../types';

/**
 * SSG logger backed by a Lifecycleion logger, scoped to a named service.
 *
 * Pairs with {@link SSGConsoleLogger} — use this when you want SSG generation
 * output routed through your app's existing Lifecycleion logger instead of
 * raw console calls.
 *
 * ```typescript
 * import { Logger } from 'lifecycleion';
 * import { SSGLifecycleionLogger, generateSSG } from 'unirend/server';
 *
 * const logger = new Logger({ sinks: [...] });
 *
 * const result = await generateSSG(buildDir, pages, {
 *   logger: SSGLifecycleionLogger(logger),
 *   // Custom service name:
 *   // logger: SSGLifecycleionLogger(logger, 'my-site-generator'),
 * });
 * ```
 */
export function SSGLifecycleionLogger(
  logger: Logger,
  serviceName = 'SSG',
): SSGLogger {
  const service = logger.service(serviceName);

  return {
    info: (message) => service.info(message),
    warn: (message) => service.warn(message),
    error: (message) => service.error(message),
  };
}
