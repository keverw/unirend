import { describe, it, expect, mock } from 'bun:test';
import { cookies } from './cookies';
import type { CookiesConfig } from './cookies';
import type { PluginHostInstance, PluginOptions } from '../types';

interface MockPluginHost extends PluginHostInstance {
  _lastRegistered?: { plugin: unknown; opts?: Record<string, unknown> };
  _decorations?: Record<string, unknown>;
}

const createMockPluginHost = (): MockPluginHost => {
  const host: Partial<MockPluginHost> = {};

  host.register = mock(
    (plugin: unknown, opts?: Record<string, unknown>): Promise<void> => {
      (host as MockPluginHost)._lastRegistered = { plugin, opts };
      return Promise.resolve();
    },
  );

  host.decorate = mock((property: string, value: unknown) => {
    const decorations =
      (host as MockPluginHost)._decorations ||
      (Object.create(null) as Record<string, unknown>);
    decorations[property] = value;
    (host as MockPluginHost)._decorations = decorations;
  });
  host.addHook = mock(() => {});
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

describe('cookies plugin', () => {
  it('registers @fastify/cookie with provided options', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();
    const config: CookiesConfig = {
      // cspell:disable-next-line
      secret: 'shhh',
      hook: 'preHandler',
      parseOptions: { path: '/', sameSite: 'lax', signed: true },
    } as CookiesConfig;

    const plugin = cookies(config);
    const meta = await plugin(host, options);

    // Metadata
    expect(meta).toEqual({ name: 'cookies' });

    // Registration invoked
    expect(host.register).toHaveBeenCalledTimes(1);
    const last = host._lastRegistered;
    expect(last).toBeDefined();
    expect(typeof last?.plugin).toBe('function');
    expect(last?.opts).toEqual(config as Record<string, unknown>);
  });

  it('decorates cookiePluginInfo when secret present (with custom algorithm)', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();
    const config: CookiesConfig = {
      secret: ['k2', 'k1'],
    } as CookiesConfig;

    // Inject non-standard algorithm field our plugin reads for decoration
    (config as unknown as { algorithm?: string }).algorithm = 'sha512';

    const plugin = cookies(config);
    await plugin(host, options);

    const info = host._decorations?.cookiePluginInfo as
      | { signingSecretProvided: boolean; algorithm: string }
      | undefined;

    expect(info).toBeDefined();
    expect(info?.signingSecretProvided).toBe(true);
    expect(info?.algorithm).toBe('sha512');
  });

  it('decorates cookiePluginInfo with default algorithm and no secret', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();
    const config: CookiesConfig = {};

    const plugin = cookies(config);
    await plugin(host, options);

    const info = host._decorations?.cookiePluginInfo as
      | { signingSecretProvided: boolean; algorithm: string }
      | undefined;

    expect(info).toBeDefined();
    expect(info?.signingSecretProvided).toBe(false);
    expect(info?.algorithm).toBe('sha256');
  });
});
