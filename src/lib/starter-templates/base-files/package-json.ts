import { vfsReadJSON, vfsWriteJSON } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';
import semver from 'semver';
import sortPackageJson from 'sort-package-json';
import { PKG_VERSION } from '../../../version';

const defaultScripts = {
  'type-check': 'tsc --noEmit',
  test: 'bun test',
  lint: 'eslint .',
  'lint:fix': 'eslint . --fix',
  format: 'prettier --write "**/*.{js,jsx,ts,tsx,json,css,md}"',
  'format:check': 'prettier --check "**/*.{js,jsx,ts,tsx,json,css,md}"',
  spellcheck: 'cspell lint "**/*.{ts,tsx,js,jsx,md,html,css,json}"',
  'cspell:clean': 'bun run scripts/clean-cspell.ts',
  'cspell:clean:fix': 'bun run scripts/clean-cspell.ts --write',
  'list-outdated-packages': 'bun outdated',
  check:
    'bun audit && bun run type-check && bun run lint && bun run spellcheck && bun test --pass-with-no-tests',
};

export const devDependencies = {
  '@eslint/js': '^9.39.4',
  '@tailwindcss/vite': '^4.1.17',
  '@types/bun': '^1.3.14',
  '@types/node': '^24.13.2',
  '@types/picomatch': '^3.0.2',
  '@types/react': '^19.2.17',
  '@types/react-dom': '^19.2.3',
  '@typescript-eslint/eslint-plugin': '^8.61.1',
  '@typescript-eslint/parser': '^8.61.1',
  '@vitejs/plugin-react': '^6.0.2',
  cspell: '^10.0.1',
  eslint: '^9.39.4',
  'eslint-import-resolver-typescript': '^4.4.5',
  'eslint-plugin-check-file': '^3.3.1',
  'eslint-plugin-import': '^2.32.0',
  'eslint-plugin-jsx-a11y': '^6.10.2',
  'eslint-plugin-react': '^7.37.5',
  'eslint-plugin-react-hooks': '^7.1.1',
  'eslint-plugin-react-refresh': '^0.5.3',
  'eslint-plugin-unicorn': '^62.0.0',
  picomatch: '^4.0.4',
  prettier: '^3.8.4',
  'prettier-plugin-tailwindcss': '^0.7.1',
  tailwindcss: '^4.1.17',
  typescript: '^5.9.3',
  'typescript-eslint': '^8.61.1',
  vite: '^8.0.16',
  'rollup-plugin-visualizer': '^7.0.1',
};

export const dependencies = {
  lifecycleion: '^0.0.18',
  react: '^19.2.7',
  'react-dom': '^19.2.7',
  'react-router': '^8.0.1',
  unirend: `^${PKG_VERSION}`,
};

/**
 * Helper function to merge dependencies, updating if the template version is newer
 * or if the dependency doesn't exist in the target.
 */
function mergeDependencies(
  target: Record<string, unknown>,
  source: Record<string, string>,
  depKey: 'dependencies' | 'devDependencies',
): boolean {
  let didChange = false;

  // Ensure the dependencies object exists
  if (!Object.prototype.hasOwnProperty.call(target, depKey)) {
    target[depKey] = {};
    didChange = true;
  }

  const targetDeps = target[depKey] as Record<string, string>;

  for (const [pkg, templateVersion] of Object.entries(source)) {
    const existingVersion = targetDeps[pkg];

    if (!existingVersion) {
      // Package doesn't exist, add it
      targetDeps[pkg] = templateVersion;
      didChange = true;
    } else {
      // Package exists, compare versions
      try {
        // Extract version numbers from semver ranges (e.g., "^1.2.3" -> "1.2.3")
        const templateClean = semver.minVersion(templateVersion);
        const existingClean = semver.minVersion(existingVersion);

        if (templateClean && existingClean) {
          // Only update if template version is newer
          if (semver.gt(templateClean, existingClean)) {
            targetDeps[pkg] = templateVersion;
            didChange = true;
          }
        }
        // If we can't parse versions, leave existing version unchanged
      } catch {
        // If semver comparison fails, leave existing version unchanged
      }
    }
  }

  return didChange;
}

/**
 * Helper function to merge scripts, only adding if the script name doesn't exist.
 * Never overwrites existing scripts.
 */
