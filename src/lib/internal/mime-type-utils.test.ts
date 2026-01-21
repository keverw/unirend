import { describe, it, expect } from 'bun:test';
import { matchesMimeTypePattern } from './mime-type-utils';

describe('matchesMimeTypePattern', () => {
  describe('Exact matching', () => {
    it('should match exact MIME types', () => {
      expect(matchesMimeTypePattern('image/jpeg', 'image/jpeg')).toBe(true);
      expect(matchesMimeTypePattern('application/pdf', 'application/pdf')).toBe(
        true,
      );
      expect(matchesMimeTypePattern('text/plain', 'text/plain')).toBe(true);
    });

    it('should not match different MIME types', () => {
      expect(matchesMimeTypePattern('image/jpeg', 'image/png')).toBe(false);
      expect(matchesMimeTypePattern('text/plain', 'text/html')).toBe(false);
    });
  });

  describe('Wildcard patterns', () => {
    it('should match image/* wildcard', () => {
      expect(matchesMimeTypePattern('image/jpeg', 'image/*')).toBe(true);
      expect(matchesMimeTypePattern('image/png', 'image/*')).toBe(true);
      expect(matchesMimeTypePattern('image/gif', 'image/*')).toBe(true);
      expect(matchesMimeTypePattern('image/webp', 'image/*')).toBe(true);
      expect(matchesMimeTypePattern('image/svg+xml', 'image/*')).toBe(true);
    });

    it('should not match wrong category with image/*', () => {
      expect(matchesMimeTypePattern('video/mp4', 'image/*')).toBe(false);
      expect(matchesMimeTypePattern('text/plain', 'image/*')).toBe(false);
      expect(matchesMimeTypePattern('application/pdf', 'image/*')).toBe(false);
    });

    it('should match text/* wildcard', () => {
      expect(matchesMimeTypePattern('text/plain', 'text/*')).toBe(true);
      expect(matchesMimeTypePattern('text/html', 'text/*')).toBe(true);
      expect(matchesMimeTypePattern('text/css', 'text/*')).toBe(true);
      expect(matchesMimeTypePattern('text/javascript', 'text/*')).toBe(true);
    });

    it('should match video/* wildcard', () => {
      expect(matchesMimeTypePattern('video/mp4', 'video/*')).toBe(true);
      expect(matchesMimeTypePattern('video/quicktime', 'video/*')).toBe(true);
      expect(matchesMimeTypePattern('video/x-msvideo', 'video/*')).toBe(true);
    });

    it('should match application/* wildcard', () => {
      expect(matchesMimeTypePattern('application/pdf', 'application/*')).toBe(
        true,
      );
      expect(matchesMimeTypePattern('application/json', 'application/*')).toBe(
        true,
      );
      expect(
        matchesMimeTypePattern('application/javascript', 'application/*'),
      ).toBe(true);
    });

    it('should match */* wildcard (all types)', () => {
      expect(matchesMimeTypePattern('image/jpeg', '*/*')).toBe(true);
      expect(matchesMimeTypePattern('video/mp4', '*/*')).toBe(true);
      expect(matchesMimeTypePattern('text/plain', '*/*')).toBe(true);
      expect(matchesMimeTypePattern('application/pdf', '*/*')).toBe(true);
      expect(matchesMimeTypePattern('audio/mpeg', '*/*')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle MIME types with + character', () => {
      expect(matchesMimeTypePattern('image/svg+xml', 'image/*')).toBe(true);
      expect(
        matchesMimeTypePattern('application/ld+json', 'application/*'),
      ).toBe(true);
    });

    it('should handle MIME types with parameters', () => {
      expect(matchesMimeTypePattern('text/html; charset=utf-8', 'text/*')).toBe(
        true,
      );
    });

    it('should not match partial patterns', () => {
      expect(matchesMimeTypePattern('image', 'image/*')).toBe(false);
      expect(matchesMimeTypePattern('jpeg', 'image/*')).toBe(false);
    });
  });
});
