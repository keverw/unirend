import { describe, it, expect } from 'bun:test';
import { CDN_INJECTION_PLACEHOLDER, normalizeCDNBaseURL } from './cdn';

describe('normalizeCDNBaseURL', () => {
  it('strips a trailing slash', () => {
    expect(normalizeCDNBaseURL('https://cdn.example.com/')).toBe(
      'https://cdn.example.com',
    );
  });

  it('leaves a URL without a trailing slash unchanged', () => {
    expect(normalizeCDNBaseURL('https://cdn.example.com')).toBe(
      'https://cdn.example.com',
    );
  });

  it('returns empty string for undefined', () => {
    expect(normalizeCDNBaseURL(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeCDNBaseURL('')).toBe('');
  });

  it('strips only a single trailing slash (not double)', () => {
    expect(normalizeCDNBaseURL('https://cdn.example.com//')).toBe(
      'https://cdn.example.com/',
    );
  });
});

describe('CDN_INJECTION_PLACEHOLDER', () => {
  it('is the literal a template writes by hand', () => {
    // Pinned as a string rather than referenced, because a template in
    // someone's repository spells it out and cannot follow a rename.
    expect(CDN_INJECTION_PLACEHOLDER).toBe('__CDN__INJECTION__POINT__');
  });
});
