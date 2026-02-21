import type { FastifyBaseLogger } from 'fastify';
import type {
  UnirendLoggerLevel,
  UnirendLoggerObject,
  UnirendLoggingOptions,
} from '../types';

type AdapterLogLevel = UnirendLoggerLevel;
type AdapterInternalLevel = AdapterLogLevel | 'silent';

type LevelState = {
  value: AdapterInternalLevel;
};

type NormalizedLogCall = {
  message: string;
  context?: Record<string, unknown>;
};

type AdapterLogMethodLevel = AdapterLogLevel;

type AdapterLoggerErrorContext = {
  stage: 'write' | 'fallback_error_write';
  level: AdapterLogMethodLevel;
  message: string;
  args: unknown[];
  bindings: Record<string, unknown>;
  context?: Record<string, unknown>;
  originalError?: unknown;
};

const LOG_LEVEL_PRIORITY: Record<AdapterInternalLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 70,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLevel(level: string | undefined): AdapterInternalLevel {
  const normalized = (level || 'info').toLowerCase();

  if (normalized in LOG_LEVEL_PRIORITY) {
    return normalized as AdapterInternalLevel;
  }

  return 'info';
}

function isLevelEnabled(
  currentLevel: AdapterInternalLevel,
  targetLevel: AdapterInternalLevel,
): boolean {
  return LOG_LEVEL_PRIORITY[targetLevel] >= LOG_LEVEL_PRIORITY[currentLevel];
}

function normalizeLogCallArguments(
  args: unknown[],
  bindings: Record<string, unknown>,
): NormalizedLogCall {
  const [firstArg, secondArg, ...restArgs] = args;

  let message = '';
  let context: Record<string, unknown> | undefined;

  if (typeof firstArg === 'string') {
    message = firstArg;

    if (isRecord(secondArg)) {
      context = secondArg;
    } else if (secondArg instanceof Error) {
      context = { err: secondArg };
    } else if (secondArg !== undefined) {
      context = { value: secondArg };
    }
  } else if (firstArg instanceof Error) {
    context = { err: firstArg };

    if (typeof secondArg === 'string') {
      message = secondArg;
    } else {
      message = firstArg.message;

      if (secondArg !== undefined) {
        context.secondArg = secondArg;
      }
    }
  } else if (isRecord(firstArg)) {
    context = firstArg;

    if (typeof secondArg === 'string') {
      message = secondArg;
    } else if (secondArg !== undefined) {
      context.secondArg = secondArg;
    }

    if (message === '' && typeof firstArg.msg === 'string') {
      message = firstArg.msg;
    }
  } else if (firstArg !== undefined) {
    if (
      typeof firstArg === 'number' ||
      typeof firstArg === 'bigint' ||
      typeof firstArg === 'boolean'
    ) {
      message = String(firstArg);
    } else if (typeof firstArg === 'symbol') {
      message = firstArg.toString();
    } else {
      context = { value: firstArg };
    }

    if (secondArg !== undefined) {
      context = {
        ...(context || {}),
        secondArg,
      };
    }
  }

  if (restArgs.length > 0) {
    context = {
      ...(context || {}),
      extraArgs: restArgs,
    };
  }

  const hasBindings = Object.keys(bindings).length > 0;

  if (hasBindings) {
    context = {
      ...bindings,
      ...(context || {}),
    };
  }

  return { message, context };
}

function reportUnhandledLoggerFailure(
  error: unknown,
  context: AdapterLoggerErrorContext,
): void {
  const globalScope = globalThis as typeof globalThis & {
    reportError?: (error: unknown) => void;
  };

  if (typeof globalScope.reportError === 'function') {
    try {
      globalScope.reportError(error);
      return;
    } catch {
      // Fall through to console fallback
    }
  }

  // eslint-disable-next-line no-console
  console.error('[Unirend Logger Adapter] Logger call failed', {
    error,
    context,
  });
}

function assertValidLoggerObject(logger: UnirendLoggerObject): void {
  const loggerWithLegacyGenericLog = logger as UnirendLoggerObject & {
    log?: unknown;
  };

  if (typeof loggerWithLegacyGenericLog.log === 'function') {
    throw new TypeError(
      'options.logging.logger.log(level, message, context) is not supported. Use level methods (trace/debug/info/warn/error/fatal) instead.',
    );
  }

  const requiredMethods: Array<keyof UnirendLoggerObject> = [
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
  ];

  const missingMethods = requiredMethods.filter(
    (methodName) => typeof logger[methodName] !== 'function',
  );

  if (missingMethods.length > 0) {
    throw new TypeError(
      `options.logging.logger must provide all log methods (trace/debug/info/warn/error/fatal). Missing: ${missingMethods.join(', ')}`,
    );
  }
}

function createAdapterLogger(
  loggingOptions: UnirendLoggingOptions,
  bindings: Record<string, unknown>,
  levelState: LevelState,
): FastifyBaseLogger {
  const emit = (level: AdapterInternalLevel, args: unknown[]): void => {
    // Keep pino-compatible semantics: silent is a no-op log method.
    if (level === 'silent') {
      return;
    }

    // Match pino/Fastify level filtering before doing any argument work.
    if (!isLevelEnabled(levelState.value, level)) {
      return;
    }

    // Accept pino-style arg shapes and attach child logger bindings as context.
    const normalizedCall = normalizeLogCallArguments(args, bindings);
    const loggerMethod = loggingOptions.logger[level];

    try {
      loggerMethod(normalizedCall.message, normalizedCall.context);
    } catch (error) {
      // Preserve enough state to make fallback/error reports debuggable.
      const writeErrorContext: AdapterLoggerErrorContext = {
        stage: 'write',
        level,
        message: normalizedCall.message,
        args,
        bindings,
        context: normalizedCall.context,
      };

      // First fallback stays inside user logger infrastructure.
      const fallbackMessage = '[Unirend Logger Adapter] Logger write failed';
      const fallbackContext: Record<string, unknown> = {
        originalError: error,
        failedLevel: writeErrorContext.level,
        failedMessage: writeErrorContext.message,
        failedBindings: writeErrorContext.bindings,
        failedContext: writeErrorContext.context,
      };

      try {
        loggingOptions.logger.error(fallbackMessage, fallbackContext);
        return;
      } catch (fallbackError) {
        reportUnhandledLoggerFailure(fallbackError, {
          ...writeErrorContext,
          stage: 'fallback_error_write',
          originalError: error,
        });
        return;
      }
    }
  };

  return {
    get level() {
      return levelState.value;
    },
    set level(value: string) {
      levelState.value = normalizeLevel(value);
    },
    trace: (...args: unknown[]) => emit('trace', args),
    debug: (...args: unknown[]) => emit('debug', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
    fatal: (...args: unknown[]) => emit('fatal', args),
    // Fastify expects this method when logger level is set to "silent".
    silent: () => {},
    child: (
      childBindings: Record<string, unknown>,
      _options?: Record<string, unknown>,
    ) => {
      const normalizedBindings = isRecord(childBindings) ? childBindings : {};

      // Child loggers share level state and merge structured context bindings.
      return createAdapterLogger(
        loggingOptions,
        {
          ...bindings,
          ...normalizedBindings,
        },
        levelState,
      );
    },
  };
}

export function createFastifyLoggerFromUnirendLogging(
  loggingOptions: UnirendLoggingOptions,
): FastifyBaseLogger {
  assertValidLoggerObject(loggingOptions.logger);

  const levelState: LevelState = {
    value: normalizeLevel(loggingOptions.level),
  };

  return createAdapterLogger(loggingOptions, {}, levelState);
}
