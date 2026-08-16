/**
 * Byte-equality harness for the `request.trigger404()` test matrix.
 *
 * TEST ONLY. Nothing here is exported from any entry point in tsup.config.ts,
 * so it never reaches dist/. It lives outside the two test files because both
 * `trigger-404.test.ts` and `trigger-404-ssr.test.ts` compare responses the same
 * way, and a second copy of the comparison is exactly the drift the feature
 * exists to prevent.
 *
 * The property under test is that a triggered 404 and a genuine route miss are
 * indistinguishable to the caller. Two things follow from that:
 *
 * - The comparison is on the **raw body string**, not a parsed object, so key
 *   order counts. A caller reading bytes off the wire sees key order.
 * - Asserting merely on `404` proves nothing, so every cell also pins the status
 *   code, the content type, and the cache control header, and names the envelope
 *   type and error code it expects rather than accepting whatever both sides
 *   happen to agree on.
 *
 * `request_id` is pinned per server with `getRequestID`. `request_timestamp` is
 * the one field two genuinely separate requests cannot share, so it is
 * normalized out of the raw string before the comparison.
 */

import { APIResponseHelpers } from '../../api-envelope';
import type {
  APIErrorResponse,
  BaseMeta,
  PageErrorResponse,
} from '../api-envelope/api-envelope-types';
import type { UnirendLoggerLevel, UnirendLoggingOptions } from '../types';

/** Pinned on both servers in a cell so the envelopes carry the same request id. */
export const FIXED_REQUEST_ID = 'fixed-request-id';

/** Server option value, shaped for `getRequestID`. */
export const pinnedRequestID = (): string => FIXED_REQUEST_ID;

/**
 * Replaces the only field two separate requests may legitimately differ on.
 * Applied to the raw string rather than a parsed object so the rest of the body
 * — including key order — is still compared byte for byte.
 */
export function normalizeEnvelopeBody(body: string): string {
  return body.replace(
    /"request_timestamp":"[^"]*"/g,
    '"request_timestamp":"<normalized>"',
  );
}

/** Marker written into `meta` by the API branch of {@link MarkerHelpers}. */
export const API_HELPERS_MARKER = 'custom-api-helpers';

/** Marker written into `meta` by the page branch of {@link MarkerHelpers}. */
export const PAGE_HELPERS_MARKER = 'custom-page-helpers';

/**
 * The routing state a custom helpers class can reach through the request.
 *
 * Written into `meta` by both branches of {@link MarkerHelpers} so the
 * byte-equality matrix actually exercises it. A helpers class receives the
 * request, which is a documented way to branch per request, and these three
 * fields are the ones that differ between a routed request and a genuine miss:
 * a trigger carries its route's `params` and `routeOptions.url` and
 * `is404 === false`, while a miss carries Fastify's wildcard params, no route
 * URL, and `is404 === true`. If the not-found path ever hands the raw request
 * to the helpers class again instead of the stripped `NotFoundRequest` view,
 * every custom-helpers cell in the matrix fails on these fields.
 */
function probeRoutingState(request: unknown): Record<string, unknown> {
  const fields = request as {
    params?: unknown;
    routeOptions?: { url?: string };
    is404?: unknown;
  };

  return {
    probe_params: fields.params ?? null,
    probe_route_url: fields.routeOptions?.url ?? null,
    probe_is404: fields.is404 ?? null,
  };
}

/**
 * A custom `APIResponseHelpers` class for the custom-helpers cells.
 *
 * It overrides **both** error constructors, each with its own marker, so a
 * page-data cell that comes back carrying the page marker proves the shared
 * not-found path reached the `isPageData` branch rather than quietly building an
 * API envelope that happened to look close enough.
 *
 * Each branch also reflects the request's routing state back into `meta`, so
 * the matrix compares what a helpers class can *see* and not only what the
 * framework chose to write. See {@link probeRoutingState}.
 */
export class MarkerHelpers extends APIResponseHelpers {
  public static override createAPIErrorResponse<M extends BaseMeta = BaseMeta>(
    params: Parameters<typeof APIResponseHelpers.createAPIErrorResponse<M>>[0],
  ): APIErrorResponse<M> {
    return APIResponseHelpers.createAPIErrorResponse<M>({
      ...params,
      meta: {
        ...params.meta,
        helpers_marker: API_HELPERS_MARKER,
        ...probeRoutingState(params.request),
      } as unknown as Partial<M>,
    });
  }

  public static override createPageErrorResponse<M extends BaseMeta = BaseMeta>(
    params: Parameters<typeof APIResponseHelpers.createPageErrorResponse<M>>[0],
  ): PageErrorResponse<M> {
    return APIResponseHelpers.createPageErrorResponse<M>({
      ...params,
      meta: {
        ...params.meta,
        helpers_marker: PAGE_HELPERS_MARKER,
        ...probeRoutingState(params.request),
      } as unknown as Partial<M>,
    });
  }
}

