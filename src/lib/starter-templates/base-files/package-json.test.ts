import { describe, test, expect } from 'bun:test';
import {
  ensurePackageJSON,
  dependencies,
  devDependencies,
} from './package-json';
import type { InMemoryDir } from '../vfs';

describe('ensurePackageJSON', () => {
  describe('new package.json creation', () => {
    test('creates package.json with all required fields and dependencies', async () => {
      const memRoot: InMemoryDir = {};
      await ensurePackageJSON(memRoot, 'test-repo');

      expect('package.json' in memRoot).toBe(true);

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.name).toBe('test-repo');
      expect(pkg.version).toBe('0.0.1');
      expect(pkg.type).toBe('module');
      expect(pkg.private).toBe(true);
      expect(pkg.license).toBe('UNLICENSED');
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.devDependencies).toBeDefined();
      expect(pkg.dependencies.react).toBe(dependencies.react);
      expect(pkg.dependencies['react-dom']).toBe(dependencies['react-dom']);
      expect(pkg.devDependencies.typescript).toBe(devDependencies.typescript);
      expect(pkg.devDependencies.vite).toBe(devDependencies.vite);
      expect(pkg.scripts).toBeDefined();
      expect(pkg.scripts.lint).toBe('eslint .');
      expect(pkg.scripts['lint:fix']).toBe('eslint . --fix');
      expect(pkg.scripts.format).toBeDefined();
      expect(pkg.scripts['format:check']).toBeDefined();
    });
  });

  describe('existing package.json updates', () => {
    test('adds missing fields without overwriting existing ones', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'existing-name',
          version: '2.0.0',
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo');

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.name).toBe('existing-name'); // Not overwritten
      expect(pkg.version).toBe('2.0.0'); // Not overwritten
      expect(pkg.type).toBe('module'); // Added
      expect(pkg.private).toBe(true); // Added
      expect(pkg.license).toBe('UNLICENSED'); // Added
    });

    test('adds missing dependencies', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          version: '1.0.0',
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo');

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.devDependencies).toBeDefined();
      expect(pkg.dependencies.react).toBe(dependencies.react);
      expect(pkg.devDependencies.typescript).toBe(devDependencies.typescript);
    });

    test('updates dependencies when template version is newer', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          version: '1.0.0',
          dependencies: {
            react: '^18.0.0', // Older version
            'react-dom': dependencies['react-dom'], // Same version as template
          },
          devDependencies: {
            typescript: '^5.0.0', // Older version
            vite: devDependencies.vite, // Same version as template
          },
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo');

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.dependencies.react).toBe(dependencies.react); // Updated
      expect(pkg.dependencies['react-dom']).toBe(dependencies['react-dom']); // Unchanged
      expect(pkg.devDependencies.typescript).toBe(devDependencies.typescript); // Updated
      expect(pkg.devDependencies.vite).toBe(devDependencies.vite); // Unchanged
    });

    test('does not downgrade dependencies when existing version is newer', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          version: '1.0.0',
          dependencies: {
            react: '^20.0.0', // Newer than template
            'react-dom': '^20.0.0', // Newer than template
          },
          devDependencies: {
            typescript: '^6.0.0', // Newer than template
            vite: '^8.0.0', // Newer than template
          },
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo');

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.dependencies.react).toBe('^20.0.0'); // Not downgraded
      expect(pkg.dependencies['react-dom']).toBe('^20.0.0'); // Not downgraded
      expect(pkg.devDependencies.typescript).toBe('^6.0.0'); // Not downgraded
      expect(pkg.devDependencies.vite).toBe('^8.0.0'); // Not downgraded
    });

    test('preserves custom dependencies not in template', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          version: '1.0.0',
          dependencies: {
            'custom-package': '^1.0.0',
          },
          devDependencies: {
            'custom-dev-package': '^2.0.0',
          },
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo');

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.dependencies['custom-package']).toBe('^1.0.0'); // Preserved
      expect(pkg.devDependencies['custom-dev-package']).toBe('^2.0.0'); // Preserved
      expect(pkg.dependencies.react).toBe(dependencies.react); // Added from template
      expect(pkg.devDependencies.typescript).toBe(devDependencies.typescript); // Added from template
    });

    test('adds missing scripts without overwriting existing ones', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          version: '1.0.0',
          scripts: {
            lint: 'custom-lint-command', // Custom script - should not be overwritten
            dev: 'vite', // Custom script not in template - should be preserved
          },
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo');

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.scripts.lint).toBe('custom-lint-command'); // Not overwritten
      expect(pkg.scripts.dev).toBe('vite'); // Preserved
      expect(pkg.scripts['lint:fix']).toBe('eslint . --fix'); // Added from template
      expect(pkg.scripts.format).toBeDefined(); // Added from template
      expect(pkg.scripts['format:check']).toBeDefined(); // Added from template
    });

    test('merges template-specific scripts and dependencies', async () => {
      const memRoot: InMemoryDir = {};
      await ensurePackageJSON(memRoot, 'test-repo', {
        templateScripts: {
          dev: 'vite',
          build: 'vite build',
        },
        templateDependencies: {
          'custom-lib': '^1.0.0',
        },
        templateDevDependencies: {
          'custom-dev-tool': '^2.0.0',
        },
      });

      const pkg = JSON.parse(memRoot['package.json'] as string);

      // Default scripts should be present
      expect(pkg.scripts.lint).toBe('eslint .');
      expect(pkg.scripts.format).toBeDefined();

      // Template scripts should be added
      expect(pkg.scripts.dev).toBe('vite');
      expect(pkg.scripts.build).toBe('vite build');

      // Default dependencies should be present
      expect(pkg.dependencies.react).toBe(dependencies.react);

      // Template dependencies should be added
      expect(pkg.dependencies['custom-lib']).toBe('^1.0.0');

      // Default devDependencies should be present
      expect(pkg.devDependencies.typescript).toBe(devDependencies.typescript);

      // Template devDependencies should be added
      expect(pkg.devDependencies['custom-dev-tool']).toBe('^2.0.0');
    });

    test('sorts package.json keys according to standard order', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          // Intentionally unsorted order
          devDependencies: { typescript: '^5.0.0' },
          scripts: { test: 'bun test' },
          dependencies: { react: '^18.0.0' },
          license: 'MIT',
          version: '1.0.0',
          name: 'test-repo',
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo');

      const pkg = JSON.parse(memRoot['package.json'] as string);
      const keys = Object.keys(pkg);

      // Verify name comes before version (standard sort order)
      expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('version'));
      // Verify version comes before license
      expect(keys.indexOf('version')).toBeLessThan(keys.indexOf('license'));
      // Verify scripts comes before dependencies
      expect(keys.indexOf('scripts')).toBeLessThan(
        keys.indexOf('dependencies'),
      );
      // Verify dependencies comes before devDependencies
      expect(keys.indexOf('dependencies')).toBeLessThan(
        keys.indexOf('devDependencies'),
      );
    });

    test('handles invalid JSON with proper error', () => {
      const memRoot: InMemoryDir = {
        'package.json': 'invalid json{',
      };

      expect(ensurePackageJSON(memRoot, 'test-repo')).rejects.toThrow(
        'Invalid JSON in repo root package.json',
      );
    });
  });
});
