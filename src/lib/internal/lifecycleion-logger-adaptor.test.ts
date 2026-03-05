import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Logger } from 'lifecycleion/logger';
import { UnirendLifecycleionLoggerAdaptor } from './lifecycleion-logger-adaptor';
import { serveAPI } from '../api';
import type { APIServer } from './api-server';
import type { ServerPlugin } from '../types';
import getPort from 'get-port';

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('UnirendLifecycleionLoggerAdaptor (unit)', () => {
  it('routes info/warn/error/debug to the matching Lifecycleion method', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.info('info message');
    adaptor.warn('warn message');
    adaptor.error('error message');
    adaptor.debug('debug message');

    const types = arraySink.logs.map((e) => e.type);
    expect(types).toContain('info');
    expect(types).toContain('warn');
    expect(types).toContain('error');
    expect(types).toContain('debug');
  });

  it('maps trace → debug', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.trace('trace message');

    expect(arraySink.logs).toHaveLength(1);
    expect(arraySink.logs[0].type).toBe('debug');
    expect(arraySink.logs[0].template).toBe('trace message');
  });

  it('maps fatal → error', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.fatal('fatal message');

    expect(arraySink.logs).toHaveLength(1);
    expect(arraySink.logs[0].type).toBe('error');
    expect(arraySink.logs[0].template).toBe('fatal message');
  });

  it('passes message through as the template string', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.info('hello world');

    expect(arraySink.logs[0].template).toBe('hello world');
    expect(arraySink.logs[0].message).toBe('hello world');
  });

  it('forwards context.logger.params to Lifecycleion', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.info('user {{id}} logged in', {
      logger: { params: { id: 'u_123' } },
    });

    expect(arraySink.logs[0].params).toEqual({ id: 'u_123' });
    expect(arraySink.logs[0].message).toBe('user u_123 logged in');
  });

  it('forwards context.logger.redactedKeys to Lifecycleion and values are redacted', () => {
    const { arraySink } = Logger.createTestOptimizedLogger();

    // Create a Logger with a redactFunction so Lifecycleion actually masks the values
    const loggerWithRedact = new Logger({
      sinks: [arraySink],
      callProcessExit: false,
      redactFunction: (_key, _value) => '[REDACTED]',
    });

    const adaptor = UnirendLifecycleionLoggerAdaptor(loggerWithRedact);

    adaptor.info('auth attempt', {
      logger: {
        params: { username: 'alice', password: 'secret123' },
        redactedKeys: ['password'],
      },
    });

    const entry = arraySink.logs[0];
    expect(entry.redactedKeys).toEqual(['password']);
    // Non-redacted key is preserved in params
    expect(entry.params?.username).toBe('alice');
    // Redacted key is masked in redactedParams
    expect(entry.redactedParams?.password).toBe('[REDACTED]');
  });

  it('forwards context.logger.tags to Lifecycleion and they appear in the log entry', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.warn('payment failed', {
      logger: { tags: ['billing', 'critical'] },
    });

    const entry = arraySink.logs[0];
    expect(entry.tags).toEqual(['billing', 'critical']);
    expect(entry.type).toBe('warn');
    expect(entry.template).toBe('payment failed');
  });

  it('ignores context.logger when it is not a plain object', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    // Class instance — should not crash, just logs with no options
    adaptor.info('message', {
      logger: new Date() as unknown as Record<string, unknown>,
    });

    expect(arraySink.logs).toHaveLength(1);
    expect(arraySink.logs[0].template).toBe('message');
    expect(arraySink.logs[0].params).toBeUndefined();
  });

  it('logs normally when context has no logger key', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.info('plain message', { someKey: 'abc', pid: 1234 });

    expect(arraySink.logs).toHaveLength(1);
    expect(arraySink.logs[0].template).toBe('plain message');
    expect(arraySink.logs[0].params).toBeUndefined();
  });

  it('logs normally when context is undefined', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.info('no context');

    expect(arraySink.logs).toHaveLength(1);
    expect(arraySink.logs[0].template).toBe('no context');
  });

  it('allows an empty string message', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const adaptor = UnirendLifecycleionLoggerAdaptor(logger);

    adaptor.info('');

    expect(arraySink.logs).toHaveLength(1);
    expect(arraySink.logs[0].template).toBe('');
  });

  it('works with a LoggerService (service logger)', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const serviceLogger = logger.service('TestService');
    const adaptor = UnirendLifecycleionLoggerAdaptor(serviceLogger);

    adaptor.info('service message');

    expect(arraySink.logs).toHaveLength(1);
    expect(arraySink.logs[0].serviceName).toBe('TestService');
    expect(arraySink.logs[0].template).toBe('service message');
  });

  it('works with an entity logger (child of a service)', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const entityLogger = logger.service('TestService').entity('worker-1');
    const adaptor = UnirendLifecycleionLoggerAdaptor(entityLogger);

    adaptor.info('entity message');

    expect(arraySink.logs).toHaveLength(1);
    expect(arraySink.logs[0].serviceName).toBe('TestService');
    expect(arraySink.logs[0].entityName).toBe('worker-1');
    expect(arraySink.logs[0].template).toBe('entity message');
  });
});

