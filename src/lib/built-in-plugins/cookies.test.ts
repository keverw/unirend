import { describe, it, expect, mock } from "bun:test";
import { cookies, type CookiesConfig } from "./cookies";
import type { PluginHostInstance, PluginOptions } from "../types";

const createMockPluginHost = () => {
  const host = {
    register: mock(
      async (
        plugin: unknown,
        opts?: Record<string, unknown>,
      ): Promise<void> => {
        (host as any)._lastRegistered = { plugin, opts };
      },
    ),
    decorate: mock((property: string, value: unknown) => {
      ((host as unknown as Record<string, unknown>)._decorations ||=
        Object.create(null))[property] = value;
    }),
    addHook: mock(() => {}),
    decorateRequest: mock(() => {}),
    decorateReply: mock(() => {}),
    route: mock(() => {}),
    get: mock(() => {}),
    post: mock(() => {}),
    put: mock(() => {}),
    delete: mock(() => {}),
    patch: mock(() => {}),
  } as unknown as PluginHostInstance & {
    _lastRegistered?: { plugin: unknown; opts?: Record<string, unknown> };
    _decorations?: Record<string, unknown>;
  };

  return host;
};

const createMockOptions = (
  overrides: Partial<PluginOptions> = {},
): PluginOptions => ({
  serverType: "ssr",
  mode: "production",
  isDevelopment: false,
  apiEndpoints: { apiEndpointPrefix: "/api" },
  ...overrides,
});

describe("cookies plugin", () => {
  it("registers @fastify/cookie with provided options", async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();
    const config: CookiesConfig = {
      secret: "shhh",
      hook: "preHandler",
      parseOptions: { path: "/", sameSite: "lax", signed: true },
    } as CookiesConfig;

    const plugin = cookies(config);
    const meta = await plugin(host, options);

    // Metadata
    expect(meta).toEqual({ name: "cookies" });

    // Registration invoked
    expect((host as any).register).toHaveBeenCalledTimes(1);
    const last = (host as any)._lastRegistered;
    expect(typeof last.plugin).toBe("function");
    expect(last.opts).toEqual(config as Record<string, unknown>);
  });

  it("decorates cookiePluginInfo when secret present (with custom algorithm)", async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();
    const config: CookiesConfig = {
      secret: ["k2", "k1"],
    } as CookiesConfig;

    // Inject non-standard algorithm field our plugin reads for decoration
    (config as unknown as { algorithm?: string }).algorithm = "sha512";

    const plugin = cookies(config);
    await plugin(host, options);

    const info = ((host as any)._decorations || {}).cookiePluginInfo as
      | { signingSecretProvided: boolean; algorithm: string }
      | undefined;

    expect(info).toBeDefined();
    expect(info?.signingSecretProvided).toBe(true);
    expect(info?.algorithm).toBe("sha512");
  });

  it("decorates cookiePluginInfo with default algorithm and no secret", async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();
    const config: CookiesConfig = {};

    const plugin = cookies(config);
    await plugin(host, options);

    const info = ((host as any)._decorations || {}).cookiePluginInfo as
      | { signingSecretProvided: boolean; algorithm: string }
      | undefined;

    expect(info).toBeDefined();
    expect(info?.signingSecretProvided).toBe(false);
    expect(info?.algorithm).toBe("sha256");
  });
});
