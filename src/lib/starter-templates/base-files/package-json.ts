import { vfsReadJSON, vfsWriteJSON, type FileRoot } from '../vfs';

/**
 * Ensure package.json exists at the repo root with required fields.
 * Returns true if successful, false if an error occurred.
 */

export async function ensurePackageJSON(
  repoRoot: FileRoot,
  repoName: string,
  log?: (message: string) => void,
): Promise<boolean> {
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
        private: true,
        license: 'UNLICENSED',
      };

      await vfsWriteJSON(repoRoot, 'package.json', pkg);

      if (log) {
        log('Created repo root package.json');
      }

      return true;
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

  // write updated package.json only if we actually changed something
  if (didChange) {
    await vfsWriteJSON(repoRoot, 'package.json', parsed);

    if (log) {
      log('Updated repo root package.json (added missing fields)');
    }
  }

  return true;
}
