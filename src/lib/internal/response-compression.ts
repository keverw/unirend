import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { ResponseCompressionOptions } from '../types';
import { addToVaryHeader } from './http-header-utils';

const gzipAsync = promisify(gzip);
const brotliCompressAsync = promisify(brotliCompress);

export type ResponseEncoding = 'br' | 'gzip';

export interface NormalizedResponseCompressionOptions {
  enabled: boolean;
  threshold: number;
  preferBrotli: boolean;
  brotliQuality: number;
  gzipLevel: number;
}

const DEFAULT_OPTIONS: NormalizedResponseCompressionOptions = {
  enabled: true,
  threshold: 1024,
  preferBrotli: true,
  brotliQuality: 4,
  gzipLevel: 6,
};

const COMPRESSIBLE_CONTENT_TYPE_PREFIXES = [
  'text/',
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/javascript',
  'text/javascript',
  'application/xml',
  'text/xml',
  'application/xhtml+xml',
  'application/rss+xml',
  'application/atom+xml',
  'image/svg+xml',
];

/**
 * Normalize the public boolean/object config into one internal shape so the
 * hot path does not need to branch on user-facing option forms.
 */
export function normalizeResponseCompressionOptions(
  options: boolean | ResponseCompressionOptions | undefined,
): NormalizedResponseCompressionOptions {
  if (options === false) {
    return {
      ...DEFAULT_OPTIONS,
      enabled: false,
    };
  }

  if (options === true || options === undefined) {
    return { ...DEFAULT_OPTIONS };
  }

  return {
    enabled: options.enabled ?? DEFAULT_OPTIONS.enabled,
    threshold: options.threshold ?? DEFAULT_OPTIONS.threshold,
    preferBrotli: options.preferBrotli ?? DEFAULT_OPTIONS.preferBrotli,
    brotliQuality: options.brotliQuality ?? DEFAULT_OPTIONS.brotliQuality,
    gzipLevel: options.gzipLevel ?? DEFAULT_OPTIONS.gzipLevel,
  };
}

/**
 * Minimal content-type allowlist for generic response compression.
 *
 * Static file handling uses MIME metadata from the file layer, but the
 * server-level onSend hook needs a straightforward check based only on the
 * response header that was already chosen.
 */
