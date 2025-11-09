import { describe, it, expect } from 'bun:test';
import {
  isCookieNameAllowed,
  filterIncomingCookieHeader,
  filterSetCookieHeaderValues,
} from './cookie-utils';

describe('cookie-utils: isCookieNameAllowed', () => {
  it('allows all when both allow and block are empty', () => {
    expect(isCookieNameAllowed('sid')).toBe(true);
    expect(isCookieNameAllowed(' theme ')).toBe(true);
  });

  it('allows only names in allow list when provided', () => {
    const allow = new Set(['sid', 'theme']);
    expect(isCookieNameAllowed('sid', allow)).toBe(true);
    expect(isCookieNameAllowed('theme', allow)).toBe(true);
    expect(isCookieNameAllowed('other', allow)).toBe(false);
  });

  it('block list denies even if present in allow list', () => {
    const allow = new Set(['sid', 'theme']);
    const block = new Set(['theme']);
    expect(isCookieNameAllowed('sid', allow, block)).toBe(true);
    expect(isCookieNameAllowed('theme', allow, block)).toBe(false);
    expect(isCookieNameAllowed('other', allow, block)).toBe(false);
  });

  it('supports block-all with boolean true', () => {
    expect(isCookieNameAllowed('sid', undefined, true)).toBe(false);
    expect(isCookieNameAllowed('theme', new Set(['theme']), true)).toBe(false);
  });

  it('returns false for empty/invalid names', () => {
    expect(isCookieNameAllowed(' ')).toBe(false);
    expect(isCookieNameAllowed('')).toBe(false);
  });
});

describe('cookie-utils: filterIncomingCookieHeader', () => {
  it('returns undefined for null/undefined/empty headers', () => {
    expect(filterIncomingCookieHeader(undefined)).toBeUndefined();
    expect(
      filterIncomingCookieHeader(null as unknown as string),
    ).toBeUndefined();
    expect(filterIncomingCookieHeader('')).toBeUndefined();
    expect(filterIncomingCookieHeader('   ')).toBeUndefined();
  });

  it('passes through all cookies when no policy provided (normalized spacing)', () => {
    const result = filterIncomingCookieHeader('a=1; b=2; c=3');
    expect(result).toBe('a=1; b=2; c=3');
  });

  it('filters by allow list only', () => {
    const allow = new Set(['b']);
    const result = filterIncomingCookieHeader('a=1; b=2; c=3', allow);
    expect(result).toBe('b=2');
  });

  it('filters by block list only', () => {
    const block = new Set(['c']);
    const result = filterIncomingCookieHeader(
      'a=1; b=2; c=3',
      undefined,
      block,
    );
    expect(result).toBe('a=1; b=2');
  });

  it('block takes precedence over allow', () => {
    const allow = new Set(['b', 'c']);
    const block = new Set(['c']);
    const result = filterIncomingCookieHeader('a=1; b=2; c=3', allow, block);
    expect(result).toBe('b=2');
  });

  it('block-all removes all cookies from incoming header', () => {
    const result = filterIncomingCookieHeader('a=1; b=2; x=', undefined, true);
    expect(result).toBeUndefined();
  });

  it('ignores invalid segments and empty names, but preserves empty values', () => {
    const input = 'a=1; bad; x=; =y; b=2';
    const result = filterIncomingCookieHeader(input);
    expect(result).toBe('a=1; x=; b=2');
  });

  it('returns undefined when no cookies remain after filtering', () => {
    const allow = new Set(['z']);
    const result = filterIncomingCookieHeader('a=1; b=2', allow);
    expect(result).toBeUndefined();
  });
});

describe('cookie-utils: filterSetCookieHeaderValues', () => {
  const cA = 'a=1; Path=/; HttpOnly';
  const cB = 'b=2; Secure';
  const cC = 'c=3';

  it('passes through all when no policy provided', () => {
    const result = filterSetCookieHeaderValues([cA, cB, cC]);
    expect(result).toEqual([cA, cB, cC]);
  });

  it('accepts a single header string input', () => {
    const result = filterSetCookieHeaderValues(cA);
    expect(result).toEqual([cA]);
  });

  it('filters by allow list only', () => {
    const allow = new Set(['b']);
    const result = filterSetCookieHeaderValues([cA, cB, cC], allow);
    expect(result).toEqual([cB]);
  });

  it('filters by block list only', () => {
    const block = new Set(['a']);
    const result = filterSetCookieHeaderValues([cA, cB, cC], undefined, block);
    expect(result).toEqual([cB, cC]);
  });

  it('block takes precedence over allow', () => {
    const allow = new Set(['c']);
    const block = new Set(['c']);
    const result = filterSetCookieHeaderValues([cA, cB, cC], allow, block);
    expect(result).toEqual([]);
  });

  it('block-all drops all Set-Cookie values', () => {
    const result = filterSetCookieHeaderValues([cA, cB, cC], undefined, true);
    expect(result).toEqual([]);
  });

  it('drops invalid Set-Cookie values (no name=value)', () => {
    const invalid = 'invalidcookie';
    const result = filterSetCookieHeaderValues([invalid, cA]);
    expect(result).toEqual([cA]);
  });
});
