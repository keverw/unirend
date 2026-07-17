import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { cleanCspell } from './clean-cspell';

// ---------------------------------------------------------------------------
// cleanCspell — run the exported scan against a fake repo. The scaffolded
// scripts/clean-cspell.ts is a thin wrapper over this function (asserted in
// base-files/ensure-clean-cspell.test.ts), so its behavior is tested here at
// the function level.
// ---------------------------------------------------------------------------

describe('cleanCspell', () => {
  let tmpDir: TmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'unirend-clean-cspell-',
      unsafeCleanup: true,
    });
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  async function writeRepo(options: {
    cspell?: unknown;
    files?: Record<string, string>;
  }) {
    const { cspell, files = {} } = options;

    if (cspell !== undefined) {
      await fs.promises.writeFile(
        path.join(tmpDir.path, 'cspell.json'),
        typeof cspell === 'string' ? cspell : JSON.stringify(cspell, null, 2),
      );
    }

    for (const [relPath, content] of Object.entries(files)) {
      const filePath = path.join(tmpDir.path, ...relPath.split('/'));
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content);
    }
  }

  function run(isFix = false) {
    const lines: string[] = [];
    const sink = (message: string) => {
      lines.push(message);
    };

    return cleanCspell({
      rootDir: tmpDir.path,
      fix: isFix,
      log: sink,
      logWarn: sink,
    }).then((result) => ({ result, output: lines.join('\n') }));
  }

  test('passes when every custom word is used', async () => {
    await writeRepo({
      cspell: { words: ['unirend', 'Fastify'] },
      files: { 'src/index.ts': '// unirend uses fastify\n' },
    });

    const { result, output } = await run();
    expect(result.success).toBe(true);
    expect(result.unusedWords).toEqual([]);
    expect(output).toContain('All custom words are currently used');
  });

  test('reports unused words without fix and returns failure', async () => {
    await writeRepo({
      cspell: { words: ['unirend', 'obsoleteWord'] },
      files: { 'src/index.ts': 'unirend only\n' },
    });

    const { result, output } = await run();
    expect(result.success).toBe(false);
    expect(result.unusedWords).toEqual(['obsoleteWord']);
    expect(result.usedWords).toEqual(['unirend']);
    expect(result.fixed).toBe(false);
    expect(output).toContain('obsoleteWord');
    expect(output).toContain('cspell:clean:fix');
  });

  test('fix removes unused words from cspell.json and keeps the rest', async () => {
    await writeRepo({
      cspell: {
        words: ['zeta', 'unirend', 'obsoleteWord'],
        ignorePaths: ['ignored/**'],
      },
      files: { 'src/index.ts': 'unirend and Zeta\n' },
    });

    const { result } = await run(true);
    expect(result.success).toBe(true);
    expect(result.fixed).toBe(true);
    expect(result.unusedWords).toEqual(['obsoleteWord']);

    const updated = JSON.parse(
      await fs.promises.readFile(
        path.join(tmpDir.path, 'cspell.json'),
        'utf-8',
      ),
    );

    // Sorted, unused word dropped, other config keys untouched
    expect(updated.words).toEqual(['unirend', 'zeta']);
    expect(updated.ignorePaths).toEqual(['ignored/**']);
  });

  test('matches words case-insensitively by default, and splits camelCase', async () => {
    // "Avenir" appears only inside a camelCase identifier; "upsert" only in
    // different casing — both count as used under CSpell's default rules.
    await writeRepo({
      cspell: { words: ['Avenir', 'upsert'] },
      files: { 'src/index.ts': 'const avenirFont = 1; // UPSERT\n' },
    });

    const { result } = await run();
    expect(result.success).toBe(true);
  });

  test('respects ignorePaths and skips cspell.json itself', async () => {
    // The only usage sits in an ignored folder, so the word counts as unused
    // — and its presence in cspell.json's own word list must not count.
    await writeRepo({
      cspell: { words: ['obsoleteWord'], ignorePaths: ['generated/**'] },
      files: { 'generated/out.txt': 'obsoleteWord\n' },
    });

    const { result } = await run();
    expect(result.success).toBe(false);
    expect(result.unusedWords).toEqual(['obsoleteWord']);
  });

  test('passes with no custom words', async () => {
    await writeRepo({ cspell: { words: [] } });

    const { result, output } = await run();
    expect(result.success).toBe(true);
    expect(output).toContain('No custom words found');
  });

  test('throws when cspell.json is missing or malformed', async () => {
    await writeRepo({ files: { 'src/index.ts': 'code\n' } });
    expect(run()).rejects.toThrow(/Failed to read cspell\.json/);

    await writeRepo({ cspell: '{ not json' });
    expect(run()).rejects.toThrow(/Failed to parse cspell\.json/);
  });

  test('skips binary files by extension and by null-byte sniff', async () => {
    // A word that only "appears" inside binary content must not count as
    // used: the .png is skipped by extension, the .txt by its null byte.
    await writeRepo({
      cspell: { words: ['obsoleteWord'] },
      files: {
        'assets/obsoleteWord.png': 'obsoleteWord',
        'notes.txt': 'obsoleteWord\0binary',
      },
    });

    const { result } = await run();

    // The filename itself is not scanned content, so the word stays unused
    expect(result.unusedWords).toEqual(['obsoleteWord']);
    expect(result.success).toBe(false);
  });
});
