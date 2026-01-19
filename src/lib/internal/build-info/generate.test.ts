import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GenerateBuildInfo } from './generate';
import type { GenerateBuildInfoOptions } from './types';

describe('GenerateBuildInfo', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'generate-build-info-test-'),
    );
    originalCwd = process.cwd();
  });

  afterEach(async () => {
    // Restore original working directory
    process.chdir(originalCwd);

    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const generator = new GenerateBuildInfo();

      // Access private properties for testing (TypeScript will complain but it works at runtime)
      // @ts-expect-error - Accessing private property for testing
      expect(generator.workingDir).toBe(process.cwd());
      // @ts-expect-error - Accessing private property for testing
      expect(generator.version).toBeUndefined();
      // @ts-expect-error - Accessing private property for testing
      expect(generator.customProperties).toEqual({});
      expect(generator).toBeInstanceOf(GenerateBuildInfo);
    });

    it('should accept custom working directory', () => {
      const generator = new GenerateBuildInfo({ workingDir: tempDir });
      // @ts-expect-error - Accessing private property for testing
      expect(generator.workingDir).toBe(tempDir);
      expect(generator).toBeInstanceOf(GenerateBuildInfo);
    });

    it('should accept custom version', () => {
      const generator = new GenerateBuildInfo({ version: '2.0.0' });
      // @ts-expect-error - Accessing private property for testing
      expect(generator.version).toBe('2.0.0');
      expect(generator).toBeInstanceOf(GenerateBuildInfo);
    });

    it('should accept custom properties', () => {
      const customProps = {
        environment: 'test',
        buildNumber: 42,
        features: ['feature1', 'feature2'],
      };
      const generator = new GenerateBuildInfo({
        customProperties: customProps,
      });
      // @ts-expect-error - Accessing private property for testing
      expect(generator.customProperties).toEqual(customProps);
      expect(generator).toBeInstanceOf(GenerateBuildInfo);
    });

    it('should accept all options together', () => {
      const options: GenerateBuildInfoOptions = {
        workingDir: tempDir,
        version: '3.0.0',
        customProperties: { env: 'staging' },
      };

      const generator = new GenerateBuildInfo(options);
      // @ts-expect-error - Accessing private property for testing
      expect(generator.workingDir).toBe(tempDir);
      // @ts-expect-error - Accessing private property for testing
      expect(generator.version).toBe('3.0.0');
      // @ts-expect-error - Accessing private property for testing
      expect(generator.customProperties).toEqual({ env: 'staging' });
      expect(generator).toBeInstanceOf(GenerateBuildInfo);
    });
  });

  describe('generateInfo', () => {
    it('should generate build info with fallback values when git is not available', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.0.0',
      });
      const result = await generator.generateInfo();

      expect(result.buildInfo).toMatchObject({
        version: '1.0.0',
        git_hash: '(unknown)',
        git_branch: '(unknown)',
      });
      expect(result.buildInfo.build_timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
      );
      expect(result.warnings.length).toBeGreaterThanOrEqual(2); // Should have git-related warnings
      expect(result.warnings.some((w) => w.includes('git'))).toBe(true);
    });

    it('should read version from package.json when not provided', async () => {
      // Create a mock package.json
      const packageJSON = { version: '2.5.1', name: 'test-package' };
      const packageJSONPath = path.join(tempDir, 'package.json');
      await fs.writeFile(packageJSONPath, JSON.stringify(packageJSON, null, 2));

      const generator = new GenerateBuildInfo({ workingDir: tempDir });
      const result = await generator.generateInfo();

      expect(result.buildInfo.version).toBe('2.5.1');
      // Will have git warnings since we're not in a git repo
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle missing package.json', async () => {
      const generator = new GenerateBuildInfo({ workingDir: tempDir });
      const result = await generator.generateInfo();

      expect(result.buildInfo.version).toBe('(unknown)');
      expect(
        result.warnings.some((w) => w.includes('Error reading package.json')),
      ).toBe(true);
    });

    it('should handle invalid package.json', async () => {
      // Create invalid JSON
      const packageJSONPath = path.join(tempDir, 'package.json');
      await fs.writeFile(packageJSONPath, '{ invalid json }');

      const generator = new GenerateBuildInfo({ workingDir: tempDir });
      const result = await generator.generateInfo();

      expect(result.buildInfo.version).toBe('(unknown)');
      expect(
        result.warnings.some((w) => w.includes('Error reading package.json')),
      ).toBe(true);
    });

    it('should include custom properties', async () => {
      const customProperties = {
        environment: 'production',
        buildNumber: 100,
        deployedBy: 'ci-cd',
      };

      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '3.0.0',
        customProperties,
      });
      const result = await generator.generateInfo();

      expect(result.buildInfo).toMatchObject({
        version: '3.0.0',
        git_hash: '(unknown)', // Will be unknown since not in git repo
        git_branch: '(unknown)', // Will be unknown since not in git repo
        environment: 'production',
        buildNumber: 100,
        deployedBy: 'ci-cd',
      });
    });

    it('should filter out custom properties that conflict with core BuildInfo properties', async () => {
      const customProperties = {
        environment: 'production',
        version: 'custom-version', // This should be filtered out
        git_hash: 'custom-hash', // This should be filtered out
        build_timestamp: 'custom-timestamp', // This should be filtered out
        git_branch: 'custom-branch', // This should be filtered out
        buildNumber: 100, // This should be kept
      };

      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '3.0.0',
        customProperties,
      });
      const result = await generator.generateInfo();

      // Should use the actual version, not the custom one
      expect(result.buildInfo.version).toBe('3.0.0');
      expect(result.buildInfo.git_hash).toBe('(unknown)');
      expect(result.buildInfo.git_branch).toBe('(unknown)');
      expect(result.buildInfo.build_timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
      );

      // Should keep non-conflicting custom properties
      expect(result.buildInfo.environment).toBe('production');
      expect(result.buildInfo.buildNumber).toBe(100);

      // Should not have the conflicting custom properties
      expect(result.buildInfo).not.toHaveProperty('custom-version');
      expect(result.buildInfo).not.toHaveProperty('custom-hash');
      expect(result.buildInfo).not.toHaveProperty('custom-timestamp');
      expect(result.buildInfo).not.toHaveProperty('custom-branch');

      // Should have warnings for the filtered properties
      expect(result.warnings).toContain(
        'Custom property "version" conflicts with core BuildInfo property and will be ignored',
      );
      expect(result.warnings).toContain(
        'Custom property "git_hash" conflicts with core BuildInfo property and will be ignored',
      );
      expect(result.warnings).toContain(
        'Custom property "build_timestamp" conflicts with core BuildInfo property and will be ignored',
      );
      expect(result.warnings).toContain(
        'Custom property "git_branch" conflicts with core BuildInfo property and will be ignored',
      );
    });

    it('should use provided version over package.json', async () => {
      // Create a mock package.json with different version
      const packageJSON = { version: '5.0.0', name: 'test-package' };
      const packageJSONPath = path.join(tempDir, 'package.json');
      await fs.writeFile(packageJSONPath, JSON.stringify(packageJSON, null, 2));

      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.2.3', // This should take precedence
      });
      const result = await generator.generateInfo();

      expect(result.buildInfo.version).toBe('1.2.3');
    });
  });

  describe('generateSourceCode', () => {
    it('should generate valid TypeScript source code', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.0.0',
      });

      const sourceCode = await generator.generateSourceCode();

      // Check that it contains expected exports
      expect(sourceCode).toContain('export const BUILD_INFO = {');
      expect(sourceCode).toContain('export const BUILD_TIMESTAMP = ');
      expect(sourceCode).toContain("export const APP_VERSION = '1.0.0';");
      expect(sourceCode).toContain("export const GIT_HASH = '(unknown)';"); // Will be unknown in non-git environment
      expect(sourceCode).toContain("export const GIT_BRANCH = '(unknown)';"); // Will be unknown in non-git environment
      expect(sourceCode).toContain(
        '// This file is auto-generated. Do not edit manually.',
      );
      expect(sourceCode).toContain(
        '// Export individual properties for convenience',
      );
    });

    it('should generate source code with custom properties', async () => {
      const customProperties = {
        environment: 'test',
        buildNumber: 42,
        features: ['feature1', 'feature2'],
      };

      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '2.0.0',
        customProperties,
      });

      const sourceCode = await generator.generateSourceCode();

      // Check custom properties are included
      expect(sourceCode).toContain('environment: "test"');
      expect(sourceCode).toContain('buildNumber: 42');
      expect(sourceCode).toContain('features: ["feature1","feature2"]');
    });

    it('should use last generated info if available', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.5.0',
      });

      // First call to generateInfo
      await generator.generateInfo();

      const sourceCode = await generator.generateSourceCode();

      // Should use cached values
      expect(sourceCode).toContain("export const APP_VERSION = '1.5.0';");
    });
  });

  describe('generateJSON', () => {
    it('should generate valid JSON', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.0.0',
      });

      const jsonString = await generator.generateJSON();
      const parsed = JSON.parse(jsonString) as Record<string, unknown>;

      expect(parsed).toMatchObject({
        version: '1.0.0',
        git_hash: '(unknown)', // Will be unknown in non-git environment
        git_branch: '(unknown)', // Will be unknown in non-git environment
      });
      expect(parsed.build_timestamp as string).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
      );
    });

    it('should use last generated info if available', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '2.0.0',
      });

      // First call to generateInfo
      await generator.generateInfo();

      const jsonString = await generator.generateJSON();
      const parsed = JSON.parse(jsonString) as Record<string, unknown>;

      expect(parsed.version as string).toBe('2.0.0');
    });
  });

  describe('saveTS', () => {
    it('should save TypeScript file with default name', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.0.0',
      });

      const result = await generator.saveTS();

      expect(result.saved).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0); // Will have git warnings

      // Check file was created
      const filePath = path.join(tempDir, 'current-build-info.ts');
      const doesFileExist = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(doesFileExist).toBe(true);

      // Check file content
      const fileContent = await fs.readFile(filePath, 'utf8');
      expect(fileContent).toContain('export const BUILD_INFO = {');
      expect(fileContent).toContain("export const APP_VERSION = '1.0.0';");
    });

    it('should save TypeScript file with custom name', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '2.0.0',
      });

      const customFileName = 'my-build-info.ts';
      const result = await generator.saveTS(customFileName);

      expect(result.saved).toBe(true);

      // Check file was created with custom name
      const filePath = path.join(tempDir, customFileName);
      const doesFileExist = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(doesFileExist).toBe(true);
    });
  });

  describe('saveJSON', () => {
    it('should save JSON file with default name', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.0.0',
      });

      const result = await generator.saveJSON();

      expect(result.saved).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0); // Will have git warnings

      // Check file was created
      const filePath = path.join(tempDir, 'current-build-info.json');
      const doesFileExist = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(doesFileExist).toBe(true);

      // Check file content
      const fileContent = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(fileContent) as Record<string, unknown>;
      expect(parsed.version as string).toBe('1.0.0');
      expect(parsed.git_hash as string).toBe('(unknown)'); // Will be unknown in non-git environment
    });

    it('should save JSON file with custom name', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '2.0.0',
      });

      const customFileName = 'my-build-info.json';
      const result = await generator.saveJSON(customFileName);

      expect(result.saved).toBe(true);

      // Check file was created with custom name
      const filePath = path.join(tempDir, customFileName);
      const doesFileExist = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(doesFileExist).toBe(true);

      const fileContent = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(fileContent) as Record<string, unknown>;
      expect(parsed.version as string).toBe('2.0.0');
    });
  });

  describe('getLastGeneratedInfo', () => {
    it('should return undefined when no info generated yet', () => {
      const generator = new GenerateBuildInfo({ workingDir: tempDir });
      const result = generator.getLastGeneratedInfo();
      expect(result).toBeUndefined();
    });

    it('should return last generated info after generateInfo call', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.0.0',
      });

      await generator.generateInfo();
      const result = generator.getLastGeneratedInfo();

      expect(result).toBeDefined();
      expect(result?.buildInfo.version).toBe('1.0.0');
      expect(result?.buildInfo.git_hash).toBe('(unknown)'); // Will be unknown in non-git environment
      expect(result?.buildInfo.git_branch).toBe('(unknown)'); // Will be unknown in non-git environment
    });
  });

  describe('integration tests', () => {
    it('should work end-to-end with all methods', async () => {
      const packageJSON = { version: '1.0.0', name: 'test-app' };
      const packageJSONPath = path.join(tempDir, 'package.json');
      await fs.writeFile(packageJSONPath, JSON.stringify(packageJSON, null, 2));

      const generator = new GenerateBuildInfo({ workingDir: tempDir });

      // Test all methods work together
      const info = await generator.generateInfo();
      const sourceCode = await generator.generateSourceCode();
      const jsonString = await generator.generateJSON();
      const tsResult = await generator.saveTS();
      const jsonResult = await generator.saveJSON();

      expect(info.buildInfo.version).toBe('1.0.0');
      expect(sourceCode).toContain('export const BUILD_INFO = {');
      expect(
        (JSON.parse(jsonString) as Record<string, unknown>).version as string,
      ).toBe('1.0.0');
      expect(tsResult.saved).toBe(true);
      expect(jsonResult.saved).toBe(true);

      // Check files were actually created
      const tsPath = path.join(tempDir, 'current-build-info.ts');
      const jsonPath = path.join(tempDir, 'current-build-info.json');

      const doesTSExist = await fs
        .access(tsPath)
        .then(() => true)
        .catch(() => false);

      const doesJSONExist = await fs
        .access(jsonPath)
        .then(() => true)
        .catch(() => false);

      expect(doesTSExist).toBe(true);
      expect(doesJSONExist).toBe(true);
    });

    it('should handle complex custom properties correctly', async () => {
      const customProperties = {
        environment: 'production',
        buildNumber: 123,
        features: ['auth', 'payments', 'notifications'],
        config: {
          apiURL: 'https://api.example.com',
          timeout: 5000,
        },
        buildMetadata: {
          buildServer: 'ci-server-01',
          buildAgent: 'github-actions',
        },
      };

      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '2.1.0',
        customProperties,
      });

      const info = await generator.generateInfo();
      const sourceCode = await generator.generateSourceCode();
      const jsonString = await generator.generateJSON();

      // Check that all custom properties are preserved
      expect(info.buildInfo.environment).toBe('production');
      expect(info.buildInfo.buildNumber).toBe(123);
      expect(info.buildInfo.features).toEqual([
        'auth',
        'payments',
        'notifications',
      ]);
      expect(info.buildInfo.config).toEqual({
        apiURL: 'https://api.example.com',
        timeout: 5000,
      });

      // Check source code generation
      expect(sourceCode).toContain('environment: "production"');
      expect(sourceCode).toContain('buildNumber: 123');
      expect(sourceCode).toContain(
        'features: ["auth","payments","notifications"]',
      );
      expect(sourceCode).toContain('"apiURL":"https://api.example.com"');

      // Check JSON generation
      const parsed = JSON.parse(jsonString) as Record<string, unknown>;
      expect(parsed.environment as string).toBe('production');
      expect(parsed.features as string[]).toEqual([
        'auth',
        'payments',
        'notifications',
      ]);
      expect((parsed.config as Record<string, unknown>).apiURL as string).toBe(
        'https://api.example.com',
      );
    });

    it('should generate consistent timestamps across calls when using cached info', async () => {
      const generator = new GenerateBuildInfo({
        workingDir: tempDir,
        version: '1.0.0',
      });

      // Generate info once
      const info1 = await generator.generateInfo();

      // Generate source code and JSON - should use cached timestamp
      const sourceCode = await generator.generateSourceCode();
      const jsonString = await generator.generateJSON();

      const parsed = JSON.parse(jsonString) as Record<string, unknown>;

      // All should have the same timestamp
      expect(info1.buildInfo.build_timestamp).toBe(
        parsed.build_timestamp as string,
      );
      expect(sourceCode).toContain(info1.buildInfo.build_timestamp);
    });
  });
});
