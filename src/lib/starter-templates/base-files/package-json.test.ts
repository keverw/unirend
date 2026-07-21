import { describe, test, expect } from 'bun:test';
import {
  ensurePackageJSON,
  readRootPackageJSON,
  findScriptConflicts,
  dependencies,
  devDependencies,
} from './package-json';
import type { RootPackageJSONState } from './package-json';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

/**
 * Mirror how production obtains the state: read once, then pass it in.
 * `ensurePackageJSON` no longer reads the file itself, so tests read the
 * fixture they set up and thread the result in.
 */
async function readState(root: InMemoryDir): Promise<RootPackageJSONState> {
  const result = await readRootPackageJSON(root);

  if (result.status === 'parse_error' || result.status === 'read_error') {
    throw new Error(
      `unexpected package.json read error in test: ${result.status}`,
    );
  }

  return result;
}

describe('ensurePackageJSON', () => {
  describe('new package.json creation', () => {
    test('creates package.json with all required fields and dependencies', async () => {
      const memRoot: InMemoryDir = {};
      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

      expect('package.json' in memRoot).toBe(true);

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.name).toBe('test-repo');
      expect(pkg.version).toBe('0.0.1');
      expect(pkg.type).toBe('module');
      expect(pkg.private).toBe(true);
      expect(pkg.license).toBe('UNLICENSED');
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.devDependencies).toBeDefined();
      expect(pkg.dependencies.lifecycleion).toBe(dependencies.lifecycleion);
      expect(pkg.dependencies.react).toBe(dependencies.react);
      expect(pkg.dependencies['react-dom']).toBe(dependencies['react-dom']);
      expect(pkg.devDependencies.typescript).toBe(devDependencies.typescript);
      expect(pkg.devDependencies.vite).toBe(devDependencies.vite);
      expect(pkg.devDependencies.cspell).toBe(devDependencies.cspell);
      expect(pkg.scripts).toBeDefined();
      expect(pkg.scripts['type-check']).toBe('tsc --noEmit');
      expect(pkg.scripts.lint).toBe('eslint .');
      expect(pkg.scripts['lint:fix']).toBe('eslint . --fix');
      expect(pkg.scripts.format).toBeDefined();
      expect(pkg.scripts['format:check']).toBeDefined();
      expect(pkg.scripts.spellcheck).toBeDefined();
      expect(pkg.scripts['cspell:clean']).toBeDefined();
      expect(pkg.scripts['cspell:clean:fix']).toBeDefined();
      expect(pkg.scripts['list-outdated-packages']).toBe('bun outdated');
      expect(pkg.scripts['check:public-assets']).toBe(
        'bun run scripts/check-public-assets.ts',
      );
      expect(pkg.scripts['check:overrides']).toBe(
        'bun run scripts/check-overrides.ts',
      );
      expect(pkg.scripts['check:null-bytes']).toBe(
        'bun run scripts/check-null-bytes.ts',
      );
      // install:fresh mutates the lockfile, so it's scaffolded but left out of
      // the check chain below.
      expect(pkg.scripts['install:fresh']).toBe(
        'bun run scripts/refresh-lockfile.ts',
      );
      expect(pkg.scripts.check).toBe(
        'bun run check:null-bytes && bun audit && bun run type-check && bun run lint && bun run spellcheck && bun run check:public-assets && bun run check:overrides && bun test --pass-with-no-tests',
      );
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

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.name).toBe('existing-name'); // Not overwritten
      expect(pkg.version).toBe('2.0.0'); // Not overwritten
      expect(pkg.type).toBe('module'); // Added
      expect(pkg.private).toBe(true); // Added
      expect(pkg.license).toBe('UNLICENSED'); // Added
    });

    test('upgrades a check script that still matches a previous generated one', async () => {
      // The chain must grow as checks are added, but mergeScripts never
      // overwrites, so a repo scaffolded before check:null-bytes existed would
      // gain the script entry while `bun run check` quietly skipped it.
      // A byte-identical match proves nobody edited it, so upgrading is safe.
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          scripts: {
            check:
              'bun audit && bun run type-check && bun run lint && bun run spellcheck && bun run check:public-assets && bun test --pass-with-no-tests',
          },
        }),
      };

      const logs: Array<{ level: LogLevel; message: string }> = [];

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot), {
        log: (level, message) => logs.push({ level, message }),
      });

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.scripts.check).toContain('bun run check:null-bytes');
      expect(pkg.scripts.check).toContain('bun run check:overrides');
      expect(logs.some((entry) => entry.message.includes('Updated the'))).toBe(
        true,
      );
    });

    test('leaves a customized check script alone and says what it misses', async () => {
      // There is no safe way to splice entries into someone's own command, so
      // the decision stays theirs. The notice names only what is absent.
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          scripts: { check: 'bun run type-check && bun run my-custom-thing' },
        }),
      };

      const logs: Array<{ level: LogLevel; message: string }> = [];

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot), {
        log: (level, message) => logs.push({ level, message }),
      });

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.scripts.check).toBe(
        'bun run type-check && bun run my-custom-thing',
      );

      const warning = logs.find((entry) => entry.level === 'warning');
      expect(warning?.message).toContain('looks customized');
      expect(warning?.message).toContain('check:null-bytes');
      expect(warning?.message).toContain('check:overrides');
      // type-check IS referenced, so it must not be listed as missing.
      expect(warning?.message).not.toContain('`type-check`');
    });

    test('does not treat a longer script name as proof a check runs', async () => {
      // Regression test. Substring matching would read `bun run lint:fix` as
      // proof that `lint` runs, and `bun run check:overrides:custom` as proof
      // that `check:overrides` does, under-reporting in the one place that has
      // to be right: this warning is all a customized chain gets.
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          scripts: {
            check: 'bun run lint:fix && bun run check:overrides:custom',
            'lint:fix': 'eslint . --fix',
            'check:overrides:custom': 'bun run scripts/check-overrides.ts',
          },
        }),
      };

      const logs: Array<{ level: LogLevel; message: string }> = [];

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot), {
        log: (level, message) => logs.push({ level, message }),
      });

      const warning = logs.find((entry) => entry.level === 'warning');
      expect(warning?.message).toContain('`lint`');
      expect(warning?.message).toContain('`check:overrides`');
    });

    test('says nothing when a customized check already runs every check', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          scripts: {
            check:
              'bun run check:null-bytes && bun run type-check && bun run lint && bun run spellcheck && bun run check:public-assets && bun run check:overrides && bun run my-extra-step',
          },
        }),
      };

      const logs: Array<{ level: LogLevel; message: string }> = [];

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot), {
        log: (level, message) => logs.push({ level, message }),
      });

      expect(logs.filter((entry) => entry.level === 'warning')).toEqual([]);
    });

    test('adds missing dependencies', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          version: '1.0.0',
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

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

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

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
            vite: '^9.0.0', // Newer than template
          },
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.dependencies.react).toBe('^20.0.0'); // Not downgraded
      expect(pkg.dependencies['react-dom']).toBe('^20.0.0'); // Not downgraded
      expect(pkg.devDependencies.typescript).toBe('^6.0.0'); // Not downgraded
      expect(pkg.devDependencies.vite).toBe('^9.0.0'); // Not downgraded
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

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

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

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.scripts.lint).toBe('custom-lint-command'); // Not overwritten
      expect(pkg.scripts.dev).toBe('vite'); // Preserved
      expect(pkg.scripts['lint:fix']).toBe('eslint . --fix'); // Added from template
      expect(pkg.scripts.format).toBeDefined(); // Added from template
      expect(pkg.scripts['format:check']).toBeDefined(); // Added from template
    });

    test('preserves scripts whose existing value is an empty string', async () => {
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({
          name: 'test-repo',
          scripts: { check: '', lint: '' },
        }),
      };

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.scripts.check).toBe('');
      expect(pkg.scripts.lint).toBe('');
    });

    test('merges template-specific scripts and dependencies', async () => {
      const memRoot: InMemoryDir = {};
      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot), {
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

      await ensurePackageJSON(memRoot, 'test-repo', await readState(memRoot));

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
  });

  describe('passed-in package.json state', () => {
    test('takes the creation path when the state is not_found', async () => {
      // The state is the source of truth: even though a package.json sits on
      // disk, a `not_found` state makes ensurePackageJSON create (overwrite)
      // rather than merge — ensurePackageJSON never reads the file itself.
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({ name: 'on-disk', custom: true }),
      };

      // passing the known state instead of re-reading
      const result = await ensurePackageJSON(memRoot, 'test-repo', {
        status: 'not_found',
      });

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.name).toBe('test-repo'); // Created fresh, not merged from disk
      expect(pkg.custom).toBeUndefined();
      expect(pkg.scripts['type-check']).toBe('tsc --noEmit');

      // Returns the resulting state so callers can thread it onward
      expect(result.status).toBe('found');
      if (result.status === 'found') {
        expect(result.data.name).toBe('test-repo');
      }
    });

    test('takes the update path using the passed-in data and merges options', async () => {
      // In real usage this state comes from readRootPackageJSON; here it's
      // constructed directly to keep the fixture self-contained. Options are
      // included to mirror real call sites (e.g. createProject passing
      // templateScripts alongside the threaded state).
      const memRoot: InMemoryDir = {
        'package.json': JSON.stringify({ name: 'my-repo', version: '3.0.0' }),
      };

      const result = await ensurePackageJSON(
        memRoot,
        'test-repo',
        {
          status: 'found',
          // the same data that was previously read from disk
          data: { name: 'my-repo', version: '3.0.0' },
        },
        // options that would come from the template that can change the package.json
        {
          templateScripts: { 'my-app:build': 'vite build' },
          templateDependencies: { 'my-lib': '^1.0.0' },
        },
      );

      const pkg = JSON.parse(memRoot['package.json'] as string);
      expect(pkg.name).toBe('my-repo'); // Preserved from the state
      expect(pkg.version).toBe('3.0.0'); // Preserved from the state
      expect(pkg.type).toBe('module'); // Added
      expect(pkg.scripts.lint).toBe('eslint .'); // Added from defaults
      expect(pkg.scripts['my-app:build']).toBe('vite build'); // From options
      expect(pkg.dependencies['my-lib']).toBe('^1.0.0'); // From options

      // Returned state mirrors what was written
      expect(result.status).toBe('found');
      if (result.status === 'found') {
        expect(result.data.name).toBe('my-repo');
      }
    });
  });
});

