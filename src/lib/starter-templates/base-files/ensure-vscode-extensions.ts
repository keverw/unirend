import { vfsReadJSON, vfsWriteJSON } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

const defaultExtensions = [
  'dbaeumer.vscode-eslint',
  'esbenp.prettier-vscode',
  'streetsidesoftware.code-spell-checker',
  'FanaticPythoner.better-todo-tree',
  'jmbeach.list-symbols',
  'firsttris.vscode-jest-runner',
  'bradlc.vscode-tailwindcss',
];

/**
 * Extensions we used to recommend and now actively drop, each with the
 * extension that takes over its job when there is one. Without this, a repo
 * scaffolded earlier would keep the old entry forever and end up recommending
 * both halves of a replacement at once.
 */
const supersededExtensions: Array<{ id: string; replacedBy?: string }> = [
  // Todo Tree located VS Code's bundled ripgrep by hardcoded path. VS Code
  // 1.122 renamed that package to `@vscode/ripgrep-universal`, breaking the
  // lookup in every workspace at once, and upstream has been inactive for
  // years, so the fix sitting in its PR queue will not land. Better Todo Tree
  // is a maintained fork that ships its own ripgrep — so it cannot break this
  // way again — and keeps the same `todo-tree.*` settings, making it a drop-in.
  {
    id: 'Gruntfuggly.todo-tree',
    replacedBy: 'FanaticPythoner.better-todo-tree',
  },
];

interface VSCodeExtensions {
  recommendations?: string[];
  [key: string]: unknown;
}

/**
 * Normalize an extension ID for comparison. VS Code treats `publisher.name` as
 * case-insensitive, so a hand-edited file may disagree with our casing and
 * would otherwise pick up a near-duplicate entry.
 *
 * Non-string entries normalize to `''`, which matches no real ID, so a
 * hand-edited file containing one is left alone rather than crashing.
 */
function normalizeID(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * Ensure .vscode/extensions.json exists at the repo root with recommended extensions.
 * If the file exists, merges in any missing extensions from the default list.
 * Only removes extensions listed in `supersededExtensions`, adding their
 * replacement in their place; anything else the user added is left alone.
 *
 * @throws {Error} If file read/write fails
 */
export async function ensureVSCodeExtensions(
  repoRoot: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  try {
    const filePath = '.vscode/extensions.json';
    const readResult = await vfsReadJSON(repoRoot, filePath);

    let extensionsData: VSCodeExtensions;
    let didChange = false;

    if (!readResult.ok) {
      if (readResult.code !== 'ENOENT') {
        if (readResult.code === 'PARSE_ERROR') {
          throw new Error(
            `Invalid JSON in .vscode/extensions.json: ${readResult.message}`,
          );
        }

        throw new Error(
          `Failed to read .vscode/extensions.json: ${readResult.message}`,
        );
      }

      // File doesn't exist, create it
      extensionsData = {
        recommendations: [...defaultExtensions].sort(),
      };

      await vfsWriteJSON(repoRoot, filePath, extensionsData);

      if (log) {
        log('info', 'Created .vscode/extensions.json');
      }

      return;
    }

    // File exists, merge extensions
    extensionsData = readResult.data as VSCodeExtensions;

    // Ensure recommendations array exists
    if (!Array.isArray(extensionsData.recommendations)) {
      extensionsData.recommendations = [];
      didChange = true;
    }

    // Work on a local copy so reassigning it below cannot widen the type back
    // out, then hand it back to extensionsData once the merge is settled.
    let recommendations: string[] = extensionsData.recommendations;

    const added: string[] = [];
    const removed: string[] = [];

    // Everything we want present by the end: the defaults, plus the
    // replacement for any superseded extension we actually find below.
    const wantedExtensions = [...defaultExtensions];

    // Drop superseded extensions, queueing their replacements
    for (const { id, replacedBy } of supersededExtensions) {
      const target = normalizeID(id);
      const kept = recommendations.filter((ext) => normalizeID(ext) !== target);

      // Not present, so there is nothing to replace
      if (kept.length === recommendations.length) {
        continue;
      }

      recommendations = kept;
      removed.push(id);
      didChange = true;

      if (replacedBy) {
        wantedExtensions.push(replacedBy);
      }
    }

    // Add missing extensions. Tracked case-insensitively, and updated as we go,
    // so neither a differently-cased existing entry nor a replacement that is
    // also a default can be added twice.
    const existingExtensions = new Set(recommendations.map(normalizeID));

    for (const ext of wantedExtensions) {
      const key = normalizeID(ext);

      if (!existingExtensions.has(key)) {
        existingExtensions.add(key);
        recommendations.push(ext);
        added.push(ext);
        didChange = true;
      }
    }

    if (didChange) {
      // Sort recommendations alphabetically for consistency
      recommendations.sort();

      extensionsData.recommendations = recommendations;

      await vfsWriteJSON(repoRoot, filePath, extensionsData);

      if (log) {
        const changes: string[] = [];

        if (added.length > 0) {
          changes.push(`added ${[...added].sort().join(', ')}`);
        }

        if (removed.length > 0) {
          changes.push(`removed ${[...removed].sort().join(', ')}`);
        }

        log(
          'info',
          changes.length > 0
            ? `Updated .vscode/extensions.json: ${changes.join('; ')}`
            : 'Updated .vscode/extensions.json',
        );
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to ensure .vscode/extensions.json: ${errorMessage}`,
    );
  }
}
