import { describe, expect, test } from 'bun:test';
import {
  buildAppEnvVarName,
  isRepoDirEmptyish,
  isReadmeEntry,
  isLicenseEntry,
  isDirEmpty,
  appendMissingIgnoreEntries,
} from './internal-utils';
import type { InMemoryDir } from './vfs';

describe('buildAppEnvVarName', () => {
  test('converts project names to uppercase and appends the suffix', () => {
    expect(buildAppEnvVarName('my-app', 'PORT')).toBe('MY_APP_PORT');
  });

  test('normalizes kebab-case separators to underscores', () => {
    expect(buildAppEnvVarName('my-api-app-v2', 'PORT')).toBe(
      'MY_API_APP_V2_PORT',
    );
  });

  test('preserves numbers after the leading letter', () => {
    expect(buildAppEnvVarName('app1', 'PORT')).toBe('APP1_PORT');
  });
});

describe('isRepoDirEmptyish', () => {
  test('returns safe: true for empty directory', async () => {
    const root: InMemoryDir = {};
    const res = await isRepoDirEmptyish(root);
    expect(res).toEqual({ safe: true });
  });

  test('returns safe: true for directory with only .git', async () => {
    const root: InMemoryDir = {
      '.git': '',
    };
    const res = await isRepoDirEmptyish(root);
    expect(res).toEqual({ safe: true });
  });

  test('returns safe: true for directory with only .gitignore', async () => {
    const root: InMemoryDir = {
      '.gitignore': '',
    };
    const res = await isRepoDirEmptyish(root);
    expect(res).toEqual({ safe: true });
  });

  test('returns safe: true for directory with both .git and .gitignore', async () => {
    const root: InMemoryDir = {
      '.git': '',
      '.gitignore': '',
    };
    const res = await isRepoDirEmptyish(root);
    expect(res).toEqual({ safe: true });
  });

  test('returns safe: false for directory with other files', async () => {
    const root: InMemoryDir = {
      'package.json': '{}',
    };
    const res = await isRepoDirEmptyish(root);
    expect(res).toEqual({
      safe: false,
      reason:
        'Directory is not empty and not a unirend repository. Found: package.json',
    });
  });

  test('ignores OS/cloud junk files (case-insensitive) when deciding emptiness', async () => {
    const root: InMemoryDir = {
      '.DS_Store': '',
      '._hidden': '',
      'Thumbs.db': '',
      'desktop.ini': '',
      '.dropbox.attr': '',
      '.gitattributes': '',
    };
    const res = await isRepoDirEmptyish(root);
    expect(res).toEqual({ safe: true });
  });

  test('initializes with only .DS_Store + README.md, surfacing the README and not the junk', async () => {
    const root: InMemoryDir = {
      '.DS_Store': '',
      'README.md': '# Hello',
    };
    const res = await isRepoDirEmptyish(root);
    expect(res).toEqual({ safe: true, notices: ['README.md'] });
    expect(res.notices).not.toContain('.DS_Store');
  });

  test('aborts on stray content while still surfacing notices and hiding junk', async () => {
    const root: InMemoryDir = {
      '.DS_Store': '',
      'README.md': '# Hello',
      'foo.ts': '',
    };
    const res = await isRepoDirEmptyish(root);
    expect(res.safe).toBe(false);
    expect(res.reason).toBe(
      'Directory is not empty and not a unirend repository. Found: foo.ts',
    );
    expect(res.reason).not.toContain('.DS_Store');
    expect(res.reason).not.toContain('README.md');
    expect(res.notices).toEqual(['README.md']);
  });

  test('truncates list of non-git entries in error message if > 5', async () => {
    const root: InMemoryDir = {
      'file1.txt': '',
      'file2.txt': '',
      'file3.txt': '',
      'file4.txt': '',
      'file5.txt': '',
      'file6.txt': '',
    };
    const res = await isRepoDirEmptyish(root);
    expect(res.safe).toBe(false);
    expect(res.reason).toContain(
      'Found: file1.txt, file2.txt, file3.txt, file4.txt, file5.txt...',
    );
  });
});

describe('isReadmeEntry', () => {
  test('matches README.md case-insensitively', () => {
    expect(isReadmeEntry('README.md')).toBe(true);
    expect(isReadmeEntry('readme.md')).toBe(true);
    expect(isReadmeEntry('ReadMe.MD')).toBe(true);
  });

  test('does not match non-README entries', () => {
    expect(isReadmeEntry('README')).toBe(false);
    expect(isReadmeEntry('README.txt')).toBe(false);
    expect(isReadmeEntry('CONTRIBUTING.md')).toBe(false);
  });
});