export function isCompressibleContentType(
  contentType: string | undefined,
): boolean {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.split(';')[0]?.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return COMPRESSIBLE_CONTENT_TYPE_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

/**
 * Parse Accept-Encoding into a simple encoding -> q-value map.
 *
 * This intentionally supports the small subset we need: direct `br`, `gzip`,
 * and wildcard fallback. We do not need full RFC-grade preference sorting for
 * the current use case.
 */
function parseAcceptEncoding(
  acceptEncoding: string | string[] | undefined,
): Map<string, number> {
  const header = Array.isArray(acceptEncoding)
    ? acceptEncoding.join(',')
    : acceptEncoding;
  const values = new Map<string, number>();

  if (!header) {
    return values;
  }

  for (const part of header.split(',')) {
    const [encodingRaw, ...params] = part.trim().split(';');

    if (!encodingRaw) {
      continue;
    }

    let quality = 1;

    for (const param of params) {
      const [key, value] = param.trim().split('=');

      if (key === 'q' && value) {
        const parsed = Number.parseFloat(value);

        if (!Number.isNaN(parsed)) {
          quality = parsed;
        }
      }
    }

    values.set(encodingRaw.toLowerCase(), quality);
  }

  return values;
}

/**
 * Choose the best supported encoding for the current request.
 *
 * Preference is controlled by config (`preferBrotli`), while q-values still
 * gate whether an encoding is allowed at all.
 */
export function selectResponseEncoding(
  acceptEncoding: string | string[] | undefined,
  shouldPreferBrotli: boolean,
): ResponseEncoding | null {
  const parsed = parseAcceptEncoding(acceptEncoding);
  const brQuality = parsed.get('br') ?? parsed.get('*') ?? 0;
  const gzipQuality = parsed.get('gzip') ?? parsed.get('*') ?? 0;

  if (brQuality <= 0 && gzipQuality <= 0) {
    return null;
  }

  if (brQuality > gzipQuality) {
    return 'br';
  }

  if (gzipQuality > brQuality) {
    return 'gzip';
  }

  return shouldPreferBrotli
    ? brQuality > 0
      ? 'br'
      : 'gzip'
    : gzipQuality > 0
      ? 'gzip'
      : 'br';
}

/**
 * Derive a representation-specific ETag from a base file/response ETag.
 *
 * This lets compressed and identity responses vary independently while still
 * preserving the original validator as the underlying content identity.
 */
export function buildEncodedETag(
  etag: string,
  encoding: ResponseEncoding,
): string {
  const isWeakPrefix = etag.startsWith('W/');
  const quoted = isWeakPrefix ? etag.slice(2) : etag;

  if (quoted.startsWith('"') && quoted.endsWith('"')) {
    return `${isWeakPrefix ? 'W/' : ''}"${quoted.slice(1, -1)}--${encoding}"`;
  }

  return `${etag}--${encoding}`;
}

/**
 * Simple If-None-Match matcher for the exact representation ETag we are about
 * to send. Wildcard `*` is supported because callers may use it to indicate
 * "any current representation".
 */
export function matchesIfNoneMatch(
  ifNoneMatchHeader: string | string[] | undefined,
  etag: string,
): boolean {
  const header = Array.isArray(ifNoneMatchHeader)
    ? ifNoneMatchHeader.join(',')
    : ifNoneMatchHeader;

  if (!header) {
    return false;
  }

  const normalizeWeakETag = (value: string): string =>
    value.startsWith('W/') ? value.slice(2) : value;
  const normalizedETag = normalizeWeakETag(etag);

  return header
    .split(',')
    .map((value) => value.trim())
    .some(
      (value) =>
        value === '*' || normalizeWeakETag(value) === normalizedETag,
    );
}

export async function compressPayload(
  payload: Buffer,
  encoding: ResponseEncoding,
  options: NormalizedResponseCompressionOptions,
): Promise<Buffer> {
  if (encoding === 'br') {
    return brotliCompressAsync(payload, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: options.brotliQuality,
      },
    });
  }

  return gzipAsync(payload, {
    level: options.gzipLevel,
  });
}

/**
 * Compress a non-streaming reply payload when it is safe and worthwhile.
 *
 * Important constraints:
 * - skips replies that already selected a representation (Content-Encoding)
 * - skips ranged responses because byte ranges and on-the-fly compression do
 *   not compose cleanly
 * - skips small payloads to avoid wasting CPU and bytes
 *
 * The hook is deliberately representation-aware:
 * - once we choose gzip/br, we must treat the compressed bytes as a distinct
 *   HTTP representation with their own validator (`ETag`)
 * - `HEAD` must negotiate the same representation metadata as `GET`, even
 *   though no body will actually be written to the socket
 * - `If-None-Match` must be evaluated against the representation we are about
 *   to send, not the original uncompressed bytes
 */
