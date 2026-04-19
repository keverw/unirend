import { describe, it, expect } from 'bun:test';
import {
  assertSupportedRuntime,
  deepFreeze,
  getRuntimeSupportInfo,
  isSupportedRuntime,
  MINIMUM_SUPPORTED_NODE_MAJOR,
} from './utils';

describe('deepFreeze', () => {
  it('freezes a flat object', () => {
    const obj = { a: 1, b: 'hello' };
    const result = deepFreeze(obj);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toBe(obj);
  });

  it('freezes nested objects recursively', () => {
    const obj = { a: { b: { c: 42 } } };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.a)).toBe(true);
    expect(Object.isFrozen(obj.a.b)).toBe(true);
  });

  it('returns null without throwing', () => {
    expect(() => deepFreeze(null)).not.toThrow();
    expect(deepFreeze(null)).toBe(null);
  });

  it('returns primitives unchanged', () => {
    expect(deepFreeze(42 as any)).toBe(42);
    expect(deepFreeze('hello' as any)).toBe('hello');
    expect(deepFreeze(undefined as any)).toBe(undefined);
  });

  it('does not re-freeze already-frozen nested objects', () => {
    const inner = Object.freeze({ x: 1 });
    const outer = { inner };
    deepFreeze(outer);
    expect(Object.isFrozen(outer)).toBe(true);
    expect(Object.isFrozen(inner)).toBe(true);
  });

  it('handles arrays as values', () => {
    const obj = { arr: [1, 2, 3] };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.arr)).toBe(true);
  });
});

describe('runtime support utilities', () => {
  it('treats Bun as supported even when Bun reports an older Node version', () => {
    const result = getRuntimeSupportInfo(MINIMUM_SUPPORTED_NODE_MAJOR, {
      Bun: {},
      process: {
        versions: {
          bun: '1.3.2',
          node: '24.3.0',
        },
      },
    });

    expect(result.runtime).toBe('bun');
    expect(result.isSupported).toBe(true);
    expect(result.nodeVersion).toBe('24.3.0');
    expect(result.bunVersion).toBe('1.3.2');
  });

  it('accepts Node when the major version meets the minimum', () => {
    expect(
      isSupportedRuntime(MINIMUM_SUPPORTED_NODE_MAJOR, {
        process: {
          versions: {
            node: '25.0.0',
          },
        },
      }),
    ).toBe(true);
  });

  it('rejects Node when the major version is below the minimum', () => {
    const result = getRuntimeSupportInfo(MINIMUM_SUPPORTED_NODE_MAJOR, {
      process: {
        versions: {
          node: '24.9.0',
        },
      },
    });

    expect(result.runtime).toBe('node');
    expect(result.isSupported).toBe(false);
  });

  it('rejects unknown runtimes', () => {
    const result = getRuntimeSupportInfo(MINIMUM_SUPPORTED_NODE_MAJOR, {});

    expect(result.runtime).toBe('unknown');
    expect(result.isSupported).toBe(false);
  });

  it('throws a descriptive error for unsupported runtimes', () => {
    expect(() =>
      assertSupportedRuntime(MINIMUM_SUPPORTED_NODE_MAJOR, {
        process: {
          versions: {
            node: '24.0.0',
          },
        },
      }),
    ).toThrow('Unirend requires Node >= 25 or Bun.');
  });
});
