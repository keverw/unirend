# HTTPS Configuration

Both `SSRServer` (via `serveSSRDev`/`serveSSRProd`) and `APIServer` (via `serveAPI`) provide first-class HTTPS support with certificate files and SNI callback for dynamic certificate selection.

<!-- toc -->

- [Basic HTTPS Setup](#basic-https-setup)
- [SNI Callback for Multi-Tenant SaaS](#sni-callback-for-multi-tenant-saas)
- [HTTP to HTTPS Redirect Server](#http-to-https-redirect-server)
- [Development vs Production](#development-vs-production)

<!-- tocstop -->

## Basic HTTPS Setup

Add HTTPS configuration to your server options:

```typescript
import { serveSSRProd } from 'unirend/server';

const server = serveSSRProd('./build', {
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

## SNI Callback for Multi-Tenant SaaS

For applications serving multiple domains with different certificates (e.g., multi-tenant SaaS), use the SNI callback:

> **⚠️ Runtime Compatibility:** SNI callbacks are fully supported in **Node.js**. **Bun** currently only supports static `tls.serverName` and does not support dynamic SNI callbacks ([bun#14395](https://github.com/oven-sh/bun/issues/14395)). If you need multi-domain HTTPS with dynamic certificate selection, target Node.js for production deployments. You can still use Bun for development, testing, and build tooling.

```typescript
import { serveSSRProd } from 'unirend/server';
import { createSecureContext } from 'tls';

const server = serveSSRProd('./build', {
  https: {
    // Default certificate (REQUIRED - acts as universal fallback)
    // Used when: SNI callback errors or unknown domains
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
      const { key, cert } = await loadCertificateForDomain(servername);

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

  // Return null/throw error to use default certificate
  // (Node.js will automatically fall back to the default cert above)
  return null;
}
```

**SNI Callback Notes:**

- The callback can be **async** (return a Promise) or sync
- Called during TLS handshake for each new connection
- Should be fast - cache certificates in memory when possible
- **Error handling**: If the callback throws an error or returns null/undefined, Node.js automatically falls back to the default certificate (the `key`/`cert` in the main HTTPS options)
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
- `invalidDomainHandler` - Custom error response for blocked domains
- `logErrors` - Whether to automatically log errors (default: `true`)
- `logging` - Framework-level logging options (same as APIServer/SSRServer)
- `fastifyOptions` - Fastify server options (logger, trustProxy, etc.)

**Domain Validation:**
The `allowedDomains` option supports wildcard patterns:

- `'example.com'` - Exact match only
- `'*.example.com'` - Direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
- `'**.example.com'` - All subdomains including nested (`api.example.com` ✅, `app.api.example.com` ✅)

**Why validate domains?**
Without validation, your redirect server becomes an **open redirect** - anyone can use it to redirect to any domain by manipulating the `Host` header:

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

**Advanced Domain Handling:**
The `RedirectServer` handles basic HTTP→HTTPS redirects with optional domain validation. For additional domain handling features on your **main HTTPS application server** (SSR or API server), use the [domainValidation plugin](./built-in-plugins/domainValidation.md):

- `wwwHandling: 'add'` - Redirect `example.com` → `www.example.com`
- `wwwHandling: 'remove'` - Redirect `www.example.com` → `example.com`
- Canonical domain enforcement with HTTPS
- Additional security validations

## Development vs Production

Use environment variables or config flags to toggle between development and production modes:

**Basic Setup:**

```typescript
const isDev = process.env.NODE_ENV === 'development';

if (isDev) {
  // Development: serveSSRDev with hot reloading
  const server = serveSSRDev(buildDir);
  await server.listen(3000, 'localhost');
} else {
  // Production: serveSSRProd with HTTPS + HTTP redirect server
  const server = serveSSRProd(buildDir, {
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
import { serveRedirect, serveSSRProd, serveSSRDev } from 'unirend/server';
import { domainValidation } from 'unirend/plugins';

async function main() {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // Development: serveSSRDev with hot reloading
    const server = serveSSRDev('./build');
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
    const mainServer = serveSSRProd('./build', {
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
        // Note: Cross-origin requests are blocked by default (secure)
        // Add cors() plugin only if you need to allow cross-origin API access
        // See docs/built-in-plugins/cors.md for configuration
      ],

      frontendAppConfig: {
        apiUrl: 'https://api.example.com',
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
