import { vfsWriteIfNotExists, vfsDeleteFile } from '../vfs';
import type { FileRoot } from '../vfs';
import { isDirEmpty } from '../internal-utils';
import type { LoggerFunction } from '../types';

/**
 * Ensure a directory has a .gitkeep file if it is empty (or only has .gitkeep).
 * If the directory has other files, the .gitkeep file is deleted.
 *
 * @param repoRoot - Repository root
 * @param dirName - Directory name to check (e.g. 'scripts')
 * @param fileSrc - Content for the .gitkeep file
 * @param log - Optional logger
 */
export async function ensureGitkeep(
  repoRoot: FileRoot,
  dirName: string,
  fileSrc: string,
  log?: LoggerFunction,
): Promise<void> {
  // Check if directory is empty, ignoring existing .gitkeep
  // Returns true if empty or only contains .gitkeep
  const isEmpty = await isDirEmpty(repoRoot, dirName, ['.gitkeep']);

  if (isEmpty) {
    // Directory is empty (or only has .gitkeep), so ensure .gitkeep exists
    const didWrite = await vfsWriteIfNotExists(
      repoRoot,
      `${dirName}/.gitkeep`,
      fileSrc,
    );

    if (didWrite && log) {
      log('info', `Created .gitkeep in ${dirName}`);
    }
  } else {
    // Directory has other files, so delete .gitkeep if it exists
    const didDelete = await vfsDeleteFile(repoRoot, `${dirName}/.gitkeep`);

    if (didDelete && log) {
      log(
        'info',
        `Removed .gitkeep from ${dirName} (directory is no longer empty)`,
      );
    }
  }
}
