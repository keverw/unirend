import { LogController } from 'fastify';
import type {
  FastifyBaseLogger,
  FastifyLoggerOptions,
  FastifyServerOptions,
} from 'fastify';
import type { UnirendLoggingOptions } from '../types';
import { createFastifyLoggerFromUnirendLogging } from './unirend-logger-adapter';

type CuratedFastifyLoggerOptions = {
  logger?: boolean | FastifyLoggerOptions;
  loggerInstance?: FastifyBaseLogger;
};

/**
 * Resolve logging options into Fastify logger configuration while enforcing
 * mutual exclusivity across logging configuration paths.
 *
 * Note: request logging is always disabled via a LogController — Fastify's
 * built-in request lifecycle logs are permanently suppressed. Use accessLog on
 * the server config for first-party request logging instead. (The old
 * top-level disableRequestLogging option was deprecated in fastify 5.10 as
 * FSTDEP023 and is removed in fastify 6; the LogController is its replacement.)
 */
export function resolveFastifyLoggerConfig({
  logging,
  fastifyOptions,
}: {
  logging?: UnirendLoggingOptions;
  fastifyOptions?: CuratedFastifyLoggerOptions;
}): Pick<FastifyServerOptions, 'logger' | 'loggerInstance' | 'logController'> {
  const configuredPaths: string[] = [];

  if (logging) {
    configuredPaths.push('logging');
  }

  if (fastifyOptions?.logger !== undefined) {
    configuredPaths.push('fastifyOptions.logger');
  }

  if (fastifyOptions?.loggerInstance !== undefined) {
    configuredPaths.push('fastifyOptions.loggerInstance');
  }

  if (configuredPaths.length > 1) {
    throw new Error(
      `Logging configuration conflict: choose exactly one of \`logging\`, \`fastifyOptions.logger\`, or \`fastifyOptions.loggerInstance\`. Received: ${configuredPaths.join(', ')}`,
    );
  }

  const resolvedConfig: Pick<
    FastifyServerOptions,
    'logger' | 'loggerInstance' | 'logController'
  > = {
    // Always suppress Fastify's built-in "incoming request" / "request completed" logs.
    // Use the accessLog server option for first-party request logging. Set through
    // a LogController rather than the deprecated top-level disableRequestLogging
    // option (FSTDEP023), which fastify 6 removes.
    logController: new LogController({ disableRequestLogging: true }),
  };

  if (logging) {
    resolvedConfig.loggerInstance =
      createFastifyLoggerFromUnirendLogging(logging);
  } else if (fastifyOptions?.logger !== undefined) {
    resolvedConfig.logger = fastifyOptions.logger;
  } else if (fastifyOptions?.loggerInstance !== undefined) {
    resolvedConfig.loggerInstance = fastifyOptions.loggerInstance;
  }

  return resolvedConfig;
}
