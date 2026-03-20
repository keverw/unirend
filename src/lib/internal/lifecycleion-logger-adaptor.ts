/**
 * Lifecycleion logger adapter for Unirend servers (SSR/API/Static).
 *
 * For the SSG generator version, see {@link ./ssg-lifecycleion-logger}.
 */

import type { Logger, LoggerService, LogOptions } from 'lifecycleion/logger';
import { isPlainObject } from 'lifecycleion/is-plain-object';
import type { UnirendLoggerObject } from '../types';

/**
 * Optional Lifecycleion-specific options that can be passed through the
 * UnirendLoggerObject interface via the `context.logger` convention.
 *
 * Place this under the `logger` key in the context object when calling
 * a log method. Both `request.log` (per-request) and `pluginHost.log`
 * (during plugin setup, before any request exists) route through the adaptor
 * and use pino's `(obj, message)` argument order. TypeScript will not catch
 * the wrong order — pino's overloads accept a bare string as the first
 * argument too, so swapping obj/message compiles but silently drops your params.
 *
 * ```typescript
 * pluginHost.get('/api/profile', (request) => {
 *   request.log.info(
 *     { logger: { params: { id: 'u_123' }, redactedKeys: ['token'] } },
 *     'User {{id}} loaded profile',
 *   );
 *   return { ok: true };
 * });
 * ```
 */
export interface LifecycleionLogContextOptions {
  /** Template params for `{{variableName}}` placeholders in the message string. */
  params?: Record<string, unknown>;
  /** Keys in params whose values should be redacted in Lifecycleion logger output. */
  redactedKeys?: string[];
  /** Tags to attach to the log entry for categorizing/filtering logs (e.g., ['auth', 'security']). */
  tags?: string[];
}

function extractLogOptions(
  context: Record<string, unknown> | undefined,
): LogOptions | undefined {
  if (!context) {
    return undefined;
  }

  // Strip the Lifecycleion-specific `logger` key from the rest of the context.
  // Everything else (pino bindings like reqId/pid/hostname, user context fields
  // like err/requestID) is passed as a nested `pinoContext` param — accessible
  // in templates as {{pinoContext.reqId}} etc.
  // User-provided params (context.logger.params) are spread beside it at the
  // top level, keeping them separate and clearly user-owned.
  const { logger: rawLogger, ...pinoContext } = context;
  const raw = isPlainObject(rawLogger) ? rawLogger : null;

  const result: LogOptions = {};
  let hasAny = false;

  const hasPinoContext = Object.keys(pinoContext).length > 0;
  const userParams = raw && isPlainObject(raw.params) ? raw.params : null;

  if (hasPinoContext || userParams) {
    result.params = {
      ...(hasPinoContext ? { pinoContext } : {}),
      ...(userParams ?? {}),
    };

    hasAny = true;
  }

  if (raw && Array.isArray(raw.redactedKeys)) {
    result.redactedKeys = raw.redactedKeys as string[];
    hasAny = true;
  }

  if (raw && Array.isArray(raw.tags)) {
    result.tags = raw.tags as string[];
    hasAny = true;
  }

  return hasAny ? result : undefined;
}

/**
 * Wraps a Lifecycleion `Logger`, `LoggerService`, or entity logger as a
 * `UnirendLoggerObject` so it can be passed to `logging.logger` in Unirend
 * server options.
 *
 * Level mapping (Unirend → Lifecycleion):
 * - `trace` → `debug` (Lifecycleion has no trace level)
 * - `debug` → `debug`
 * - `info`  → `info`
 * - `warn`  → `warn`
 * - `error` → `error`
 * - `fatal` → `error` (Lifecycleion has no fatal level)
 *
 * Once wired up via `logging.logger`, `request.log` and `pluginHost.log` both
 * route through the adaptor. See {@link LifecycleionLogContextOptions} for
 * template rendering, redaction, and tags via the `context.logger` convention.
 *
 * ```typescript
 * import { Logger } from 'lifecycleion';
 * import { UnirendLifecycleionLoggerAdaptor, serveSSRProd } from 'unirend/server';
 *
 * const logger = new Logger({ sinks: [...] });
 *
 * const server = serveSSRProd('./build', {
 *   logging: {
 *     logger: UnirendLifecycleionLoggerAdaptor(logger),
 *   },
 * });
 * ```
 *
 * See docs/lifecycleion-logger-adaptor.md for full usage and level mapping details.
 */
export function UnirendLifecycleionLoggerAdaptor(
  logger: Logger | LoggerService,
): UnirendLoggerObject {
  return {
    trace: (msg, ctx) => logger.debug(msg, extractLogOptions(ctx)),
    debug: (msg, ctx) => logger.debug(msg, extractLogOptions(ctx)),
    info: (msg, ctx) => logger.info(msg, extractLogOptions(ctx)),
    warn: (msg, ctx) => logger.warn(msg, extractLogOptions(ctx)),
    error: (msg, ctx) => logger.error(msg, extractLogOptions(ctx)),
    fatal: (msg, ctx) => logger.error(msg, extractLogOptions(ctx)),
  };
}
