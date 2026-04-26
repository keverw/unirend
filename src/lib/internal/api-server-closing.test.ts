import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import getPort from 'get-port';
import { serveAPI } from '../api';
import { APIResponseHelpers } from '../../api-envelope';
import type { APIServer } from './api-server';
import type { FastifyInstance } from 'fastify';

describe('API Server Closing Responses', () => {
  let server: APIServer | null = null;
  let port: number;

  beforeEach(async () => {
    port = await getPort();
  });

  afterEach(async () => {
    if (server) {
      (server as unknown as { _isStopping?: boolean })._isStopping = false;
      await server.stop();
      server = null;
    }
  });

  const markStopping = async (target: APIServer) => {
    await target.listen(port, 'localhost');
    (target as unknown as { _isStopping: boolean })._isStopping = true;

    return (target as unknown as { fastifyInstance: FastifyInstance })
      .fastifyInstance;
  };

  it('returns the default API envelope while stopping', async () => {
    server = serveAPI();
    const fastify = await markStopping(server);

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/missing',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body.status).toBe('error');
    expect(body.status_code).toBe(503);
    expect(body.error.code).toBe('service_unavailable');
    expect(body.error.message).toBe('Server is shutting down');
  });

  it('returns the default web page while stopping in web-only mode', async () => {
    server = serveAPI({
      apiEndpoints: { apiEndpointPrefix: false },
    });
    const fastify = await markStopping(server);

    const response = await fastify.inject({
      method: 'GET',
      url: '/anything',
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('503 - Service Unavailable');
    expect(response.body).toContain('Server is shutting down');
  });

  it('uses split closing handlers for API and web requests', async () => {
    server = serveAPI({
      closingHandler: {
        api: (request) =>
          APIResponseHelpers.createAPIErrorResponse({
            request,
            statusCode: 503,
            errorCode: 'maintenance',
            errorMessage: 'Maintenance window active',
          }),
        web: () => ({
          contentType: 'text',
          content: 'Maintenance window active',
          statusCode: 503,
        }),
      },
    });
    const fastify = await markStopping(server);

    const apiResponse = await fastify.inject({
      method: 'GET',
      url: '/api/users',
    });
    const apiBody = JSON.parse(apiResponse.body);

    const webResponse = await fastify.inject({
      method: 'GET',
      url: '/status',
    });

    expect(apiResponse.statusCode).toBe(503);
    expect(apiBody.error.code).toBe('maintenance');
    expect(apiBody.error.message).toBe('Maintenance window active');
    expect(webResponse.statusCode).toBe(503);
    expect(webResponse.headers['content-type']).toContain('text/plain');
    expect(webResponse.body).toBe('Maintenance window active');
  });
});
