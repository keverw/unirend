import type { FastifyRequest, FastifyReply } from 'fastify';
import type { OutgoingHttpHeaders } from 'node:http';
import type {
  APIErrorResponse,
  BaseMeta,
  PageErrorResponse,
} from '../api-envelope/api-envelope-types';

/**
 * Sends an error envelope immediately via the raw/hijacked response path.
 *
 * This is shared by controlled reply wrappers and the public helper fallback so
 * both paths apply the same CORS/header logic before writing the final JSON
 * body directly to the socket.
 */
export async function sendRawErrorEnvelopeResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  errorResponse: APIErrorResponse<BaseMeta> | PageErrorResponse<BaseMeta>,
): Promise<void> {
  const body = JSON.stringify(errorResponse);

  // Raw/hijacked sends bypass Fastify's normal onSend pipeline, so any
  // plugin-managed headers that still matter here must be applied explicitly
  // before we snapshot reply.getHeaders() for writeHead(). Keep this ahead of
  // reply.hijack() so header-application failures still propagate through
  // Fastify's normal error handling instead of failing after raw ownership has
  // already been taken.
  await request.applyCORSHeaders?.(reply);

  // Keep Fastify's reply state aligned with the status/content-type we are
  // about to send even though the final body write happens on reply.raw.
  reply.code(statusCode);
  reply.type('application/json; charset=utf-8');
  reply.header('Content-Length', String(Buffer.byteLength(body)));

  // Hijack before writeHead() so Fastify does not attempt its own send path
  // after this helper has already fully terminated the response.
  reply.hijack();
  reply.raw.writeHead(statusCode, reply.getHeaders() as OutgoingHttpHeaders);

  // Error envelopes are always JSON here, so a single buffered end() keeps the
  // transport simple and makes the termination point explicit.
  reply.raw.end(request.method === 'HEAD' ? undefined : body);
}
