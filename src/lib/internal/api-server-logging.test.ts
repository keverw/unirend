import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { serveAPI } from '../api';
import type { APIServer } from './api-server';
import getPort from 'get-port';

describe('API Server Logging Configuration', () => {
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

  it('should reject multiple logging sources (logging + fastifyOptions.logger)', async () => {
    server = serveAPI({
      logging: {
        logger: {
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {},
        },
      },
      fastifyOptions: {
        logger: true, // ❌ conflict
      },
    });

    // Error is thrown during listen(), not construction
    try {
      await server.listen(port, 'localhost');
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect((error as Error).message).toMatch(
        /logging configuration conflict/i,
      );
    }
  });

  it('should reject multiple logging sources (logging + fastifyOptions.loggerInstance)', async () => {
    const mockPinoLogger = {
      info: () => {},
      error: () => {},
      debug: () => {},
      fatal: () => {},
      warn: () => {},
      trace: () => {},
      silent: () => {},
      level: 'info',
      child: () => mockPinoLogger,
    };

    server = serveAPI({
      logging: {
        logger: {
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {},
        },
      },
      fastifyOptions: {
        loggerInstance: mockPinoLogger, // ❌ conflict
      },
    });

    try {
      await server.listen(port, 'localhost');
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect((error as Error).message).toMatch(
        /logging configuration conflict/i,
      );
    }
  });

  it('should reject multiple logging sources (fastifyOptions.logger + loggerInstance)', async () => {
    const mockPinoLogger = {
      info: () => {},
      error: () => {},
      debug: () => {},
      fatal: () => {},
      warn: () => {},
      trace: () => {},
      silent: () => {},
      level: 'info',
      child: () => mockPinoLogger,
    };

    server = serveAPI({
      fastifyOptions: {
        logger: true,
        loggerInstance: mockPinoLogger, // ❌ conflict
      },
    });

    try {
      await server.listen(port, 'localhost');
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect((error as Error).message).toMatch(
        /logging configuration conflict/i,
      );
    }
  });

  it('should accept Unirend logging configuration alone', async () => {
    const logs: Array<{ level: string; message: string; context?: unknown }> =
      [];

    server = serveAPI({
      logging: {
        level: 'info',
        logger: {
          trace: (msg, ctx) =>
            logs.push({ level: 'trace', message: msg, context: ctx }),
          debug: (msg, ctx) =>
            logs.push({ level: 'debug', message: msg, context: ctx }),
          info: (msg, ctx) =>
            logs.push({ level: 'info', message: msg, context: ctx }),
          warn: (msg, ctx) =>
            logs.push({ level: 'warn', message: msg, context: ctx }),
          error: (msg, ctx) =>
            logs.push({ level: 'error', message: msg, context: ctx }),
          fatal: (msg, ctx) =>
            logs.push({ level: 'fatal', message: msg, context: ctx }),
        },
      },
    });

    await server.listen(port, 'localhost');
    expect(server.isListening()).toBe(true);
  });

  it('should accept fastifyOptions.logger configuration alone', async () => {
    server = serveAPI({
      fastifyOptions: {
        logger: true,
      },
    });

    await server.listen(port, 'localhost');
    expect(server.isListening()).toBe(true);
  });

  it('should accept fastifyOptions.loggerInstance configuration alone', async () => {
    const logs: string[] = [];
    const mockPinoLogger = {
      info: (msg: string) => logs.push(`info: ${msg}`),
      error: (msg: string) => logs.push(`error: ${msg}`),
      debug: (msg: string) => logs.push(`debug: ${msg}`),
      fatal: (msg: string) => logs.push(`fatal: ${msg}`),
      warn: (msg: string) => logs.push(`warn: ${msg}`),
      trace: (msg: string) => logs.push(`trace: ${msg}`),
      silent: () => {},
      level: 'info',
      child: () => mockPinoLogger,
    };

    server = serveAPI({
      fastifyOptions: {
        loggerInstance: mockPinoLogger,
      },
    });

    await server.listen(port, 'localhost');
    expect(server.isListening()).toBe(true);
  });

  it('should respect log level filtering in Unirend logger', async () => {
    const logs: Array<{ level: string; message: string }> = [];

    server = serveAPI({
      logging: {
        level: 'warn', // Only warn and above
        logger: {
          trace: (msg) => logs.push({ level: 'trace', message: msg }),
          debug: (msg) => logs.push({ level: 'debug', message: msg }),
          info: (msg) => logs.push({ level: 'info', message: msg }),
          warn: (msg) => logs.push({ level: 'warn', message: msg }),
          error: (msg) => logs.push({ level: 'error', message: msg }),
          fatal: (msg) => logs.push({ level: 'fatal', message: msg }),
        },
      },
    });

    await server.listen(port, 'localhost');

    // Make a request to trigger some logs
    const response = await fetch(`http://localhost:${port}/api/nonexistent`);
    await response.text();

    // Info-level request logs should be filtered out due to level: 'warn'
    const infoLogs = logs.filter((log) => log.level === 'info');
    expect(infoLogs.length).toBe(0);
  });

  it('should emit automatic request logs when logging is enabled', async () => {
    const logs: Array<{ level: string; message: string }> = [];

    server = serveAPI({
      logging: {
        logger: {
          trace: (msg) => logs.push({ level: 'trace', message: msg }),
          debug: (msg) => logs.push({ level: 'debug', message: msg }),
          info: (msg) => logs.push({ level: 'info', message: msg }),
          warn: (msg) => logs.push({ level: 'warn', message: msg }),
          error: (msg) => logs.push({ level: 'error', message: msg }),
          fatal: (msg) => logs.push({ level: 'fatal', message: msg }),
        },
      },
      // disableRequestLogging defaults to false, so request logs should appear
    });

    await server.listen(port, 'localhost');

    // Make a request
    const response = await fetch(`http://localhost:${port}/api/nonexistent`);
    await response.text();

    // Should have automatic "incoming request" and "request completed" logs
    const incomingLogs = logs.filter((log) =>
      log.message.includes('incoming request'),
    );
    const completedLogs = logs.filter((log) =>
      log.message.includes('request completed'),
    );

    expect(incomingLogs.length).toBeGreaterThan(0);
    expect(completedLogs.length).toBeGreaterThan(0);
  });

  it('should work with disableRequestLogging option', async () => {
    const logs: Array<{ level: string; message: string }> = [];

    server = serveAPI({
      logging: {
        logger: {
          trace: (msg) => logs.push({ level: 'trace', message: msg }),
          debug: (msg) => logs.push({ level: 'debug', message: msg }),
          info: (msg) => logs.push({ level: 'info', message: msg }),
          warn: (msg) => logs.push({ level: 'warn', message: msg }),
          error: (msg) => logs.push({ level: 'error', message: msg }),
          fatal: (msg) => logs.push({ level: 'fatal', message: msg }),
        },
      },
      fastifyOptions: {
        disableRequestLogging: true, // Disable automatic request logs
      },
    });

    await server.listen(port, 'localhost');

    // Make a request
    const response = await fetch(`http://localhost:${port}/api/nonexistent`);
    await response.text();

    // Should not have automatic "incoming request" or "request completed" logs
    const requestLogs = logs.filter(
      (log) =>
        log.message.includes('incoming request') ||
        log.message.includes('request completed'),
    );

    expect(requestLogs.length).toBe(0);
  });

  it('should handle logger write errors gracefully with fallback chain', async () => {
    const errorLogs: string[] = [];
    const fatalLogs: string[] = [];
    let infoThrowCount = 0;

    server = serveAPI({
      logging: {
        logger: {
          trace: () => {},
          debug: () => {},
          info: () => {
            infoThrowCount++;
            if (infoThrowCount === 1) {
              throw new Error('Info logger failed');
            }
          },
          warn: () => {},
          error: (msg) => errorLogs.push(msg),
          fatal: (msg) => fatalLogs.push(msg),
        },
      },
    });

    await server.listen(port, 'localhost');

    // The framework should catch the error and fall back to logger.error
    // This is hard to test without triggering internal framework logs
    // For now, just verify server starts successfully with a throwing logger
    expect(server.isListening()).toBe(true);
  });

  it('should allow no logging configuration (silent mode)', async () => {
    server = serveAPI({
      // No logging config at all
    });

    await server.listen(port, 'localhost');
    expect(server.isListening()).toBe(true);

    // Make a request to ensure server works without logging
    const response = await fetch(`http://localhost:${port}/api/nonexistent`);
    expect(response.status).toBe(404);
  });
});
