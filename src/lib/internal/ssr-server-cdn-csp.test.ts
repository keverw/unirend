import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import getPort from 'get-port';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { serveSSRBuilt } from '../ssr';
import { securityHeaders } from '../built-in-plugins/security-headers';
import { hashInlineContentForCSP } from './csp-hash';
import type { SSRServer } from './ssr-server';
import type { ServerPlugin } from '../types';
import type { FastifyRequest } from 'fastify';

/**
 * The CDN placeholder inside a template's inline `<style>`, end to end through a
 * real production SSR server.
 *
 * Every piece of this is unit tested elsewhere. What is only testable here is
 * that the pieces are wired to each other: `processTemplate` holds the block
 * back at startup, the hashes are cached, `resolveTemplateCSPHashes` settles
 * them against *this* request's CDN, `addCSPSources` carries them, and the
 * `onSend` backstop folds them into the header that actually goes out. A break
 * anywhere along that chain is silent, because the page still renders and only
 * a browser enforcing the policy would notice.
 *
 * Production rather than development, since production is where the interesting
 * failure lives: the hashes come from a cache computed once at startup, and the
 * whole question is whether a per-request value can still reach them. The
 * development path re-hashes per request and differs only in where the input
 * comes from. Standing up a real Vite dev server here would cost far more than
 * it would prove.
 */

const TEMPLATE_STYLE = '.hero{background:url(__CDN__INJECTION__POINT__/h.png)}';

/** The inline `<style>` blocks of a served page, in document order. */
function inlineStyles(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
    (match) => match[1],
  );
}

/** A quoted CSP source expression for a block of inline style text. */
function styleSource(content: string): string {
  return `'${hashInlineContentForCSP(content)}'`;
}

/**
 * Write a minimal but genuine production build: a client template, a server
 * entry that renders, and the two Vite manifests the loader reads.
 */
async function writeBuild(buildDir: string): Promise<void> {
  const clientDir = join(buildDir, 'client');
  const serverDir = join(buildDir, 'server');

  await mkdir(join(clientDir, '.vite'), { recursive: true });
  await mkdir(join(serverDir, '.vite'), { recursive: true });
  await mkdir(join(serverDir, 'assets'), { recursive: true });

  await writeFile(
    join(clientDir, 'index.html'),
    `<!DOCTYPE html>
<html>
  <head>
    <!--ss-head-->
    <!--context-scripts-injection-point-->
    <style>${TEMPLATE_STYLE}</style>
  </head>
  <body>
    <div id="root"><!--ss-outlet--></div>
  </body>
</html>`,
  );

  await writeFile(
    join(clientDir, '.vite', 'manifest.json'),
    JSON.stringify({
      'index.html': { file: 'assets/index.js', isEntry: true },
    }),
  );

  await writeFile(
    join(serverDir, 'assets', 'EntrySSR.js'),
    `export async function render() {
      return { resultType: 'page', html: '<p>rendered</p>' };
    }`,
  );

  await writeFile(
    join(serverDir, '.vite', 'manifest.json'),
    JSON.stringify({ 'EntrySSR.tsx': { file: 'assets/EntrySSR.js' } }),
  );
}

/**
 * Lets each request pick its own CDN, which is the shape the feature exists
 * for: one processed template serving several CDNs, decided per request rather
 * than at startup.
 */
const cdnPerRequest: ServerPlugin<'ssr'> = (pluginHost) => {
  pluginHost.addHook('onRequest', (request: FastifyRequest) => {
    const wanted = request.headers['x-cdn'];

    if (typeof wanted === 'string') {
      request.CDNBaseURL = wanted;
    }

    return Promise.resolve();
  });
};

describe('SSR CDN placeholder in a template style, under a CSP', () => {
  let tmpDir: TmpDir;
  let server: SSRServer;
  let port: number;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'ssr-cdn-csp-test-',
      unsafeCleanup: true,
    });

    await writeBuild(tmpDir.path);

    server = serveSSRBuilt(tmpDir.path, {
      plugins: [
        securityHeaders({
          csp: { defaultSrc: ["'self'"], styleSrc: ["'self'"] },
        }),
        cdnPerRequest,
      ],
    });

    port = await getPort();
    await server.listen(port, '127.0.0.1');
  });

  afterEach(async () => {
    await server.stop();
    await tmpDir.cleanup();
  });

  async function get(cdn?: string) {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: cdn === undefined ? {} : { 'x-cdn': cdn },
    });

    const html = await response.text();

    return {
      html,
      csp: response.headers.get('content-security-policy') ?? '',
    };
  }

  it('sends a hash covering the style this request actually served', async () => {
    const { html, csp } = await get('https://eu.example.com');

    expect(html).toContain('url(https://eu.example.com/h.png)');

    // Taken from the bytes that came back over the wire, so this asserts the
    // policy against the response rather than against another copy of the
    // pipeline's own reasoning.
    const served = inlineStyles(html).find((style) => style.includes('h.png'));

    expect(served).toBeDefined();
    expect(csp).toContain(styleSource(served as string));
  });

  it('sends a different hash to a request naming a different CDN', async () => {
    // The reason this cannot be hashed once at startup. Both responses come off
    // the same processed template and the same cached hash list.
    const eu = await get('https://eu.example.com');
    const apac = await get('https://apac.example.com');

    const euStyle = inlineStyles(eu.html).find((s) => s.includes('h.png'));
    const apacStyle = inlineStyles(apac.html).find((s) => s.includes('h.png'));

    expect(euStyle).not.toBe(apacStyle);
    expect(eu.csp).toContain(styleSource(euStyle as string));
    expect(apac.csp).toContain(styleSource(apacStyle as string));

    // And neither carries the other's, which is what would happen if the value
    // were resolved once and reused.
    expect(eu.csp).not.toContain(styleSource(apacStyle as string));
    expect(apac.csp).not.toContain(styleSource(euStyle as string));
  });

  it('covers the root-relative form when no CDN is configured', async () => {
    // The placeholder resolves to nothing, leaving the original path, and the
    // hash has to follow it there too.
    const { html, csp } = await get();

    expect(html).toContain('url(/h.png)');

    const served = inlineStyles(html).find((style) => style.includes('h.png'));

    expect(csp).toContain(styleSource(served as string));
  });

  it('never leaves the unresolved placeholder in a hash or the page', async () => {
    // The failure this whole path exists to prevent: hashing the template as
    // written and shipping something else.
    const { html, csp } = await get('https://eu.example.com');

    expect(html).not.toContain('__CDN__INJECTION__POINT__');
    expect(csp).not.toContain(styleSource(TEMPLATE_STYLE));
  });
});
