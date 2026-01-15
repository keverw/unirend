import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { Logger } from '../types';

const fileSrc = `# EditorConfig is awesome: https://EditorConfig.org

# top-most EditorConfig file
root = true

# Unix-style newlines with a newline ending every file
[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
trim_trailing_whitespace = true

# TypeScript and JavaScript files
[*.{ts,tsx,js,jsx}]
indent_style = space
indent_size = 2

# JSON files
[*.json]
indent_style = space
indent_size = 2

# CSS files
[*.{css,scss,sass}]
indent_style = space
indent_size = 2

# HTML files
[*.{html,htm}]
indent_style = space
indent_size = 2

# Markdown files
[*.md]
trim_trailing_whitespace = false`;

/**
 * Ensure .editorconfig exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensureEditorConfig(
  repoRoot: FileRoot,
  log?: Logger,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(
      repoRoot,
      '.editorconfig',
      fileSrc,
    );

    if (didWrite && log) {
      log('info', 'Created repo root .editorconfig');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure .editorconfig: ${errorMessage}`);
  }
}
