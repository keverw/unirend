import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import http from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { Readable } from 'stream';
import getPort from 'get-port';
import { serveAPI } from '../api';
import type { APIServer } from './api-server';
import {
  buildEncodedETag,
  compressPayload,
  compressReplyPayload,
  isCompressibleContentType,
  matchesIfNoneMatch,
  normalizeResponseCompressionOptions,
  registerResponseCompression,
  selectResponseEncoding,
} from './response-compression';
import type { ServerPlugin } from '../types';

const createMockRequest = (
  headers: Record<string, string> = {},
  method: string = 'GET',
): Partial<FastifyRequest> => ({
  method,
  headers,
});

const createMockReply = (
  statusCode: number = 200,
  headers: Record<string, string> = {},
): FastifyReply => {
  const sentHeaders = { ...headers };
  const reply = {
    statusCode,
    getHeader: (name: string) => sentHeaders[name],
    hasHeader: (name: string) => name in sentHeaders,
    header: (name: string, value: string) => {
      sentHeaders[name] = value;
      return reply as FastifyReply;
    },
    removeHeader: (name: string) => {
      delete sentHeaders[name];
    },
  };

  return reply as unknown as FastifyReply;
};

function makeRawRequest(options: {
  method?: string;
  port: number;
  path: string;
  headers?: Record<string, string>;
}): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: options.port,
        path: options.path,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