describe('readRootPackageJSON', () => {
  test('returns not_found when there is no package.json', async () => {
    const memRoot: InMemoryDir = {};
    const result = await readRootPackageJSON(memRoot);
    expect(result).toEqual({ status: 'not_found' });
  });

  test('returns found with parsed data', async () => {
    const memRoot: InMemoryDir = {
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { dev: 'vite' },
      }),
    };

    const result = await readRootPackageJSON(memRoot);
    expect(result.status).toBe('found');

    if (result.status === 'found') {
      expect(result.data.name).toBe('demo');
      expect((result.data.scripts as Record<string, string>).dev).toBe('vite');
    }
  });

  test('returns parse_error for invalid JSON', async () => {
    const memRoot: InMemoryDir = {
      'package.json': 'invalid json{',
    };

    const result = await readRootPackageJSON(memRoot);
    expect(result.status).toBe('parse_error');
  });
});

describe('findScriptConflicts', () => {
  test('returns colliding project-script names in order', () => {
    const existing = { 'app-build': 'old', lint: 'eslint .', 'app-dev': 'old' };
    const projectScripts = {
      'app-dev': 'vite',
      'app-build': 'vite build',
      'app-serve': 'node serve.js',
    };

    expect(findScriptConflicts(existing, projectScripts)).toEqual([
      'app-dev',
      'app-build',
    ]);
  });

  test('returns empty array when nothing collides', () => {
    const existing = { lint: 'eslint .' };
    const projectScripts = { 'app-build': 'vite build' };
    expect(findScriptConflicts(existing, projectScripts)).toEqual([]);
  });

  test('tolerates missing existing scripts or project scripts', () => {
    expect(findScriptConflicts(undefined, { 'app-build': 'x' })).toEqual([]);
    expect(findScriptConflicts({ 'app-build': 'x' }, undefined)).toEqual([]);
    expect(findScriptConflicts(undefined, undefined)).toEqual([]);
  });

  test('ignores inherited object properties on the existing scripts', () => {
    // A script literally named "toString" should still be detectable, but
    // inherited prototype keys must not count as collisions.
    const existing = { 'app-build': 'old' };
    expect(
      findScriptConflicts(existing, { toString: 'x', hasOwnProperty: 'y' }),
    ).toEqual([]);
  });
});
