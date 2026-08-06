import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateSSG } from './ssg';
import { hashInlineContentForCSP } from './internal/csp-hash';
import { UNIREND_BOOTSTRAP_SCRIPT_HASH } from './internal/html-utils/context-data-block';

/**
 * A build directory with the least in it that `generateSSG` will accept: a
 * server manifest naming an entry, the entry itself, and a client template.
 *
 * Most pages here are the `html` type, which writes its content verbatim, so a
 * test can name the exact bytes it expects to see hashed. The `spa` type earns
 * its place by going through `injectContent`, which is what puts unirend's own
 * data block and bootstrap script on the page. A full React render would drag
 * in a built entry module and say nothing further about hashing.
 */
async function createBuildDir(template: string): Promise<string> {
  const buildDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unirend-ssg-'));

  await fs.mkdir(path.join(buildDir, 'server', '.vite'), { recursive: true });
  await fs.mkdir(path.join(buildDir, 'client'), { recursive: true });

  await fs.writeFile(
    path.join(buildDir, 'server', '.vite', 'manifest.json'),
    JSON.stringify({ 'src/EntrySSG.tsx': { file: 'EntrySSG.js' } }),
  );

  // Imported up front, before any page is generated, so it has to exist even
  // for page types that never render through it.
  await fs.writeFile(
    path.join(buildDir, 'server', 'EntrySSG.js'),
    'export function render() { return { html: "", statusCode: 200 }; }\n',
  );

  await fs.writeFile(path.join(buildDir, 'client', 'index.html'), template);

  return buildDir;
}

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Test</title>
    <!--ss-head-->
  </head>
  <body>
    <div id="root"><!--ss-outlet--></div>
  </body>
</html>`;

describe('generateSSG CSP hashes', () => {
  let buildDir: string;

  beforeEach(async () => {
    buildDir = await createBuildDir(TEMPLATE);
  });

  afterEach(async () => {
    await fs.rm(buildDir, { recursive: true, force: true });
  });

  it('hashes the inline blocks of every page it writes', async () => {
    // The whole reason this happens at generation time: once this returns, the
    // site is a directory of files with no template left to hash, and whatever
    // serves it may not be unirend at all.
    const themeScript = `document.documentElement.className='dark';`;
    const pageStyle = `body{margin:0}`;

    const report = await generateSSG(buildDir, [
      {
        type: 'html',
        path: '/',
        filename: 'index.html',
        html: `<!doctype html><html><head><script>${themeScript}</script><style>${pageStyle}</style></head><body></body></html>`,
      },
    ]);

    expect(report.generationFailed).toBe(false);
    expect(report.cspHashes.scriptSrc).toContain(
      `'${hashInlineContentForCSP(themeScript)}'`,
    );
    expect(report.cspHashes.styleSrc).toContain(
      `'${hashInlineContentForCSP(pageStyle)}'`,
    );
  });

  it('deduplicates across pages that share their inline content', async () => {
    // Every page of a site carries the same template blocks, so a list with one
    // entry per page would be a policy nobody could read.
    const shared = `console.log('shared');`;

    const page = (filename: string, urlPath: string) =>
      ({
        type: 'html' as const,
        path: urlPath,
        filename,
        html: `<!doctype html><html><head><script>${shared}</script></head><body></body></html>`,
      }) satisfies Parameters<typeof generateSSG>[1][number];

    const report = await generateSSG(buildDir, [
      page('index.html', '/'),
      page('about.html', '/about'),
      page('contact.html', '/contact'),
    ]);

    expect(report.generationFailed).toBe(false);
    expect(report.pagesReport.successCount).toBe(3);
    expect(report.cspHashes.scriptSrc).toEqual([
      `'${hashInlineContentForCSP(shared)}'`,
    ]);
  });

  it('reports inline attributes with the hash each would need', async () => {
    // A plain hash source never matches an attribute, so these are reported
    // rather than added: covering one takes 'unsafe-hashes' as well, which is
    // the caller's decision.
    const handler = `alert(1)`;

    const report = await generateSSG(buildDir, [
      {
        type: 'html',
        path: '/',
        filename: 'index.html',
        html: `<!doctype html><html><body><button onclick="${handler}">go</button></body></html>`,
      },
    ]);

    expect(report.cspHashes.inlineAttributes).toEqual([
      {
        description: '<button> has onclick=',
        kind: 'script',
        hash: `'${hashInlineContentForCSP(handler)}'`,
      },
    ]);
  });

  it('is empty when generation failed before any page was written', async () => {
    // Nothing reached disk, so there is nothing to write a policy for. An
    // absent field would be worse than an empty one: a caller spreading it into
    // a directive should not have to guard.
    const report = await generateSSG(path.join(buildDir, 'does-not-exist'), [
      {
        type: 'html',
        path: '/',
        filename: 'index.html',
        html: '<html></html>',
      },
    ]);

    expect(report.generationFailed).toBe(true);
    expect(report.cspHashes).toEqual({
      scriptSrc: [],
      styleSrc: [],
      inlineAttributes: [],
    });
  });

  it('covers a noscript style, which a scripting parser hides', async () => {
    // A parser with scripting enabled treats <noscript> contents as raw text,
    // so a selector sees nothing in there. A browser with JavaScript disabled
    // parses the same bytes as real markup, which is exactly when the fallback
    // matters and exactly when nobody is watching it break.
    const fallbackStyle = `.spa-only{display:none}`;

    const report = await generateSSG(buildDir, [
      {
        type: 'html',
        path: '/',
        filename: 'index.html',
        html: `<!doctype html><html><body><noscript><style>${fallbackStyle}</style></noscript></body></html>`,
      },
    ]);

    expect(report.cspHashes.styleSrc).toContain(
      `'${hashInlineContentForCSP(fallbackStyle)}'`,
    );
  });

  it("covers unirend's own bootstrap on a rendered page", async () => {
    // A `spa` page goes through injectContent, so it carries the data block and
    // the bootstrap script that reads it. Those are unirend's bytes rather than
    // the author's, and a policy built from this report has to cover them too
    // or the page ships with its injected globals blocked.
    const report = await generateSSG(buildDir, [
      { type: 'spa', path: '/app', filename: 'app.html' },
    ]);

    expect(report.generationFailed).toBe(false);
    expect(report.cspHashes.scriptSrc).toContain(
      `'${UNIREND_BOOTSTRAP_SCRIPT_HASH}'`,
    );
  });
});
