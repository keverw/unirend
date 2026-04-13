import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import getPort from 'get-port';
import type { OutgoingHttpHeaders } from 'node:http';
import { serveAPI } from '../api';
import type { APIServer } from './api-server';
import type { ServerPlugin } from '../types';
import {
  formatResponseTimeHeaderValue,
  getResponseTimeMS,
  normalizeResponseTimeHeaderOptions,
} from './response-time-header';

describe('response-time header', () => {
  describe('normalizeResponseTimeHeaderOptions', () => {
    it('defaults to disabled', () => {
      expect(normalizeResponseTimeHeaderOptions(undefined)).toEqual({
        enabled: false,
        headerName: 'X-Response-Time',
        digits: 2,
      });
    });

    it('enables with defaults for boolean true', () => {
      expect(normalizeResponseTimeHeaderOptions(true)).toEqual({
        enabled: true,
        headerName: 'X-Response-Time',
        digits: 2,
      });
    });

    it('merges partial option objects', () => {
      expect(
        normalizeResponseTimeHeaderOptions({
          headerName: 'Server-Timing-Like',
          digits: 0,
        }),
      ).toEqual({
        enabled: true,
        headerName: 'Server-Timing-Like',
        digits: 0,
      });
    });

    it('rejects empty header names', () => {
      expect(() =>
        normalizeResponseTimeHeaderOptions({
          headerName: '',
        }),
      ).toThrow('responseTimeHeader.headerName must be a non-empty string');
    });

    it('rejects header names with unsupported characters', () => {
      expect(() =>
        normalizeResponseTimeHeaderOptions({
          headerName: 'X Response Time',
        }),
      ).toThrow(
        'responseTimeHeader.headerName must contain only letters, numbers, and dashes',
      );

      expect(() =>
        normalizeResponseTimeHeaderOptions({
          headerName: 'X_Response_Time',
        }),
      ).toThrow(
        'responseTimeHeader.headerName must contain only letters, numbers, and dashes',
      );
    });

    it('rejects invalid digits', () => {
      expect(() =>
        normalizeResponseTimeHeaderOptions({
          digits: -1,
        }),
      ).toThrow(/responseTimeHeader\.digits/);

      expect(() =>
        normalizeResponseTimeHeaderOptions({
          digits: 7,
        }),
      ).toThrow(/responseTimeHeader\.digits/);

      expect(() =>
        normalizeResponseTimeHeaderOptions({
          digits: 1.5,
        }),
      ).toThrow(/responseTimeHeader\.digits/);
    });
  });

  describe('formatResponseTimeHeaderValue', () => {
    it('formats milliseconds with a fixed number of digits', () => {
      expect(formatResponseTimeHeaderValue(12.3456, 2)).toBe('12.35ms');
      expect(formatResponseTimeHeaderValue(12.3456, 0)).toBe('12ms');
    });
  });

  describe('getResponseTimeMS', () => {
    it('falls back to request.receivedAt when elapsedTime is not finite', () => {
      const originalNow = Date.now;
      Date.now = () => 1500;

      try {
        const reply = {
          elapsedTime: Number.NaN,
          request: { receivedAt: 1000 },
        } as unknown as Parameters<typeof getResponseTimeMS>[0];

        expect(getResponseTimeMS(reply)).toBe(500);
      } finally {
        Date.now = originalNow;
      }
    });

    it('falls back to -1 when neither elapsedTime nor receivedAt is usable', () => {
      const reply = {
        elapsedTime: Number.POSITIVE_INFINITY,
        request: {},
      } as unknown as Parameters<typeof getResponseTimeMS>[0];

      expect(getResponseTimeMS(reply)).toBe(-1);
    });
  });

  describe('integration via APIServer', () => {
    let server: APIServer | null = null;
    let port: number;
    let logs: string[];

    const makeLoggingConfig = () => ({
      logger: {
        trace: (_msg: string) => {},
        debug: (_msg: string) => {},
        info: (msg: string) => logs.push(msg),
        warn: (msg: string) => logs.push(msg),
        error: (msg: string) => logs.push(msg),
        fatal: (msg: string) => logs.push(msg),
      },
    });

    const delayedRoutePlugin: ServerPlugin = (pluginHost) => {
      pluginHost.get('/api/timing', async () => {
        await Bun.sleep(25);

        return {
          value: 'x'.repeat(4000),
        };
      });
    };

    beforeEach(async () => {
      port = await getPort();
      logs = [];
    });

    afterEach(async () => {
      if (server) {
        await server.stop();
        server = null;
      }
    });

    it('does not emit the header by default', async () => {
      server = serveAPI({
        plugins: [delayedRoutePlugin],
        accessLog: { events: 'none' },
      });

      await server.listen(port, 'localhost');

      const response = await fetch(`http://localhost:${port}/api/timing`);
      await response.text();

      expect(response.headers.get('x-response-time')).toBeNull();
    });

    it('emits the response-time header when enabled', async () => {
      server = serveAPI({
        plugins: [delayedRoutePlugin],
        accessLog: { events: 'none' },
        responseTimeHeader: true,
      });

      await server.listen(port, 'localhost');

      const response = await fetch(`http://localhost:${port}/api/timing`);
      await response.text();

      expect(response.headers.get('x-response-time')).toMatch(/^\d+\.\d{2}ms$/);
    });

    it('supports custom header names on normal replies', async () => {
      server = serveAPI({
        plugins: [delayedRoutePlugin],
        logging: makeLoggingConfig(),
        responseTimeHeader: {
          headerName: 'X-Total-Time',
          digits: 0,
        },
        accessLog: {
          responseTemplate: '{{responseTime}}ms {{url}}',
        },
      });

      await server.listen(port, 'localhost');

      const response = await fetch(`http://localhost:${port}/api/timing`);
      await response.text();

      const headerValue = response.headers.get('x-total-time');
      expect(headerValue).toMatch(/^\d+ms$/);

      const accessLog = logs.find((message) => message.includes('/api/timing'));
      expect(accessLog).toBeDefined();
      expect(accessLog).toContain('/api/timing');
    });

    it('coexists with response compression', async () => {
      server = serveAPI({
        plugins: [delayedRoutePlugin],
        accessLog: { events: 'none' },
        responseTimeHeader: true,
      });

      await server.listen(port, 'localhost');

      const response = await fetch(`http://localhost:${port}/api/timing`, {
        headers: {
          'accept-encoding': 'gzip',
        },
      });

      await response.arrayBuffer();

      expect(response.headers.get('content-encoding')).toBe('gzip');
      expect(response.headers.get('x-response-time')).toMatch(/^\d+\.\d{2}ms$/);
    });

    it('applies the header before hijacked raw writeHead uses reply.getHeaders()', async () => {
      const hijackPlugin: ServerPlugin = (pluginHost) => {
        pluginHost.get('/api/hijack-timing', async (_request, reply) => {
          await Bun.sleep(20);
          reply.header('Content-Type', 'text/plain');
          reply.hijack();
          reply.raw.writeHead(206, reply.getHeaders() as OutgoingHttpHeaders);
          reply.raw.end('partial');
        });
      };

      server = serveAPI({
        plugins: [hijackPlugin],
        accessLog: { events: 'none' },
        responseTimeHeader: true,
      });

      await server.listen(port, 'localhost');

      const response = await fetch(
        `http://localhost:${port}/api/hijack-timing`,
      );
      expect(response.status).toBe(206);
      expect(response.headers.get('x-response-time')).toMatch(/^\d+\.\d{2}ms$/);
      expect(await response.text()).toBe('partial');
    });

    it('lets hijacked streamed replies log completion time independently of the header', async () => {
      const hijackPlugin: ServerPlugin = (pluginHost) => {
        pluginHost.get('/api/hijack-stream-timing', async (_request, reply) => {
          await Bun.sleep(10);
          reply.header('Content-Type', 'text/plain');
          reply.hijack();
          reply.raw.writeHead(200, reply.getHeaders() as OutgoingHttpHeaders);
          await Bun.sleep(60);
          reply.raw.end('streamed');
        });
      };

      server = serveAPI({
        plugins: [hijackPlugin],
        logging: makeLoggingConfig(),
        responseTimeHeader: {
          headerName: 'X-Total-Time',
          digits: 0,
        },
        accessLog: {
          responseTemplate: '{{responseTime}}ms {{url}}',
        },
      });

      await server.listen(port, 'localhost');

      const response = await fetch(
        `http://localhost:${port}/api/hijack-stream-timing`,
      );
      await response.text();

      const headerValue = response.headers.get('x-total-time');
      expect(headerValue).toMatch(/^\d+ms$/);

      const headerMS = Number.parseInt(headerValue as string, 10);
      const accessLog = logs.find((message) =>
        message.includes('/api/hijack-stream-timing'),
      );

      expect(accessLog).toBeDefined();
      const loggedMS = Number.parseInt(
        (accessLog ?? '').split('ms ')[0] ?? '',
        10,
      );
      expect(loggedMS).toBeGreaterThan(headerMS);
    });
  });
});
