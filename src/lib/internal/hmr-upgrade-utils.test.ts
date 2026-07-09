import { describe, it, expect } from 'bun:test';
import {
  hmrPathForApp,
  isViteHMRUpgrade,
  upgradeRequestPathname,
} from './hmr-upgrade-utils';

// These helpers back the shared-server HMR wiring: each app's Vite HMR socket
// lives at a unique path on the main HTTP server, and when application
// WebSockets are also enabled an upgrade dispatcher uses isViteHMRUpgrade() to
// split Vite HMR traffic from application WebSocket traffic on that one port.

describe('hmrPathForApp()', () => {
  it('builds the conventional per-app HMR path', () => {
    expect(hmrPathForApp('__default__')).toBe('/__hmr/__default__');
    expect(hmrPathForApp('app-b')).toBe('/__hmr/app-b');
  });

  it('gives distinct paths to distinct apps (the port replacement)', () => {
    expect(hmrPathForApp('marketing')).not.toBe(hmrPathForApp('dashboard'));
  });

  it('URL-encodes keys so arbitrary app keys stay safe and consistent', () => {
    // The server listener and the injected client both derive the path this
    // way, so any character that needs escaping stays consistent between them.
    expect(hmrPathForApp('a b')).toBe('/__hmr/a%20b');
    expect(hmrPathForApp('a/b')).toBe('/__hmr/a%2Fb');
    expect(hmrPathForApp('café')).toBe('/__hmr/caf%C3%A9');
  });
});

describe('upgradeRequestPathname()', () => {
  it('extracts the pathname and ignores the query string', () => {
    expect(upgradeRequestPathname('/__hmr/app-b?token=abc')).toBe(
      '/__hmr/app-b',
    );
    expect(upgradeRequestPathname('/ws/echo')).toBe('/ws/echo');
  });

  it('returns null for a missing or unparseable URL', () => {
    expect(upgradeRequestPathname(undefined)).toBeNull();
    expect(upgradeRequestPathname('')).toBeNull();
  });
});

describe('isViteHMRUpgrade()', () => {
  const hmrPaths = new Set(['/__hmr/__default__', '/__hmr/app-b']);

  it('claims Vite subprotocols only when the path is a configured HMR path', () => {
    expect(isViteHMRUpgrade('vite-hmr', '/__hmr/__default__', hmrPaths)).toBe(
      true,
    );
    expect(isViteHMRUpgrade('vite-ping', '/__hmr/app-b', hmrPaths)).toBe(true);
    // Query string (Vite appends a token) must not defeat the path match.
    expect(
      isViteHMRUpgrade('vite-hmr', '/__hmr/app-b?token=xyz', hmrPaths),
    ).toBe(true);
  });

  it('does NOT swallow a Vite subprotocol aimed at a non-HMR path', () => {
    // Regression: a request that reuses the vite-hmr subprotocol but targets an
    // application route must still fall through to @fastify/websocket rather
    // than being dropped (Vite would not claim it either).
    expect(isViteHMRUpgrade('vite-hmr', '/ws/echo', hmrPaths)).toBe(false);
    expect(isViteHMRUpgrade('vite-hmr', '/__hmr/unknown', hmrPaths)).toBe(
      false,
    );
    expect(isViteHMRUpgrade('vite-hmr', undefined, hmrPaths)).toBe(false);
  });

  it('routes application and unknown subprotocols to the app handlers', () => {
    expect(isViteHMRUpgrade('chat', '/__hmr/__default__', hmrPaths)).toBe(
      false,
    );
    expect(isViteHMRUpgrade('', '/__hmr/__default__', hmrPaths)).toBe(false);
    expect(isViteHMRUpgrade(undefined, '/__hmr/__default__', hmrPaths)).toBe(
      false,
    );
  });

  it('treats a multi-value protocol header as non-Vite (exact match only)', () => {
    // Mirrors Vite's own exact-string check; an array of offered subprotocols
    // is not a Vite HMR socket, so it is forwarded to the app handlers.
    expect(
      isViteHMRUpgrade(
        ['vite-hmr', 'chat'] as unknown as string,
        '/__hmr/__default__',
        hmrPaths,
      ),
    ).toBe(false);
  });
});
