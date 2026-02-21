import { describe, it, expect, beforeEach } from 'bun:test';
import { createFastifyLoggerFromUnirendLogging } from './unirend-logger-adapter';

describe('Unirend Logger Adapter', () => {
  describe('createFastifyLoggerFromUnirendLogging', () => {
    it('should validate logger object and throw if missing methods', () => {
      const incompleteLogger = {
        info: () => {},
        error: () => {},
        // Missing trace, debug, warn, fatal
      } as any;

      expect(() => {
        createFastifyLoggerFromUnirendLogging({
          logger: incompleteLogger,
        });
      }).toThrow(/must provide all log methods/i);
    });

    it('should reject logger with legacy .log() method', () => {
      const legacyLogger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        log: () => {}, // ❌ Not supported
      } as any;

      expect(() => {
        createFastifyLoggerFromUnirendLogging({
          logger: legacyLogger,
        });
      }).toThrow(/logger\.log.*is not supported/i);
    });

    it('should normalize invalid log level to "info"', () => {
      const logs: string[] = [];

      const logger = createFastifyLoggerFromUnirendLogging({
        level: 'invalid-level' as any, // Should fallback to 'info'
        logger: {
          trace: (msg) => logs.push(`trace: ${msg}`),
          debug: (msg) => logs.push(`debug: ${msg}`),
          info: (msg) => logs.push(`info: ${msg}`),
          warn: (msg) => logs.push(`warn: ${msg}`),
          error: (msg) => logs.push(`error: ${msg}`),
          fatal: (msg) => logs.push(`fatal: ${msg}`),
        },
      });

      // Should default to 'info' level
      expect(logger.level).toBe('info');
    });

    it('should respect log level filtering', () => {
      const logs: string[] = [];

      const logger = createFastifyLoggerFromUnirendLogging({
        level: 'warn', // Only warn and above
        logger: {
          trace: (msg) => logs.push(`trace: ${msg}`),
          debug: (msg) => logs.push(`debug: ${msg}`),
          info: (msg) => logs.push(`info: ${msg}`),
          warn: (msg) => logs.push(`warn: ${msg}`),
          error: (msg) => logs.push(`error: ${msg}`),
          fatal: (msg) => logs.push(`fatal: ${msg}`),
        },
      });

      logger.trace('should not appear');
      logger.debug('should not appear');
      logger.info('should not appear');
      logger.warn('should appear');
      logger.error('should appear');
      logger.fatal('should appear');

      expect(logs).toEqual([
        'warn: should appear',
        'error: should appear',
        'fatal: should appear',
      ]);
    });

    it('should handle silent level (no-op)', () => {
      const logs: string[] = [];
      const logger = createFastifyLoggerFromUnirendLogging({
        level: 'silent' as any,
        logger: {
          trace: (msg) => logs.push(`trace: ${msg}`),
          debug: (msg) => logs.push(`debug: ${msg}`),
          info: (msg) => logs.push(`info: ${msg}`),
          warn: (msg) => logs.push(`warn: ${msg}`),
          error: (msg) => logs.push(`error: ${msg}`),
          fatal: (msg) => logs.push(`fatal: ${msg}`),
        },
      });

      logger.info('should not appear');
      logger.error('should not appear');
      (logger as any).silent();

      expect(logs).toEqual([]);
    });

    it('should dynamically update level via setter', () => {
      const logs: string[] = [];
      const logger = createFastifyLoggerFromUnirendLogging({
        level: 'warn',
        logger: {
          trace: (msg) => logs.push(`trace: ${msg}`),
          debug: (msg) => logs.push(`debug: ${msg}`),
          info: (msg) => logs.push(`info: ${msg}`),
          warn: (msg) => logs.push(`warn: ${msg}`),
          error: (msg) => logs.push(`error: ${msg}`),
          fatal: (msg) => logs.push(`fatal: ${msg}`),
        },
      });

      logger.info('filtered out');
      expect(logs).toEqual([]);

      logger.level = 'info';
      logger.info('now visible');

      expect(logs).toEqual(['info: now visible']);
    });
  });

  describe('Log argument normalization', () => {
    let logs: Array<{ msg: string; ctx?: any }>;
    let logger: any;

    beforeEach(() => {
      logs = [];
      logger = createFastifyLoggerFromUnirendLogging({
        level: 'trace',
        logger: {
          trace: (msg, ctx) => logs.push({ msg, ctx }),
          debug: (msg, ctx) => logs.push({ msg, ctx }),
          info: (msg, ctx) => logs.push({ msg, ctx }),
          warn: (msg, ctx) => logs.push({ msg, ctx }),
          error: (msg, ctx) => logs.push({ msg, ctx }),
          fatal: (msg, ctx) => logs.push({ msg, ctx }),
        },
      });
    });

    it('should handle string message only', () => {
      logger.info('test message');
      expect(logs).toEqual([{ msg: 'test message', ctx: undefined }]);
    });

    it('should handle string message with record context', () => {
      logger.info('test', { user_id: 123 });
      expect(logs).toEqual([{ msg: 'test', ctx: { user_id: 123 } }]);
    });

    it('should handle string message with Error as second arg (Error is treated as record)', () => {
      const error = new Error('oops');
      logger.error('failed', error);
      expect(logs[0].msg).toBe('failed');
      // Error objects are records, so they're passed as-is (not wrapped)
      expect(logs[0].ctx).toBe(error);
    });

    it('should handle string message with primitive as second arg', () => {
      logger.info('count', 42);
      expect(logs).toEqual([{ msg: 'count', ctx: { value: 42 } }]);
    });

    it('should handle Error as first arg with string message', () => {
      const error = new Error('boom');
      logger.error(error, 'custom message');
      expect(logs[0].msg).toBe('custom message');
      expect(logs[0].ctx.err).toBe(error);
    });

    it('should handle Error as first arg without message (uses error.message)', () => {
      const error = new Error('boom');
      logger.error(error);
      expect(logs[0].msg).toBe('boom');
      expect(logs[0].ctx.err).toBe(error);
    });

    it('should handle Error with non-string second arg', () => {
      const error = new Error('boom');
      logger.error(error, { extra: 'data' });
      expect(logs[0].msg).toBe('boom');
      expect(logs[0].ctx.err).toBe(error);
      expect(logs[0].ctx.secondArg).toEqual({ extra: 'data' });
    });

    it('should handle record as first arg with string message', () => {
      logger.info({ user_id: 456 }, 'user action');
      expect(logs).toEqual([{ msg: 'user action', ctx: { user_id: 456 } }]);
    });

    it('should handle record with msg property (pino-style)', () => {
      logger.info({ msg: 'from msg property', user_id: 789 });
      expect(logs[0].msg).toBe('from msg property');
      expect(logs[0].ctx).toEqual({ msg: 'from msg property', user_id: 789 });
    });

    it('should handle record with non-string second arg', () => {
      logger.info({ user_id: 111 }, { extra: 'context' });
      expect(logs[0].ctx.user_id).toBe(111);
      expect(logs[0].ctx.secondArg).toEqual({ extra: 'context' });
    });

    it('should handle number as first arg', () => {
      logger.info(42);
      expect(logs).toEqual([{ msg: '42', ctx: undefined }]);
    });

    it('should handle bigint as first arg', () => {
      logger.info(BigInt(9007199254740991));
      expect(logs[0].msg).toBe('9007199254740991');
    });

    it('should handle boolean as first arg', () => {
      logger.info(true);
      expect(logs).toEqual([{ msg: 'true', ctx: undefined }]);
    });

    it('should handle symbol as first arg', () => {
      const sym = Symbol('test');
      logger.info(sym);
      expect(logs[0].msg).toBe(sym.toString());
    });

    it('should handle primitive with second arg', () => {
      logger.info(42, { extra: 'data' });
      expect(logs[0].msg).toBe('42');
      expect(logs[0].ctx.secondArg).toEqual({ extra: 'data' });
    });

    it('should handle extra arguments (rest args)', () => {
      logger.info('message', { ctx: 1 }, 'extra1', 'extra2');
      expect(logs[0].ctx.extraArgs).toEqual(['extra1', 'extra2']);
    });

    it('should handle non-primitive, non-record, non-error as first arg', () => {
      const arr = [1, 2, 3];
      logger.info(arr);
      expect(logs[0].ctx.value).toBe(arr);
    });
  });

  describe('Child logger bindings', () => {
    it('should merge child bindings into context', () => {
      const logs: Array<{ msg: string; ctx?: any }> = [];
      const logger = createFastifyLoggerFromUnirendLogging({
        logger: {
          trace: (msg, ctx) => logs.push({ msg, ctx }),
          debug: (msg, ctx) => logs.push({ msg, ctx }),
          info: (msg, ctx) => logs.push({ msg, ctx }),
          warn: (msg, ctx) => logs.push({ msg, ctx }),
          error: (msg, ctx) => logs.push({ msg, ctx }),
          fatal: (msg, ctx) => logs.push({ msg, ctx }),
        },
      });

      const child = logger.child({ request_id: 'abc-123' });
      (child as any).info('child log', { user_id: 456 });

      expect(logs[0].ctx).toEqual({
        request_id: 'abc-123',
        user_id: 456,
      });
    });

    it('should handle nested child loggers', () => {
      const logs: Array<{ msg: string; ctx?: any }> = [];
      const logger = createFastifyLoggerFromUnirendLogging({
        logger: {
          trace: (msg, ctx) => logs.push({ msg, ctx }),
          debug: (msg, ctx) => logs.push({ msg, ctx }),
          info: (msg, ctx) => logs.push({ msg, ctx }),
          warn: (msg, ctx) => logs.push({ msg, ctx }),
          error: (msg, ctx) => logs.push({ msg, ctx }),
          fatal: (msg, ctx) => logs.push({ msg, ctx }),
        },
      });

      const child1 = logger.child({ service: 'api' });
      const child2 = child1.child({ request_id: 'xyz' });

      child2.info('nested');

      expect(logs[0].ctx).toEqual({
        service: 'api',
        request_id: 'xyz',
      });
    });

    it('should share level state between parent and child', () => {
      const logs: string[] = [];
      const logger = createFastifyLoggerFromUnirendLogging({
        level: 'warn',
        logger: {
          trace: (msg) => logs.push(`trace: ${msg}`),
          debug: (msg) => logs.push(`debug: ${msg}`),
          info: (msg) => logs.push(`info: ${msg}`),
          warn: (msg) => logs.push(`warn: ${msg}`),
          error: (msg) => logs.push(`error: ${msg}`),
          fatal: (msg) => logs.push(`fatal: ${msg}`),
        },
      });

      const child = logger.child({ service: 'api' });

      child.info('filtered');
      expect(logs).toEqual([]);

      // Changing parent level affects child
      logger.level = 'info';
      child.info('visible');

      expect(logs).toEqual(['info: visible']);
    });

    it('should handle non-record child bindings gracefully', () => {
      const logs: Array<{ msg: string; ctx?: any }> = [];
      const logger = createFastifyLoggerFromUnirendLogging({
        logger: {
          trace: (msg, ctx) => logs.push({ msg, ctx }),
          debug: (msg, ctx) => logs.push({ msg, ctx }),
          info: (msg, ctx) => logs.push({ msg, ctx }),
          warn: (msg, ctx) => logs.push({ msg, ctx }),
          error: (msg, ctx) => logs.push({ msg, ctx }),
          fatal: (msg, ctx) => logs.push({ msg, ctx }),
        },
      });

      // Pass null/undefined as bindings
      const child = logger.child(null as any);
      child.info('test');

      expect(logs[0].ctx).toBeUndefined();
    });
  });

  describe('Error handling and fallbacks', () => {
    it('should fallback to logger.error when primary write throws', () => {
      const errorLogs: Array<{ msg: string; ctx?: any }> = [];
      let infoCallCount = 0;

      const logger = createFastifyLoggerFromUnirendLogging({
        logger: {
          trace: () => {},
          debug: () => {},
          info: () => {
            infoCallCount++;
            throw new Error('Info write failed');
          },
          warn: () => {},
          error: (msg, ctx) => errorLogs.push({ msg, ctx }),
          fatal: () => {},
        },
      });

      logger.info('test message');

      expect(infoCallCount).toBe(1);
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0].msg).toMatch(/logger write failed/i);
      expect(errorLogs[0].ctx.failedMessage).toBe('test message');
    });

    it('should use globalThis.reportError when both primary and error write fail', () => {
      const originalReportError = (globalThis as any).reportError;
      const reportedErrors: unknown[] = [];

      (globalThis as any).reportError = (error: unknown) => {
        reportedErrors.push(error);
      };

      try {
        const logger = createFastifyLoggerFromUnirendLogging({
          logger: {
            trace: () => {},
            debug: () => {},
            info: () => {
              throw new Error('Info write failed');
            },
            warn: () => {},
            error: () => {
              throw new Error('Error write also failed');
            },
            fatal: () => {},
          },
        });

        logger.info('test');

        expect(reportedErrors.length).toBe(1);
      } finally {
        if (originalReportError) {
          (globalThis as any).reportError = originalReportError;
        } else {
          delete (globalThis as any).reportError;
        }
      }
    });

    it('should fallback to console.error when globalThis.reportError throws', () => {
      const originalReportError = (globalThis as any).reportError;
      const originalConsoleError = console.error;
      const consoleErrors: unknown[] = [];

      (globalThis as any).reportError = () => {
        throw new Error('reportError failed');
      };

      console.error = (...args: unknown[]) => {
        consoleErrors.push(args);
      };

      try {
        const logger = createFastifyLoggerFromUnirendLogging({
          logger: {
            trace: () => {},
            debug: () => {},
            info: () => {
              throw new Error('Info write failed');
            },
            warn: () => {},
            error: () => {
              throw new Error('Error write also failed');
            },
            fatal: () => {},
          },
        });

        logger.info('test');

        expect(consoleErrors.length).toBe(1);
        expect((consoleErrors[0] as unknown[])[0]).toMatch(
          /logger call failed/i,
        );
      } finally {
        if (originalReportError) {
          (globalThis as any).reportError = originalReportError;
        } else {
          delete (globalThis as any).reportError;
        }
        console.error = originalConsoleError;
      }
    });

    it('should fallback to console.error when globalThis.reportError does not exist', () => {
      const originalReportError = (globalThis as any).reportError;
      const originalConsoleError = console.error;
      const consoleErrors: unknown[] = [];

      delete (globalThis as any).reportError;

      console.error = (...args: unknown[]) => {
        consoleErrors.push(args);
      };

      try {
        const logger = createFastifyLoggerFromUnirendLogging({
          logger: {
            trace: () => {},
            debug: () => {},
            info: () => {
              throw new Error('Info write failed');
            },
            warn: () => {},
            error: () => {
              throw new Error('Error write also failed');
            },
            fatal: () => {},
          },
        });

        logger.info('test');

        expect(consoleErrors.length).toBe(1);
        expect((consoleErrors[0] as unknown[])[0]).toMatch(
          /logger call failed/i,
        );
      } finally {
        if (originalReportError) {
          (globalThis as any).reportError = originalReportError;
        }

        console.error = originalConsoleError;
      }
    });
  });
});
