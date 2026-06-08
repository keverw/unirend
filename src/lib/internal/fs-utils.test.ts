import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import {
  checkAndLoadManifest,
  getServerEntryFromManifest,
  readHTMLFile,
  readJSONFile,
  writeJSONFile,
  writeHTMLFile,
  validateDevPaths,
} from './fs-utils';

describe('fs-utils', () => {
  let tmpDir: TmpDir;
  let tempDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'fs-utils-test-',
      unsafeCleanup: true,
    });
    tempDir = tmpDir.path;
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  // ─── checkAndLoadManifest ──────────────────────────────────────────────────

  describe('checkAndLoadManifest', () => {
    it('loads a regular manifest when it exists', async () => {
      const viteDir = path.join(tempDir, '.vite');
      await fs.mkdir(viteDir);
      const data = { 'src/main.ts': { file: 'assets/main.js' } };
      await fs.writeFile(
        path.join(viteDir, 'manifest.json'),
        JSON.stringify(data),
      );

      const result = await checkAndLoadManifest(tempDir);

      expect(result.success).toBe(true);
      expect(result.manifest).toEqual(data);
    });

    it('loads an SSR manifest when isSSR is true', async () => {
      const viteDir = path.join(tempDir, '.vite');
      await fs.mkdir(viteDir);
      const data = { 'src/entry-server.ts': { file: 'server/entry.js' } };
      await fs.writeFile(
        path.join(viteDir, 'ssr-manifest.json'),
        JSON.stringify(data),
      );

      const result = await checkAndLoadManifest(tempDir, true);

      expect(result.success).toBe(true);
      expect(result.manifest).toEqual(data);
    });

    it('returns failure when the manifest file does not exist', async () => {
      const result = await checkAndLoadManifest(tempDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to load');
      expect(result.error).toContain('manifest.json');
    });

    it('returns failure when the manifest contains invalid JSON', async () => {
      const viteDir = path.join(tempDir, '.vite');
      await fs.mkdir(viteDir);
      await fs.writeFile(path.join(viteDir, 'manifest.json'), 'not-json{{{');

      const result = await checkAndLoadManifest(tempDir);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('SSR failure message mentions SSR', async () => {
      const result = await checkAndLoadManifest(tempDir, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain('SSR');
    });
  });

  // ─── getServerEntryFromManifest ────────────────────────────────────────────

  describe('getServerEntryFromManifest', () => {
    it('finds the default EntrySSR entry', () => {
      const manifest = {
        'src/EntrySSR.ts': { file: 'server/EntrySSR.js', isEntry: true },
        'src/other.ts': { file: 'server/other.js' },
      };

      const result = getServerEntryFromManifest(manifest, tempDir);

      expect(result.success).toBe(true);
      expect(result.entryPath).toContain('EntrySSR.js');
    });

    it('finds a custom server entry name', () => {
      const manifest = {
        'src/MyServer.ts': { file: 'server/MyServer.js', isEntry: true },
      };

      const result = getServerEntryFromManifest(manifest, tempDir, 'MyServer');

      expect(result.success).toBe(true);
      expect(result.entryPath).toContain('MyServer.js');
    });

    it('returns failure when the entry is not in the manifest', () => {
      const manifest = {
        'src/other.ts': { file: 'server/other.js' },
      };

      const result = getServerEntryFromManifest(manifest, tempDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain('EntrySSR');
    });

    it('skips entries where value is not an object', () => {
      const manifest = {
        'src/EntrySSR.ts': 'not-an-object',
      } as unknown as Record<string, unknown>;

      const result = getServerEntryFromManifest(manifest, tempDir);

      expect(result.success).toBe(false);
    });

    it('skips entries where value has no file property', () => {
      const manifest = {
        'src/EntrySSR.ts': { isEntry: true },
      };

      const result = getServerEntryFromManifest(manifest, tempDir);

      expect(result.success).toBe(false);
    });

    it('resolves the entryPath to an absolute path under serverBuildDir', () => {
      const manifest = {
        'src/EntrySSR.ts': { file: 'nested/EntrySSR.js' },
      };

      const result = getServerEntryFromManifest(manifest, tempDir);

      expect(result.success).toBe(true);
      expect(path.isAbsolute(result.entryPath ?? '')).toBe(true);
      expect(result.entryPath).toContain(tempDir);
    });
  });

  // ─── readHTMLFile ──────────────────────────────────────────────────────────

  describe('readHTMLFile', () => {
    it('reads an existing HTML file', async () => {
      const filePath = path.join(tempDir, 'page.html');
      await fs.writeFile(filePath, '<html>hello</html>');

      const result = await readHTMLFile(filePath);

      expect(result.exists).toBe(true);
      expect(result.content).toBe('<html>hello</html>');
      expect(result.error).toBeUndefined();
    });

    it('returns exists=false for a missing file', async () => {
      const result = await readHTMLFile(path.join(tempDir, 'nope.html'));

      expect(result.exists).toBe(false);
      expect(result.content).toBeUndefined();
      expect(result.error).toBeUndefined();
    });
  });

  // ─── readJSONFile ──────────────────────────────────────────────────────────

  describe('readJSONFile', () => {
    it('reads and parses an existing JSON file', async () => {
      const filePath = path.join(tempDir, 'data.json');
      const data = { foo: 'bar', count: 42 };
      await fs.writeFile(filePath, JSON.stringify(data));

      const result = await readJSONFile(filePath);

      expect(result.exists).toBe(true);
      expect(result.data).toEqual(data);
      expect(result.error).toBeUndefined();
    });

    it('returns exists=false for a missing file', async () => {
      const result = await readJSONFile(path.join(tempDir, 'nope.json'));

      expect(result.exists).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('returns exists=true with an error when JSON is invalid', async () => {
      const filePath = path.join(tempDir, 'bad.json');
      await fs.writeFile(filePath, 'not json {{{');

      const result = await readJSONFile(filePath);

      expect(result.exists).toBe(true);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain('bad.json');
    });
  });

  // ─── writeJSONFile ─────────────────────────────────────────────────────────

  describe('writeJSONFile', () => {
    it('writes JSON to disk with 2-space indentation', async () => {
      const filePath = path.join(tempDir, 'out.json');
      const data = { hello: 'world' };

      const result = await writeJSONFile(filePath, data);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const raw = await fs.readFile(filePath, 'utf-8');
      expect(raw).toBe(JSON.stringify(data, null, 2));
    });

    it('returns failure when the target directory does not exist', async () => {
      const filePath = path.join(tempDir, 'nonexistent-dir', 'out.json');

      const result = await writeJSONFile(filePath, { x: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('out.json');
    });
  });

  // ─── writeHTMLFile ─────────────────────────────────────────────────────────

  describe('writeHTMLFile', () => {
    it('writes HTML content to disk', async () => {
      const filePath = path.join(tempDir, 'page.html');
      const content = '<html><body>test</body></html>';

      const result = await writeHTMLFile(filePath, content);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const raw = await fs.readFile(filePath, 'utf-8');
      expect(raw).toBe(content);
    });

    it('returns failure when the target directory does not exist', async () => {
      const filePath = path.join(tempDir, 'nonexistent-dir', 'page.html');

      const result = await writeHTMLFile(filePath, '<html/>');

      expect(result.success).toBe(false);
      expect(result.error).toContain('page.html');
    });
  });

  // ─── validateDevPaths ──────────────────────────────────────────────────────

  describe('validateDevPaths', () => {
    it('succeeds when all three paths exist', async () => {
      const serverEntry = path.join(tempDir, 'entry-server.ts');
      const template = path.join(tempDir, 'index.html');
      const viteConfig = path.join(tempDir, 'vite.config.ts');

      await Promise.all([
        fs.writeFile(serverEntry, ''),
        fs.writeFile(template, ''),
        fs.writeFile(viteConfig, ''),
      ]);

      const result = await validateDevPaths({
        serverEntry,
        template,
        viteConfig,
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('collects errors for each missing path', async () => {
      const result = await validateDevPaths({
        serverEntry: path.join(tempDir, 'missing-entry.ts'),
        template: path.join(tempDir, 'missing.html'),
        viteConfig: path.join(tempDir, 'missing-vite.config.ts'),
      });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]).toContain('missing-entry.ts');
      expect(result.errors[1]).toContain('missing.html');
      expect(result.errors[2]).toContain('missing-vite.config.ts');
    });

    it('reports only the missing paths when some exist', async () => {
      const serverEntry = path.join(tempDir, 'entry-server.ts');
      await fs.writeFile(serverEntry, '');

      const result = await validateDevPaths({
        serverEntry,
        template: path.join(tempDir, 'missing.html'),
        viteConfig: path.join(tempDir, 'missing-vite.config.ts'),
      });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some((e) => e.includes('missing.html'))).toBe(true);
      expect(
        result.errors.some((e) => e.includes('missing-vite.config.ts')),
      ).toBe(true);
    });
  });
});
