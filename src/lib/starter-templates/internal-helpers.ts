import {
  ensurePackageJSON,
  type EnsurePackageJSONOptions,
} from './base-files/package-json';
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
 * Ensure base repo files exist at the workspace root.
 * Returns early if any file creation fails.
 */
export async function ensureBaseFiles(
  repoRoot: FileRoot,
  repoName: string,
  options?: EnsurePackageJSONOptions,
): Promise<void> {
  // Ensure package.json exists with required fields
  const isPkgSuccess = await ensurePackageJSON(repoRoot, repoName, options);

  if (!isPkgSuccess) {
    return; // Early exit if package.json setup failed
  }
}
