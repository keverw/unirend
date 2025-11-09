# Domain & Origin Utilities

Hardened helpers for normalizing and matching domains and origins used in CORS and routing. Includes IDNA/TR46 normalization, IPv6 (zone IDs), and robust wildcard semantics.

## Quick links

- API: see `domain-utils.ts`
- Tests: `domain-utils.test.ts`
- Security guidance: see below

## Why use this

- Consistent origin/domain normalization across environments
- Safer wildcard matching (rejects `*.com`, forbids partial-label wildcards, IP-tail guard)
- Protocol-aware origin wildcards with scheme enforcement (e.g., `https://*`, `https://*.example.com`)

## Dependencies

- `tr46` for IDNA/Unicode domain processing
- `tldts` for public suffix queries

## Quick start

Pick a helper for your scenario and validate entries at startup:

- **Public APIs (no credentials)**: `matchesOriginList` + `validateConfigEntry(..., "origin")`
- **Credentials (exact only)**: `matchesCORSCredentialsList`
- **Credentials (subdomains)**: `matchesCORSCredentialsList(..., { allowWildcardSubdomains: true })` + `validateConfigEntry`
- **Domain-only checks**: `matchesDomainList` (schemes are not allowed)

Example:

```ts
for (const e of allowedOrigins) {
  const v = validateConfigEntry(e, 'origin', { allowGlobalWildcard: false });
  if (!v.valid) throw new Error(`Invalid origin: ${e} (${v.info})`);
}

const ok = matchesOriginList(
  req.headers.get('Origin') ?? undefined,
  allowedOrigins,
);
```

## Wildcard semantics

- `*` matches exactly one label
- `**` matches zero-or-more labels; when leftmost, at least one label is required before the fixed tail
- Multi-label patterns like `*.*.example.com` are supported and must match the exact number of wildcarded labels
- Partial-label wildcards are not allowed. A label may be `*` or `**` only; patterns like `ex*.demo.com`, `*ample.demo.com`, `a*b.demo.com`, `foo*bar.demo.com` are rejected.
- Apex domains never match wildcard patterns; list apex explicitly
- Origins:
  - `*` matches any valid HTTP(S) origin
  - `https://*` or `http://*` matches any origin with that scheme
  - `https://*.example.com` matches direct subdomains over HTTPS only

## Security hardening

- Rejects partial-label wildcards (e.g., `ex*.example.com`)
- Rejects invalid characters in patterns: ports, paths, fragments, brackets, userinfo, backslashes
- PSL/IP tail guard: disallows patterns like `*.com` or `**.co.uk`, and forbids wildcarding around IPs
- Unicode dot normalization (`．。｡` → `.`) to avoid bypasses
- Step limits and label count caps to avoid pathological inputs
- Credentials helpers: exact-only and wildcard-enabled variants

## API surface

- `normalizeDomain(domain: string): string`
- `normalizeOrigin(origin: string): string`
- `matchesWildcardDomain(domain: string, pattern: string): boolean`
- `matchesWildcardOrigin(origin: string, pattern: string): boolean`
- `matchesDomainList(domain: string, allowedDomains: string[]): boolean`
- `matchesOriginList(origin: string | undefined, allowedOrigins: string[], opts?: { treatNoOriginAsAllowed?: boolean }): boolean`
- `matchesCORSCredentialsList(origin: string | undefined, allowedOrigins: string[], options?: { allowWildcardSubdomains?: boolean }): boolean`
- `validateConfigEntry(entry: string, context: "domain" | "origin", options?: { allowGlobalWildcard?: boolean; allowProtocolWildcard?: boolean }): { valid: boolean; info?: string; wildcardKind: "none" | "global" | "protocol" | "subdomain" }`
- `isIPAddress(s: string): boolean`

## Configuration & validation