describe('response compression', () => {
  describe('normalizeResponseCompressionOptions', () => {
    it('uses defaults for true and undefined', () => {
      expect(normalizeResponseCompressionOptions(true)).toEqual(
        normalizeResponseCompressionOptions(undefined),
      );
    });

    it('disables compression when false is provided', () => {
      expect(normalizeResponseCompressionOptions(false).enabled).toBe(false);
    });

    it('merges partial option objects with defaults', () => {
      expect(
        normalizeResponseCompressionOptions({
          threshold: 2048,
          preferBrotli: false,
        }),
      ).toEqual({
        enabled: true,
        threshold: 2048,
        preferBrotli: false,
        brotliQuality: 4,
        gzipLevel: 6,
      });
    });
  });

  describe('isCompressibleContentType', () => {
    it('accepts known compressible types', () => {
      expect(isCompressibleContentType('text/html; charset=utf-8')).toBe(true);
      expect(isCompressibleContentType('application/json')).toBe(true);
      expect(isCompressibleContentType('image/svg+xml')).toBe(true);
    });

    it('rejects unknown or missing types', () => {
      expect(isCompressibleContentType(undefined)).toBe(false);
      expect(isCompressibleContentType('image/png')).toBe(false);
      expect(isCompressibleContentType('')).toBe(false);
      expect(isCompressibleContentType('   ; charset=utf-8')).toBe(false);
    });
  });

  describe('selectResponseEncoding', () => {
    it('prefers Brotli by default when both are accepted', () => {
      expect(selectResponseEncoding('gzip, br', true)).toBe('br');
    });

    it('can prefer gzip when configured', () => {
      expect(selectResponseEncoding('gzip, br', false)).toBe('gzip');
    });

    it('falls back to Brotli when gzip is unavailable and Brotli is allowed', () => {
      expect(selectResponseEncoding('br;q=1, gzip;q=0', false)).toBe('br');
    });

    it('honors q weights before server preference', () => {
      expect(selectResponseEncoding('gzip;q=1, br;q=0.1', true)).toBe('gzip');
      expect(selectResponseEncoding('gzip;q=0.2, br;q=1', false)).toBe('br');
    });

    it('uses preferBrotli only to break q-value ties', () => {
      expect(selectResponseEncoding('gzip;q=0.8, br;q=0.8', true)).toBe('br');
      expect(selectResponseEncoding('gzip;q=0.8, br;q=0.8', false)).toBe(
        'gzip',
      );
    });

    it('falls back to wildcard matches', () => {
      expect(selectResponseEncoding('*;q=0.8', true)).toBe('br');
    });

    it('returns null when no supported encoding is allowed', () => {
      expect(selectResponseEncoding('deflate, br;q=0, gzip;q=0', true)).toBe(
        null,
      );
      expect(selectResponseEncoding(undefined, true)).toBe(null);
    });
  });

  describe('ETag helpers', () => {
    it('adds encoding suffixes to strong ETags', () => {
      expect(buildEncodedETag('"abc"', 'gzip')).toBe('"abc--gzip"');
    });

    it('preserves weak ETag prefixes', () => {
      expect(buildEncodedETag('W/"abc"', 'br')).toBe('W/"abc--br"');
    });

    it('falls back cleanly for non-quoted ETags', () => {
      expect(buildEncodedETag('abc', 'gzip')).toBe('abc--gzip');
    });

    it('matches If-None-Match exact and wildcard forms', () => {
      expect(matchesIfNoneMatch('"abc"', '"abc"')).toBe(true);
      expect(matchesIfNoneMatch('"x", "abc"', '"abc"')).toBe(true);
      expect(matchesIfNoneMatch('*', '"abc"')).toBe(true);
      expect(matchesIfNoneMatch(undefined, '"abc"')).toBe(false);
      expect(matchesIfNoneMatch('"x"', '"abc"')).toBe(false);
    });

    it('uses weak comparison semantics for If-None-Match', () => {
      expect(matchesIfNoneMatch('W/"abc"', '"abc"')).toBe(true);
      expect(matchesIfNoneMatch('"abc"', 'W/"abc"')).toBe(true);
      expect(matchesIfNoneMatch('W/"xyz"', '"abc"')).toBe(false);
    });
  });

  describe('compressPayload', () => {
    it('compresses with gzip', async () => {
      const payload = Buffer.from('hello world '.repeat(300));
      const compressed = await compressPayload(
        payload,
        'gzip',
        normalizeResponseCompressionOptions(true),
      );

      expect(gunzipSync(compressed).toString()).toBe(payload.toString());
    });

    it('compresses with Brotli', async () => {
      const payload = Buffer.from('hello world '.repeat(300));
      const compressed = await compressPayload(
        payload,
        'br',
        normalizeResponseCompressionOptions(true),
      );

      expect(brotliDecompressSync(compressed).toString()).toBe(
        payload.toString(),
      );
    });
  });

  describe('compressReplyPayload', () => {
    it('compresses JSON responses when gzip is accepted', async () => {
      const request = createMockRequest({
        'accept-encoding': 'gzip, br;q=0',
      });

      const reply = createMockReply(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': '2048',
      });

      const payload = JSON.stringify({ value: 'x'.repeat(3000) });

      const result = await compressReplyPayload(
        request as FastifyRequest,
        reply,
        payload,
        true,
      );

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(reply.getHeader('Content-Encoding')).toBe('gzip');
      expect(reply.getHeader('Vary')).toBe('Accept-Encoding');
      expect(reply.getHeader('Content-Length')).toBe(
        String((result as Buffer).length),
      );
      expect(gunzipSync(result as Buffer).toString()).toBe(payload);
    });

    it('compresses with Brotli when preferred and supported', async () => {
      const request = createMockRequest({
        'accept-encoding': 'br, gzip',
      });

      const reply = createMockReply(200, {
        'Content-Type': 'text/html',
      });

      const payload = '<html>' + 'x'.repeat(3000) + '</html>';

      const result = await compressReplyPayload(
        request as FastifyRequest,
        reply,
        payload,
        true,
      );

      expect(reply.getHeader('Content-Encoding')).toBe('br');
      expect(brotliDecompressSync(result as Buffer).toString()).toBe(payload);
    });

    it('rewrites ETag when a compressed representation is selected', async () => {
      const request = createMockRequest({
        'accept-encoding': 'gzip',
      });

      const reply = createMockReply(200, {
        'Content-Type': 'application/json',
        ETag: '"abc123"',
      });

      const payload = JSON.stringify({ value: 'x'.repeat(3000) });

      const result = await compressReplyPayload(
        request as FastifyRequest,
        reply,
        payload,
        true,
      );

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(reply.getHeader('Content-Encoding')).toBe('gzip');
      expect(reply.getHeader('ETag')).toBe('"abc123--gzip"');
      expect(gunzipSync(result as Buffer).toString()).toBe(payload);
    });

    it('skips streamed payloads', async () => {
      const request = createMockRequest({
        'accept-encoding': 'gzip',
      });

      const reply = createMockReply(200, {
        'Content-Type': 'text/plain',
      });

      const payload = new Readable();

      const result = await compressReplyPayload(
        request as FastifyRequest,
        reply,
        payload,
        true,
      );

      expect(result).toBe(payload);
      expect(reply.getHeader('Content-Encoding')).toBeUndefined();
    });

    it('skips when disabled via config', async () => {
      // Passing `false` (or `{ enabled: false }`) as the compression option
      // disables compression entirely — the payload is returned unchanged even
      // when the client advertises gzip support.
      const payload = JSON.stringify({ value: 'x'.repeat(3000) });

      const result = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'gzip',
        }) as FastifyRequest,
        createMockReply(200, {
          'Content-Type': 'application/json',
        }),
        payload,
        false, // compression disabled
      );

      expect(result).toBe(payload);
    });

    it('skips when reply is already sent (e.g. hijacked by static content)', async () => {
      // Static content uses reply.hijack() + reply.raw, bypassing onSend entirely.
      // This guard catches the edge case where the hook fires anyway.
      const payload = JSON.stringify({ value: 'x'.repeat(3000) });
      const request = createMockRequest(
        { 'accept-encoding': 'gzip' },
        'GET',
      ) as FastifyRequest;

      const reply = createMockReply(200, {
        'Content-Type': 'application/json',
      });

      // Simulate a hijacked reply (reply.sent returns true)
      (reply as unknown as { sent: boolean }).sent = true;

      // Will return the result without modifying the reply
      const result = await compressReplyPayload(request, reply, payload, true);

      expect(result).toBe(payload);
    });

    it('negotiates compression headers for HEAD responses', async () => {
      const request = createMockRequest(
        {
          'accept-encoding': 'gzip',
        },
        'HEAD',
      );

      const reply = createMockReply(200, {
        'Content-Type': 'application/json',
        'Content-Length': '3012',
        ETag: '"head-etag"',
      });

      const payload = JSON.stringify({ value: 'x'.repeat(3000) });

      const result = await compressReplyPayload(
        request as FastifyRequest,
        reply,
        payload,
        true,
      );

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(reply.getHeader('Vary')).toBe('Accept-Encoding');
      expect(reply.getHeader('Content-Encoding')).toBe('gzip');
      expect(reply.getHeader('ETag')).toBe('"head-etag--gzip"');

      const reportedLength = Number(reply.getHeader('Content-Length'));
      expect(Number.isFinite(reportedLength)).toBe(true);
      expect(reportedLength).toBeGreaterThan(0);
      expect(reportedLength).toBeLessThan(Buffer.byteLength(payload));
      expect((result as Buffer).length).toBe(reportedLength);
    });

    it('skips HEAD, 204, 304, range requests, and already-encoded replies', async () => {
      const payload = JSON.stringify({ value: 'x'.repeat(3000) });

      // 204 No Content should not gain a body via compression.
      const noContentResult = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'gzip',
        }) as FastifyRequest,
        createMockReply(204, {
          'Content-Type': 'application/json',
        }),
        payload,
        true,
      );
      expect(noContentResult).toBe(payload);

      // 304 Not Modified likewise has no response body to transform.
      const notModifiedResult = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'gzip',
        }) as FastifyRequest,
        createMockReply(304, {
          'Content-Type': 'application/json',
        }),
        payload,
        true,
      );
      expect(notModifiedResult).toBe(payload);

      // Range requests are handled as partial-content semantics, not generic
      // compression transforms.
      const rangeResult = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'gzip',
          range: 'bytes=0-10',
        }) as FastifyRequest,
        createMockReply(200, {
          'Content-Type': 'application/json',
        }),
        payload,
        true,
      );
      expect(rangeResult).toBe(payload);

      // Pre-existing Content-Range indicates a partial-content response path.
      const contentRangeResult = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'gzip',
        }) as FastifyRequest,
        createMockReply(200, {
          'Content-Type': 'application/json',
          'Content-Range': 'bytes 0-10/100',
        }),
        payload,
        true,
      );
      expect(contentRangeResult).toBe(payload);

      // If a response already declared Content-Encoding, the generic hook must
      // not try to re-encode it.
      const encodedResult = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'gzip',
        }) as FastifyRequest,
        createMockReply(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        }),
        payload,
        true,
      );
      expect(encodedResult).toBe(payload);
    });

    it('skips unknown content types, small payloads, and unsupported encodings', async () => {
      const largePayload = JSON.stringify({ value: 'x'.repeat(3000) });

      // Non-compressible content types are left alone.
      const unknownType = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'gzip',
        }) as FastifyRequest,
        createMockReply(200, {
          'Content-Type': 'image/png',
        }),
        largePayload,
        true,
      );
      expect(unknownType).toBe(largePayload);

      // Tiny payloads are not worth compressing.
      const smallPayload = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'gzip',
        }) as FastifyRequest,
        createMockReply(200, {
          'Content-Type': 'application/json',
        }),
        '{}',
        true,
      );
      expect(smallPayload).toBe('{}');

      // If the client does not accept gzip or Brotli, we leave the payload as-is.
      const unsupportedEncoding = await compressReplyPayload(
        createMockRequest({
          'accept-encoding': 'deflate',
        }) as FastifyRequest,
        createMockReply(200, {
          'Content-Type': 'application/json',
        }),
        largePayload,
        true,
      );
      expect(unsupportedEncoding).toBe(largePayload);
    });

    it('skips compression when it would not reduce payload size', async () => {
      const request = createMockRequest({
        'accept-encoding': 'gzip',
      });
      const reply = createMockReply(200, {
        'Content-Type': 'text/plain',
      });
      const payload = 'abcdef'.repeat(200);

      const result = await compressReplyPayload(
        request as FastifyRequest,
        reply,
        payload,
        {
          threshold: 1,
          gzipLevel: 0,
        },
      );

      expect(result).toBe(payload);
      expect(reply.getHeader('Content-Encoding')).toBeUndefined();
      expect(reply.getHeader('Vary')).toBe('Accept-Encoding');
    });
  });

  describe('registerResponseCompression', () => {
    it('registers an onSend hook when enabled', () => {
      const addHook = mock(() => {});
      const fastifyInstance = {
        addHook,
      } as unknown as FastifyInstance;

      registerResponseCompression(fastifyInstance, true);

      expect(addHook).toHaveBeenCalledTimes(1);
      expect(addHook).toHaveBeenCalledWith('onSend', expect.any(Function));
    });

    it('does not register an onSend hook when disabled', () => {
      const addHook = mock(() => {});
      const fastifyInstance = {
        addHook,
      } as unknown as FastifyInstance;

      registerResponseCompression(fastifyInstance, false);

      expect(addHook).not.toHaveBeenCalled();
    });
  });

  describe('integration', () => {
    let server: APIServer | null = null;
    let port: number;

    beforeEach(async () => {
      port = await getPort();
    });

    afterEach(async () => {
      if (server) {
        await server.stop();
        server = null;
      }
    });

    it('keeps GET and HEAD compression metadata aligned for dynamic routes', async () => {
      const payload = JSON.stringify({ value: 'x'.repeat(3000) });
      const testPlugin: ServerPlugin = (pluginHost) => {
        pluginHost.get('/api/compression-check', async (_request, reply) => {
          reply.type('application/json').header('ETag', '"dynamic-etag"');
          return payload;
        });
      };

      server = serveAPI({
        plugins: [testPlugin],
        accessLog: { events: 'none' },
      });

      await server.listen(port, 'localhost');

      const getResponse = await makeRawRequest({
        port,
        path: '/api/compression-check',
        headers: {
          'accept-encoding': 'gzip',
        },
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.headers['content-encoding']).toBe('gzip');
      expect(getResponse.headers.vary).toContain('Accept-Encoding');
      expect(getResponse.headers.etag).toBe('"dynamic-etag--gzip"');

      const getContentLength = getResponse.headers['content-length'];
      expect(getContentLength).toBeDefined();

      const headResponse = await makeRawRequest({
        port,
        path: '/api/compression-check',
        method: 'HEAD',
        headers: {
          'accept-encoding': 'gzip',
        },
      });

      expect(headResponse.statusCode).toBe(200);
      expect(headResponse.headers['content-encoding']).toBe('gzip');
      expect(headResponse.headers.vary).toContain('Accept-Encoding');
      expect(headResponse.headers.etag).toBe('"dynamic-etag--gzip"');
      expect(headResponse.headers['content-length']).toBe(getContentLength);
      expect(headResponse.body.length).toBe(0);
    });

    it('returns 304 for If-None-Match against the encoded dynamic ETag', async () => {
      const payload = JSON.stringify({ value: 'x'.repeat(3000) });
      const testPlugin: ServerPlugin = (pluginHost) => {
        pluginHost.get('/api/compression-304', async (_request, reply) => {
          reply.type('application/json').header('ETag', '"dynamic-304"');
          return payload;
        });
      };

      server = serveAPI({
        plugins: [testPlugin],
        accessLog: { events: 'none' },
      });

      await server.listen(port, 'localhost');

      const initialResponse = await makeRawRequest({
        port,
        path: '/api/compression-304',
        headers: {
          'accept-encoding': 'gzip',
        },
      });

      const encodedETag = initialResponse.headers.etag;
      expect(encodedETag).toBe('"dynamic-304--gzip"');

      if (typeof encodedETag !== 'string') {
        throw new TypeError('Expected encoded ETag header to be a string');
      }

      const notModifiedResponse = await makeRawRequest({
        port,
        path: '/api/compression-304',
        headers: {
          'accept-encoding': 'gzip',
          'if-none-match': encodedETag,
        },
      });

      expect(notModifiedResponse.statusCode).toBe(304);
      expect(notModifiedResponse.headers.etag).toBe(encodedETag);
      expect(notModifiedResponse.headers['content-encoding']).toBe('gzip');
      expect(notModifiedResponse.body.length).toBe(0);
    });
  });
});
