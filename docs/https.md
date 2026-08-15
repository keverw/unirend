# HTTPS Configuration

Both `SSRServer` (via `serveSSRWithHMR`/`serveSSRBuilt`) and `APIServer` (via `serveAPI`) provide first-class HTTPS support with certificate files and SNI callback for dynamic certificate selection.

<!-- toc -->

- [Basic HTTPS Setup](#basic-https-setup)
- [Behind a TLS-Terminating Proxy](#behind-a-tls-terminating-proxy)
  - [Reading the Original vs. the Resolved Value](#reading-the-original-vs-the-resolved-value)
- [HSTS](#hsts)
- [SNI Callback for Multi-Tenant SaaS](#sni-callback-for-multi-tenant-saas)
- [HTTP to HTTPS Redirect Server](#http-to-https-redirect-server)
- [Development vs. Production](#development-vs-production)

<!-- tocstop -->

## Basic HTTPS Setup

Add HTTPS configuration to your server options:

```typescript
import { serveSSRBuilt } from 'unirend/server';

const server = serveSSRBuilt('./build', {
  https: {
    key: privateKey, // string | Buffer - Your private key in PEM format
    cert: certificate, // string | Buffer - Your certificate in PEM format
    // Optional: CA certificate chain
    ca: caCertificate, // string | Buffer - CA bundle
    // Optional: passphrase for encrypted private key
    passphrase: process.env.KEY_PASSPHRASE,
  },
});

await server.listen(443, '0.0.0.0');
console.log('HTTPS server running on port 443');
```

> **✅ Runtime Compatibility:** Basic HTTPS with static certificates works in both **Node.js** and **Bun**. For dynamic multi-domain certificate selection (SNI callbacks), use Node.js (see [SNI Callback section](#sni-callback-for-multi-tenant-saas)).

**Security Notes:**

- Keep private keys secure - never commit them to version control
- **Secret management**:
  - **Development/Simple deployments**: Environment variables are fine for paths and non-sensitive config (e.g., `CERT_PATH=/run/secrets/tls.crt`)
  - **Production (recommended)**: Use dedicated secret management:
    - **Secret managers**: Key vaults, secure enclaves, or dedicated secret management services
    - **Container secrets**: Mounted secrets files provided by your container orchestration platform
    - **Runtime loading**: Read certificates from secure files at startup
  - **Why avoid env vars for secrets**: They leak in logs, process listings, and error reports. Modern secret managers provide rotation, auditing, and better security.
- Set appropriate file permissions (0600 for private keys)

## Behind a TLS-Terminating Proxy

A common deployment terminates TLS at nginx, OpenResty, a load balancer, or a CDN, and forwards plain HTTP to the app. Unirend then sees an HTTP request, and the only record of the original HTTPS hop is the `x-forwarded-proto` header the proxy set.

Fastify believes that header only when `fastifyOptions.trustProxy` vouches for the peer that sent it. Set it, and `request.protocol` and `request.host` reflect what the browser actually asked for.

```typescript
const server = serveSSRBuilt('./build', {
  fastifyOptions: {
    // Trust only the proxy. See the guidance below before using a bare `true`.
    trustProxy: '10.0.0.0/8',
  },
});
```

<!-- prettier-ignore -->
> [!IMPORTANT]
> If you use the `domainValidation` plugin with `enforceHTTPS: true` behind such a proxy, `fastifyOptions.trustProxy` is **required**. Without it Fastify sees the plain HTTP hop, the plugin redirects to HTTPS, the proxy forwards HTTP again, and the browser reports `ERR_TOO_MANY_REDIRECTS`. The symptom is an infinite redirect loop and the site is down until `trustProxy` is set.

Guidance on what to set it to:

- **Origin reachable only from the proxy** (loopback bind, private network, container network): `trustProxy: true` is fine, because no untrusted peer can connect.
- **Origin reachable from anywhere else**: name the proxy, for example `trustProxy: '10.0.0.0/8'` or its specific address. A bare `true` lets any client forge forwarded headers.
- **A CDN in front of a proxy** is more than one hop, so use a hop count or the full trusted set.

### Reading the Original vs. the Resolved Value

Trusting a proxy does not rewrite anything. `request.headers` still holds exactly what arrived on the wire, and the resolved values are getters computed alongside it. Both views stay available, which is what you want when an access log or an audit trail should record what a client claimed as well as what was believed.

Given `trustProxy: true` and a request carrying `Host: internal.upstream:8080`, `X-Forwarded-Host: evil.com, real.example.com:8443`, and `X-Forwarded-Proto: https, http`:

| What you want | Read | Value in this example |
| --- | --- | --- |
| Host as received | `request.headers.host` | `internal.upstream:8080` |
| Forwarded host as sent | `request.headers['x-forwarded-host']` | `evil.com, real.example.com:8443` |
| Resolved host with port | `request.host` | `real.example.com:8443` |
| Resolved host, no port | `request.hostname` | `real.example.com` |
| Resolved port | `request.port` | `8443` |
| Forwarded proto as sent | `request.headers['x-forwarded-proto']` | `https, http` |
| Resolved protocol | `request.protocol` | `http` |
| Resolved client IP | `request.ip` | `9.9.9.9` |
| Full IP chain | `request.ips` | `['127.0.0.1', '10.0.0.5', '9.9.9.9']` |

Note which end of a multi-value header wins. For host and protocol the **last** entry is the one the trusted proxy appended, so that is what Fastify resolves, and the leading `evil.com` and `https` here are whatever the client sent. `X-Forwarded-For` runs the other way by convention, with the client leftmost, which is why `request.ip` is the first entry rather than the last. `request.ips` is the only ready-made chain accessor. For hosts, you would split the raw header yourself.

See [domainValidation](./built-in-plugins/domainValidation.md#proxy-support) for the plugin-side details.

## HSTS

`Strict-Transport-Security` tells a browser to use HTTPS for a domain for a fixed period. Configure it through the `securityHeaders` plugin:

```typescript
import { securityHeaders } from 'unirend/plugins';

securityHeaders({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
});
```

Unirend sends the header only on requests that arrived over a secure transport, which RFC 6797 requires. Behind a TLS-terminating proxy that means `fastifyOptions.trustProxy` must be set, otherwise Fastify sees plain HTTP and no HSTS header is sent at all.

Two things to weigh before enabling it:

- `maxAge` is not revocable. A browser that has seen the header honors it for the full duration even if you stop sending it, so start with a short value and raise it once you are confident.
- `includeSubDomains` on a domain you do not control, such as a customer's custom domain, forces HTTPS across every other subdomain of that domain, including things unrelated to your app.

## SNI Callback for Multi-Tenant SaaS

For applications serving multiple domains with different certificates (e.g., multi-tenant SaaS), use the SNI callback:

> **⚠️ Runtime Compatibility:** SNI callbacks are fully supported in **Node.js**. **Bun** currently only supports static `tls.serverName` and does not support dynamic SNI callbacks ([bun#14395](https://github.com/oven-sh/bun/issues/14395)). If you need multi-domain HTTPS with dynamic certificate selection, target Node.js for production deployments. You can still use Bun for development, testing, and build tooling.

```typescript
import { serveSSRBuilt } from 'unirend/server';
import { createSecureContext } from 'tls';

const server = serveSSRBuilt('./build', {
  https: {
    // Default certificate (REQUIRED - acts as universal fallback)
    // Used when: SNI returns null/undefined for unknown domains
    // Common approaches:
    // - Wildcard cert for *.yourdomain.com (covers all subdomains)
    // - Self-signed cert as fallback (causes browser warnings but works if all valid domains use SNI)
    // - Primary domain cert (e.g., app.yourdomain.com)
    key: defaultPrivateKey, // string | Buffer
    cert: defaultCertificate, // string | Buffer

    // SNI callback for dynamic certificate selection per domain
    sni: async (servername) => {
      // Load certificate based on domain
      // This example assumes you have a certificate store/database
      const certificate = await loadCertificateForDomain(servername);

      if (!certificate) {
        return null;
      }

      const { key, cert } = certificate;

      return createSecureContext({
        key,
        cert,
      });
    },
  },
});

await server.listen(443, '0.0.0.0');

// Example certificate loader (implement based on your infrastructure)
async function loadCertificateForDomain(domain: string) {
  // Load from file system, database, secure object storage, certificate manager, etc.
  if (domain === 'example.com') {
    return {
      key: examplePrivateKey, // string | Buffer
      cert: exampleCertificate, // string | Buffer
    };
  }

  // Load from database/S3/certificate manager
  // const cert = await certStore.get(domain);
  // return cert;

  // Return null to use the default certificate.
  return null;
}
```

**SNI Callback Notes:**

- The callback can be **async** (return a Promise) or sync
- Called during TLS handshake for each new connection
- Should be fast - cache certificates in memory when possible
- **Fallback behavior**: If the callback returns `null`/`undefined`, Unirend passes no context to Node's SNI callback, and Node uses the default secure context from the main HTTPS `key`/`cert`.
- **Error handling**: If the callback throws or rejects, Unirend forwards the error to Node's SNI callback error path. Use `return null` for "no matching certificate". Throw only for lookup or certificate-loading failures that should fail the handshake.
- **Default certificate is REQUIRED**: Node.js TLS requires a valid certificate to start the HTTPS server. The SNI callback is for _dynamic selection_ on top of this base certificate.

**Default Certificate Strategies for Multi-Tenant SaaS:**

Node.js requires a default certificate to start the HTTPS server. The SNI callback dynamically selects certificates on top of this base. Choose a strategy:

1. **Main app domain cert** - Use your primary app domain cert (e.g., `app.yoursaas.com`)
   - ✅ Best if you have a main app that should work without SNI
   - ✅ Health checks and monitoring work properly
   - ⚠️ Misconfigured domains get less obvious certificate name mismatch

2. **Self-signed cert** (Recommended if all domains use SNI) - Use intentionally invalid cert
   - ✅ Best if ALL domains expected to use SNI (no main app domain)
   - ✅ Clear browser security warning for misconfigured domains
   - ⚠️ Health checks need separate HTTP server on another port for orchestrator

3. **Wildcard cert** - Use `*.tenants.yoursaas.com` for subdomain-based tenancy
   - ✅ All customer subdomains work without SNI
   - ⚠️ Doesn't help with fully custom domains (still need SNI)

## HTTP to HTTPS Redirect Server

For production deployments, run a separate redirect server on port 80 to redirect HTTP traffic to HTTPS:

```typescript
import { serveRedirect } from 'unirend/server';

// HTTP → HTTPS redirect server (port 80)
const redirectServer = serveRedirect({
  targetProtocol: 'https',
  statusCode: 301, // Permanent redirect

  // Optional: Domain validation (prevents Host header attacks)
  allowedDomains: ['example.com', '*.example.com'],

  // Optional: Preserve port numbers (useful for dev/testing)
  preservePort: false,

  // Optional: Custom error handler for invalid domains
  // Supports JSON, HTML, or plain text responses
  invalidDomainHandler: (request, domain) => ({
    contentType: 'json',
    content: {
      error: 'invalid_domain',
      message: `Domain "${domain}" is not authorized`,
    },
  }),
});

await redirectServer.listen(80, '0.0.0.0');
console.log('HTTP redirect server running on port 80');
```

**Configuration Options:**

- `targetProtocol` - Target protocol to redirect to (default: `'https'`). **Note:** Only HTTPS is supported as the redirect target.
- `statusCode` - HTTP status code for redirects (default: `301`)
  - `301` - Permanent redirect (cached by browsers)
  - `302` - Temporary redirect
  - `307` - Temporary redirect (preserves method)
  - `308` - Permanent redirect (preserves method)
- `allowedDomains` - Optional domain validation (prevents Host header attacks)
- `preservePort` - Whether to preserve port numbers in redirects (default: `false`)
- `targetPort` - Override the port in the redirect URL (e.g., redirect `http://host:8080` → `https://host:8443`). Takes precedence over `preservePort` when set. Port `443` is automatically omitted from the URL since it's the HTTPS default.
- `invalidDomainHandler` - Custom error response for blocked domains
- `logging` - Framework-level logging options (same as APIServer/SSRServer)
- `accessLog` - First-party access logging, same `AccessLogConfig` as SSR/API servers (templates, level config, `onRequest`/`onResponse` hooks). Hooks are installed by default (`events: 'finish'`), but printed log lines require a configured logger. Use `{ events: 'none' }` to disable template log output, or provide config to customize. Also adjustable at runtime via `redirectServer.updateAccessLoggingConfig(partial)`. See [Access Logging](./ssr.md#access-logging).
- `fastifyOptions` - Fastify server options (logger, trustProxy, etc.)
- `getConnectionIP` - Custom resolver for `request.connectionIP` (the connecting IP, base for `request.clientIP`). Same as APIServer/SSRServer.
- `clientInfo` - Client-identity resolution: the real end-user `request.clientIP`, `request.clientUserAgent`, and `request.clientInfo`. On by default. Pass `false` to disable. Same as APIServer/SSRServer. See [Client Identity](./client-identity.md)
- `getRequestID` - Custom generator for `request.requestID` (available as the `{{requestID}}` access-log template variable and in hooks). Defaults to a ULID. Returning `undefined` or an empty string opts out. Same as APIServer/SSRServer. See [ssr.md](./ssr.md#shared-server-configuration).
- `closingHandler` - Custom `WebResponse` for requests received while `stop()` is closing the redirect server. If omitted, Unirend returns a default 503 HTML page.

**Domain Validation:** The `allowedDomains` option supports wildcard patterns:

- `'example.com'` - Exact match only
- `'*.example.com'` - Direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
- `'**.example.com'` - All subdomains including nested (`api.example.com` ✅, `app.api.example.com` ✅)

**Why validate domains?** Without validation, your redirect server becomes an **open redirect** - anyone can use it to redirect to any domain by manipulating the `Host` header:

```http
GET / HTTP/1.1
Host: evil.com
→ Redirects to https://evil.com (attacker's site)
```

This lets attackers:

- Use your infrastructure as a free redirect service (port 80 → any HTTPS domain)
- Abuse your server resources for malicious redirects

Domain validation ensures your redirect server only redirects to domains you control, preventing infrastructure abuse and open redirect vulnerabilities

**Custom Error Responses:**

The `invalidDomainHandler` option lets you customize the response when a domain is blocked. It follows the same pattern as the `domainValidation` plugin for consistency:

```typescript
import type { InvalidDomainResponse } from 'unirend/server';

const redirectServer = serveRedirect({
  allowedDomains: ['example.com', '*.example.com'],

  // Return JSON error (useful for API monitoring)
  invalidDomainHandler: (request, domain) => ({
    contentType: 'json',
    content: {
      error: 'invalid_domain',
      message: `Domain "${domain}" is not authorized`,
      allowed: ['example.com', '*.example.com'],
    },
  }),
});
```

Response types supported:

- `'json'` - Returns JSON object with `application/json` content type
- `'html'` - Returns HTML page with `text/html` content type
- `'text'` - Returns plain text with `text/plain` content type (default)

**Example: HTML error page**

> **⚠️ Security:** Always escape dynamic values when returning HTML to prevent XSS attacks.

```typescript
import { escapeHTML } from 'unirend/utils';

invalidDomainHandler: (request, domain) => ({
  contentType: 'html',
  content: `
    <!DOCTYPE html>
    <html>
      <head><title>Access Denied</title></head>
      <body>
        <h1>403 Forbidden</h1>
        <p>Domain "${escapeHTML(domain)}" is not authorized to access this server.</p>
      </body>
    </html>
  `,
}),
```

All invalid domain responses return HTTP 403 status code with `Cache-Control: no-store` to prevent caching of error responses.

**Advanced Domain Handling:** The `RedirectServer` handles basic HTTP→HTTPS redirects with optional domain validation. For additional domain handling features on your **main HTTPS application server** (SSR or API server), use the [domainValidation plugin](./built-in-plugins/domainValidation.md):

- `wwwHandling: 'add'` - Redirect `example.com` → `www.example.com`
- `wwwHandling: 'remove'` - Redirect `www.example.com` → `example.com`
- Canonical domain enforcement with HTTPS
- Additional security validations

## Development vs. Production

Use `initDevMode()` to set development mode at startup. Pass a CLI argument (`dev` or `prod`) or use environment detection:

```bash
# Development (HMR)
bun run serve-hmr.ts dev   # (or serve.ts dev for SSG/API)

# Production (Built)
bun run serve-built.ts prod # (or serve.ts prod for SSG/API)
```

**Basic Setup:**

```typescript
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import { serveSSRWithHMR, serveSSRBuilt, serveRedirect } from 'unirend/server';

initDevMode({ detect: 'cmd' }); // reads "dev" / "prod" from process.argv
const isDev = getDevMode();

if (isDev) {
  // Development: serveSSRWithHMR with hot reloading
  const server = serveSSRWithHMR({
    serverEntry: './src/EntrySSR.tsx',
    template: './index.html',
    viteConfig: './vite.config.ts',
  });

  await server.listen(3000, 'localhost');
} else {
  // Production: serveSSRBuilt with HTTPS + HTTP redirect server
  const server = serveSSRBuilt(buildDir, {
    https: { key, cert },
  });
  await server.listen(443, '0.0.0.0');

  const redirectServer = serveRedirect({
    allowedDomains: ['example.com', '*.example.com'],
  });
  await redirectServer.listen(80, '0.0.0.0');
}
```

**Advanced Production Setup:**

Add domain validation plugin for additional security and canonical domain enforcement:

```typescript
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import { serveRedirect, serveSSRBuilt, serveSSRWithHMR } from 'unirend/server';
import { domainValidation } from 'unirend/plugins';

async function main() {
  initDevMode({ detect: 'cmd' });
  const isDev = getDevMode();

  if (isDev) {
    // Development: serveSSRWithHMR with hot reloading
    const server = serveSSRWithHMR({
      serverEntry: './src/EntrySSR.tsx',
      template: './index.html',
      viteConfig: './vite.config.ts',
    });

    await server.listen(3000, 'localhost');
    console.log('✓ Development server running at http://localhost:3000');
  } else {
    // Production: HTTP redirect server (port 80)
    const redirectServer = serveRedirect({
      targetProtocol: 'https',
      statusCode: 301,
      allowedDomains: ['example.com', '*.example.com'],
    });

    await redirectServer.listen(80, '0.0.0.0');
    console.log('✓ HTTP redirect server running on port 80');

    // Production: Main HTTPS server (port 443)
    const mainServer = serveSSRBuilt('./build', {
      https: {
        key: privateKey, // string | Buffer - Load your SSL key
        cert: certificate, // string | Buffer - Load your SSL certificate
      },

      plugins: [
        // Domain validation plugin for additional security
        domainValidation({
          validProductionDomains: ['example.com', '*.example.com'],
          canonicalDomain: 'example.com',
          enforceHTTPS: true, // Redirect HTTP → HTTPS (backup layer)
          wwwHandling: 'remove', // Redirect www.example.com → example.com
        }),
        // Browsers restrict cross-origin response reads by default. Configure
        // CORS only for origins that need access. State-changing routes that
        // authenticate with cookies still require CSRF protection.
        // Add securityHeaders() for CORS and other browser security headers.
        // See docs/built-in-plugins/security-headers.md for configuration
      ],

      publicAppConfig: {
        api_endpoint: 'https://api.example.com',
      },
    });

    await mainServer.listen(443, '0.0.0.0');
    console.log('✓ HTTPS server running on port 443');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}. Shutting down...`);
      await Promise.all([redirectServer.stop(), mainServer.stop()]);
      console.log('Servers stopped gracefully');
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  }
}

main().catch(console.error);
```

**Patterns:**

- **Development**: HTTP-only on standard port (3000, 8080) with `localhost` binding
- **Production**: HTTPS on port 443 with `0.0.0.0` binding + HTTP redirect server on port 80
- **Alternative**: Use a reverse proxy (Nginx, Caddy, Traefik) or load balancer for SSL termination if you prefer centralized certificate management. In this case, run your SSR server on HTTP behind the proxy.
