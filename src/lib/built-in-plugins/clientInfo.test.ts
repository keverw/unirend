import { describe, it, expect, mock } from "bun:test";
import { clientInfo, type ClientInfoConfig } from "./clientInfo";
import { ulid, isValid as isValidULID } from "ulid";
import type { PluginOptions, PluginHostInstance } from "../types";

// Helpers to create mock Fastify-like request/reply and plugin host
const createMockRequest = (overrides: any = {}) => ({
  method: "GET",
  url: "/test",
  ip: "127.0.0.1",
  log: {
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
  },
  ...overrides,
  headers: {
    "user-agent": "UA",
    ...(overrides.headers ?? {}),
  },
});

const createMockReply = () => {
  const reply = {
    header: mock(() => reply),
  } as any;
  return reply;
};

const createMockPluginHost = () => {
  const hooks: Array<{
    event: string;
    handler: (req: any, reply: any) => Promise<void>;
  }> = [];

  const mockHost = {
    addHook: mock(
      (event: string, handler: (req: any, reply: any) => Promise<void>) => {
        hooks.push({ event, handler });
      },
    ),
    decorateRequest: mock((_name: string, _value: unknown) => {}),
    getHooks: () => hooks,
  } as any;

  return mockHost as unknown as PluginHostInstance & {
    getHooks: () => typeof hooks;
  };
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

describe("clientInfo", () => {
  it("registers onRequest hook", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo();

    await plugin(pluginHost, options);

    expect(pluginHost.addHook).toHaveBeenCalledWith(
      "onRequest",
      expect.any(Function),
    );
  });

  it("logs requestReceived when enabled (both early and late logs)", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      requestIDGenerator: () => "req-log",
      logging: { requestReceived: true },
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest();
    const reply = createMockReply();
    await onRequestHook?.handler(request, reply);

    // Should log twice: once at start, once after setting correlationID
    expect(request.log.info).toHaveBeenCalledTimes(2);
    const firstArgs = (request.log.info as any).mock.calls[0];
    const secondArgs = (request.log.info as any).mock.calls[1];

    // First log contains requestID
    expect(firstArgs[0]).toEqual({ requestID: "req-log" });
    // Second log contains both requestID and correlationID
    expect(secondArgs[0]).toEqual({
      requestID: "req-log",
      correlationID: "req-log",
    });
  });

  it("logs forwarded client info when enabled", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      requestIDGenerator: () => "req-fwd",
      requestIDValidator: (id) => id === "corr-fwd",
      trustForwardedHeaders: () => true,
      logging: { forwardedClientInfo: true },
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest({
      ip: "10.0.0.9",
      headers: {
        "x-ssr-request": "true",
        "x-ssr-original-ip": "9.9.9.9",
        "x-ssr-forwarded-user-agent": "UA-fwd",
        "x-correlation-id": "corr-fwd",
      },
    });
    const reply = createMockReply();
    await onRequestHook?.handler(request, reply);

    expect(request.log.debug).toHaveBeenCalled();
    const [meta, msg] = (request.log.debug as any).mock.calls[0];
    expect(meta).toMatchObject({
      requestID: "req-fwd",
      correlationID: "corr-fwd",
      originalIP: "9.9.9.9",
      ssrIP: "10.0.0.9",
      isFromSSRServerAPICall: true,
    });
    expect(msg).toContain("Using forwarded client info from trusted source");
  });

  it("warns on rejected forwarded headers when enabled", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      requestIDGenerator: () => "req-warn",
      logging: { rejectedForwardedHeaders: true },
      // No trustForwardedHeaders => defaults to private IP check; we'll use a public IP
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest({
      ip: "203.0.113.50",
      headers: {
        "x-ssr-request": "true",
        "x-ssr-original-ip": "1.1.1.1",
      },
    });
    const reply = createMockReply();
    await onRequestHook?.handler(request, reply);

    expect(request.log.warn).toHaveBeenCalled();
    const [meta, msg] = (request.log.warn as any).mock.calls[0];
    expect(meta).toMatchObject({ requestID: "req-warn", ip: "203.0.113.50" });
    expect(msg).toContain("Rejected SSR headers from untrusted source");
  });
  it("sets requestID, correlationID (default), response headers, and clientInfo defaults", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      requestIDGenerator: () => "req-1",
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest({ ip: "203.0.113.10" });
    const reply = createMockReply();

    await onRequestHook?.handler(request, reply);

    expect(reply.header).toHaveBeenCalledWith("X-Request-ID", "req-1");
    expect(reply.header).toHaveBeenCalledWith("X-Correlation-ID", "req-1");

    expect(request.requestID).toBe("req-1");
    expect(request.clientInfo?.requestID).toBe("req-1");
    expect(request.clientInfo?.correlationID).toBe("req-1");
    expect(request.clientInfo?.isFromSSRServerAPICall).toBe(false);
    expect(request.clientInfo?.IPAddress).toBe("203.0.113.10");
    expect(request.clientInfo?.userAgent).toBe("UA");
    expect(request.clientInfo?.isIPFromHeader).toBe(false);
    expect(request.clientInfo?.isUserAgentFromHeader).toBe(false);
  });

  it("trusts forwarded headers and sets SSR flags, correlationID, IP and UA", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      requestIDGenerator: () => "req-2",
      requestIDValidator: (id) => id === "corr-2",
      trustForwardedHeaders: () => true,
    } as ClientInfoConfig);

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest({
      ip: "10.0.0.5",
      headers: {
        "x-ssr-request": "true",
        "x-ssr-original-ip": "1.2.3.4",
        "x-ssr-forwarded-user-agent": "UA-forwarded",
        "x-correlation-id": "corr-2",
      },
    });
    const reply = createMockReply();

    await onRequestHook?.handler(request, reply);

    expect(request.clientInfo?.isFromSSRServerAPICall).toBe(true);
    expect(request.clientInfo?.IPAddress).toBe("1.2.3.4");
    expect(request.clientInfo?.isIPFromHeader).toBe(true);
    expect(request.clientInfo?.userAgent).toBe("UA-forwarded");
    expect(request.clientInfo?.isUserAgentFromHeader).toBe(true);
    expect(request.clientInfo?.correlationID).toBe("corr-2");
    expect(reply.header).toHaveBeenCalledWith("X-Correlation-ID", "corr-2");
  });

  it("ignores untrusted forwarded headers by default", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      requestIDGenerator: () => "req-3",
      // No trustForwardedHeaders provided; default is private IP check
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest({
      ip: "203.0.113.2", // public IP => not trusted
      headers: {
        "x-ssr-request": "true",
        "x-ssr-original-ip": "1.2.3.4",
        "x-ssr-forwarded-user-agent": "UA-forwarded",
        "x-correlation-id": "corr-public",
      },
    });
    const reply = createMockReply();

    await onRequestHook?.handler(request, reply);

    expect(request.clientInfo?.isFromSSRServerAPICall).toBe(false);
    expect(request.clientInfo?.IPAddress).toBe("203.0.113.2");
    expect(request.clientInfo?.isIPFromHeader).toBe(false);
    expect(request.clientInfo?.userAgent).toBe("UA");
    expect(request.clientInfo?.isUserAgentFromHeader).toBe(false);
    // correlationID should fall back to requestID when not trusted/invalid
    expect(request.clientInfo?.correlationID).toBe("req-3");
    expect(reply.header).toHaveBeenCalledWith("X-Correlation-ID", "req-3");
  });

  it("does not accept invalid correlation IDs (validator rejects)", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      requestIDGenerator: () => "req-4",
      requestIDValidator: () => false,
      trustForwardedHeaders: () => true,
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest({
      headers: {
        "x-ssr-request": "true",
        "x-correlation-id": "not-valid",
      },
    });
    const reply = createMockReply();

    await onRequestHook?.handler(request, reply);

    expect(request.clientInfo?.correlationID).toBe("req-4");
    expect(reply.header).toHaveBeenCalledWith("X-Correlation-ID", "req-4");
  });

  it("can disable response headers via setResponseHeaders: false", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      requestIDGenerator: () => "req-5",
      setResponseHeaders: false,
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest();
    const reply = createMockReply();
    await onRequestHook?.handler(request, reply);

    // Should not set the request/correlation headers when disabled
    expect(reply.header).not.toHaveBeenCalledWith(
      "X-Request-ID",
      expect.any(String),
    );
    expect(reply.header).not.toHaveBeenCalledWith(
      "X-Correlation-ID",
      expect.any(String),
    );
  });

  it("uses default trust and validator with valid forwarded ULID", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo(); // defaults: generate ULID, validate ULID, trust private IPs

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const forwardedCorrelation = ulid();
    const request = createMockRequest({
      ip: "10.1.2.3", // private IP → trusted
      headers: {
        "x-ssr-request": "true",
        "x-correlation-id": forwardedCorrelation,
      },
    });
    const reply = createMockReply();

    await onRequestHook?.handler(request, reply);

    // Generated requestID should be a valid ULID
    expect(isValidULID(request.requestID)).toBe(true);
    // Correlation should reflect forwarded value
    expect(request.clientInfo?.correlationID).toBe(forwardedCorrelation);
    expect(reply.header).toHaveBeenCalledWith(
      "X-Correlation-ID",
      forwardedCorrelation,
    );
  });

  it("handles missing User-Agent header gracefully", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({ requestIDGenerator: () => "req-no-ua" });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest({
      headers: {
        // Explicitly unset user-agent
        "user-agent": undefined,
      },
    });
    const reply = createMockReply();

    await onRequestHook?.handler(request, reply);

    expect(request.clientInfo?.userAgent).toBe("");
    expect(request.clientInfo?.isUserAgentFromHeader).toBe(false);
  });

  it("when logging=true, logs requestReceived and forwarded details", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      logging: true,
      trustForwardedHeaders: () => true,
      requestIDGenerator: () => "req-log-all",
      requestIDValidator: (id) => id === "corr-all",
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest({
      ip: "10.0.0.1",
      headers: {
        "x-ssr-request": "true",
        "x-correlation-id": "corr-all",
        "x-ssr-original-ip": "9.9.9.9",
        "x-ssr-forwarded-user-agent": "UA-fwd",
      },
    });
    const reply = createMockReply();
    await onRequestHook?.handler(request, reply);

    expect(request.log.info).toHaveBeenCalledTimes(2); // early + late
    expect(request.log.debug).toHaveBeenCalledTimes(1);
    expect(request.log.warn).not.toHaveBeenCalled();
  });

  it("when logging=false, suppresses all logs including rejected forwarded headers", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({
      logging: false,
    });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    // Public IP with SSR headers would normally trigger a warn when enabled
    const request = createMockRequest({
      ip: "203.0.113.77",
      headers: {
        "x-ssr-request": "true",
        "x-ssr-original-ip": "1.2.3.4",
      },
    });
    const reply = createMockReply();
    await onRequestHook?.handler(request, reply);

    expect(request.log.info).not.toHaveBeenCalled();
    expect(request.log.debug).not.toHaveBeenCalled();
    expect(request.log.warn).not.toHaveBeenCalled();
  });

  it("when logging is undefined, does not log", async () => {
    const pluginHost = createMockPluginHost();
    const options = createMockOptions();
    const plugin = clientInfo({ requestIDGenerator: () => "req-no-log" });

    await plugin(pluginHost, options);
    const onRequestHook = pluginHost
      .getHooks()
      .find((h) => h.event === "onRequest");

    const request = createMockRequest();
    const reply = createMockReply();
    await onRequestHook?.handler(request, reply);

    expect(request.log.info).not.toHaveBeenCalled();
    expect(request.log.debug).not.toHaveBeenCalled();
    expect(request.log.warn).not.toHaveBeenCalled();
  });
});
