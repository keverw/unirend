# Built-in Plugins

<!-- toc -->

<!-- tocstop -->

Unirend provides a collection of built-in plugins that handle common server functionality. These plugins are available through the `unirend/plugins` namespace and can be easily integrated into your SSR or API servers.

## domainValidation

The `domainValidation` plugin provides comprehensive domain security and normalization for production deployments. It handles domain validation, canonical redirects, HTTPS enforcement, WWW prefix management, and proxy header support.

**Features:**

- **Domain validation**: Validates requests against allowed production domains with wildcard support
- **Canonical domain redirects**: Redirects to the preferred domain when multiple domains are configured
- **HTTPS enforcement**: Automatically redirects HTTP requests to HTTPS with proxy header support
- **WWW prefix handling**: Add or remove WWW prefix with smart apex domain detection (no changes to subdomains)
- **Internationalized domain support**: Handles IDN domains with punycode normalization
- **Proxy-aware**: Supports `x-forwarded-host` and `x-forwarded-proto` headers
- **API endpoint detection**: Different error handling for API vs web requests
- **Single redirect**: Combines multiple redirect conditions to avoid redirect chains
- **Port preservation**: Configurable port handling for development and custom setups
- **Development-friendly**: Automatically skips validation for localhost, 127.0.0.1, ::1, and development mode

**Usage:**

```typescript
import { domainValidation } from "unirend/plugins";

const server = await serveSSRProd(buildDir, {
  plugins: [
    domainValidation({
      validProductionDomains: ["example.com", "*.example.com"],
      canonicalDomain: "example.com",
      enforceHttps: true,
      wwwHandling: "remove",
      redirectStatusCode: 301,
      skipInDevelopment: true,
    }),
  ],
});
```

**Configuration:**

- `validProductionDomains` (optional): Array of allowed domains. Supports wildcards (e.g., `["example.com", "*.example.com"]`). If not provided, domain validation is skipped. Use this to protect against unexpected domains pointing at your server (e.g., DNS misconfiguration or hostile `Host` headers). Requests from non-allowed hosts are always blocked; `invalidDomainHandler` only customizes the error response.
- `canonicalDomain` (optional): Preferred domain to redirect to when multiple domains are allowed
- `enforceHttps` (default: `true`): Whether to redirect HTTP requests to HTTPS
- `wwwHandling` (default: `"preserve"`): How to handle www prefix:
  - `"add"`: Add www prefix to apex domains
  - `"remove"`: Remove www prefix from apex domains
  - `"preserve"`: Keep www prefix as-is
- `redirectStatusCode` (default: `301`): HTTP status code for redirects (301, 302, 307, or 308)
- `skipInDevelopment` (default: `true`): Skip validation in development mode
- `preservePort` (default: `false`): Whether to preserve port numbers in redirects
- `invalidDomainHandler` (optional): Custom function to format the error response for blocked requests (e.g., JSON/text/HTML). Does not bypass validation or allow the request to proceed.

**Examples:**

```typescript
// Basic setup - validate domain and enforce HTTPS
domainValidation({
  validProductionDomains: ["example.com"],
});

// Multiple domains with canonical redirect
domainValidation({
  validProductionDomains: ["example.com", "www.example.com", "example.org"],
  canonicalDomain: "example.com",
  wwwHandling: "remove",
});

// Wildcard subdomains with WWW addition
domainValidation({
  validProductionDomains: ["*.example.com"],
  wwwHandling: "add",
});

// Custom error handling
domainValidation({
  validProductionDomains: ["example.com"],
  invalidDomainHandler: (request, domain, isDev, isAPI) => ({
    contentType: "html",
    content: `<h1>Access denied for ${domain}</h1>`,
  }),
});

// Custom development setup with port preservation
domainValidation({
  validProductionDomains: ["dev.example.com"],
  preservePort: true,
  skipInDevelopment: false,
});
```

**Proxy Support:**

The plugin automatically handles common proxy headers:

- `x-forwarded-host`: Uses the forwarded host for domain validation
- `x-forwarded-proto`: Respects the original protocol for HTTPS enforcement

**Error Responses:**

- **API endpoints**: Returns JSON error responses
- **Web requests**: Returns plain text error by default (or HTML if your custom handler returns it)
- **Custom handler**: Use `invalidDomainHandler` for custom error handling