- Validate configuration at startup with `validateConfigEntry` and reject misconfigurations early.
- Prefer exact matches for credentials; enable wildcard credentials only when subdomains are strictly required and after validation.
- For hot paths, pre-normalize/validate allowlists once and reuse them.

### Validate at startup

Validate every allowlist entry (domain/origin) at startup with `validateConfigEntry`. This ensures each entry is structurally safe before you pass it to matchers at runtime.

```ts
for (const entry of allowedOrigins) {
  const v = validateConfigEntry(entry, 'origin', {
    allowGlobalWildcard: false,
  });

  if (!v.valid) throw new Error(`Invalid origin: ${entry} (${v.info})`);
}
```

Domain list example (reject origin-style entries early):

```ts
for (const entry of allowedDomains) {
  const v = validateConfigEntry(entry, 'domain');
  if (!v.valid) throw new Error(`Invalid domain: ${entry} (${v.info})`);
}
```

Inputs: a single entry (domain, domain pattern, origin, or protocol wildcard)

Outputs: `{ valid, info?, wildcardKind }`, where `wildcardKind` is `"none" | "global" | "protocol" | "subdomain"` and `info` may include hints (e.g., non-http(s) scheme).

## End-to-end example

```ts
import { matchesOriginList, validateConfigEntry } from './domain-utils';

const allowed = ['https://*.example.com', 'https://partner.io', '*']; // example

// Validate at config time
for (const entry of allowed) {
  const v = validateConfigEntry(entry, 'origin', { allowGlobalWildcard: true });
  if (!v.valid) throw new Error(`Invalid origin entry: ${entry} (${v.info})`);
}

// At runtime
const ok = matchesOriginList(
  request.headers.get('Origin') ?? undefined,
  allowed,
  {
    treatNoOriginAsAllowed: false,
  },
);
```

## Recommended defaults

### Quick rules

- Domain vs Origin contexts differ: origins may include protocol wildcards; domains may not.
- `matchesDomainList` allows `"*"` as match-all. If undesired, reject it at config time with `validateConfigEntry`.
- `normalizeOrigin` returns `""` on invalid URLs or failed hostname normalization; the literal `"null"` is preserved.
- In origin lists, `"null"` never matches wildcards. Include `"null"` explicitly if you want to allow it.
- `normalizeDomain` returns `""` on invalid input and strips IPv6 brackets (e.g., `[::1]` → `::1`). Use `validateConfigEntry` at config time if you need hard failures.
- Protocol-only wildcards (e.g., `https://*`) are allowed by default in validation and respected by origin matching.
- In domain context, entries with `://` are invalid; the validator returns info `"protocols are not allowed in domain context"`.

### Behavior notes

- Domain-only checks (`matchesDomainList`) reject origin-style entries (anything with `://`) by throwing. Use `matchesOriginList` for origin-style matching.
- Origin matching: domain wildcard patterns (e.g., `*.example.com`, `**.example.com`) are protocol-agnostic; protocol wildcards (e.g., `https://*`) match only that scheme.
- Credentials: prefer exact-only matching. Enable wildcard subdomains for credentials only when necessary and after pre-validation.
- IPv6 zone IDs: For link-local IPv6 addresses with a zone identifier, the zone must be percent-encoded as `%25`. Major browsers do not support zone IDs in URLs; this is primarily for non-browser clients.
  - Domain/IP example: `"fe80::1%25eth0"` (exact IPs only; wildcards never apply to IPs)

### Defaults by function

- `validateConfigEntry(entry, "domain")`
  - Typical: disallow global `"*"`. Validate concrete domains and wildcard patterns only.

- `validateConfigEntry(entry, "origin", { allowGlobalWildcard, allowProtocolWildcard })`
  - Recommended: `{ allowGlobalWildcard: false, allowProtocolWildcard: true }`. Disable protocol wildcards for stricter setups.
  - Exact origins and bare domains are validated; origins must not include path/query/fragment/userinfo; bracketed IPv6 is supported.

