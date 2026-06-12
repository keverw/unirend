import { describe, it, expect, mock } from 'bun:test';
import { ulid, isValid as isValidULID } from 'ulid';
import { registerClientInfoResolution } from './client-info-resolution';
import type { ClientInfoConfig } from './client-info-resolution';
import type { FastifyInstance } from 'fastify';

interface MockReply {
  header: ReturnType<typeof mock>;
}

const createMockReply = (): MockReply => ({
  header: mock(function (this: MockReply) {
    return this;
  }),
});

const createFakeFastify = () => {
  const hooks: Array<(req: unknown, reply: unknown) => Promise<void>> = [];
  const instance = {
    decorateRequest: mock((_name: string, _value: unknown) => {}),
    addHook: mock(
      (
        _name: string,
        handler: (req: unknown, reply: unknown) => Promise<void>,
      ) => hooks.push(handler),
    ),
    _hooks: hooks,
  };
  return instance;
};

interface MockRequest {
  method: string;
  url: string;
  connectionIP: string;
  clientIP: string;
  requestID?: string;
  headers: Record<string, string | undefined>;
  log: {
    info: ReturnType<typeof mock>;
    debug: ReturnType<typeof mock>;
    warn: ReturnType<typeof mock>;
  };
  clientInfo?: unknown;
}

const createMockRequest = (
  overrides: Partial<MockRequest> = {},
): MockRequest => {
  const connectionIP = overrides.connectionIP ?? '127.0.0.1';
  return {
    method: 'GET',
    url: '/test',
    connectionIP,
    // base clientIP == connectionIP (seeded by connection-IP decoration)
    clientIP: overrides.clientIP ?? connectionIP,
    requestID: 'requestID' in overrides ? overrides.requestID : 'req-1',
    log: {
      info: mock(() => {}),
      debug: mock(() => {}),
      warn: mock(() => {}),
    },
    ...overrides,
    headers: { 'user-agent': 'UA', ...(overrides.headers ?? {}) },
  };
};

const run = async (config: ClientInfoConfig, request: MockRequest) => {
  const f = createFakeFastify();
  registerClientInfoResolution(f as unknown as FastifyInstance, config);
  const handler = f._hooks[0];
  const reply = createMockReply();
  await handler(request, reply);
  return { reply, request };
};

