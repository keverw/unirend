import { describe, expect, it, mock } from 'bun:test';
import { APIServer } from './api-server';
import { SSRServer } from './ssr-server';

describe('closeAllConnections()', () => {
  it('is a no-op before the server starts', () => {
    const server = new APIServer();

    expect(() => server.closeAllConnections()).not.toThrow();
  });

  it('is a no-op for SSR before the server starts', () => {
    const server = new SSRServer({
      mode: 'development',
      paths: {
        serverEntry: './src/entry-ssr.tsx',
        template: './index.html',
        viteConfig: './vite.config.ts',
      },
      options: {},
    });

    expect(() => server.closeAllConnections()).not.toThrow();
  });

  it('terminates Fastify WebSocket clients before closing raw HTTP connections', () => {
    const server = new APIServer({ enableWebSockets: true });
    const terminateClient = mock(() => {});
    const closeRawConnections = mock(() => {});

    (
      server as unknown as {
        _isListening: boolean;
        fastifyInstance: unknown;
      }
    )._isListening = true;
    (
      server as unknown as {
        _isListening: boolean;
        fastifyInstance: unknown;
      }
    ).fastifyInstance = {
      server: { closeAllConnections: closeRawConnections },
      websocketServer: {
        clients: new Set([{ terminate: terminateClient }]),
      },
    };

    server.closeAllConnections();

    expect(terminateClient).toHaveBeenCalledTimes(1);
    expect(closeRawConnections).toHaveBeenCalledTimes(1);
  });

  it('also terminates Vite HMR clients in SSR development mode', () => {
    const server = new SSRServer({
      mode: 'development',
      paths: {
        serverEntry: './src/entry-ssr.tsx',
        template: './index.html',
        viteConfig: './vite.config.ts',
      },
      options: { enableWebSockets: true },
    });
    const terminateFastifyClient = mock(() => {});
    const terminateHMRSocket = mock(() => {});
    const closeHMRServer = mock(() => Promise.resolve());
    const closeRawConnections = mock(() => {});

    (
      server as unknown as {
        _isListening: boolean;
        fastifyInstance: unknown;
        apps: Map<string, unknown>;
      }
    )._isListening = true;
    (
      server as unknown as {
        _isListening: boolean;
        fastifyInstance: unknown;
        apps: Map<string, unknown>;
      }
    ).fastifyInstance = {
      server: { closeAllConnections: closeRawConnections },
      websocketServer: {
        clients: new Set([{ terminate: terminateFastifyClient }]),
      },
    };
    (
      server as unknown as {
        _isListening: boolean;
        fastifyInstance: unknown;
        apps: Map<string, unknown>;
      }
    ).apps = new Map([
      [
        '__default__',
        {
          paths: {
            serverEntry: './src/entry-ssr.tsx',
            template: './index.html',
            viteConfig: './vite.config.ts',
          },
          clientFolderName: 'client',
          serverFolderName: 'server',
          viteDevServer: {
            ws: {
              clients: new Set([
                {
                  socket: {
                    terminate: terminateHMRSocket,
                  },
                },
              ]),
              close: closeHMRServer,
            },
          },
        },
      ],
    ]);

    server.closeAllConnections();

    expect(terminateFastifyClient).toHaveBeenCalledTimes(1);
    expect(terminateHMRSocket).toHaveBeenCalledTimes(1);
    expect(closeHMRServer).toHaveBeenCalledTimes(0);
    expect(closeRawConnections).toHaveBeenCalledTimes(1);
  });
});

describe('SSRServer.stop()', () => {
  it('marks the server stopped when Vite fully closes after pre-close warnings', async () => {
    const server = new SSRServer({
      mode: 'development',
      paths: {
        serverEntry: './src/entry-ssr.tsx',
        template: './index.html',
        viteConfig: './vite.config.ts',
      },
      options: { enableWebSockets: true },
    });
    const fastifyClose = mock(() => Promise.resolve());
    const watcherUnref = mock(() => {});
    const watcherClose = mock(() =>
      Promise.reject(new Error('watcher already closing')),
    );
    const wsClose = mock(() => Promise.reject(new Error('ws already closing')));
    const terminateHMRSocket = mock(() => {});
    const viteClose = mock(() => Promise.resolve());

    (
      server as unknown as {
        _isListening: boolean;
        fastifyInstance: unknown;
        apps: Map<string, unknown>;
      }
    )._isListening = true;
    (
      server as unknown as {
        _isListening: boolean;
        fastifyInstance: unknown;
        apps: Map<string, unknown>;
      }
    ).fastifyInstance = {
      close: fastifyClose,
    };

    const appConfig = {
      paths: {
        serverEntry: './src/entry-ssr.tsx',
        template: './index.html',
        viteConfig: './vite.config.ts',
      },
      clientFolderName: 'client',
      serverFolderName: 'server',
      viteDevServer: {
        watcher: {
          unref: watcherUnref,
          close: watcherClose,
        },
        ws: {
          clients: new Set([
            {
              socket: {
                terminate: terminateHMRSocket,
              },
            },
          ]),
          close: wsClose,
        },
        close: viteClose,
      },
    };

    (
      server as unknown as {
        _isListening: boolean;
        fastifyInstance: unknown;
        apps: Map<string, typeof appConfig>;
      }
    ).apps = new Map([['__default__', appConfig]]);

    await expect(server.stop()).resolves.toBeUndefined();

    expect(fastifyClose).toHaveBeenCalledTimes(1);
    expect(watcherUnref).toHaveBeenCalledTimes(1);
    expect(watcherClose).toHaveBeenCalledTimes(1);
    expect(wsClose).toHaveBeenCalledTimes(1);
    expect(terminateHMRSocket).toHaveBeenCalledTimes(1);
    expect(viteClose).toHaveBeenCalledTimes(1);
    expect(server.isListening()).toBe(false);
    expect(appConfig.viteDevServer).toBeUndefined();
  });
});