describe('isLicenseEntry', () => {
  test('matches LICENSE and its .md/.txt variants case-insensitively', () => {
    expect(isLicenseEntry('LICENSE')).toBe(true);
    expect(isLicenseEntry('license')).toBe(true);
    expect(isLicenseEntry('LICENSE.md')).toBe(true);
    expect(isLicenseEntry('license.txt')).toBe(true);
  });

  test('does not match non-LICENSE entries', () => {
    expect(isLicenseEntry('LICENSE.rst')).toBe(false);
    expect(isLicenseEntry('LICENSES')).toBe(false);
    expect(isLicenseEntry('COPYING')).toBe(false);
  });
});

describe('isDirEmpty', () => {
  test('returns true for completely empty directory', async () => {
    const root: InMemoryDir = {};
    const isEmpty = await isDirEmpty(root);
    expect(isEmpty).toBe(true);
  });

  test('returns false when files exist', async () => {
    const root: InMemoryDir = {
      'file.txt': '',
    };
    const isEmpty = await isDirEmpty(root);
    expect(isEmpty).toBe(false);
  });

  test('returns true when only excluded files exist', async () => {
    const root: InMemoryDir = {
      '.gitkeep': '',
    };
    const isEmpty = await isDirEmpty(root, '', ['.gitkeep']);
    expect(isEmpty).toBe(true);
  });

  test('returns false when mixed files exist with excludes', async () => {
    const root: InMemoryDir = {
      '.gitkeep': '',
      'other.txt': '',
    };
    const isEmpty = await isDirEmpty(root, '', ['.gitkeep']);
    expect(isEmpty).toBe(false);
  });

  test('checks subdirectories correctly', async () => {
    const root: InMemoryDir = {
      'subdir/file.txt': '',
    };
    expect(await isDirEmpty(root, 'subdir')).toBe(false);
    expect(await isDirEmpty(root, 'other')).toBe(true);
  });
});

describe('appendMissingIgnoreEntries', () => {
  test('returns existing string if entries array is empty', () => {
    const existing = 'node_modules\n';
    expect(appendMissingIgnoreEntries(existing, '# Test', [])).toBe(existing);
  });

  test('returns existing string if all entries already exist in the file', () => {
    const existing = 'node_modules\n.env\n';
    expect(
      appendMissingIgnoreEntries(existing, '# Test', ['.env', 'node_modules']),
    ).toBe(existing);
  });

  test('appends section header and entries to empty file', () => {
    const existing = '';
    const header = '# Test';
    const entries = ['foo', 'bar'];
    const res = appendMissingIgnoreEntries(existing, header, entries);
    expect(res).toBe('# Test\nfoo\nbar');
  });

  test('appends section header and entries to non-empty file when section does not exist', () => {
    const existing = 'node_modules\n.env';
    const header = '# Test';
    const entries = ['foo', 'bar'];
    const res = appendMissingIgnoreEntries(existing, header, entries);
    expect(res).toBe('node_modules\n.env\n\n# Test\nfoo\nbar');
  });

  test('inserts entries inside existing section', () => {
    const existing = '# Test\nfoo\n\n# Other\nxyz';
    const header = '# Test';
    const entries = ['foo', 'bar'];
    const res = appendMissingIgnoreEntries(existing, header, entries);
    expect(res).toBe('# Test\nfoo\nbar\n\n# Other\nxyz');
  });

  test('inserts entries inside existing section and adds visual separator if next line starts with #', () => {
    const existing = '# Test\nfoo\n# Other\nxyz';
    const header = '# Test';
    const entries = ['bar'];
    const res = appendMissingIgnoreEntries(existing, header, entries);
    expect(res).toBe('# Test\nfoo\nbar\n\n# Other\nxyz');
  });

  test('works with CRLF line endings', () => {
    const existing = '# Test\r\nfoo\r\n\r\n# Other\r\nxyz';
    const header = '# Test';
    const entries = ['bar'];
    const res = appendMissingIgnoreEntries(existing, header, entries);
    expect(res.replace(/\r\n/g, '\n')).toBe('# Test\nfoo\nbar\n\n# Other\nxyz');
  });
});