function mergeScripts(
  target: Record<string, unknown>,
  source: Record<string, string>,
): boolean {
  let didChange = false;

  // Ensure the scripts object exists
  if (!Object.prototype.hasOwnProperty.call(target, 'scripts')) {
    target.scripts = {};
    didChange = true;
  }

  const targetScripts = target.scripts as Record<string, string>;

  for (const [scriptName, scriptCommand] of Object.entries(source)) {
    if (!targetScripts[scriptName]) {
      // Script doesn't exist, add it
      targetScripts[scriptName] = scriptCommand;
      didChange = true;
    }

    // If script exists, leave it unchanged (never overwrite user's scripts)
  }

  return didChange;
}

/**
 * Result of *reading* the root package.json — reading is fallible, so this
 * carries both the known states and the failure states. Mirrors the
 * discriminated shape of `readRepoConfig` so callers can surface parse/read
 * errors with a clear message before doing any work.
 */
export type RootPackageJSONResult =
  | { status: 'found'; data: Record<string, unknown> } // ─┐ known states
  | { status: 'not_found' } //                            ─┘ (no error)
  | { status: 'parse_error'; errorMessage?: string } //   ─┐ error states
  | { status: 'read_error'; errorMessage?: string }; //   ─┘

/**
 * A *known* (error-free) root package.json state — the `found`/`not_found`
 * subset of {@link RootPackageJSONResult}, i.e. what you have once the
 * parse/read errors have been handled.
 *
 * `Extract<Union, Filter>` is a built-in TS utility that *narrows* a union down
 * to only the members assignable to `Filter` — so this keeps `found`/`not_found`
 * and drops the two error members. (It's a filter/subset, despite the name
 * sounding like "extend".) Deriving it from `RootPackageJSONResult` instead of
 * re-typing the two members by hand keeps the shapes in sync if they change.
 *
 * Using the narrower type for the values threaded between helpers —
 * `ensurePackageJSON`'s preload input + return, and the `packageJSON` handed
 * back by `ensureBaseFiles`/`initRepoInternal` — makes it a compile-time
 * guarantee that a parse/read error can never be passed around as if it were a
 * real package.json, and means a caller never has to re-read the file.
 * - `{ status: 'not_found' }` → no package.json yet; take the creation path.
 * - `{ status: 'found', data }` → existing/parsed package.json; take the update path.
 */
export type RootPackageJSONState = Extract<
  RootPackageJSONResult,
  { status: 'found' } | { status: 'not_found' }
>;

/**
 * Read and parse the root package.json once, classifying the outcome so the
 * caller can fail early on invalid/unreadable JSON and otherwise thread the
 * resulting {@link RootPackageJSONState} into `ensurePackageJSON`/
 * `ensureBaseFiles` instead of reading the file again.
 */
export async function readRootPackageJSON(
  repoRoot: FileRoot,
): Promise<RootPackageJSONResult> {
  const result = await vfsReadJSON<Record<string, unknown>>(
    repoRoot,
    'package.json',
  );

  if (!result.ok) {
    if (result.code === 'ENOENT') {
      return { status: 'not_found' };
    } else if (result.code === 'PARSE_ERROR') {
      return { status: 'parse_error', errorMessage: result.message };
    } else {
      return { status: 'read_error', errorMessage: result.message };
    }
  }

  return { status: 'found', data: result.data };
}

/**
 * Find which of the given project-specific script names already exist in the
 * target package.json scripts. Used by `createProject` to detect collisions
 * before writing anything: project-specific scripts (e.g. `<app>-build`) must
 * not clash with the user's existing scripts, whereas generic shared scripts
 * are allowed to be skipped silently by `mergeScripts`.
 *
 * @returns The colliding script names, in the order they appear in `projectScripts`.
 */
export function findScriptConflicts(
  existingScripts: Record<string, unknown> | undefined,
  projectScripts: Record<string, string> | undefined,
): string[] {
  if (!existingScripts || !projectScripts) {
    return [];
  }

  return Object.keys(projectScripts).filter((name) =>
    Object.prototype.hasOwnProperty.call(existingScripts, name),
  );
}

/**
 * Options for customizing package.json generation
 */
export interface EnsurePackageJSONOptions {
  /** Optional logger function */
  log?: LoggerFunction;
  /** Template-specific scripts to merge with defaults */
  templateScripts?: Record<string, string>;
  /** Template-specific dependencies to merge with defaults */
  templateDependencies?: Record<string, string>;
  /** Template-specific devDependencies to merge with defaults */
  templateDevDependencies?: Record<string, string>;
}

