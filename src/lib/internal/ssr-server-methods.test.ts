import { describe, it, expect } from 'bun:test';
import { serveSSRWithHMR, serveSSRBuilt } from '../ssr';
import type { SSRServer } from './ssr-server';

/**
 * Covers the SSRServer public methods that are not exercised by the
 * existing integration tests (which require a running Vite + Fastify stack):
 *   - registerHMRApp() validation paths
 *   - registerBuiltApp() validation paths
 *   - updateAccessLoggingConfig()
 *   - .api getter
 *   - .pageDataHandler getter
 *   - registerWebSocketHandler() throw path
 *
 * All tests work against un-started servers — no Vite, no file system,
 * no listen() call required.
 */

const FAKE_HMR_PATHS = {
  serverEntry: '/fake/EntrySSR.tsx',
  template: '/fake/index.html',
  viteConfig: '/fake/vite.config.ts',
};

const FAKE_BUILD_DIR = '/fake/build';

// ---------------------------------------------------------------------------
// registerHMRApp()
// ---------------------------------------------------------------------------

describe('SSRServer.registerHMRApp()', () => {
  it('throws on an empty app key', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => server.registerHMRApp('', FAKE_HMR_PATHS)).toThrow(
      /non-empty string/,
    );
  });

  it('throws on a whitespace-only app key', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => server.registerHMRApp('   ', FAKE_HMR_PATHS)).toThrow();
  });

  it('throws when called on a production (built) server', () => {
    const server = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() => server.registerHMRApp('marketing', FAKE_HMR_PATHS)).toThrow(
      /registerBuiltApp/,
    );
  });

  it('throws when using the reserved __default__ key', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => server.registerHMRApp('__default__', FAKE_HMR_PATHS)).toThrow(
      /__default__/,
    );
  });

  it('throws when app key contains a forward slash', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => server.registerHMRApp('my/app', FAKE_HMR_PATHS)).toThrow(
      /path separators/,
    );
  });

  it('throws when app key contains a backslash', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => server.registerHMRApp('my\\app', FAKE_HMR_PATHS)).toThrow(
      /path separators/,
    );
  });

  it('throws when the same key is registered twice', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    server.registerHMRApp('marketing', FAKE_HMR_PATHS);
    expect(() => server.registerHMRApp('marketing', FAKE_HMR_PATHS)).toThrow(
      /already registered/,
    );
  });

  it('succeeds when a valid unique key is provided', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() =>
      server.registerHMRApp('marketing', FAKE_HMR_PATHS),
    ).not.toThrow();
  });

  it('trims whitespace from the key before comparison', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    // "marketing" (no spaces) and "  marketing  " should map to the same key
    server.registerHMRApp('marketing', FAKE_HMR_PATHS);
    expect(() =>
      server.registerHMRApp('  marketing  ', FAKE_HMR_PATHS),
    ).toThrow(/already registered/);
  });

  it('accepts options without throwing', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() =>
      server.registerHMRApp('admin', FAKE_HMR_PATHS, {
        publicAppConfig: { api_endpoint: 'http://localhost:3001' },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// registerBuiltApp()
// ---------------------------------------------------------------------------

describe('SSRServer.registerBuiltApp()', () => {
  it('throws on an empty app key', () => {
    const server = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() => server.registerBuiltApp('', FAKE_BUILD_DIR)).toThrow(
      /non-empty string/,
    );
  });

  it('throws when called on a development (HMR) server', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => server.registerBuiltApp('marketing', FAKE_BUILD_DIR)).toThrow(
      /registerHMRApp/,
    );
  });

  it('throws when using the reserved __default__ key', () => {
    const server = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() =>
      server.registerBuiltApp('__default__', FAKE_BUILD_DIR),
    ).toThrow(/__default__/);
  });

  it('throws when app key contains a forward slash', () => {
    const server = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() => server.registerBuiltApp('my/app', FAKE_BUILD_DIR)).toThrow(
      /path separators/,
    );
  });

  it('throws when the same key is registered twice', () => {
    const server = serveSSRBuilt(FAKE_BUILD_DIR);
    server.registerBuiltApp('marketing', FAKE_BUILD_DIR);
    expect(() => server.registerBuiltApp('marketing', FAKE_BUILD_DIR)).toThrow(
      /already registered/,
    );
  });

  it('succeeds when a valid unique key is provided', () => {
    const server = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() =>
      server.registerBuiltApp('marketing', FAKE_BUILD_DIR),
    ).not.toThrow();
  });

  it('multiple distinct apps can be registered', () => {
    const server = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() => {
      server.registerBuiltApp('app-a', FAKE_BUILD_DIR);
      server.registerBuiltApp('app-b', FAKE_BUILD_DIR);
      server.registerBuiltApp('app-c', FAKE_BUILD_DIR);
    }).not.toThrow();
  });

  it('accepts options without throwing', () => {
    const server = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() =>
      server.registerBuiltApp('admin', FAKE_BUILD_DIR, {
        publicAppConfig: { theme: 'dark' },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateAccessLoggingConfig()
// ---------------------------------------------------------------------------

describe('SSRServer.updateAccessLoggingConfig()', () => {
  it('can be called on an HMR server without throwing', () => {
    const server: SSRServer = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() =>
      server.updateAccessLoggingConfig({ events: 'none' }),
    ).not.toThrow();
  });

  it('can be called on a built server without throwing', () => {
    const server: SSRServer = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() =>
      server.updateAccessLoggingConfig({ events: 'finish' }),
    ).not.toThrow();
  });

  it('accepts a partial update with just a template string', () => {
    const server: SSRServer = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() =>
      server.updateAccessLoggingConfig({
        responseTemplate: '{{method}} {{url}} {{statusCode}}',
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// .api getter
// ---------------------------------------------------------------------------

describe('SSRServer.api getter', () => {
  it('returns an object with HTTP-method helpers on an HMR server', () => {
    const server: SSRServer = serveSSRWithHMR(FAKE_HMR_PATHS);
    const api = server.api;
    expect(typeof api).toBe('object');
    expect(api).not.toBeNull();
    expect(typeof api.get).toBe('function');
    expect(typeof api.post).toBe('function');
  });

  it('returns an object on a built server', () => {
    const server: SSRServer = serveSSRBuilt(FAKE_BUILD_DIR);
    const api = server.api;
    expect(typeof api).toBe('object');
    expect(api).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// .pageDataHandler getter
// ---------------------------------------------------------------------------

describe('SSRServer.pageDataHandler getter', () => {
  it('returns an object with a register function on an HMR server', () => {
    const server: SSRServer = serveSSRWithHMR(FAKE_HMR_PATHS);
    const pdh = server.pageDataHandler;
    expect(typeof pdh).toBe('object');
    expect(pdh).not.toBeNull();
    expect(typeof pdh.register).toBe('function');
  });

  it('returns an object on a built server', () => {
    const server: SSRServer = serveSSRBuilt(FAKE_BUILD_DIR);
    const pdh = server.pageDataHandler;
    expect(typeof pdh).toBe('object');
    expect(pdh).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// registerWebSocketHandler() — throw path when WS is disabled
// ---------------------------------------------------------------------------

describe('SSRServer.registerWebSocketHandler()', () => {
  it('throws when WebSocket support is not enabled', () => {
    // Neither serveSSRWithHMR nor serveSSRBuilt enables WebSockets by default
    const server: SSRServer = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => {
      server.registerWebSocketHandler({ path: '/ws', handler: () => {} });
    }).toThrow(/WebSocket support is not enabled/);
  });

  it('error message mentions enableWebSockets on HMR server', () => {
    const server: SSRServer = serveSSRWithHMR(FAKE_HMR_PATHS);
    let caught: Error | undefined;
    try {
      server.registerWebSocketHandler({ path: '/ws', handler: () => {} });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain('enableWebSockets');
  });

  it('throws when WebSocket support is not enabled on a built server', () => {
    const server: SSRServer = serveSSRBuilt(FAKE_BUILD_DIR);
    expect(() => {
      server.registerWebSocketHandler({ path: '/ws', handler: () => {} });
    }).toThrow(/WebSocket support is not enabled/);
  });
});
