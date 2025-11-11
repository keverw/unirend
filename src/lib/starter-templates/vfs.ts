import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir as fsMkdir,
  rm as fsRm,
  stat as fsStat,
} from 'fs/promises';
import { join } from 'path';

/**
 * Virtual File System (VFS) helpers
 *
 * These utilities operate on a "file root" that can be either:
 * - a real filesystem directory path (string), or
 * - an in-memory object mapping normalized relative paths to content.
 *
 * Design notes:
 * - All relative paths are normalized with forward slashes and without leading separators.
 * - Text/binary reads are symmetric: strings are UTF-8 encoded to bytes for binary reads,
 *   and Uint8Array is UTF-8 decoded to string for text reads.
 * - Read APIs return a discriminated result with { ok: false, code: "ENOENT" | "READ_ERROR" } on failure.
 * - ".." segments that escape the root are rejected by normalization; display helpers keep raw when invalid.
 */
/** In-memory directory object mapping normalized relative paths to content */
export type InMemoryDir = Record<string, FileContent>;
/** File root: real filesystem directory path or in-memory object */
export type FileRoot = string | InMemoryDir;
/** File content as UTF-8 string or binary bytes */
export type FileContent = string | Uint8Array;

/**
 * Normalize a relative path for VFS operations.
 * - Removes leading separators
 * - Collapses repeated separators and dot segments
 * - Uses forward slashes
 * - Throws if traversal would escape the root (leading to an empty stack)
 */
export function normalizeRelPath(relPath: string): string {
  const trimmed = relPath.replace(/^[\\/]+/, '');
  const raw = trimmed.split(/[\\/]+/);
  const parts: string[] = [];

  for (const part of raw) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      if (parts.length === 0) {
        throw new Error('Path traversal outside root is not allowed');
      }

      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join('/');
}

export function isInMemoryFileRoot(root: FileRoot): root is InMemoryDir {
  return typeof root === 'object' && root !== null;
}

/** Ensure the directory exists when using a real filesystem root. No-op for in-memory roots. */
export async function vfsEnsureDir(root: FileRoot): Promise<void> {
  if (!isInMemoryFileRoot(root)) {
    await fsMkdir(root, { recursive: true });
  }
}

/**
 * Write a file under the provided root at the normalized relative path.
 * - In-memory: stores the provided content as-is (string or Uint8Array)
 * - Filesystem: creates parent directories and writes the file
 */
export async function vfsWrite(
  root: FileRoot,
  relPath: string,
  content: FileContent,
): Promise<void> {
  const norm = normalizeRelPath(relPath);

  if (isInMemoryFileRoot(root)) {
    root[norm] = content;
    return;
  }

  const abs = join(root, norm);
  await fsMkdir(join(abs, '..'), { recursive: true }).catch(() => {});
  await fsWriteFile(abs, content);
}

/** Unified internal reader used by text/binary readers */
async function vfsReadRaw(
  root: FileRoot,
  relPath: string,
  desired: 'text' | 'Uint8Array',
): Promise<
  | { ok: true; data: string | Uint8Array }
  | { ok: false; code: 'ENOENT' | 'READ_ERROR'; message?: string }
