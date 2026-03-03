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
 * Note: disableRequestLogging is always set to true — Fastify's built-in
 * request lifecycle logs are permanently suppressed. Use accessLog on the
 * server config for first-party request logging instead.
 */
export function resolveFastifyLoggerConfig({
  logging,
  fastifyOptions,
}: {
  logging?: UnirendLoggingOptions;
  fastifyOptions?: CuratedFastifyLoggerOptions;
}): Pick<
  FastifyServerOptions,
  'logger' | 'loggerInstance' | 'disableRequestLogging'
> {
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
    'logger' | 'loggerInstance' | 'disableRequestLogging'
  > = {
    // Always suppress Fastify's built-in "incoming request" / "request completed" logs.
    // Use the accessLog server option for first-party request logging.
    disableRequestLogging: true,
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
