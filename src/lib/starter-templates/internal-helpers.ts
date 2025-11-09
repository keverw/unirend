import type { RepoConfig } from './types';
import { vfsReadText, vfsWrite, type FileRoot } from './vfs';

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
 */

export async function ensureBaseFiles(
  repoRoot: FileRoot,
  repoName: string,
  log?: (message: string) => void,
): Promise<void> {
  // Attempt to read an existing package.json at the repo root
  const pkgResult = await vfsReadText(repoRoot, 'package.json');

  // Creation path: no package.json found; create a minimal one
  if (!pkgResult.ok) {
    if (pkgResult.code === 'ENOENT') {
      const pkg = {
        name: repoName,
        private: true,
        license: 'UNLICENSED',
      };

      await vfsWrite(repoRoot, 'package.json', JSON.stringify(pkg, null, 2));

      if (log) {
        log('Created repo root package.json');
      }
    } else {
      throw new Error(
        `Failed to read repo root package.json: ${pkgResult.message}`,
      );
    }

    return;
  }

  // Update path: package.json exists — add missing fields only, never overwrite
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(pkgResult.text) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Invalid JSON in repo root package.json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let changed = false;

  // Add defaults only when these fields are absent
  if (!Object.prototype.hasOwnProperty.call(parsed, 'name')) {
    (parsed as { name: string }).name = repoName;
    changed = true;
  }

  if (!Object.prototype.hasOwnProperty.call(parsed, 'private')) {
    (parsed as { private: boolean }).private = true;
    changed = true;
  }

  if (!Object.prototype.hasOwnProperty.call(parsed, 'license')) {
    (parsed as { license: string }).license = 'UNLICENSED';
    changed = true;
  }

  // write updated package.json only if we actually changed something
  if (changed) {
    await vfsWrite(repoRoot, 'package.json', JSON.stringify(parsed, null, 2));

    if (log) {
      log('Updated repo root package.json (added missing fields)');
    }
  }
}