> {
  try {
    if (isInMemoryFileRoot(root)) {
      const norm = normalizeRelPath(relPath);
      const data = root[norm];

      if (data === undefined) {
        return { ok: false, code: 'ENOENT' };
      }

      if (desired === 'Uint8Array') {
        if (data instanceof Uint8Array) {
          return { ok: true, data };
        }

        return { ok: true, data: new TextEncoder().encode(String(data)) };
      }

      // desired text
      if (typeof data === 'string') {
        return { ok: true, data };
      }

      return { ok: true, data: new TextDecoder().decode(data as Uint8Array) };
    }

    const norm = normalizeRelPath(relPath);
    const abs = join(root, norm);
    const buf = await fsReadFile(abs);

    if (desired === 'Uint8Array') {
      return { ok: true, data: buf };
    }

    return { ok: true, data: buf.toString('utf8') };
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      return { ok: false, code: 'ENOENT' };
    }

    return {
      ok: false,
      code: 'READ_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Read a file as UTF-8 text with consistent result shape across roots. */
export async function vfsReadText(
  root: FileRoot,
  relPath: string,
): Promise<
  | { ok: true; text: string }
  | { ok: false; code: 'ENOENT' | 'READ_ERROR'; message?: string }
> {
  const res = await vfsReadRaw(root, relPath, 'text');

  if (!res.ok) {
    return res;
  }

  return { ok: true, text: res.data as string };
}

/** Read a file as raw bytes (Uint8Array) with consistent result shape across roots. */
export async function vfsReadBinary(
  root: FileRoot,
  relPath: string,
): Promise<
  | { ok: true; data: Uint8Array }
  | { ok: false; code: 'ENOENT' | 'READ_ERROR'; message?: string }
> {
  const res = await vfsReadRaw(root, relPath, 'Uint8Array');

  if (!res.ok) {
    return res;
  }

  return { ok: true, data: res.data as Uint8Array };
}

/** Delete a file at the normalized relative path. No error if the file is missing. */
export async function vfsDelete(
  root: FileRoot,
  relPath: string,
): Promise<void> {
  const norm = normalizeRelPath(relPath);

  if (isInMemoryFileRoot(root)) {
    delete root[norm];
    return;
  }

  const abs = join(root, norm);
  await fsRm(abs, { force: true });
}

/**
 * Write a file only if it doesn't already exist.
 * Returns true if the file was written, false if it already existed.
 * @param root - File root (filesystem path or in-memory object)
 * @param relPath - Relative path to the file
 * @param content - Content to write (string or Uint8Array)
 * @throws {Error} If filesystem operation fails (e.g., permission denied, read-only filesystem)
 */
export async function vfsWriteIfNotExists(
  root: FileRoot,
  relPath: string,
  content: FileContent,
): Promise<boolean> {
  const norm = normalizeRelPath(relPath);

  if (isInMemoryFileRoot(root)) {
    if (root[norm] !== undefined) {
      return false;
    }

    root[norm] = content;
    return true;
  }

  // For filesystem, use stat to check if file exists (more efficient than reading)
  const abs = join(root, norm);

  try {
    await fsStat(abs);
    // File exists, don't overwrite
    return false;
  } catch (err) {
    // Only proceed if file doesn't exist (ENOENT)
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      await vfsWrite(root, relPath, content);
      return true;
    }

    // Other errors (permissions, read-only filesystem, etc.) should propagate
    throw err;
  }
}

/**
 * Write JSON data to a file with optional human-readable formatting.
 * @param root - File root (filesystem path or in-memory object)
 * @param relPath - Relative path to the JSON file
 * @param data - Data to serialize as JSON
 * @param useHumanFormat - Whether to format with indentation (default: true)
 */
export async function vfsWriteJSON(
  root: FileRoot,
  relPath: string,
  data: unknown,
  useHumanFormat = true,
): Promise<void> {
  const jsonString = useHumanFormat
    ? JSON.stringify(data, null, 2)
    : JSON.stringify(data);

  await vfsWrite(root, relPath, jsonString);
}

/**
 * Read and parse JSON data from a file.
 * Returns a discriminated result with parse error handling.
 */
export async function vfsReadJSON<T = unknown>(
  root: FileRoot,
  relPath: string,
): Promise<
  | { ok: true; data: T }
  | {
      ok: false;
      code: 'ENOENT' | 'READ_ERROR' | 'PARSE_ERROR';
      message?: string;
    }
> {
  const textResult = await vfsReadText(root, relPath);

  if (!textResult.ok) {
    return textResult;
  }

  try {
    const data = JSON.parse(textResult.text) as T;

    return { ok: true, data };
  } catch (parseError) {
    return {
      ok: false,
      code: 'PARSE_ERROR',
      message:
        parseError instanceof Error ? parseError.message : 'Invalid JSON',
    };
  }
}

/**
 * Display helper for logging/debugging paths in a consistent format across roots.
 * - Memory roots: "[in-memory]" optionally followed by normalized (or raw if invalid) path
 * - Filesystem roots: absolute path via join(root, normalizedRelPath) or join(root, rawRelPath) if invalid
 */
export function vfsDisplayPath(root: FileRoot, relPath?: string): string {
  if (isInMemoryFileRoot(root)) {
    if (!relPath) {
      return `[in-memory]`;
    }

    let norm = relPath;

    try {
      norm = normalizeRelPath(relPath);
    } catch {
      // keep raw
    }

    return `[in-memory] ${norm}`;
  }

  if (!relPath) {
    return root;
  }

  let norm = relPath;

  try {
    norm = normalizeRelPath(relPath);
  } catch {
    // keep raw
  }

  return join(root, norm);
}