// ─── Integration tests (via APIServer) ───────────────────────────────────────

describe('UnirendLifecycleionLoggerAdaptor (integration via APIServer)', () => {
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

  it('routes server logs through the adaptor when wired to logging.logger', async () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();

    server = serveAPI({
      logging: { logger: UnirendLifecycleionLoggerAdaptor(logger) },
      accessLog: { responseTemplate: '{{method}} {{url}} {{statusCode}}' },
    });

    await server.listen(port, 'localhost');

    const response = await fetch(`http://localhost:${port}/api/nonexistent`);
    await response.text();

    const accessLogs = arraySink.logs.filter((e) =>
      e.message.includes('GET /api/nonexistent'),
    );

    expect(accessLogs.length).toBeGreaterThan(0);
  });

  it('routes request.log calls from plugins through the adaptor', async () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();

    const testPlugin: ServerPlugin = (pluginHost) => {
      pluginHost.get('/api/plugin-log-test', (request) => {
        request.log.info('plugin log entry');
        return Promise.resolve({ ok: true });
      });
    };

    server = serveAPI({
      logging: { logger: UnirendLifecycleionLoggerAdaptor(logger) },
      plugins: [testPlugin],
      accessLog: { events: 'none' },
    });

    await server.listen(port, 'localhost');

    await fetch(`http://localhost:${port}/api/plugin-log-test`);

    const pluginLogs = arraySink.logs.filter(
      (e) => e.message === 'plugin log entry',
    );

    expect(pluginLogs.length).toBeGreaterThan(0);
    expect(pluginLogs[0].type).toBe('info');
  });

  it('forwards context.logger.params through the full server stack', async () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();

    const testPlugin: ServerPlugin = (pluginHost) => {
      pluginHost.get('/api/param-test', (request) => {
        request.log.info(
          { logger: { params: { id: 'u_999' } } },
          'user {{id}} visited',
        );

        return Promise.resolve({ ok: true });
      });
    };

    server = serveAPI({
      logging: { logger: UnirendLifecycleionLoggerAdaptor(logger) },
      plugins: [testPlugin],
      accessLog: { events: 'none' },
    });

    await server.listen(port, 'localhost');

    await fetch(`http://localhost:${port}/api/param-test`);

    const entry = arraySink.logs.find(
      (e) => e.template === 'user {{id}} visited',
    );

    expect(entry).toBeDefined();
    expect(entry?.message).toBe('user u_999 visited');
    expect(entry?.params).toEqual({ id: 'u_999' });
  });

  it('handles pino object-only log (no message string) — normalizes to empty template', async () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();

    const testPlugin: ServerPlugin = (pluginHost) => {
      pluginHost.get('/api/object-only-log', (request) => {
        // Pino allows logging a plain object with no message
        request.log.info({ someKey: 'bar' });
        return Promise.resolve({ ok: true });
      });
    };

    server = serveAPI({
      logging: { logger: UnirendLifecycleionLoggerAdaptor(logger) },
      plugins: [testPlugin],
      accessLog: { events: 'none' },
    });

    await server.listen(port, 'localhost');
    await fetch(`http://localhost:${port}/api/object-only-log`);

    const entry = arraySink.logs.find((e) => e.template === '');
    expect(entry).toBeDefined();
    expect(entry?.type).toBe('info');
  });

  it('handles pino array-only log (no message string) — normalizes to empty template', async () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();

    const testPlugin: ServerPlugin = (pluginHost) => {
      pluginHost.get('/api/array-only-log', (request) => {
        // Pino's first overload accepts `object` — arrays are objects
        request.log.info(['a', 'b'] as unknown as object);
        return Promise.resolve({ ok: true });
      });
    };

    server = serveAPI({
      logging: { logger: UnirendLifecycleionLoggerAdaptor(logger) },
      plugins: [testPlugin],
      accessLog: { events: 'none' },
    });

    await server.listen(port, 'localhost');
    await fetch(`http://localhost:${port}/api/array-only-log`);

    const entry = arraySink.logs.find((e) => e.template === '');
    expect(entry).toBeDefined();
    expect(entry?.type).toBe('info');
  });
});