export async function compressReplyPayload(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  options: boolean | ResponseCompressionOptions | undefined,
): Promise<unknown> {
  const normalized = normalizeResponseCompressionOptions(options);

  if (!normalized.enabled) {
    return payload;
  }

  // Representation-aware paths (for example static content) can set this to
  // signal that they already selected the final encoding/ETag themselves and
  // must bypass the generic onSend compression hook.
  if (
    (request as { _unirendSkipCompression?: boolean })._unirendSkipCompression
  ) {
    return payload;
  }

  if (
    reply.statusCode < 200 ||
    reply.statusCode === 204 ||
    reply.statusCode === 304
  ) {
    return payload;
  }

  if (request.headers.range || reply.hasHeader('Content-Range')) {
    return payload;
  }

  if (reply.hasHeader('Content-Encoding')) {
    return payload;
  }

  const contentType = reply.getHeader('Content-Type') as string | undefined;

  if (!isCompressibleContentType(contentType)) {
    return payload;
  }

  // This generic hook only handles fully materialized payloads. Streamed
  // responses stay on their existing path because on-the-fly compression would
  // need different range/backpressure semantics.
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
    return payload;
  }

  const bufferPayload =
    typeof payload === 'string' ? Buffer.from(payload) : payload;

  // Match the static-content behavior: small bodies usually are not worth the
  // extra CPU, header bytes, and cache fragmentation that compression adds.
  if (bufferPayload.length < normalized.threshold) {
    return payload;
  }

  // Only add Vary when the payload is otherwise eligible for compression.
  // That keeps the header tied to actual response-shape variation.
  addToVaryHeader(reply, 'Accept-Encoding');

  const encoding = selectResponseEncoding(
    request.headers['accept-encoding'],
    normalized.preferBrotli,
  );

  if (!encoding) {
    return payload;
  }

  // Compression is attempted before mutating representation headers so we can
  // bail out cleanly when the encoded bytes are not actually smaller.
  const compressed = await compressPayload(bufferPayload, encoding, normalized);

  if (compressed.length >= bufferPayload.length) {
    return payload;
  }

  // If upstream already attached an ETag to the identity response, convert it
  // into a representation-specific validator before the reply leaves the hook.
  // Otherwise caches would see the same ETag for both compressed and
  // uncompressed bytes and could serve or validate the wrong representation.
  const existingETag = reply.getHeader('ETag');
  const currentETag = Array.isArray(existingETag)
    ? existingETag[0]
    : existingETag;

  if (typeof currentETag === 'string' && currentETag.length > 0) {
    reply.header('ETag', buildEncodedETag(currentETag, encoding));
  }

  const encodedETag = reply.getHeader('ETag');
  const responseETag =
    typeof encodedETag === 'string'
      ? encodedETag
      : Array.isArray(encodedETag) && typeof encodedETag[0] === 'string'
        ? encodedETag[0]
        : undefined;

  reply.header('Content-Encoding', encoding);

  // Conditional GET/HEAD must be checked against the final representation
  // validator, not the base identity ETag. If the client already has the
  // encoded variant we can return 304 without sending the compressed body.
  if (
    responseETag &&
    matchesIfNoneMatch(request.headers['if-none-match'], responseETag)
  ) {
    reply.code(304);
    reply.removeHeader('Content-Length');
    return '';
  }

  if (request.method === 'HEAD') {
    // HEAD still needs to advertise the metadata of the representation that a
    // GET would have produced after negotiation.
    //
    // Fastify still uses the payload returned from onSend to derive outgoing
    // metadata for HEAD responses. Returning the compressed buffer keeps the
    // wire-level Content-Length aligned with the corresponding GET, while
    // Fastify itself suppresses the actual response body for HEAD.
    reply.header('Content-Length', compressed.length.toString());
    return compressed;
  }

  // We already know the exact compressed byte length here, so set it
  // explicitly instead of relying on later framework inference.
  reply.header('Content-Length', compressed.length.toString());

  return compressed;
}

/**
 * Register the generic response-compression hook for dynamic API/web replies.
 *
 * Static file serving uses its own representation-selection path so it can keep
 * ETags, range requests, and cache invalidation tied to concrete file variants.
 */
export function registerResponseCompression(
  fastifyInstance: FastifyInstance,
  options: boolean | ResponseCompressionOptions | undefined,
): void {
  const normalized = normalizeResponseCompressionOptions(options);

  if (!normalized.enabled) {
    return;
  }

  fastifyInstance.addHook('onSend', async (request, reply, payload) => {
    return compressReplyPayload(request, reply, payload, normalized);
  });
}
