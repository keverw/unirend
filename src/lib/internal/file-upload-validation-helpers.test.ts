import { describe, it, expect } from 'bun:test';
import { matchesRoutePattern } from './file-upload-validation-helpers';

describe('matchesRoutePattern', () => {
  describe('Exact matching', () => {
    it('should match exact routes', () => {
      expect(matchesRoutePattern('/api/upload', '/api/upload')).toBe(true);
      expect(
        matchesRoutePattern('/api/upload/avatar', '/api/upload/avatar'),
      ).toBe(true);
    });

    it('should not match different routes', () => {
      expect(matchesRoutePattern('/api/upload', '/api/download')).toBe(false);
      expect(matchesRoutePattern('/api/upload/avatar', '/api/upload/doc')).toBe(
        false,
      );
    });

    it('should not match partial routes', () => {
      expect(matchesRoutePattern('/api/upload', '/api/upload/avatar')).toBe(
        false,
      );
      expect(matchesRoutePattern('/api/upload/avatar', '/api/upload')).toBe(
        false,
      );
    });
  });

  describe('Wildcard patterns', () => {
    it('should match single wildcard segment', () => {
      expect(
        matchesRoutePattern(
          '/api/workspace/123/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/workspace/abc/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/workspace/test-id/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
    });

    it('should not match wildcard with multiple segments', () => {
      // Wildcard only matches a single segment
      expect(
        matchesRoutePattern(
          '/api/workspace/123/456/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(false);
    });

    it('should match multiple wildcards', () => {
      expect(
        matchesRoutePattern(
          '/api/workspace/123/file/456',
          '/api/workspace/*/file/*',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/workspace/abc/file/xyz',
          '/api/workspace/*/file/*',
        ),
      ).toBe(true);
    });

    it('should not match incorrect wildcard patterns', () => {
      expect(
        matchesRoutePattern(
          '/api/workspace/123/upload',
          '/api/workspace/*/download',
        ),
      ).toBe(false);
      expect(
        matchesRoutePattern(
          '/api/different/123/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(false);
    });
  });

  describe('Path normalization', () => {
    it('should handle trailing slashes - matching with or without', () => {
      // Trailing slashes are normalized away (except for root)
      expect(matchesRoutePattern('/api/upload', '/api/upload/')).toBe(true);
      expect(matchesRoutePattern('/api/upload/', '/api/upload')).toBe(true);
      expect(matchesRoutePattern('/api/upload/', '/api/upload/')).toBe(true);
      expect(matchesRoutePattern('/api/upload', '/api/upload')).toBe(true);
    });

    it('should preserve root path with trailing slash', () => {
      expect(matchesRoutePattern('/', '/')).toBe(true);
      expect(matchesRoutePattern('/api', '/')).toBe(false);
    });

    it('should collapse multiple consecutive slashes', () => {
      // Multiple slashes are normalized to single slash
      expect(matchesRoutePattern('/api//upload', '/api/upload')).toBe(true);
      expect(matchesRoutePattern('/api/upload', '/api//upload')).toBe(true);
      expect(matchesRoutePattern('/api///upload', '/api/upload')).toBe(true);
      expect(matchesRoutePattern('/api/upload///', '/api/upload')).toBe(true);
    });

    it('should escape regex special characters in patterns', () => {
      expect(matchesRoutePattern('/api/upload.json', '/api/upload.json')).toBe(
        true,
      );
      expect(matchesRoutePattern('/api/upload+test', '/api/upload+test')).toBe(
        true,
      );
      expect(matchesRoutePattern('/api/upload(1)', '/api/upload(1)')).toBe(
        true,
      );
    });
  });

  describe('Query string handling (automatic normalization)', () => {
    it('should automatically strip query strings from URLs', () => {
      // Query strings are automatically removed during normalization
      expect(matchesRoutePattern('/api/upload?test=1', '/api/upload')).toBe(
        true,
      );
      expect(
        matchesRoutePattern(
          '/api/upload/avatar?user=123',
          '/api/upload/avatar',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/upload/avatar?user=123&token=abc',
          '/api/upload/avatar',
        ),
      ).toBe(true);
    });

    it('should handle query strings with wildcards', () => {
      expect(
        matchesRoutePattern(
          '/api/workspace/123/upload?version=2',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/workspace/abc/upload?foo=bar&baz=qux',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
    });

    it('should handle query strings with trailing slashes', () => {
      expect(matchesRoutePattern('/api/upload/?test=1', '/api/upload')).toBe(
        true,
      );
      expect(matchesRoutePattern('/api/upload?test=1', '/api/upload/')).toBe(
        true,
      );
    });
  });

  describe('Combined normalization (real-world scenarios)', () => {
    it('should handle messy URLs with all normalization features', () => {
      // URL with trailing slash, query string, and extra slashes
      expect(
        matchesRoutePattern('/api//upload/?test=1&foo=bar', '/api/upload'),
      ).toBe(true);

      // Pattern with trailing slash, URL with query string
      expect(matchesRoutePattern('/api/upload?test=1', '/api/upload/')).toBe(
        true,
      );

      // Wildcard with multiple slashes and query strings
      expect(
        matchesRoutePattern(
          '/api//workspace//123//upload/?version=2',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
    });
  });
});
