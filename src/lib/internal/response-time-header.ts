import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ResponseTimeHeaderOptions } from '../types';

export interface NormalizedResponseTimeHeaderOptions {
  enabled: boolean;
  headerName: string;
  digits: number;
}

const DEFAULT_OPTIONS: NormalizedResponseTimeHeaderOptions = {
  enabled: false,
  headerName: 'X-Response-Time',
  digits: 2,
};

const SIMPLE_HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * Resolve the best available response-time measurement for the current reply.
 *
 * Fastify usually provides `reply.elapsedTime`, but we harden this helper for
 * edge cases where that value is missing or non-finite by falling back to the
 * request-start timestamp captured by the framework. If no timing source is
 * usable, we return `-1` as an explicit sentinel meaning "measurement
 * unavailable" so it is distinguishable from a genuine near-zero response.
 */
function normalizeResponseTimeMS(reply: FastifyReply): number {
  if (
    typeof reply.elapsedTime === 'number' &&
    Number.isFinite(reply.elapsedTime)
  ) {
    return Math.max(0, reply.elapsedTime);
  }

  const receivedAt = reply.request.receivedAt;

  if (typeof receivedAt === 'number' && Number.isFinite(receivedAt)) {
    return Math.max(0, Date.now() - receivedAt);
  }

  return -1;
}

/**
 * Normalize and validate the public response-time-header config into one
 * internal shape so the runtime hooks do not need to branch on boolean/object
 * forms or repeat input validation on the hot path.
 */
export function normalizeResponseTimeHeaderOptions(
  options: boolean | ResponseTimeHeaderOptions | undefined,
): NormalizedResponseTimeHeaderOptions {
  // Public config supports boolean shorthand for the common cases:
  // - `true` enables the feature with defaults
  // - `false`/`undefined` disables it entirely
  if (options === true) {
    return {
      ...DEFAULT_OPTIONS,
      enabled: true,
    };
  }

  if (options === false || options === undefined) {
    return { ...DEFAULT_OPTIONS };
  }

  // Object form means "enabled unless explicitly turned off", mirroring the
  // style used by other server options in this codebase.
  const digits = options.digits ?? DEFAULT_OPTIONS.digits;

  // Keep formatting constrained to a small, predictable range so header output
  // stays readable and we do not accidentally expose extremely long decimals.
  if (!Number.isInteger(digits) || digits < 0 || digits > 6) {
    throw new RangeError(
      `responseTimeHeader.digits must be an integer between 0 and 6; got ${JSON.stringify(options.digits)}`,
    );
  }

  const headerName = options.headerName ?? DEFAULT_OPTIONS.headerName;

  // We intentionally use a simpler validation rule than the full HTTP token
  // grammar: letters, numbers, and dashes cover the normal custom-header use
  // cases while keeping the error message easy to understand.
  if (typeof headerName !== 'string' || headerName.trim().length === 0) {
    throw new TypeError(
      'responseTimeHeader.headerName must be a non-empty string',
    );
  }

  if (!SIMPLE_HEADER_NAME_PATTERN.test(headerName)) {
    throw new TypeError(
      'responseTimeHeader.headerName must contain only letters, numbers, and dashes',
    );
  }

  return {
    enabled: options.enabled ?? true,
    headerName,
    digits,
  };
}

export function getResponseTimeMS(reply: FastifyReply): number {
  return normalizeResponseTimeMS(reply);
}

/**
 * Format the numeric response time into the wire/header form.
 */
export function formatResponseTimeHeaderValue(
  responseTimeMS: number,
  digits: number,
): string {
  // Headers carry a user-facing string (`12.34ms`), while the internal
  // measurement remains numeric for logs and related helpers.
  return `${responseTimeMS.toFixed(digits)}ms`;
}

/**
 * Format the numeric response time for access-log output, which uses integer
 * milliseconds today.
 */
export function formatRoundedResponseTime(responseTimeMS: number): number {
  return Math.round(responseTimeMS);
}

function applyResponseTimeHeader(
  reply: FastifyReply,
  options: NormalizedResponseTimeHeaderOptions,
): void {
  const responseTimeMS = getResponseTimeMS(reply);

  reply.header(
    options.headerName,
    formatResponseTimeHeaderValue(responseTimeMS, options.digits),
  );
}

export function registerResponseTimeHijackPatch(
  fastifyInstance: FastifyInstance,
  options: boolean | ResponseTimeHeaderOptions | undefined,
): void {
  const normalized = normalizeResponseTimeHeaderOptions(options);

  if (!normalized.enabled) {
    return;
  }

  // This hook must be registered early, before routes, so every route sees the
  // wrapped hijack() method. Hijacked replies bypass onSend entirely.
  fastifyInstance.addHook('onRequest', (_request, reply, done) => {
    const originalHijack = reply.hijack.bind(reply);

    reply.hijack = ((...args: unknown[]) => {
      // If a route switches to raw Node response handling, make sure the
      // response-time header is already present in reply.getHeaders() before
      // user code calls raw.writeHead(...). This is an early measurement for
      // raw/hijacked replies; access logging still measures at completion.
      if (!reply.raw.headersSent) {
        applyResponseTimeHeader(reply, normalized);
      }

      return originalHijack(...(args as []));
    }) as typeof reply.hijack;

    done();
  });
}

/**
 * Register the normal Fastify-managed onSend path for the response-time
 * header. This handles non-hijacked replies and can be registered later in
 * bootstrap so third-party onSend hooks run first.
 */
export function registerResponseTimeHeader(
  fastifyInstance: FastifyInstance,
  options: boolean | ResponseTimeHeaderOptions | undefined,
): void {
  const normalized = normalizeResponseTimeHeaderOptions(options);

  if (!normalized.enabled) {
    return;
  }

  // Keep the normal onSend path separate from the hijack patch so we can
  // register this later in server bootstrap, after plugins/routes, which lets
  // third-party onSend hooks run first.
  fastifyInstance.addHook('onSend', (_request, reply, payload, done) => {
    if (!reply.sent && !reply.raw?.headersSent) {
      applyResponseTimeHeader(reply, normalized);
    }

    done(null, payload);
  });
}
