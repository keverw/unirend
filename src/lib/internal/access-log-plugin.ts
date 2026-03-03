import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  AccessLogConfig,
  AccessLogLevelConfig,
  AccessLogRequestContext,
  AccessLogResponseContext,
  AccessLogReplyInfo,
  UnirendLoggerLevel,
} from '../types';

const DEFAULT_REQUEST_TEMPLATE = 'Request started {{method}} {{url}}';
const DEFAULT_RESPONSE_TEMPLATE =
  'Request finished {{method}} {{url}} {{statusCode}} ({{responseTime}}ms)';

const VALID_EVENTS = new Set(['start', 'finish', 'both', 'none']);
const VALID_LEVELS = new Set<UnirendLoggerLevel>([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

const DEFAULT_ACCESS_LOG_LEVELS = {
  success: 'info',
  clientError: 'warn',
  serverError: 'error',
} as const;

/**
 * Validate a full or partial AccessLogConfig object.
 * Throws a descriptive Error for any invalid field value.
 */
export function validateAccessLogConfig(
  config: Partial<AccessLogConfig>,
): void {
  if (config.events !== undefined && !VALID_EVENTS.has(config.events)) {
    throw new Error(
      `accessLog.events must be 'start', 'finish', 'both', or 'none'; got ${JSON.stringify(config.events)}`,
    );
  }

  if (config.level !== undefined) {
    const level = config.level;

    if (typeof level === 'string') {
      if (!VALID_LEVELS.has(level)) {
        throw new Error(
          `accessLog.level must be a valid log level or an object; got ${JSON.stringify(level)}`,
        );
      }
    } else if (typeof level === 'object') {
      for (const key of ['success', 'clientError', 'serverError'] as const) {
        const v = level[key];

        if (v !== undefined && !VALID_LEVELS.has(v)) {
          throw new Error(
            `accessLog.level.${key} must be a valid log level; got ${JSON.stringify(v)}`,
          );
        }
      }
    } else {
      throw new TypeError(
        `accessLog.level must be a string or object; got ${typeof level}`,
      );
    }
  }

  if (
    config.responseTemplate !== undefined &&
    typeof config.responseTemplate !== 'string'
  ) {
    throw new Error('accessLog.responseTemplate must be a string');
  }

  if (
    config.requestTemplate !== undefined &&
    typeof config.requestTemplate !== 'string'
  ) {
    throw new Error('accessLog.requestTemplate must be a string');
  }

  if (
    config.onRequest !== undefined &&
    typeof config.onRequest !== 'function'
  ) {
    throw new Error('accessLog.onRequest must be a function');
  }

  if (
    config.onResponse !== undefined &&
    typeof config.onResponse !== 'function'
  ) {
    throw new Error('accessLog.onResponse must be a function');
  }
}

/**
 * Resolve the log level to use for a given status code and level config.
 * Defaults: info for 2xx/3xx, warn for 4xx, error for 5xx.
 */
export function resolveAccessLogLevel(
  level: AccessLogLevelConfig | undefined,
  statusCode: number,
): UnirendLoggerLevel {
  if (!level) {
    if (statusCode >= 500) {
      return DEFAULT_ACCESS_LOG_LEVELS.serverError;
    }

    if (statusCode >= 400) {
      return DEFAULT_ACCESS_LOG_LEVELS.clientError;
    }

    return DEFAULT_ACCESS_LOG_LEVELS.success;
  }

  if (typeof level === 'string') {
    return level;
  }

  if (statusCode >= 500) {
    return level.serverError ?? DEFAULT_ACCESS_LOG_LEVELS.serverError;
  }

  if (statusCode >= 400) {
    return level.clientError ?? DEFAULT_ACCESS_LOG_LEVELS.clientError;
  }

  return level.success ?? DEFAULT_ACCESS_LOG_LEVELS.success;
}

type TemplateVars = Record<string, string | number | boolean | undefined>;

/**
 * Substitute {{variable}} placeholders in a template string.
 * vars must contain only primitive-safe values (no objects).
 */
function applyTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(vars[key] ?? ''),
  );
}

function requestTemplateVars(ctx: AccessLogRequestContext): TemplateVars {
  return {
    reqID: ctx.reqID,
    method: ctx.method,
    url: ctx.url,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

function responseTemplateVars(ctx: AccessLogResponseContext): TemplateVars {
  return {
    reqID: ctx.reqID,
    method: ctx.method,
    url: ctx.url,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    statusCode: ctx.statusCode,
    responseTime: ctx.responseTime,
    finishType: ctx.finishType,
  };
}

function buildRequestContext(request: FastifyRequest): AccessLogRequestContext {
  return {
    reqID: request.id,
    method: request.method,
    url: request.url,
    ip: request.clientIP,
    userAgent: request.headers['user-agent'],
    request,
  };
}

function buildReplyInfo(reply: FastifyReply): AccessLogReplyInfo {
  const raw = reply.getHeaders();
  const headers: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number') {
      headers[key] = String(value);
    } else {
      headers[key] = value;
    }
  }

  return { statusCode: reply.statusCode, headers };
}

