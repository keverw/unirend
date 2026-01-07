import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  normalizeRelPath,
  isInMemoryFileRoot,
  vfsEnsureDir,
  vfsExists,
  vfsWrite,
  vfsWriteIfNotExists,
  vfsReadText,
  vfsReadBinary,
  vfsDeleteFile,
  vfsDisplayPath,
  vfsReadJSON,
  vfsWriteJSON,
  vfsListDir,
  type InMemoryDir,
} from './vfs';
import { tmpdir } from 'os';
import { join } from 'path';
import { stat, mkdtemp, rm, readFile as fsReadFile } from 'fs/promises';

async function createTmpDir(prefix = 'unirend-vfs-'): Promise<string> {
  const base = tmpdir();
  const dir = await mkdtemp(join(base, prefix));
  return dir;
}

async function cleanupTmpDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

describe('VFS', () => {
  describe('path utils', () => {
    test('strips leading slashes and collapses separators', () => {
      expect(normalizeRelPath('/foo/bar')).toBe('foo/bar');
      expect(normalizeRelPath('foo/bar')).toBe('foo/bar');
      expect(normalizeRelPath('//foo///bar//')).toBe('foo/bar');
      expect(normalizeRelPath('\\foo\\bar')).toBe('foo/bar');
      expect(normalizeRelPath('/foo\\bar/baz')).toBe('foo/bar/baz');
    });

    test('resolves . and .. within root', () => {
      expect(normalizeRelPath('foo/./bar/./baz')).toBe('foo/bar/baz');
      expect(normalizeRelPath('foo/bar/../baz')).toBe('foo/baz');
      expect(normalizeRelPath('./foo/../bar')).toBe('bar');
    });

    test('empty or current dir resolves to empty string', () => {
      expect(normalizeRelPath('')).toBe('');
      expect(normalizeRelPath('.')).toBe('');
      expect(normalizeRelPath('/')).toBe('');
    });

    test('throws on traversal outside root', () => {
      expect(() => normalizeRelPath('..')).toThrow();
      expect(() => normalizeRelPath('../foo')).toThrow();
      expect(() => normalizeRelPath('foo/../../bar')).toThrow();
      expect(() => normalizeRelPath('/../../etc')).toThrow();
    });
  });

  describe('display path', () => {
    describe('memory', () => {
      test('returns [in-memory] when no relPath provided', () => {
        const mem: InMemoryDir = {};
        expect(vfsDisplayPath(mem)).toBe('[in-memory]');
      });

      test('normalizes and prefixes with [in-memory]', () => {
        const mem: InMemoryDir = {};
        expect(vfsDisplayPath(mem, 'a/b/c')).toBe('[in-memory] a/b/c');
        expect(vfsDisplayPath(mem, '/a\\b//c')).toBe('[in-memory] a/b/c');
        expect(vfsDisplayPath(mem, 'a/./b/../c')).toBe('[in-memory] a/c');
      });

      test('keeps raw when normalize throws (outside root traversal)', () => {
        const mem: InMemoryDir = {};
        expect(vfsDisplayPath(mem, '../secret')).toBe('[in-memory] ../secret');
        expect(vfsDisplayPath(mem, '..')).toBe('[in-memory] ..');
      });
    });

    describe('file system', () => {
      let base: string;

      beforeEach(async () => {
        base = await createTmpDir();
      });

      afterEach(async () => {
        await cleanupTmpDir(base);
      });

      test('returns root when no relPath provided', () => {
        expect(vfsDisplayPath(base)).toBe(base);
      });

      test('normalizes relative path under root', () => {
        expect(vfsDisplayPath(base, 'a/b/c')).toBe(join(base, 'a/b/c'));
        expect(vfsDisplayPath(base, '/a\\b//c')).toBe(join(base, 'a/b/c'));
        expect(vfsDisplayPath(base, 'a/./b/../c')).toBe(join(base, 'a/c'));
      });

      test('keeps raw when normalize throws and joins with root', () => {
        expect(vfsDisplayPath(base, '..')).toBe(join(base, '..'));
        expect(vfsDisplayPath(base, '../escape')).toBe(join(base, '../escape'));
      });
    });
  });

  describe('memory', () => {
    test('isInMemoryFileRoot detects object roots', () => {
      expect(isInMemoryFileRoot({})).toBe(true);
      expect(isInMemoryFileRoot({ 'a.txt': 'hello' })).toBe(true);
      expect(isInMemoryFileRoot({ 'b.bin': new Uint8Array([1, 2, 3]) })).toBe(
        true,
      );
    });

    test('isInMemoryFileRoot returns false for non-objects', () => {
      expect(isInMemoryFileRoot('/tmp/project')).toBe(false);

      expect(isInMemoryFileRoot(123 as any)).toBe(false);

      expect(isInMemoryFileRoot(null as any)).toBe(false);

      expect(isInMemoryFileRoot(undefined as any)).toBe(false);
    });

    test('vfsEnsureDir is a no-op for in-memory roots', () => {
      const mem: InMemoryDir = {};
      expect(vfsEnsureDir(mem)).resolves.toBeUndefined();
      expect(isInMemoryFileRoot(mem)).toBe(true);
    });

    test('vfsWrite writes string content into in-memory object as string', async () => {
      const mem: InMemoryDir = {};
      await vfsWrite(mem, 'foo/bar.txt', 'hello world');

      expect(mem['foo/bar.txt']).toBe('hello world');
      expect(typeof mem['foo/bar.txt']).toBe('string');

      const read = await vfsReadText(mem, 'foo/bar.txt');
      expect(read).toEqual({ ok: true, text: 'hello world' });
    });

    test('vfsWrite writes binary content into in-memory object as Uint8Array', async () => {
      const mem: InMemoryDir = {};
      const bytes = new Uint8Array([0, 1, 2, 3, 255]);
      await vfsWrite(mem, 'bin/data.bin', bytes);

      const stored = mem['bin/data.bin'];
      expect(stored instanceof Uint8Array).toBe(true);
      expect(Array.from(stored as Uint8Array)).toEqual(Array.from(bytes));

      const read = await vfsReadBinary(mem, 'bin/data.bin');
      expect(read.ok).toBe(true);

      if (read.ok) {
        expect(Array.from(read.data)).toEqual(Array.from(bytes));
      }
    });

    test('vfsReadText returns ENOENT for missing in-memory path', async () => {
      const mem: InMemoryDir = {};
      const res = await vfsReadText(mem, 'does/not/exist.txt');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsReadBinary returns ENOENT for missing in-memory path', async () => {
      const mem: InMemoryDir = {};
      const res = await vfsReadBinary(mem, 'missing.bin');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsReadBinary returns UTF-8 bytes for string content', async () => {
      const mem: InMemoryDir = {};
      const text = 'hello ✓ world';
      await vfsWrite(mem, 'mixed/utf8.txt', text);
      const res = await vfsReadBinary(mem, 'mixed/utf8.txt');
      expect(res.ok).toBe(true);

      if (res.ok) {
        const decoded = new TextDecoder().decode(res.data);
        expect(decoded).toBe(text);
      }
    });

    test('vfsReadText decodes UTF-8 from binary content', async () => {
      const mem: InMemoryDir = {};
      const text = 'héllo 🧪';
      const bytes = new TextEncoder().encode(text);
      await vfsWrite(mem, 'mixed/bytes.bin', bytes);
      const res = await vfsReadText(mem, 'mixed/bytes.bin');
      expect(res).toEqual({ ok: true, text });
    });

    test('vfsDeleteFile removes string content in memory and returns true', async () => {
      const mem: InMemoryDir = {};
      await vfsWrite(mem, 'to/remove.txt', 'remove me');
      const didDelete = await vfsDeleteFile(mem, 'to/remove.txt');
      expect(didDelete).toBe(true);
      expect(mem['to/remove.txt']).toBeUndefined();
      const res = await vfsReadText(mem, 'to/remove.txt');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsDeleteFile removes binary content in memory and returns true', async () => {
      const mem: InMemoryDir = {};
      await vfsWrite(mem, 'to/remove.bin', new Uint8Array([1, 2, 3]));
      const didDelete = await vfsDeleteFile(mem, 'to/remove.bin');
      expect(didDelete).toBe(true);
      expect(mem['to/remove.bin']).toBeUndefined();
      const res = await vfsReadBinary(mem, 'to/remove.bin');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsDeleteFile on missing in-memory path returns false', async () => {
      const mem: InMemoryDir = {};
      const didDelete = await vfsDeleteFile(mem, 'missing.txt');
      expect(didDelete).toBe(false);
    });
  });

  describe('file system', () => {
    let base: string;

    beforeEach(async () => {
      base = await createTmpDir();
    });

    afterEach(async () => {
      await cleanupTmpDir(base);
    });

    test('vfsEnsureDir creates missing directory path', async () => {
      const target = join(base, 'new-project');
      await vfsEnsureDir(target);
      const s = await stat(target);
      expect(s.isDirectory()).toBe(true);
    });

    test('vfsWrite writes string file on disk', async () => {
      await vfsWrite(base, 'notes/readme.txt', 'hello fs');
      const abs = join(base, 'notes/readme.txt');

      const content = await fsReadFile(abs, 'utf8');
      expect(content).toBe('hello fs');

      const read = await vfsReadText(base, 'notes/readme.txt');
      expect(read).toEqual({ ok: true, text: 'hello fs' });
    });

    test('vfsWrite writes binary file on disk', async () => {
      const bytes = new Uint8Array([10, 20, 30, 40, 50]);
      await vfsWrite(base, 'bin/blob.bin', bytes);
      const abs = join(base, 'bin/blob.bin');

      const content = await fsReadFile(abs);
      expect(Array.from(content)).toEqual(Array.from(bytes));

      const read = await vfsReadBinary(base, 'bin/blob.bin');
      expect(read.ok).toBe(true);

      if (read.ok) {
        expect(Array.from(read.data)).toEqual(Array.from(bytes));
      }
    });

    test('vfsReadBinary returns UTF-8 bytes for string file', async () => {
      const text = 'fs string ✓';
      await vfsWrite(base, 't/utf8.txt', text);
      const res = await vfsReadBinary(base, 't/utf8.txt');
      expect(res.ok).toBe(true);
      if (res.ok) {
        const decoded = new TextDecoder().decode(res.data);
        expect(decoded).toBe(text);
      }
    });

    test('vfsReadText decodes UTF-8 from binary file', async () => {
      const text = 'fs bytes → text';
      const bytes = new TextEncoder().encode(text);
      await vfsWrite(base, 't/bytes.bin', bytes);
      const res = await vfsReadText(base, 't/bytes.bin');
      expect(res).toEqual({ ok: true, text });
    });

    test('vfsReadText returns ENOENT for missing filesystem path', async () => {
      const res = await vfsReadText(base, 'nope/missing.txt');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsReadBinary returns ENOENT for missing filesystem path', async () => {
      const res = await vfsReadBinary(base, 'missing.bin');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsDeleteFile removes string file on disk and returns true', async () => {
      await vfsWrite(base, 'del/notes.txt', 'bye');
      const didDelete = await vfsDeleteFile(base, 'del/notes.txt');
      expect(didDelete).toBe(true);
      const res = await vfsReadText(base, 'del/notes.txt');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsDeleteFile removes binary file on disk and returns true', async () => {
      await vfsWrite(base, 'del/blob.bin', new Uint8Array([9, 8, 7]));
      const didDelete = await vfsDeleteFile(base, 'del/blob.bin');
      expect(didDelete).toBe(true);
      const res = await vfsReadBinary(base, 'del/blob.bin');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsDeleteFile on missing filesystem path returns false', async () => {
      const didDelete = await vfsDeleteFile(base, 'nope.txt');
      expect(didDelete).toBe(false);
    });
  });

  describe('vfsWriteIfNotExists', () => {
    describe('memory', () => {
      test('writes file when it does not exist and returns true', async () => {
        const mem: InMemoryDir = {};
        const didWrite = await vfsWriteIfNotExists(mem, 'new.txt', 'hello');
        expect(didWrite).toBe(true);
        expect(mem['new.txt']).toBe('hello');
      });

      test('does not overwrite existing file and returns false', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'existing.txt', 'original');
        const didWrite = await vfsWriteIfNotExists(mem, 'existing.txt', 'new');
        expect(didWrite).toBe(false);
        expect(mem['existing.txt']).toBe('original');
      });

      test('works with binary content', async () => {
        const mem: InMemoryDir = {};
        const bytes = new Uint8Array([1, 2, 3]);
        const didWrite = await vfsWriteIfNotExists(mem, 'data.bin', bytes);
        expect(didWrite).toBe(true);
        expect(mem['data.bin']).toEqual(bytes);
      });

      test('does not overwrite existing binary file', async () => {
        const mem: InMemoryDir = {};
        const original = new Uint8Array([1, 2, 3]);
        const newBytes = new Uint8Array([4, 5, 6]);
        await vfsWrite(mem, 'data.bin', original);
        const didWrite = await vfsWriteIfNotExists(mem, 'data.bin', newBytes);
        expect(didWrite).toBe(false);
        expect(mem['data.bin']).toEqual(original);
      });
    });

    describe('file system', () => {
      let base: string;

      beforeEach(async () => {
        base = await createTmpDir();
      });

      afterEach(async () => {
        await cleanupTmpDir(base);
      });

      test('writes file when it does not exist and returns true', async () => {
        const didWrite = await vfsWriteIfNotExists(base, 'new.txt', 'hello');
        expect(didWrite).toBe(true);
        const content = await fsReadFile(join(base, 'new.txt'), 'utf8');
        expect(content).toBe('hello');
      });

      test('does not overwrite existing file and returns false', async () => {
        await vfsWrite(base, 'existing.txt', 'original');
        const didWrite = await vfsWriteIfNotExists(base, 'existing.txt', 'new');
        expect(didWrite).toBe(false);
        const content = await fsReadFile(join(base, 'existing.txt'), 'utf8');
        expect(content).toBe('original');
      });

      test('works with binary content', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const didWrite = await vfsWriteIfNotExists(base, 'data.bin', bytes);
        expect(didWrite).toBe(true);
        const content = await fsReadFile(join(base, 'data.bin'));
        expect(Array.from(content)).toEqual(Array.from(bytes));
      });

      test('does not overwrite existing binary file', async () => {
        const original = new Uint8Array([1, 2, 3]);
        const newBytes = new Uint8Array([4, 5, 6]);
        await vfsWrite(base, 'data.bin', original);
        const didWrite = await vfsWriteIfNotExists(base, 'data.bin', newBytes);
        expect(didWrite).toBe(false);
        const content = await fsReadFile(join(base, 'data.bin'));
        expect(Array.from(content)).toEqual(Array.from(original));
      });

      test('creates parent directories when writing new file', async () => {
        const didWrite = await vfsWriteIfNotExists(
          base,
          'deep/nested/file.txt',
          'content',
        );
        expect(didWrite).toBe(true);
        const content = await fsReadFile(
          join(base, 'deep/nested/file.txt'),
          'utf8',
        );
        expect(content).toBe('content');
      });

      test('throws non-ENOENT errors instead of returning false', async () => {
        // Create a file, then try to use it as a directory path
        // This will cause fsStat to throw ENOTDIR (not ENOENT)
        await vfsWrite(base, 'file.txt', 'content');

        // Attempting to check if 'file.txt/nested.txt' exists should throw
        // because 'file.txt' is a file, not a directory
        try {
          await vfsWriteIfNotExists(base, 'file.txt/nested.txt', 'data');
          // If we get here, the function didn't throw as expected
          expect(true).toBe(false); // Force test to fail
        } catch (error) {
          // Verify it's the expected error (ENOTDIR, not ENOENT)
          expect(error).toBeDefined();
          expect(
            error &&
              typeof error === 'object' &&
              'code' in error &&
              (error as { code?: unknown }).code,
          ).toBe('ENOTDIR');
        }
      });
    });
  });

  describe('JSON operations', () => {
    describe('memory', () => {
      test('vfsWriteJSON writes human-readable JSON by default', async () => {
        const mem: InMemoryDir = {};
        const data = { name: 'test', value: 42 };
        await vfsWriteJSON(mem, 'config.json', data);
        expect(mem['config.json']).toBe(JSON.stringify(data, null, 2));
      });

      test('vfsWriteJSON writes compact JSON when useHumanFormat is false', async () => {
        const mem: InMemoryDir = {};
        const data = { name: 'test', value: 42 };
        await vfsWriteJSON(mem, 'config.json', data, false);
        expect(mem['config.json']).toBe(JSON.stringify(data));
      });

      test('vfsReadJSON reads and parses valid JSON', async () => {
        const mem: InMemoryDir = {};
        const data = { name: 'test', value: 42 };
        await vfsWriteJSON(mem, 'config.json', data);
        const result = await vfsReadJSON(mem, 'config.json');
        expect(result).toEqual({ ok: true, data });
      });

      test('vfsReadJSON returns ENOENT for missing file', async () => {
        const mem: InMemoryDir = {};
        const result = await vfsReadJSON(mem, 'missing.json');
        expect(result).toEqual({ ok: false, code: 'ENOENT' });
      });

      test('vfsReadJSON returns PARSE_ERROR for invalid JSON', async () => {
        const mem: InMemoryDir = {};
        mem['invalid.json'] = 'not valid json {';
        const result = await vfsReadJSON(mem, 'invalid.json');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('PARSE_ERROR');
          expect(result.message).toBeDefined();
        }
      });

      test('vfsReadJSON with type parameter', async () => {
        const mem: InMemoryDir = {};
        interface TestData {
          name: string;
          value: number;
        }
        const data: TestData = { name: 'test', value: 42 };
        await vfsWriteJSON(mem, 'typed.json', data);
        const result = await vfsReadJSON<TestData>(mem, 'typed.json');
        expect(result).toEqual({ ok: true, data });
      });
    });

    describe('file system', () => {
      let base: string;

      beforeEach(async () => {
        base = await createTmpDir();
      });

      afterEach(async () => {
        await cleanupTmpDir(base);
      });

      test('vfsWriteJSON writes human-readable JSON to disk by default', async () => {
        const data = { name: 'test', value: 42 };
        await vfsWriteJSON(base, 'config.json', data);
        const content = await fsReadFile(join(base, 'config.json'), 'utf8');
        expect(content).toBe(JSON.stringify(data, null, 2));
      });

      test('vfsWriteJSON writes compact JSON when useHumanFormat is false', async () => {
        const data = { name: 'test', value: 42 };
        await vfsWriteJSON(base, 'config.json', data, false);
        const content = await fsReadFile(join(base, 'config.json'), 'utf8');
        expect(content).toBe(JSON.stringify(data));
      });

      test('vfsReadJSON reads and parses valid JSON from disk', async () => {
        const data = { name: 'test', value: 42 };
        await vfsWriteJSON(base, 'config.json', data);
        const result = await vfsReadJSON(base, 'config.json');
        expect(result).toEqual({ ok: true, data });
      });

      test('vfsReadJSON returns ENOENT for missing file on disk', async () => {
        const result = await vfsReadJSON(base, 'missing.json');
        expect(result).toEqual({ ok: false, code: 'ENOENT' });
      });

      test('vfsReadJSON returns PARSE_ERROR for invalid JSON on disk', async () => {
        await vfsWrite(base, 'invalid.json', 'not valid json {');
        const result = await vfsReadJSON(base, 'invalid.json');
        expect(result.ok).toBe(false);

        if (!result.ok) {
          expect(result.code).toBe('PARSE_ERROR');
          expect(result.message).toBeDefined();
        }
      });

      test('vfsReadJSON with type parameter on disk', async () => {
        interface TestData {
          name: string;
          value: number;
        }

        const data: TestData = { name: 'test', value: 42 };
        await vfsWriteJSON(base, 'typed.json', data);

        const result = await vfsReadJSON<TestData>(base, 'typed.json');
        expect(result).toEqual({ ok: true, data });
      });
    });
  });

  describe('vfsExists', () => {
    describe('memory', () => {
      test('returns true for existing file', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'test.txt', 'content');
        const doesExist = await vfsExists(mem, 'test.txt');
        expect(doesExist).toBe(true);
      });

      test('returns false for non-existent file', async () => {
        const mem: InMemoryDir = {};
        const doesExist = await vfsExists(mem, 'missing.txt');
        expect(doesExist).toBe(false);
      });

      test('returns true for existing nested file', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'dir/subdir/file.txt', 'content');
        const doesExist = await vfsExists(mem, 'dir/subdir/file.txt');
        expect(doesExist).toBe(true);
      });

      test('returns false for non-existent nested path', async () => {
        const mem: InMemoryDir = {};
        const doesExist = await vfsExists(mem, 'dir/subdir/missing.txt');
        expect(doesExist).toBe(false);
      });

      test('works with binary files', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'data.bin', new Uint8Array([1, 2, 3]));
        const doesExist = await vfsExists(mem, 'data.bin');
        expect(doesExist).toBe(true);
      });
    });

    describe('file system', () => {
      let base: string;

      beforeEach(async () => {
        base = await createTmpDir();
      });

      afterEach(async () => {
        await cleanupTmpDir(base);
      });

      test('returns true for existing file on disk', async () => {
        await vfsWrite(base, 'test.txt', 'content');
        const doesExist = await vfsExists(base, 'test.txt');
        expect(doesExist).toBe(true);
      });

      test('returns false for non-existent file on disk', async () => {
        const doesExist = await vfsExists(base, 'missing.txt');
        expect(doesExist).toBe(false);
      });

      test('returns true for existing directory on disk', async () => {
        await vfsWrite(base, 'mydir/file.txt', 'content');
        const doesExist = await vfsExists(base, 'mydir');
        expect(doesExist).toBe(true);
      });

      test('returns false for non-existent directory on disk', async () => {
        const doesExist = await vfsExists(base, 'nonexistent-dir');
        expect(doesExist).toBe(false);
      });

      test('returns true for nested file on disk', async () => {
        await vfsWrite(base, 'a/b/c/file.txt', 'content');
        const doesExist = await vfsExists(base, 'a/b/c/file.txt');
        expect(doesExist).toBe(true);
      });

      test('returns true for nested directory on disk', async () => {
        await vfsWrite(base, 'a/b/c/file.txt', 'content');
        const doesExist = await vfsExists(base, 'a/b');
        expect(doesExist).toBe(true);
      });

      test('works with binary files on disk', async () => {
        await vfsWrite(base, 'data.bin', new Uint8Array([1, 2, 3]));
        const doesExist = await vfsExists(base, 'data.bin');
        expect(doesExist).toBe(true);
      });

      test('returns false after file is deleted', async () => {
        await vfsWrite(base, 'temp.txt', 'content');
        await vfsDeleteFile(base, 'temp.txt');
        const doesExist = await vfsExists(base, 'temp.txt');
        expect(doesExist).toBe(false);
      });
    });
  });

  describe('vfsListDir', () => {
    describe('memory', () => {
      test('returns empty array for empty in-memory root', async () => {
        const mem: InMemoryDir = {};
        const entries = await vfsListDir(mem);
        expect(entries).toEqual([]);
      });

      test('returns top-level files', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'file1.txt', 'content1');
        await vfsWrite(mem, 'file2.txt', 'content2');
        await vfsWrite(mem, 'readme.md', 'readme');
        const entries = await vfsListDir(mem);
        expect(entries).toEqual(['file1.txt', 'file2.txt', 'readme.md']);
      });

      test('returns top-level directories from nested files', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'src/index.ts', 'code');
        await vfsWrite(mem, 'src/utils.ts', 'utils');
        await vfsWrite(mem, 'docs/readme.md', 'docs');
        const entries = await vfsListDir(mem);
        expect(entries).toEqual(['docs', 'src']);
      });

      test('returns mixed files and directories', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'package.json', '{}');
        await vfsWrite(mem, 'readme.md', 'readme');
        await vfsWrite(mem, 'src/index.ts', 'code');
        await vfsWrite(mem, 'dist/bundle.js', 'bundle');
        const entries = await vfsListDir(mem);
        expect(entries).toEqual(['dist', 'package.json', 'readme.md', 'src']);
      });

      test('deduplicates directory names from multiple nested files', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'src/a.ts', 'a');
        await vfsWrite(mem, 'src/b.ts', 'b');
        await vfsWrite(mem, 'src/sub/c.ts', 'c');
        const entries = await vfsListDir(mem);
        expect(entries).toEqual(['src']);
      });

      test('returns sorted entries', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'zebra.txt', 'z');
        await vfsWrite(mem, 'apple.txt', 'a');
        await vfsWrite(mem, 'banana/file.txt', 'b');
        const entries = await vfsListDir(mem);
        expect(entries).toEqual(['apple.txt', 'banana', 'zebra.txt']);
      });

      test('handles deeply nested paths correctly', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'a/b/c/d/e/file.txt', 'deep');
        await vfsWrite(mem, 'x/y/z.txt', 'xyz');
        const entries = await vfsListDir(mem);
        expect(entries).toEqual(['a', 'x']);
      });

      test('lists content of subdirectory', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'src/index.ts', 'code');
        await vfsWrite(mem, 'src/utils.ts', 'utils');
        await vfsWrite(mem, 'readme.md', 'docs');

        const entries = await vfsListDir(mem, 'src');
        expect(entries).toEqual(['index.ts', 'utils.ts']);
      });

      test('excludes specified files', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'file1.txt', '1');
        await vfsWrite(mem, 'file2.txt', '2');
        await vfsWrite(mem, '.gitkeep', '');

        const entries = await vfsListDir(mem, '', ['.gitkeep']);
        expect(entries).toEqual(['file1.txt', 'file2.txt']);
      });

      test('lists subdirectory and excludes files', async () => {
        const mem: InMemoryDir = {};
        await vfsWrite(mem, 'src/app/main.ts', 'main');
        await vfsWrite(mem, 'src/app/types.ts', 'types');
        await vfsWrite(mem, 'src/app/.gitkeep', '');

        const entries = await vfsListDir(mem, 'src/app', ['.gitkeep']);
        expect(entries).toEqual(['main.ts', 'types.ts']);
      });
    });

    describe('file system', () => {
      let base: string;

      beforeEach(async () => {
        base = await createTmpDir();
      });

      afterEach(async () => {
        await cleanupTmpDir(base);
      });

      test('returns empty array for empty directory', async () => {
        const entries = await vfsListDir(base);
        expect(entries).toEqual([]);
      });

      test('returns empty array for non-existent directory', async () => {
        const nonExistent = join(base, 'does-not-exist');
        const entries = await vfsListDir(nonExistent);
        expect(entries).toEqual([]);
      });

      test('returns top-level files', async () => {
        await vfsWrite(base, 'file1.txt', 'content1');
        await vfsWrite(base, 'file2.txt', 'content2');
        await vfsWrite(base, 'readme.md', 'readme');
        const entries = await vfsListDir(base);
        expect(entries).toEqual(['file1.txt', 'file2.txt', 'readme.md']);
      });

      test('returns top-level directories', async () => {
        await vfsWrite(base, 'src/index.ts', 'code');
        await vfsWrite(base, 'docs/readme.md', 'docs');
        const entries = await vfsListDir(base);
        expect(entries).toEqual(['docs', 'src']);
      });

      test('returns mixed files and directories', async () => {
        await vfsWrite(base, 'package.json', '{}');
        await vfsWrite(base, 'readme.md', 'readme');
        await vfsWrite(base, 'src/index.ts', 'code');
        await vfsWrite(base, 'dist/bundle.js', 'bundle');
        const entries = await vfsListDir(base);
        expect(entries).toEqual(['dist', 'package.json', 'readme.md', 'src']);
      });

      test('returns sorted entries', async () => {
        await vfsWrite(base, 'zebra.txt', 'z');
        await vfsWrite(base, 'apple.txt', 'a');
        await vfsWrite(base, 'banana/file.txt', 'b');
        const entries = await vfsListDir(base);
        expect(entries).toEqual(['apple.txt', 'banana', 'zebra.txt']);
      });

      test('includes hidden files and directories', async () => {
        await vfsWrite(base, '.gitignore', 'ignore');
        await vfsWrite(base, '.git/config', 'config');
        await vfsWrite(base, 'visible.txt', 'visible');
        const entries = await vfsListDir(base);
        expect(entries).toEqual(['.git', '.gitignore', 'visible.txt']);
      });

      test('handles deeply nested directory structures', async () => {
        await vfsWrite(base, 'a/b/c/d/e/file.txt', 'deep');
        await vfsWrite(base, 'x/y/z.txt', 'xyz');
        const entries = await vfsListDir(base);
        expect(entries).toEqual(['a', 'x']);
      });

      test('lists content of subdirectory', async () => {
        await vfsWrite(base, 'src/index.ts', 'code');
        await vfsWrite(base, 'src/utils.ts', 'utils');
        await vfsWrite(base, 'readme.md', 'docs');

        const entries = await vfsListDir(base, 'src');
        expect(entries).toEqual(['index.ts', 'utils.ts']);
      });

      test('excludes specified files', async () => {
        await vfsWrite(base, 'file1.txt', '1');
        await vfsWrite(base, 'file2.txt', '2');
        await vfsWrite(base, '.gitkeep', '');

        const entries = await vfsListDir(base, '', ['.gitkeep']);
        expect(entries).toEqual(['file1.txt', 'file2.txt']);
      });

      test('lists subdirectory and excludes files', async () => {
        await vfsWrite(base, 'src/app/main.ts', 'main');
        await vfsWrite(base, 'src/app/types.ts', 'types');
        await vfsWrite(base, 'src/app/.gitkeep', '');

        const entries = await vfsListDir(base, 'src/app', ['.gitkeep']);
        expect(entries).toEqual(['main.ts', 'types.ts']);
      });
    });
  });
});