/**
 * The body a page-data POST carries, shared by every page-data cell.
 *
 * Every field carries a distinct non-empty value on purpose. These four are
 * what `pageData` hands a not-found handler, and with `{}` params and a
 * `request_path` equal to `original_url` the assertions could not tell the
 * fields apart: dropping `routeParams`, swapping it with `queryParams`, or
 * swapping `requestPath` with `originalURL` would all still pass. The query
 * string on `original_url` and not on `request_path` is what a real loader
 * sends, and it is also what pins `request.url` to the full frontend URL.
 */
export const pageDataBody = {
  route_params: { id: '42' },
  query_params: { tab: 'billing' },
  request_path: '/thing',
  original_url: '/thing?tab=billing',
};

/** `pageData` as a not-found handler should receive it for {@link pageDataBody}. */
export const expectedPageDataContext = {
  pageType: 'thing',
  routeParams: { id: '42' },
  queryParams: { tab: 'billing' },
  requestPath: '/thing',
  originalURL: '/thing?tab=billing',
};

/** One `request.log.*` call, as the Unirend logger adapter hands it over. */
export interface CapturedLogRecord {
  level: UnirendLoggerLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * A server `logging` option that records every call instead of writing it.
 *
 * The trigger-404 bug paths are only observable through `request.log.error`, so
 * the cells for a forgotten `return` and an already-sent response assert on
 * these records rather than on the response alone.
 */
export function createCapturingLogging(): {
  records: CapturedLogRecord[];
  logging: UnirendLoggingOptions;
} {
  const records: CapturedLogRecord[] = [];

  const record =
    (level: UnirendLoggerLevel) =>
    (message: string, context?: Record<string, unknown>) => {
      records.push({ level, message, context });
    };

  return {
    records,
    logging: {
      level: 'trace',
      logger: {
        trace: record('trace'),
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        fatal: record('fatal'),
      },
    },
  };
}

/** Finds the single log record carrying the given `errorCode`. */
export function findLogRecord(
  records: CapturedLogRecord[],
  errorCode: string,
): CapturedLogRecord[] {
  return records.filter((entry) => entry.context?.errorCode === errorCode);
}

/** Everything a caller can observe about a not-found response. */
export interface CapturedResponse {
  statusCode: number;
  contentType: string;
  cacheControl: string;
  body: string;
}

/** Shape both `fastifyInstance.inject()` and a real `fetch` can be mapped onto. */
export interface RawResponse {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: string;
}

export function captureResponse(response: RawResponse): CapturedResponse {
  return {
    statusCode: response.statusCode,
    contentType: String(response.headers['content-type'] ?? ''),
    cacheControl: String(response.headers['cache-control'] ?? ''),
    body: normalizeEnvelopeBody(response.body),
  };
}

/** What a cell expects the shared not-found path to have produced. */
export interface ExpectedNotFound {
  statusCode: number;
  type: 'api' | 'page';
  errorCode: string;
  /** Marker written by a custom APIResponseHelpers subclass, when one is configured. */
  helpersMarker?: string;
}

/**
 * The assertion every matrix cell runs.
 *
 * Returns the parsed triggered envelope so a cell can make its own extra
 * assertions without re-parsing. Throws through the caller's `expect`, which is
 * passed in rather than imported so this module stays free of `bun:test`.
 */
export function assertIndistinguishable(
  expect: (value: unknown) => {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
  },
  triggered: CapturedResponse,
  unregistered: CapturedResponse,
  expected: ExpectedNotFound,
): Record<string, unknown> {
  // The whole point: status, both observable headers, and the raw body string.
  expect(triggered).toEqual(unregistered);

  // Pinned separately so a cell where both sides collapsed to the same wrong
  // response still fails.
  expect(triggered.statusCode).toBe(expected.statusCode);
  expect(triggered.cacheControl).toBe('no-store');
  expect(triggered.contentType).toBe('application/json; charset=utf-8');

  const envelope = JSON.parse(triggered.body) as Record<string, unknown>;

  expect(envelope.status).toBe('error');
  expect(envelope.status_code).toBe(expected.statusCode);
  expect(envelope.type).toBe(expected.type);
  expect(envelope.request_id).toBe(FIXED_REQUEST_ID);
  expect((envelope.error as { code: string }).code).toBe(expected.errorCode);

  if (expected.helpersMarker !== undefined) {
    expect((envelope.meta as { helpers_marker?: string }).helpers_marker).toBe(
      expected.helpersMarker,
    );
  }

  return envelope;
}