function buildResponseContext(
  request: FastifyRequest,
  reply: FastifyReply,
  finishType: 'completed' | 'aborted',
): AccessLogResponseContext {
  return {
    ...buildRequestContext(request),
    statusCode: reply.statusCode,
    responseTime: Math.round(reply.elapsedTime),
    finishType,
    replyInfo: buildReplyInfo(reply),
  };
}

/**
 * Owns access log configuration state and registers Fastify lifecycle hooks.
 * Config is read on every request so runtime updates via update() take effect
 * immediately without restarting the server.
 *
 * Internal — not part of the public plugin API. Users configure access logging
 * via the accessLog option on server config and server.updateAccessLoggingConfig().
 */
export class AccessLogPlugin {
  private _config: AccessLogConfig | undefined;

  constructor(initialConfig?: AccessLogConfig) {
    if (initialConfig !== undefined) {
      validateAccessLogConfig(initialConfig);
    }

    this._config = initialConfig;
  }

  /**
   * Partially update config at runtime. Only provided keys are merged;
   * omitted keys remain unchanged. Changes take effect on the next request.
   */
  public update(partial: Partial<AccessLogConfig>): void {
    validateAccessLogConfig(partial);
    this._config = { ...this._config, ...partial };
  }

  /**
   * Register Fastify lifecycle hooks on the given instance.
   * Call once per Fastify instance (during listen()).
   */
  public register(fastify: FastifyInstance): void {
    // ── onRequest: start event ────────────────────────────────────────────────
    fastify.addHook(
      'onRequest',
      async (request: FastifyRequest, _reply: FastifyReply) => {
        const config = this._config;
        if (!config) {
          return;
        }

        const events = config.events ?? 'finish';
        const ctx = buildRequestContext(request);

        // Template printing — only when events includes 'start' or 'both'
        if (events === 'start' || events === 'both') {
          const template = config.requestTemplate ?? DEFAULT_REQUEST_TEMPLATE;
          const msg = applyTemplate(template, requestTemplateVars(ctx));
          request.log[resolveAccessLogLevel(config.level, -1)](msg);
        }

        // Hook fires unconditionally (for DB writes, audit logs, etc.)
        if (config.onRequest) {
          await config.onRequest(ctx);
        }
      },
    );

    // ── onResponse: finish event (normal completion) ──────────────────────────
    fastify.addHook(
      'onResponse',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const config = this._config;
        if (!config) {
          return;
        }

        const events = config.events ?? 'finish';
        const ctx = buildResponseContext(request, reply, 'completed');

        // Template printing — only when events includes 'finish' or 'both'
        if (events === 'finish' || events === 'both') {
          const template = config.responseTemplate ?? DEFAULT_RESPONSE_TEMPLATE;
          const msg = applyTemplate(template, responseTemplateVars(ctx));
          request.log[resolveAccessLogLevel(config.level, reply.statusCode)](
            msg,
          );
        }

        // Hook fires unconditionally (for DB writes, audit logs, etc.)
        if (config.onResponse) {
          await config.onResponse(ctx);
        }
      },
    );

    // ── onRequestAbort: client disconnected before response finished ──────────
    // Fastify does NOT fire onResponse in this case, so we handle it here.
    fastify.addHook('onRequestAbort', async (request: FastifyRequest) => {
      const config = this._config;
      if (!config) {
        return;
      }

      const events = config.events ?? 'finish';

      // Build a response context with whatever state is available at abort time.
      // reply is not passed to onRequestAbort, so we synthesize replyInfo from
      // the request object (status code may be 0 if never set).
      const ctx: AccessLogResponseContext = {
        ...buildRequestContext(request),
        statusCode: 0,
        responseTime: 0,
        finishType: 'aborted',
        replyInfo: { statusCode: 0, headers: {} },
      };

      // Template printing — only when events includes 'finish' or 'both'
      if (events === 'finish' || events === 'both') {
        const template = config.responseTemplate ?? DEFAULT_RESPONSE_TEMPLATE;
        const msg = applyTemplate(template, responseTemplateVars(ctx));
        request.log[resolveAccessLogLevel(config.level, 0)](msg);
      }

      // Hook fires unconditionally (for DB writes, audit logs, etc.)
      if (config.onResponse) {
        await config.onResponse(ctx);
      }
    });
  }
}
