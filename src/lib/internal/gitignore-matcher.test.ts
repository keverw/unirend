import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import {
  addIgnoreRules,
  createIgnoreMatcher,
  isIgnored,
} from './gitignore-matcher';

describe('gitignore matcher', () => {
  let tmpDir: TmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'unirend-gitignore-matcher-',
      unsafeCleanup: true,
    });
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  async function write(relPath: string, content: string): Promise<void> {
    const filePath = path.join(tmpDir.path, ...relPath.split('/'));
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content);
  }

  test('loads root rules and distinguishes files from directories', async () => {
    await write('.gitignore', 'generated/\n*.log\n/root-only.ts\n');
    const matcher = createIgnoreMatcher();

    await addIgnoreRules(matcher, tmpDir.path, '');

    expect(isIgnored(matcher, 'generated', true)).toBe(true);
    expect(isIgnored(matcher, 'src/generated', true)).toBe(true);
    expect(isIgnored(matcher, 'src/debug.log', false)).toBe(true);
    expect(isIgnored(matcher, 'root-only.ts', false)).toBe(true);
    expect(isIgnored(matcher, 'src/root-only.ts', false)).toBe(false);
  });

  test('rebases nested rules and lets the deepest rule win', async () => {
    await write('.gitignore', '*.txt\n');
    await write('logs/.gitignore', '!keep.txt\nprivate/\n');
    const matcher = createIgnoreMatcher();

    await addIgnoreRules(matcher, tmpDir.path, '');
    await addIgnoreRules(matcher, path.join(tmpDir.path, 'logs'), 'logs');

    expect(isIgnored(matcher, 'logs/keep.txt', false)).toBe(false);
    expect(isIgnored(matcher, 'logs/drop.txt', false)).toBe(true);
    expect(isIgnored(matcher, 'other/keep.txt', false)).toBe(true);
    expect(isIgnored(matcher, 'logs/private', true)).toBe(true);
    expect(isIgnored(matcher, 'other/private', true)).toBe(false);
  });

  test('preserves significant whitespace in nested patterns', async () => {
    await write('sub/.gitignore', ' leading.ts\ntrailing\\ \n');
    const matcher = createIgnoreMatcher();

    await addIgnoreRules(matcher, tmpDir.path, '');
    await addIgnoreRules(matcher, path.join(tmpDir.path, 'sub'), 'sub');

    expect(isIgnored(matcher, 'sub/ leading.ts', false)).toBe(true);
    expect(isIgnored(matcher, 'sub/leading.ts', false)).toBe(false);
    expect(isIgnored(matcher, 'sub/trailing ', false)).toBe(true);
    expect(isIgnored(matcher, 'sub/trailing', false)).toBe(false);
  });

  test('loads info/exclude before the root gitignore', async () => {
    await write('.git/info/exclude', 'fixture.ts\nlocal-only.ts\n');
    await write('.gitignore', '!fixture.ts\n');
    const matcher = createIgnoreMatcher();

    await addIgnoreRules(matcher, tmpDir.path, '');

    expect(isIgnored(matcher, 'fixture.ts', false)).toBe(false);
    expect(isIgnored(matcher, 'local-only.ts', false)).toBe(true);
  });

  test('can deliberately load only gitignore files', async () => {
    await write('.git/info/exclude', 'local-only.ts\n');
    await write('.gitignore', 'generated.ts\n');
    const matcher = createIgnoreMatcher();

    await addIgnoreRules(matcher, tmpDir.path, '', {
      includeInfoExclude: false,
    });

    expect(isIgnored(matcher, 'local-only.ts', false)).toBe(false);
    expect(isIgnored(matcher, 'generated.ts', false)).toBe(true);
  });

  test('follows a git file and commondir in a linked worktree', async () => {
    await write('.git-data/info/exclude', 'local-only.ts\n');
    await write('.git-data/worktrees/linked/commondir', '../..\n');
    await write('.git', 'gitdir: .git-data/worktrees/linked\n');
    const matcher = createIgnoreMatcher();

    await addIgnoreRules(matcher, tmpDir.path, '');

    expect(isIgnored(matcher, 'local-only.ts', false)).toBe(true);
  });

  test('uses the pointed-to git dir when there is no commondir', async () => {
    await write('git-data/modules/sub/info/exclude', 'local-only.ts\n');
    await write('.git', 'gitdir: git-data/modules/sub\n');
    const matcher = createIgnoreMatcher();

    await addIgnoreRules(matcher, tmpDir.path, '');

    expect(isIgnored(matcher, 'local-only.ts', false)).toBe(true);
  });

  test('falls back to gitignore when git metadata is absent or malformed', async () => {
    await write('.git', 'not a gitdir pointer\n');
    await write('.gitignore', 'generated.ts\n');
    const matcher = createIgnoreMatcher();

    await addIgnoreRules(matcher, tmpDir.path, '');

    expect(isIgnored(matcher, 'generated.ts', false)).toBe(true);
    expect(isIgnored(matcher, 'source.ts', false)).toBe(false);
  });
});
