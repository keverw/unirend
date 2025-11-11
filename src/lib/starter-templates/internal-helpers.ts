import {
  ensurePackageJSON,
  type EnsurePackageJSONOptions,
} from './base-files/package-json';
import { ensureTsConfig } from './base-files/ensure-tsconfig';
import { ensureEditorConfig } from './base-files/ensure-editor-config';
import type { RepoConfig } from './types';
import { type FileRoot } from './vfs';

export function createRepoConfigObject(name: string): RepoConfig {
  return {
    version: '1.0',
    name,
    created: new Date().toISOString(),
    projects: {},
  };
}

export function addProjectToRepo(
  config: RepoConfig,
  projectName: string,
  templateID: string,
  relativePath: string,
): RepoConfig {
  return {
    ...config,
    projects: {
      ...config.projects,
      [projectName]: {
        templateID,
        path: relativePath,
        createdAt: new Date().toISOString(),
      },
    },
  };
}

/**
 * Options for ensureBaseFiles function
 * Currently inherits all options from EnsurePackageJSONOptions:
 * - log: Logger function
 * - templateScripts: Template-specific scripts
 * - templateDependencies: Template-specific dependencies
 * - templateDevDependencies: Template-specific devDependencies
 */
export type EnsureBaseFilesOptions = EnsurePackageJSONOptions;

/**
 * Ensure base repo files exist at the workspace root.
 * Creates or updates package.json, tsconfig.json, .editorconfig, and other base files.
 *
 * @throws {Error} If any file creation/update fails
 */
export async function ensureBaseFiles(
  repoRoot: FileRoot,
  repoName: string,
  options?: EnsureBaseFilesOptions,
): Promise<void> {
  // Each separate helper function will throw on error, allowing errors to propagate to the caller

  // Ensure package.json exists with required fields
  await ensurePackageJSON(repoRoot, repoName, options);

  // Ensure tsconfig.json exists (only creates if missing)
  await ensureTsConfig(repoRoot, options?.log);

  // Ensure .editorconfig exists (only creates if missing)
  await ensureEditorConfig(repoRoot, options?.log);

  // Future: Add more base file creation functions here
}