describe('registerClientInfoResolution', () => {
  it('decorates clientInfo and registers an onRequest hook', () => {
    const f = createFakeFastify();
    registerClientInfoResolution(f as unknown as FastifyInstance, {});
    expect(f.decorateRequest).toHaveBeenCalledWith('clientInfo', undefined);
    expect(f.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function));
  });

  it('direct request: correlationID falls back to requestID, clientIP unchanged, headers set', async () => {
    const request = createMockRequest({ requestID: 'req-1' });
    const { reply } = await run({}, request);

    expect(request.clientInfo).toMatchObject({
      requestID: 'req-1',
      correlationID: 'req-1',
      isFromSSRServerAPICall: false,
      connectionIP: '127.0.0.1',
      clientIP: '127.0.0.1',
      userAgent: 'UA',
      isIPFromHeader: false,
      isUserAgentFromHeader: false,
    });
    expect(request.clientIP).toBe('127.0.0.1'); // unchanged
    expect(reply.header).toHaveBeenCalledWith('X-Request-ID', 'req-1');
    expect(reply.header).toHaveBeenCalledWith('X-Correlation-ID', 'req-1');
  });

  it('trusted forwarded headers override clientIP/UA/correlation and set the SSR flag', async () => {
    const request = createMockRequest({
      requestID: 'req-2',
      connectionIP: '10.0.0.5', // private -> trusted under 'local'
      headers: {
        'x-ssr-request': 'true',
        'x-ssr-original-ip': '1.2.3.4',
        'x-ssr-forwarded-user-agent': 'UA-fwd',
        'x-correlation-id': 'corr-2',
      },
    });
    const { reply } = await run(
      {
        trustForwardedHeaders: 'local',
        forwardedRequestIDValidator: (id) => id === 'corr-2',
      },
      request,
    );

    expect(request.clientIP).toBe('1.2.3.4'); // real end user recovered
    expect(request.clientInfo).toMatchObject({
      isFromSSRServerAPICall: true,
      connectionIP: '10.0.0.5',
      clientIP: '1.2.3.4',
      userAgent: 'UA-fwd',
      isIPFromHeader: true,
      isUserAgentFromHeader: true,
      correlationID: 'corr-2',
    });
    expect(reply.header).toHaveBeenCalledWith('X-Correlation-ID', 'corr-2');
  });

  it("'local' ignores forwarded headers from an untrusted (public) connection", async () => {
    const request = createMockRequest({
      requestID: 'req-3',
      connectionIP: '203.0.113.2', // public -> not trusted even under 'local'
      clientIP: '203.0.113.2',
      headers: {
        'x-ssr-request': 'true',
        'x-ssr-original-ip': '1.2.3.4',
        'x-correlation-id': 'corr-3',
      },
    });
    await run({ trustForwardedHeaders: 'local' }, request);

    expect(request.clientIP).toBe('203.0.113.2'); // not overridden
    expect(request.clientInfo).toMatchObject({
      isFromSSRServerAPICall: false,
      isIPFromHeader: false,
      correlationID: 'req-3', // fell back to requestID
    });
  });

  it('invalid forwarded correlation ID falls back to requestID', async () => {
    const request = createMockRequest({
      requestID: 'req-4',
      connectionIP: '10.0.0.5',
      headers: { 'x-ssr-request': 'true', 'x-correlation-id': 'not-valid' },
    });
    await run(
      {
        trustForwardedHeaders: 'local',
        forwardedRequestIDValidator: () => false,
      },
      request,
    );

    expect(request.clientInfo).toMatchObject({ correlationID: 'req-4' });
  });

  it('respects a valid forwarded ULID correlation with default validator', async () => {
    const forwarded = ulid();
    const request = createMockRequest({
      connectionIP: '10.1.2.3',
      headers: { 'x-ssr-request': 'true', 'x-correlation-id': forwarded },
    });
    await run({ trustForwardedHeaders: 'local' }, request);
    expect(request.clientInfo).toMatchObject({ correlationID: forwarded });
    expect(isValidULID(request.requestID ?? '')).toBe(false); // mock uses 'req-1'
  });

  it('does not trust forwarded headers by default (deny), even from a private connection', async () => {
    const request = createMockRequest({
      requestID: 'req-deny',
      connectionIP: '10.0.0.5', // private, but no trust configured
      clientIP: '10.0.0.5',
      headers: {
        'x-ssr-request': 'true',
        'x-ssr-original-ip': '1.2.3.4',
        'x-correlation-id': 'corr-deny',
      },
    });
    await run({}, request);

    expect(request.clientIP).toBe('10.0.0.5'); // not overridden
    expect(request.clientInfo).toMatchObject({
      isFromSSRServerAPICall: false,
      isIPFromHeader: false,
      correlationID: 'req-deny', // fell back to requestID
    });
  });

  it('setResponseHeaders: false suppresses the ID headers', async () => {
    const request = createMockRequest({ requestID: 'req-5' });
    const { reply } = await run({ setResponseHeaders: false }, request);
    expect(reply.header).not.toHaveBeenCalledWith(
      'X-Request-ID',
      expect.any(String),
    );
  });

  it('does not emit empty ID headers when the request ID opted out', async () => {
    const request = createMockRequest({ requestID: undefined });
    const { reply } = await run({}, request);
    expect(reply.header).not.toHaveBeenCalledWith(
      'X-Request-ID',
      expect.any(String),
    );
    expect(reply.header).not.toHaveBeenCalledWith(
      'X-Correlation-ID',
      expect.any(String),
    );
  });

  it('custom trustForwardedHeaders controls forwarded acceptance', async () => {
    const request = createMockRequest({
      connectionIP: '203.0.113.9', // public, but custom trust returns true
      clientIP: '203.0.113.9',
      headers: { 'x-ssr-request': 'true', 'x-ssr-original-ip': '8.8.8.8' },
    });
    await run({ trustForwardedHeaders: () => true }, request);
    expect(request.clientIP).toBe('8.8.8.8');
  });

  it('logs "Request received" once (not duplicated) when requestReceived logging is on', async () => {
    const request = createMockRequest({ requestID: 'req-log' });
    await run({ logging: { requestReceived: true } }, request);
    expect(request.log.info).toHaveBeenCalledTimes(1);
  });
});