/**
 * Ensure package.json exists at the repo root with required fields.
 * Creates a new package.json if missing, or updates existing one with missing fields.
 * Never overwrites existing user-defined fields.
 *
 * This function does not read package.json itself — the caller passes the
 * already-read `existing` state (see {@link RootPackageJSONState}). Reading (and
 * surfacing any parse/read error) is therefore the caller's job, done once up
 * front; everyone in this module threads that single read around. Use
 * {@link readRootPackageJSON} to obtain the state.
 *
 * Returns the resulting {@link RootPackageJSONState} (always `found`, since the
 * file is guaranteed to exist on success) so a caller can thread it onward —
 * e.g. into a follow-up `ensurePackageJSON`/`ensureBaseFiles` call — without
 * re-reading the file.
 *
 * @param existing - The pre-read package.json state to ensure from.
 * @throws {Error} If package.json cannot be written.
 */
export async function ensurePackageJSON(
  repoRoot: FileRoot,
  repoName: string,
  existing: RootPackageJSONState,
  options?: EnsurePackageJSONOptions,
): Promise<RootPackageJSONState> {
  try {
    // Creation path: no package.json found; create a minimal one
    if (existing.status === 'not_found') {
      const pkg = {
        name: repoName,
        version: '0.0.1',
        type: 'module',
        private: true,
        license: 'UNLICENSED',
        scripts: { ...defaultScripts, ...options?.templateScripts },
        dependencies: { ...dependencies, ...options?.templateDependencies },
        devDependencies: {
          ...devDependencies,
          ...options?.templateDevDependencies,
        },
      };

      // Sort the package.json for consistency
      const sortedPkg = sortPackageJson(pkg) as Record<string, unknown>;

      await vfsWriteJSON(repoRoot, 'package.json', sortedPkg);

      if (options?.log) {
        options.log('info', 'Created repo root package.json');
      }

      // Package.json created successfully — hand back the resulting state so
      // callers can thread it onward without re-reading.
      return { status: 'found', data: sortedPkg };
    }

    // Update path: package.json exists and was successfully parsed — add missing fields only, never overwrite
    const parsed = existing.data;

    let didChange = false;

    // Add defaults only when these fields are absent
    if (!Object.prototype.hasOwnProperty.call(parsed, 'name')) {
      (parsed as { name: string }).name = repoName;
      didChange = true;
    }

    if (!Object.prototype.hasOwnProperty.call(parsed, 'private')) {
      (parsed as { private: boolean }).private = true;
      didChange = true;
    }

    if (!Object.prototype.hasOwnProperty.call(parsed, 'license')) {
      (parsed as { license: string }).license = 'UNLICENSED';
      didChange = true;
    }

    if (!Object.prototype.hasOwnProperty.call(parsed, 'version')) {
      (parsed as { version: string }).version = '0.0.1';
      didChange = true;
    }

    if (!Object.prototype.hasOwnProperty.call(parsed, 'type')) {
      (parsed as { type: string }).type = 'module';
      didChange = true;
    }

    // Merge scripts (only add missing scripts, never overwrite)
    // Combine default scripts with template-specific scripts
    const allScripts = { ...defaultScripts, ...options?.templateScripts };
    if (mergeScripts(parsed, allScripts)) {
      didChange = true;
    }

    // Merge dependencies and devDependencies (only update if newer)
    // Combine default dependencies with template-specific dependencies
    const allDependencies = {
      ...dependencies,
      ...options?.templateDependencies,
    };

    if (mergeDependencies(parsed, allDependencies, 'dependencies')) {
      didChange = true;
    }

    const allDevDependencies = {
      ...devDependencies,
      ...options?.templateDevDependencies,
    };

    if (mergeDependencies(parsed, allDevDependencies, 'devDependencies')) {
      didChange = true;
    }

    // Sort the package.json and check if sorting changed anything
    const beforeSort = JSON.stringify(parsed);
    const sortedParsed = sortPackageJson(parsed);
    const afterSort = JSON.stringify(sortedParsed);

    if (beforeSort !== afterSort) {
      didChange = true;
    }

    // write updated package.json only if we actually changed something
    if (didChange) {
      await vfsWriteJSON(repoRoot, 'package.json', sortedParsed);

      if (options?.log) {
        options.log(
          'info',
          'Updated repo root package.json (added missing fields)',
        );
      }
    }

    // Hand back the resulting state (sorted form; identical content to disk
    // when nothing changed) so callers can thread it onward without re-reading.
    return { status: 'found', data: sortedParsed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure package.json: ${errorMessage}`);
  }
}
