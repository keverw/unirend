# domainValidation

<!-- toc -->

- [About](#about)
- [Features](#features)
- [Usage](#usage)
- [Configuration](#configuration)
- [Examples](#examples)
- [Proxy support](#proxy-support)
- [Error responses](#error-responses)

<!-- tocstop -->

## About

The `domainValidation` plugin provides comprehensive domain security and normalization for production deployments. It handles domain validation, canonical redirects, HTTPS enforcement, WWW prefix management, and proxy header support.

## Features

- **Domain validation**: Validates requests against allowed production domains with wildcard support
- **Canonical domain redirects**: Redirects to the preferred domain when multiple domains are configured
- **HTTPS enforcement**: Automatically redirects HTTP requests to HTTPS with proxy header support
- **WWW prefix handling**: Add or remove WWW prefix with smart apex domain detection (no changes to subdomains)
- **Punycode normalization**: Handles international domains (IDN) safely with punycode conversion
- **Proxy-aware**: Supports `x-forwarded-host` and `x-forwarded-proto` headers
- **API endpoint detection**: Different error handling for API vs web requests
- **Single redirect**: Combines multiple redirect conditions to avoid redirect chains
- **Port preservation**: Configurable port handling for development and custom setups
- **Development-friendly**: Automatically skips validation for localhost, 127.0.0.1, ::1, and development mode

## Usage

```typescript
import { domainValidation } from 'unirend/plugins';

const server = serveSSRProd(buildDir, {
  plugins: [
    domainValidation({
      validProductionDomains: ['example.com', '*.example.com'],
      canonicalDomain: 'example.com',
      enforceHTTPS: true,
      wwwHandling: 'remove',
      redirectStatusCode: 301,
      skipInDevelopment: true,
    }),
  ],
});
```

## Configuration

- `validProductionDomains` (optional): String when a single domain, or array of allowed domains with wildcard support:
  - `"example.com"`: Exact match only
  - `"*.example.com"`: Direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
  - `"**.example.com"`: All subdomains including nested (`api.example.com` ✅, `app.api.example.com` ✅)
  - Note: Domain validation is protocol-agnostic (ignores http/https)
  - Apex domains never match wildcard entries, include the apex explicitly alongside subdomain patterns.
  - If not provided, domain validation is skipped. Use this to protect against unexpected domains pointing at your server (e.g., DNS misconfiguration or hostile `Host` headers). Requests from non-allowed hosts are always blocked, `invalidDomainHandler` only customizes the error response.
- `canonicalDomain` (optional): Preferred domain/host to redirect to when multiple domains are allowed
  - Provide a hostname or IP (IPv4 or IPv6), with no protocol
  - Use `wwwHandling` to add/remove the `www` prefix for apex domains
  - IPv6 hosts are bracketed automatically in redirects (you can pass either `2001:db8::1` or `[2001:db8::1]`)
- `enforceHTTPS` (default: `true`): Whether to redirect HTTP requests to HTTPS
- `wwwHandling` (default: `"preserve"`): How to handle www prefix:
  - `"add"`: Add www prefix to apex domains
  - `"remove"`: Remove www prefix from apex domains
  - `"preserve"`: Keep www prefix as-is
- `redirectStatusCode` (default: `301`): HTTP status code for redirects (301, 302, 307, or 308)
- `skipInDevelopment` (default: `true`): Skip validation in development mode
- `trustProxyHeaders` (default: `false`): Only when `true`, the plugin will read `x-forwarded-host` and `x-forwarded-proto` from requests to determine original host and protocol. Enable this only when behind a trusted proxy/load balancer.
- `preservePort` (default: `false`): Whether to preserve port numbers in redirects
- `invalidDomainHandler` (optional): Custom function to format the error response for blocked requests (e.g., JSON/text/HTML). Does not bypass validation or allow the request to proceed.
  - **Security Note**: When returning HTML with dynamic values, always escape them using `escapeHTML` from `unirend/utils` to prevent XSS attacks.

## Examples

```typescript
// Basic setup - validate domain and enforce HTTPS
domainValidation({
  validProductionDomains: ['example.com'],
});

// Single string form also works
domainValidation({
  validProductionDomains: 'example.com',
});

// Multiple domains with canonical redirect
domainValidation({
  validProductionDomains: ['example.com', 'www.example.com', 'example.org'],
  canonicalDomain: 'example.com',
  wwwHandling: 'remove',
});

// Wildcard subdomains with explicit apex and WWW addition
domainValidation({
  validProductionDomains: ['example.com', '**.example.com'], // Explicit apex + all subdomains
  wwwHandling: 'add',
});

// Direct subdomains only (more restrictive)
domainValidation({
  validProductionDomains: ['example.com', '*.example.com'], // Explicit apex + direct subdomains only
  wwwHandling: 'remove',
});

// Custom error handling
// ⚠️ Security: Always escape dynamic values when returning HTML to prevent XSS
import { escapeHTML } from 'unirend/utils';

domainValidation({
  validProductionDomains: ['example.com'],
  invalidDomainHandler: (request, domain, isDev, isAPI) => ({
    contentType: 'html',
    content: `<h1>Access denied for ${escapeHTML(domain)}</h1>`,
  }),
});

// Custom development setup with port preservation
domainValidation({
  validProductionDomains: ['dev.example.com'],
  preservePort: true,
  skipInDevelopment: false,
});
```

## Proxy support

When `trustProxyHeaders: true`, the plugin handles common proxy headers (first value used if comma-separated):

- `x-forwarded-host`: Uses the forwarded host for domain validation
- `x-forwarded-proto`: Respects the original protocol for HTTPS enforcement

## Error responses

- **API endpoints**: Returns JSON error responses
- **Web requests**: Returns plain text error by default (or HTML if your custom handler returns it)
- **Custom handler**: Use `invalidDomainHandler` for custom error handling
