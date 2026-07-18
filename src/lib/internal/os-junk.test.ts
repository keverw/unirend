import { describe, it, expect } from 'bun:test';
import { isOSJunkBasename, isOSJunkPath, firstOSJunkSegment } from './os-junk';

describe('isOSJunkBasename()', () => {
  it('flags macOS metadata names', () => {
    expect(isOSJunkBasename('.DS_Store')).toBe(true);
    expect(isOSJunkBasename('.AppleDouble')).toBe(true);
    expect(isOSJunkBasename('.LSOverride')).toBe(true);
    expect(isOSJunkBasename('.Spotlight-V100')).toBe(true);
    expect(isOSJunkBasename('.Trashes')).toBe(true);
    expect(isOSJunkBasename('.fseventsd')).toBe(true);
    expect(isOSJunkBasename('Icon\r')).toBe(true);
  });

  it('flags Windows metadata names', () => {
    expect(isOSJunkBasename('Thumbs.db')).toBe(true);
    expect(isOSJunkBasename('ehthumbs.db')).toBe(true);
    expect(isOSJunkBasename('desktop.ini')).toBe(true);
  });

  it('flags Linux metadata names', () => {
    expect(isOSJunkBasename('.directory')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isOSJunkBasename('.ds_store')).toBe(true);
    expect(isOSJunkBasename('.DS_STORE')).toBe(true);
    expect(isOSJunkBasename('THUMBS.DB')).toBe(true);
    expect(isOSJunkBasename('DESKTOP.INI')).toBe(true);
  });

  it('flags macOS AppleDouble resource forks (._*)', () => {
    expect(isOSJunkBasename('._favicon.svg')).toBe(true);
    expect(isOSJunkBasename('._')).toBe(true);
    expect(isOSJunkBasename('._SomeFile')).toBe(true);
  });

  it('flags Linux trash directories (.Trash-*)', () => {
    expect(isOSJunkBasename('.Trash-1000')).toBe(true);
    expect(isOSJunkBasename('.trash-user')).toBe(true);
  });

  it('leaves normal application content untouched', () => {
    expect(isOSJunkBasename('favicon.svg')).toBe(false);
    expect(isOSJunkBasename('index.html')).toBe(false);
    expect(isOSJunkBasename('robots.txt')).toBe(false);
    expect(isOSJunkBasename('.gitignore')).toBe(false);
    expect(isOSJunkBasename('desktop.png')).toBe(false);
    expect(isOSJunkBasename('my.ds_store.txt')).toBe(false);
    expect(isOSJunkBasename('trash.txt')).toBe(false);
    expect(isOSJunkBasename('_underscore.js')).toBe(false);
  });
});

describe('isOSJunkPath()', () => {
  it('flags a junk basename', () => {
    expect(isOSJunkPath('/.DS_Store')).toBe(true);
    expect(isOSJunkPath('.DS_Store')).toBe(true);
    expect(isOSJunkPath('/sub/Thumbs.db')).toBe(true);
  });

  it('flags a junk directory segment even when the basename is clean', () => {
    // Several recognized names are directories, so a file inside one is junk
    // even though its own name is not.
    expect(isOSJunkPath('/assets/.AppleDouble/metadata')).toBe(true);
    expect(isOSJunkPath('/.Trashes/secret.txt')).toBe(true);
    expect(isOSJunkPath('/x/.Spotlight-V100/store.db')).toBe(true);
    expect(isOSJunkPath('/x/.fseventsd/0000000000')).toBe(true);
    expect(isOSJunkPath('.Trash-1000/deleted')).toBe(true);
  });

  it('matches segments case-insensitively', () => {
    expect(isOSJunkPath('/x/.APPLEDOUBLE/y')).toBe(true);
    expect(isOSJunkPath('/X/.trashes/Y')).toBe(true);
  });

  it('splits on either path separator (backslash resolves as a separator on Windows)', () => {
    expect(isOSJunkPath('/assets/.AppleDouble\\metadata')).toBe(true);
    expect(isOSJunkPath('x\\.Trashes\\y')).toBe(true);
    expect(firstOSJunkSegment('/assets/.AppleDouble\\metadata')).toBe(
      '.AppleDouble',
    );
  });

  it('ignores empty segments from leading or doubled slashes', () => {
    expect(isOSJunkPath('//.DS_Store')).toBe(true);
    expect(isOSJunkPath('/assets//logo.svg')).toBe(false);
  });

  it('leaves clean paths untouched, including junk-looking substrings', () => {
    expect(isOSJunkPath('/assets/logo.svg')).toBe(false);
    expect(isOSJunkPath('/.well-known/security.txt')).toBe(false);
    expect(isOSJunkPath('/trashes/index.html')).toBe(false); // no leading dot
    expect(isOSJunkPath('/my.ds_store.dir/file')).toBe(false);
    expect(isOSJunkPath('')).toBe(false);
  });
});
