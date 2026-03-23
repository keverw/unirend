import { describe, it, expect } from 'bun:test';
import { deepFreeze } from './utils';

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
