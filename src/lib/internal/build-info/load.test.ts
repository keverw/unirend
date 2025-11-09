import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadBuildInfo, DEFAULT_BUILD_INFO } from './load';
import type { BuildInfo } from './types';

describe('build-info load', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'build-info-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadBuildInfo', () => {
    it('should return default build info in development mode', async () => {
      // Test development mode (isProduction = false)
      const result = await loadBuildInfo(false, async () => {
        throw new Error('This should not be called in development mode');
      });

      // Should return default build info with correct status
      expect(result).toEqual({
        status: 'DEFAULT_NOT_PRODUCTION',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      });
    });

    it('should load build info in production mode', async () => {
      // Mock successful import
      const mockBuildInfo: BuildInfo = {
        version: '1.2.3',
        git_hash: 'abc123',
        git_branch: 'test-branch',
        build_timestamp: '2025-05-18T21:00:00.000Z',
      };

      const result = await loadBuildInfo(
        true, // isProduction = true
        async () => ({ BUILD_INFO: mockBuildInfo }),
      );

      // Should return the loaded build info with correct status
      expect(result).toEqual({
        status: 'LOADED_SUCCESSFULLY',
        isDefault: false,
        info: mockBuildInfo,
      });
    });

    it('should load build info with custom properties', async () => {
      // Mock build info with custom properties
      const mockBuildInfo: BuildInfo = {
        version: '2.0.0',
        git_hash: 'def456',
        git_branch: 'feature-branch',
        build_timestamp: '2025-05-19T10:30:00.000Z',
        custom_property: 'custom_value',
        build_number: 42,
        environment: 'staging',
      };

      const result = await loadBuildInfo(true, async () => ({
        BUILD_INFO: mockBuildInfo,
      }));

      expect(result).toEqual({
        status: 'LOADED_SUCCESSFULLY',
        isDefault: false,
        info: mockBuildInfo,
      });
    });

    it('should handle missing BUILD_INFO in module', async () => {
      // Mock import that returns a module without BUILD_INFO
      const result = await loadBuildInfo(
        true, // isProduction = true
        async () => ({ someOtherProperty: 'value' }),
      );

      // Should return default build info with correct status
      expect(result).toEqual({
        status: 'MODULE_MISSING_DATA',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      });
    });

    it('should handle module with BUILD_INFO but wrong type', async () => {
      // Mock import that returns BUILD_INFO as wrong type
      const result = await loadBuildInfo(true, async () => ({
        BUILD_INFO: 'not an object',
      }));

      // Should return default build info with MODULE_INVALID_DATA status
      // (the function validates the structure of BUILD_INFO)
      expect(result).toEqual({
        status: 'MODULE_INVALID_DATA',
        isDefault: true,
        info: {
          version: '1.0.0',
          git_hash: 'dev',
          git_branch: 'dev',
          build_timestamp: expect.any(String),
        },
      });
    });

    it('should handle import errors', async () => {
      // Mock import that throws an error
      const result = await loadBuildInfo(
        true, // isProduction = true
        async () => {
          throw new Error('Failed to import build info');
        },
      );

      // Should return default build info with correct status
      expect(result).toEqual({
        status: 'IMPORT_ERROR',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      });
    });

    it('should handle null or undefined module', async () => {
      // Mock import that returns null
      const resultNull = await loadBuildInfo(
        true, // isProduction = true
        async () => null as any,
      );

      // Should return default build info with correct status
      expect(resultNull).toEqual({
        status: 'MODULE_MISSING_DATA',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      });

      // Mock import that returns undefined
      const resultUndefined = await loadBuildInfo(
        true, // isProduction = true
        async () => undefined as any,
      );

      // Should return default build info with correct status
      expect(resultUndefined).toEqual({
        status: 'MODULE_MISSING_DATA',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      });
    });

    it('should handle empty object module', async () => {
      // Mock import that returns empty object
      const result = await loadBuildInfo(true, async () => ({}));

      expect(result).toEqual({
        status: 'MODULE_MISSING_DATA',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      });
    });

    it('should load from actual mock file', async () => {
      // Create a mock build info file in temp directory
      const mockBuildInfo = {
        version: '1.2.3',
        git_hash: 'abc123',
        git_branch: 'test-branch',
        build_timestamp: '2025-05-18T21:00:00.000Z',
      };

      const mockFileContent = `export const BUILD_INFO = ${JSON.stringify(mockBuildInfo, null, 2)};`;
      const mockFilePath = path.join(tempDir, 'mock-build-info.js');
      await fs.writeFile(mockFilePath, mockFileContent, 'utf8');

      // Test with the actual mock file
      const result = await loadBuildInfo(
        true, // isProduction = true
        () => import(mockFilePath),
      );

      // Should match the mock file contents with correct status
      expect(result).toEqual({
        status: 'LOADED_SUCCESSFULLY',
        isDefault: false,
        info: mockBuildInfo,
      });
    });

    it('should handle module with BUILD_INFO as null', async () => {
      const result = await loadBuildInfo(true, async () => ({
        BUILD_INFO: null,
      }));

      // Should return default build info with MODULE_INVALID_DATA status
      // (null is not a valid BuildInfo object)
      expect(result).toEqual({
        status: 'MODULE_INVALID_DATA',
        isDefault: true,
        info: {
          version: '1.0.0',
          git_hash: 'dev',
          git_branch: 'dev',
          build_timestamp: expect.any(String),
        },
      });
    });

    it('should handle module with BUILD_INFO missing required fields', async () => {
      const result = await loadBuildInfo(true, async () => ({
        BUILD_INFO: {
          version: '1.0.0',
          // Missing git_hash, git_branch, build_timestamp
        },
      }));

      // Should return default build info with MODULE_INVALID_DATA status
      // (incomplete BuildInfo object)
      expect(result).toEqual({
        status: 'MODULE_INVALID_DATA',
        isDefault: true,
        info: {
          version: '1.0.0',
          git_hash: 'dev',
          git_branch: 'dev',
          build_timestamp: expect.any(String),
        },
      });
    });

    it('should handle async import promise rejection', async () => {
      const result = await loadBuildInfo(true, async () => {
        return Promise.reject(new Error('Network error'));
      });

      expect(result).toEqual({
        status: 'IMPORT_ERROR',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      });
    });

    it('should handle synchronous import function that throws', async () => {
      const result = await loadBuildInfo(true, () => {
        throw new Error('Synchronous error');
      });

      expect(result).toEqual({
        status: 'IMPORT_ERROR',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      });
    });
  });

  describe('DEFAULT_BUILD_INFO', () => {
    it('should have correct structure', () => {
      expect(DEFAULT_BUILD_INFO).toHaveProperty('version');
      expect(DEFAULT_BUILD_INFO).toHaveProperty('git_hash');
      expect(DEFAULT_BUILD_INFO).toHaveProperty('git_branch');
      expect(DEFAULT_BUILD_INFO).toHaveProperty('build_timestamp');

      expect(typeof DEFAULT_BUILD_INFO.version).toBe('string');
      expect(typeof DEFAULT_BUILD_INFO.git_hash).toBe('string');
      expect(typeof DEFAULT_BUILD_INFO.git_branch).toBe('string');
      expect(typeof DEFAULT_BUILD_INFO.build_timestamp).toBe('string');
    });

    it('should have development values', () => {
      expect(DEFAULT_BUILD_INFO.version).toBe('1.0.0');
      expect(DEFAULT_BUILD_INFO.git_hash).toBe('dev');
      expect(DEFAULT_BUILD_INFO.git_branch).toBe('dev');

      // build_timestamp should be a valid ISO string
      expect(() => new Date(DEFAULT_BUILD_INFO.build_timestamp)).not.toThrow();
    });

    it('should have a valid ISO timestamp', () => {
      expect(DEFAULT_BUILD_INFO.build_timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
      );
    });
  });

  describe('isDefault flag', () => {
    it('should be true when using default build info', async () => {
      // Test development mode
      const devResult = await loadBuildInfo(false, async () => {
        throw new Error('Should not be called');
      });

      expect(devResult.isDefault).toBe(true);

      // Test production with import error
      const errorResult = await loadBuildInfo(true, async () => {
        throw new Error('Import failed');
      });

      expect(errorResult.isDefault).toBe(true);

      // Test production with invalid data
      const invalidResult = await loadBuildInfo(true, async () => ({
        BUILD_INFO: 'invalid',
      }));

      expect(invalidResult.isDefault).toBe(true);
    });

    it('should be false when successfully loading build info', async () => {
      const mockBuildInfo = {
        version: '1.0.0',
        git_hash: 'abc123',
        git_branch: 'main',
        build_timestamp: '2025-05-18T21:00:00.000Z',
      };

      const result = await loadBuildInfo(true, async () => ({
        BUILD_INFO: mockBuildInfo,
      }));

      expect(result.isDefault).toBe(false);
      expect(result.status).toBe('LOADED_SUCCESSFULLY');
    });

    it('allows easy checking without status codes', async () => {
      // Example of how developers can use the isDefault flag
      const result = await loadBuildInfo(false, async () => ({}));

      if (result.isDefault) {
        // Using fallback build info - might want to show different UI
        expect(result.info.version).toBe('1.0.0');
        expect(result.info.git_hash).toBe('dev');
      } else {
        // Using actual build info from production build
        // Can display real version, git hash, etc.
      }

      expect(result.isDefault).toBe(true); // This test runs in dev mode
    });
  });
});
