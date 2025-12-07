import { describe, it, expect, mock } from 'bun:test';
import {
  staticContent,
  type StaticContentRouterOptions,
} from './staticContent';
import type { PluginHostInstance, PluginOptions } from '../types';

interface MockPluginHost extends PluginHostInstance {
  _hooks?: Array<{ name: string; handler: unknown }>;
  _decorations?: Record<string, unknown>;
}

const createMockPluginHost = (): MockPluginHost => {
  const host: Partial<MockPluginHost> = {};

  host.register = mock(() => Promise.resolve());
  host.decorate = mock((property: string, value: unknown) => {
    const decorations =
      (host as MockPluginHost)._decorations ||
      (Object.create(null) as Record<string, unknown>);
    decorations[property] = value;
    (host as MockPluginHost)._decorations = decorations;
  });

  host.addHook = mock((name: string, handler: unknown) => {
    const hooks = (host as MockPluginHost)._hooks || [];
    hooks.push({ name, handler });
    (host as MockPluginHost)._hooks = hooks;
  });

  host.getDecoration = (<T = unknown>(property: string): T | undefined => {
    const decorations = (host as MockPluginHost)._decorations;
    return decorations?.[property] as T | undefined;
  }) as typeof host.getDecoration;

  host.hasDecoration = mock((property: string) => {
    const decorations = (host as MockPluginHost)._decorations;
    return decorations ? property in decorations : false;
  });

  host.decorateRequest = mock(() => {});
  host.decorateReply = mock(() => {});
  host.route = mock(() => {});
  host.get = mock(() => {});
  host.post = mock(() => {});
  host.put = mock(() => {});
  host.delete = mock(() => {});
  host.patch = mock(() => {});

  return host as MockPluginHost;
};

const createMockOptions = (
  overrides: Partial<PluginOptions> = {},
): PluginOptions => ({
  serverType: 'ssr',
  mode: 'production',
  isDevelopment: false,
  apiEndpoints: { apiEndpointPrefix: '/api' },
  ...overrides,
});

describe('staticContent plugin', () => {
  it('registers onRequest hook and returns unique metadata', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();
    const config: StaticContentRouterOptions = {
      folderMap: { '/static': './static' },
    };

    const plugin = staticContent(config);
    const meta = await plugin(host, options);

    // Should return metadata with unique name
    expect(meta).toBeDefined();
    expect(meta?.name).toBeDefined();
    expect(meta?.name).toMatch(/^static-content-\d+-[a-z0-9]+$/);

    // Should register onRequest hook
    expect(host.addHook).toHaveBeenCalledTimes(1);
    const hooks = host._hooks;
    expect(hooks).toBeDefined();
    expect(hooks?.[0].name).toBe('onRequest');
    expect(typeof hooks?.[0].handler).toBe('function');
  });

  it('retrieves logger from plugin host when available', async () => {
    const host = createMockPluginHost();
    const mockLogger = { warn: mock(() => {}) };

    host.getDecoration = mock((property: string) => {
      if (property === 'log') {
        return mockLogger;
      }
      return undefined;
    }) as typeof host.getDecoration;

    const options = createMockOptions();
    const config: StaticContentRouterOptions = {
      folderMap: { '/static': './static' },
    };

    const plugin = staticContent(config);
    await plugin(host, options);

    expect(host.getDecoration).toHaveBeenCalledWith('log');
  });

  it('works when logger is not available', async () => {
    const host = createMockPluginHost();
    host.getDecoration = mock(() => undefined) as typeof host.getDecoration;

    const options = createMockOptions();
    const config: StaticContentRouterOptions = {
      folderMap: { '/static': './static' },
    };

    const plugin = staticContent(config);
    await plugin(host, options);

    expect(host.addHook).toHaveBeenCalledTimes(1);
  });

  it('creates independent instances with unique IDs', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();

    const plugin1 = staticContent({ folderMap: { '/uploads': './uploads' } });
    const meta1 = await plugin1(host, options);

    const plugin2 = staticContent({ folderMap: { '/static': './static' } });
    const meta2 = await plugin2(host, options);

    // Each instance should have unique name
    expect(meta1?.name).not.toBe(meta2?.name);

    // Should register two separate hooks
    expect(host.addHook).toHaveBeenCalledTimes(2);
  });

  it('supports custom plugin names', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();

    const plugin = staticContent(
      { folderMap: { '/uploads': './uploads' } },
      'uploads-handler',
    );
    const meta = await plugin(host, options);

    expect(meta?.name).toBe('uploads-handler');
  });

  it('validates custom names are non-empty strings', () => {
    expect(() =>
      staticContent({ folderMap: { '/static': './static' } }, ''),
    ).toThrow(
      'staticContent plugin name must be a non-empty string if provided',
    );

    expect(() =>
      staticContent({ folderMap: { '/static': './static' } }, '   '),
    ).toThrow(
      'staticContent plugin name must be a non-empty string if provided',
    );
  });
});