- `matchesDomainList(domain, allowedDomains)`
  - Domains only (no schemes). Throws if any entry contains `://`.
  - If you do not want `"*"` to match all, pre-validate and reject it.

- `matchesOriginList(origin, allowedOrigins, { treatNoOriginAsAllowed })`
  - Default: `{ treatNoOriginAsAllowed: false }`.
  - `"*"` matches any valid HTTP(S) origin; `"null"` must be explicitly listed.

- `matchesCORSCredentialsList(origin, allowedOrigins, { allowWildcardSubdomains })`
  - Default: exact-only. When `allowWildcardSubdomains: true`, subdomain wildcards are honored (e.g., `https://*.example.com`). Always pre-validate entries.

### Global wildcard and credentials

- Public, non-credential CORS: you may intentionally allow all origins by validating with `{ allowGlobalWildcard: true }` and including `"*"` in the allowlist.
- Credentialed CORS: do not use `"*"`. Browsers reject `Access-Control-Allow-Origin: *` when credentials are involved. Prefer exact origins, or enable subdomain wildcards with care and pre-validation.

### Operational guidance

- No-Origin requests: keep `treatNoOriginAsAllowed: false` unless explicitly required.
- Pre-validation: run `validateConfigEntry` on every entry at startup; fail fast on PSL/IP tails, partial-label wildcards, and URL-ish characters.

## Choose the right helper

- **CORS allowlist (non-credentials)**: `matchesOriginList(origin, allowedOrigins)`
  - Supports exact and wildcard origins (including protocol wildcards)
  - Validate at startup with `validateConfigEntry(..., "origin")`
- **CORS with credentials (strict)**: `matchesCORSCredentialsList(origin, allowedOrigins)`
  - Exact matches only; safest for cookies/authorization
- **CORS with credentials (needs subdomains)**: `matchesCORSCredentialsList(origin, allowedOrigins, { allowWildcardSubdomains: true })`
  - Allows wildcards like `https://*.example.com` and multi-label patterns as specified; pre-validate with `validateConfigEntry`
- **Domain-only checks (no scheme)**: `matchesDomainList(domain, allowedDomains)`
  - Rejects origin-style entries; pre-validate with `validateConfigEntry(..., "domain")`
- **Low-level checks**: `matchesWildcardDomain`, `matchesWildcardOrigin`
  - For custom logic; prefer list helpers for most cases

## Common recipes

Allow HTTPS subdomains, include the apex, and one exact partner origin; disallow global wildcard:

```ts
const allowed = [
  'https://example.com', // apex must be listed explicitly
  'https://*.example.com', // direct subdomains only
  'https://partner.io',
]; // no "*"

for (const e of allowed) {
  const v = validateConfigEntry(e, 'origin', { allowGlobalWildcard: false });
  if (!v.valid) throw new Error(`Invalid: ${e} (${v.info})`);
}

const ok = matchesOriginList(req.headers.get('Origin') ?? undefined, allowed);
```

Credentials (exact only):

```ts
const allowedCreds = [
  'https://admin.example.com',
  'https://console.example.com',
];

for (const e of allowedCreds) {
  const v = validateConfigEntry(e, 'origin');
  if (!v.valid) throw new Error(`Invalid: ${e} (${v.info})`);
}

const okCreds = matchesCORSCredentialsList(
  req.headers.get('Origin') ?? undefined,
  allowedCreds,
);
```

Credentials (subdomains required):

```ts
const allowedCredsWildcard = ['https://*.example.com']; // consider risk

for (const e of allowedCredsWildcard) {
  const v = validateConfigEntry(e, 'origin');
  if (!v.valid) throw new Error(`Invalid: ${e} (${v.info})`);
}

const okCredsWildcard = matchesCORSCredentialsList(
  req.headers.get('Origin') ?? undefined,
  allowedCredsWildcard,
  { allowWildcardSubdomains: true },
);
```

## Tests

```bash
bun test
```
