import { describe, test, expect } from 'bun:test';
import {
  validateVersion,
  validateSingleVersionWhenDisabled,
} from './version-helpers';

describe('version-helpers (simplified)', () => {
  describe('validateVersion', () => {
    test('should not throw for valid versions (>= 1)', () => {
      expect(() => validateVersion(1, 'Test')).not.toThrow();
      expect(() => validateVersion(2, 'Test')).not.toThrow();
      expect(() => validateVersion(100, 'Test')).not.toThrow();
    });

    test('should throw for version 0', () => {
      expect(() => validateVersion(0, 'Test')).toThrow(
        'Test version must be >= 1, got 0',
      );
    });

    test('should throw for negative versions', () => {
      expect(() => validateVersion(-1, 'API')).toThrow(
        'API version must be >= 1, got -1',
      );
      expect(() => validateVersion(-5, 'Page')).toThrow(
        'Page version must be >= 1, got -5',
      );
    });

    test('should include context in error message', () => {
      expect(() => validateVersion(0, 'Custom Context')).toThrow(
        'Custom Context version must be >= 1',
      );
    });
  });

  describe('validateSingleVersionWhenDisabled', () => {
    test('should not throw when versioning is enabled', () => {
      const versionMap = new Map([
        [1, 'handler1'],
        [2, 'handler2'],
      ]);
      expect(() =>
        validateSingleVersionWhenDisabled(true, versionMap, 'Test'),
      ).not.toThrow();
    });

    test('should not throw when only one version exists', () => {
      const versionMap = new Map([[1, 'handler1']]);
      expect(() =>
        validateSingleVersionWhenDisabled(false, versionMap, 'Test'),
      ).not.toThrow();
    });

    test('should throw when versioning disabled and multiple versions exist', () => {
      const versionMap = new Map([
        [1, 'handler1'],
        [2, 'handler2'],
      ]);
      expect(() =>
        validateSingleVersionWhenDisabled(
          false,
          versionMap,
          'Page type "HomePage"',
        ),
      ).toThrow(
        'Page type "HomePage" has multiple versions (1, 2) but versioning is disabled',
      );
    });

    test('should include correct suffix for endpoints', () => {
      const versionMap = new Map([
        [1, 'handler1'],
        [2, 'handler2'],
      ]);
      expect(() =>
        validateSingleVersionWhenDisabled(
          false,
          versionMap,
          'Endpoint "users" (GET)',
        ),
      ).toThrow('register only one version per endpoint');
    });

    test('should include correct suffix for page types', () => {
      const versionMap = new Map([
        [1, 'handler1'],
        [2, 'handler2'],
      ]);
      expect(() =>
        validateSingleVersionWhenDisabled(
          false,
          versionMap,
          'Page type "HomePage"',
        ),
      ).toThrow('register only one version per page type');
    });
  });
});
