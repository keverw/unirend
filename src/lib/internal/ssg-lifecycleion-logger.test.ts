import { describe, it, expect } from 'bun:test';
import { Logger } from 'lifecycleion/logger';
import { SSGLifecycleionLogger } from './ssg-lifecycleion-logger';

describe('SSGLifecycleionLogger', () => {
  it('defaults to service name "SSG"', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const ssgLogger = SSGLifecycleionLogger(logger);

    ssgLogger.info('test message');

    expect(arraySink.logs[0].serviceName).toBe('SSG');
  });

  it('uses a custom service name when provided', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const ssgLogger = SSGLifecycleionLogger(logger, 'my-site-generator');

    ssgLogger.info('test message');

    expect(arraySink.logs[0].serviceName).toBe('my-site-generator');
  });

  it('routes info/warn/error to the matching Lifecycleion method', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const ssgLogger = SSGLifecycleionLogger(logger);

    ssgLogger.info('info message');
    ssgLogger.warn('warn message');
    ssgLogger.error('error message');

    const types = arraySink.logs.map((e) => e.type);
    expect(types).toContain('info');
    expect(types).toContain('warn');
    expect(types).toContain('error');
  });

  it('passes message through as the template string', () => {
    const { logger, arraySink } = Logger.createTestOptimizedLogger();
    const ssgLogger = SSGLifecycleionLogger(logger);

    ssgLogger.info('generating /about');

    expect(arraySink.logs[0].template).toBe('generating /about');
    expect(arraySink.logs[0].message).toBe('generating /about');
  });
});
