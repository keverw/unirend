import { describe, expect, test } from 'bun:test';
import {
  normalizeRelPath,
  isInMemoryFileRoot,
  vfsEnsureDir,
  vfsWrite,
  vfsReadText,
  vfsReadBinary,
  vfsDelete,
  vfsDisplayPath,
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
      test('returns root when no relPath provided', async () => {
        const base = await createTmpDir();
        try {
          expect(vfsDisplayPath(base)).toBe(base);
        } finally {
          await cleanupTmpDir(base);
        }
      });

      test('normalizes relative path under root', async () => {
        const base = await createTmpDir();
        try {
          expect(vfsDisplayPath(base, 'a/b/c')).toBe(join(base, 'a/b/c'));
          expect(vfsDisplayPath(base, '/a\\b//c')).toBe(join(base, 'a/b/c'));
          expect(vfsDisplayPath(base, 'a/./b/../c')).toBe(join(base, 'a/c'));
        } finally {
          await cleanupTmpDir(base);
        }
      });

      test('keeps raw when normalize throws and joins with root', async () => {
        const base = await createTmpDir();
        try {
          expect(vfsDisplayPath(base, '..')).toBe(join(base, '..'));
          expect(vfsDisplayPath(base, '../escape')).toBe(
            join(base, '../escape'),
          );
        } finally {
          await cleanupTmpDir(base);
        }
      });
    });
  });

  describe('memory', () => {
    test('isInMemoryFileRoot detects object roots', () => {
      expect(isInMemoryFileRoot({} as any)).toBe(true);
      expect(isInMemoryFileRoot({ 'a.txt': 'hello' } as any)).toBe(true);
      expect(
        isInMemoryFileRoot({ 'b.bin': new Uint8Array([1, 2, 3]) } as any),
      ).toBe(true);
    });

    test('isInMemoryFileRoot returns false for non-objects', () => {
      expect(isInMemoryFileRoot('/tmp/project' as any)).toBe(false);
      expect(isInMemoryFileRoot(123 as any)).toBe(false);
      expect(isInMemoryFileRoot(null as any)).toBe(false);
      expect(isInMemoryFileRoot(undefined as any)).toBe(false);
    });

    test('vfsEnsureDir is a no-op for in-memory roots', async () => {
      const mem: InMemoryDir = {};
      await expect(vfsEnsureDir(mem)).resolves.toBeUndefined();
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

    test('vfsDelete removes string content in memory and subsequent reads return ENOENT', async () => {
      const mem: InMemoryDir = {};
      await vfsWrite(mem, 'to/remove.txt', 'remove me');
      await vfsDelete(mem, 'to/remove.txt');
      expect(mem['to/remove.txt']).toBeUndefined();
      const res = await vfsReadText(mem, 'to/remove.txt');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsDelete removes binary content in memory and subsequent reads return ENOENT', async () => {
      const mem: InMemoryDir = {};
      await vfsWrite(mem, 'to/remove.bin', new Uint8Array([1, 2, 3]));
      await vfsDelete(mem, 'to/remove.bin');
      expect(mem['to/remove.bin']).toBeUndefined();
      const res = await vfsReadBinary(mem, 'to/remove.bin');
      expect(res).toEqual({ ok: false, code: 'ENOENT' });
    });

    test('vfsDelete on missing in-memory path does not throw', async () => {
      const mem: InMemoryDir = {};
      await expect(vfsDelete(mem, 'missing.txt')).resolves.toBeUndefined();
    });
  });

  describe('file system', () => {
    test('vfsEnsureDir creates missing directory path', async () => {
      const base = await createTmpDir();
      try {
        const target = join(base, 'new-project');
        await vfsEnsureDir(target);
        const s = await stat(target);
        expect(s.isDirectory()).toBe(true);
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsWrite writes string file on disk', async () => {
      const base = await createTmpDir();
      try {
        await vfsWrite(base, 'notes/readme.txt', 'hello fs');
        const abs = join(base, 'notes/readme.txt');

        const content = await fsReadFile(abs, 'utf8');
        expect(content).toBe('hello fs');

        const read = await vfsReadText(base, 'notes/readme.txt');
        expect(read).toEqual({ ok: true, text: 'hello fs' });
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsWrite writes binary file on disk', async () => {
      const base = await createTmpDir();
      try {
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
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsReadBinary returns UTF-8 bytes for string file', async () => {
      const base = await createTmpDir();
      try {
        const text = 'fs string ✓';
        await vfsWrite(base, 't/utf8.txt', text);
        const res = await vfsReadBinary(base, 't/utf8.txt');
        expect(res.ok).toBe(true);
        if (res.ok) {
          const decoded = new TextDecoder().decode(res.data);
          expect(decoded).toBe(text);
        }
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsReadText decodes UTF-8 from binary file', async () => {
      const base = await createTmpDir();
      try {
        const text = 'fs bytes → text';
        const bytes = new TextEncoder().encode(text);
        await vfsWrite(base, 't/bytes.bin', bytes);
        const res = await vfsReadText(base, 't/bytes.bin');
        expect(res).toEqual({ ok: true, text });
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsReadText returns ENOENT for missing filesystem path', async () => {
      const base = await createTmpDir();
      try {
        const res = await vfsReadText(base, 'nope/missing.txt');
        expect(res).toEqual({ ok: false, code: 'ENOENT' });
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsReadBinary returns ENOENT for missing filesystem path', async () => {
      const base = await createTmpDir();
      try {
        const res = await vfsReadBinary(base, 'missing.bin');
        expect(res).toEqual({ ok: false, code: 'ENOENT' });
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsDelete removes string file on disk and subsequent reads return ENOENT', async () => {
      const base = await createTmpDir();
      try {
        await vfsWrite(base, 'del/notes.txt', 'bye');
        await vfsDelete(base, 'del/notes.txt');
        const res = await vfsReadText(base, 'del/notes.txt');
        expect(res).toEqual({ ok: false, code: 'ENOENT' });
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsDelete removes binary file on disk and subsequent reads return ENOENT', async () => {
      const base = await createTmpDir();
      try {
        await vfsWrite(base, 'del/blob.bin', new Uint8Array([9, 8, 7]));
        await vfsDelete(base, 'del/blob.bin');
        const res = await vfsReadBinary(base, 'del/blob.bin');
        expect(res).toEqual({ ok: false, code: 'ENOENT' });
      } finally {
        await cleanupTmpDir(base);
      }
    });

    test('vfsDelete on missing filesystem path does not throw', async () => {
      const base = await createTmpDir();
      try {
        await expect(vfsDelete(base, 'nope.txt')).resolves.toBeUndefined();
      } finally {
        await cleanupTmpDir(base);
      }
    });
  });
});
