import { vfsReadJSON, vfsWriteJSON, type FileRoot } from '../vfs';
import type { Logger } from '../types';
import semver from 'semver';
import sortPackageJson from 'sort-package-json';
import { PKG_VERSION } from '../../../version';

const defaultScripts = {
  lint: 'eslint .',
  'lint:fix': 'eslint . --fix',
  format: 'prettier --write "**/*.{js,jsx,ts,tsx,json,css,md}"',
  'format:check': 'prettier --check "**/*.{js,jsx,ts,tsx,json,css,md}"',
};

export const devDependencies = {
  '@eslint/js': '^9.39.1',
  '@tailwindcss/vite': '^4.1.17',
  '@types/bun': '^1.3.2',
  '@types/node': '^24.10.0',
  '@types/react': '^19.2.2',
  '@types/react-dom': '^19.2.2',
  '@typescript-eslint/eslint-plugin': '^8.46.3',
  '@typescript-eslint/parser': '^8.46.3',
  '@vitejs/plugin-react': '^5.1.0',
  eslint: '^9.39.1',
  'eslint-plugin-react': '^7.37.5',
  prettier: '^3.6.2',
  'prettier-plugin-tailwindcss': '^0.7.1',
  tailwindcss: '^4.1.17',
  typescript: '^5.9.3',
  'typescript-eslint': '^8.46.3',
  vite: '^7.2.2',
};

export const dependencies = {
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  'react-helmet-async': '^2.0.0',
  'react-router': '^7.0.0',
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
 * Options for customizing package.json generation
 */
export interface EnsurePackageJSONOptions {
  /** Optional logger function */
  log?: Logger;
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
 * @throws {Error} If package.json has invalid JSON or cannot be read/written
 */

export async function ensurePackageJSON(
  repoRoot: FileRoot,
  repoName: string,
  options?: EnsurePackageJSONOptions,
): Promise<void> {
  // Attempt to read an existing package.json at the repo root
  const pkgResult = await vfsReadJSON<Record<string, unknown>>(
    repoRoot,
    'package.json',
  );

  // Creation path: no package.json found; create a minimal one
  if (!pkgResult.ok) {
    if (pkgResult.code === 'ENOENT') {
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
      const sortedPkg = sortPackageJson(pkg);

      await vfsWriteJSON(repoRoot, 'package.json', sortedPkg);

      if (options?.log) {
        options.log('info', 'Created repo root package.json');
      }

      // Package.json created successfully, return early as we don't need to update it
      return;
    } else if (pkgResult.code === 'PARSE_ERROR') {
      throw new Error(
        `Invalid JSON in repo root package.json: ${pkgResult.message}`,
      );
    } else {
      throw new Error(
        `Failed to read repo root package.json: ${pkgResult.message}`,
      );
    }
  }

  // Update path: package.json exists and was successfully parsed — add missing fields only, never overwrite
  const parsed = pkgResult.data;

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
  const allDependencies = { ...dependencies, ...options?.templateDependencies };

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
}
