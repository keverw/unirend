# cookies

<!-- toc -->

- [Overview](#overview)
- [Usage](#usage)
- [Options](#options)
  - [SameSite and Secure Matrix](#samesite-and-secure-matrix)
  - [Recommended Patterns](#recommended-patterns)
  - [Key Rotation](#key-rotation)
  - [Dynamic Signer (Advanced)](#dynamic-signer-advanced)
  - [Reading and Setting Cookies](#reading-and-setting-cookies)
    - [Reading Cookies](#reading-cookies)
    - [Setting Cookies](#setting-cookies)
    - [Verifying an incoming signed cookie](#verifying-an-incoming-signed-cookie)
  - [Serialize Options for reply.setCookie](#serialize-options-for-replysetcookie)
  - [Manual Utilities (Re-exports)](#manual-utilities-re-exports)
  - [Decorations and Runtime Access](#decorations-and-runtime-access)
- [Plugin Dependencies](#plugin-dependencies)

<!-- tocstop -->

## Overview

The `cookies` plugin is a thin wrapper around `@fastify/cookie` that integrates with Unirend's plugin system. It enables cookie parsing and exposes `reply.setCookie/clearCookie` to handlers via the `ControlledReply` surface.

Plugins can depend on this plugin by declaring a dependency on the plugin name `"cookies"` in their metadata.

## Usage

```typescript
import { serveSSRDev } from 'unirend/server';
import { cookies } from 'unirend/plugins';

const server = serveSSRDev(
  {
    serverEntry: './src/entry-server.tsx',
    template: './index.html',
    viteConfig: './vite.config.ts',
  },
  {
    plugins: [
      cookies({
        secret: process.env.COOKIE_SECRET!,
        algorithm: 'sha256',
        hook: 'onRequest',
        parseOptions: { path: '/' },
      }),
    ],
  },
);

// In handlers, use reply:ControlledReply to set cookies when @fastify/cookie is registered
server.pageLoader.register('example', (request, reply) => {
  reply.setCookie?.('session', 'abc', { httpOnly: true, sameSite: 'lax' });
  return /* envelope */;
});
```

## Options

- `secret?: string | string[] | Buffer | Buffer[] | object`: Secret(s) for cookie signing.
  - Array enables key rotation.
  - Object enables a custom signer (e.g., providing `sign(value)`/`unsign(value)` methods). This follows the capabilities offered by `@fastify/cookie`.

- `hook?: "onRequest" | "preParsing" | "preValidation" | "preHandler" | false`: Lifecycle hook for parsing. Defaults to `onRequest`. Setting this to `false` disables autoparsing (you can still use `reply.setCookie/clearCookie` and manual cookieUtils utilities, but `request.cookies` will not be populated automatically).
- `algorithm?: string`: Hash algorithm used for signing (default `sha256`).
- `parseOptions?: CookieSerializeOptions`: Options that control cookie serialization when setting cookies (and provide decode behavior when parsing). Note: despite the name, upstream uses `parseOptions` in two places:
  - for parsing (`fastify.parseCookie`): only decode-related behavior applies
  - for setting cookies: merged into per‑call options for serialization
- `domain`: Value for the Domain attribute. By default, no domain is set, and most clients will consider the cookie to apply to only the current domain.
- `encode(val: string)`: Custom encoder. Default is `encodeURIComponent`.
- `expires`: Date for the Expires attribute. By default, no date is set, most clients treat no date as a session (non‑persistent) cookie. If both `expires` and `maxAge` are set, `maxAge` takes precedence per spec, however, prefer NOT setting both, choose one per cookie based on context.
- `httpOnly`: Add HttpOnly, blocks `document.cookie`. Default is `false`
- `maxAge`: Max‑Age in seconds (integer, rounded down). No default. Generally takes precedence over `expires`. Recommendation: avoid setting both, use `maxAge` for relative lifetimes (e.g., 30 days) or `expires` for an absolute cutoff.
- `partitioned`: Add the Partitioned attribute (non‑standard, may be ignored by clients).
- `priority`: One of `low | medium | high` for eviction priority (default is `medium` when not set).
- `path`: Value for the Path attribute. If omitted, the browser applies the default‑path algorithm (typically the request path up to the right‑most `/`). Recommendation: set `path: "/"` for cookies that should apply to the entire domain.
- `sameSite`: One of `lax | none | strict | boolean` (true → Strict, false → omit).
- `secure`: `boolean | "auto"` (`"auto"` sets Secure only over HTTPS).
- `signed`: Per‑cookie signing flag. When true, that cookie is signed using configured secret(s). If set in top‑level `parseOptions`, it acts as the default for `reply.setCookie`/`reply.clearCookie` (upstream merges `parseOptions` into per‑call options) and can be overridden per call.

These map directly to `@fastify/cookie` options and are passed through.

Security notes:

- Prefer `sha256` or stronger, and a secret of at least 20 bytes.
- If you set `sameSite: "none"`, you must also set `secure: true` (or `"auto"` under TLS). See the matrix below.

### SameSite and Secure Matrix

| sameSite option   | secure required?       | Sent on cross-site navigations (link/new tab)? | Sent on subrequests (iframe, fetch, POST)? | Notes                                                                                                                                                                                       |
| ----------------- | ---------------------- | ---------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"strict"`        | No                     | No                                             | No                                         | Only sent when the address bar already matches the cookie’s site. Not sent when arriving from other sites or direct bookmark visits.                                                        |
| `"lax"` (default) | No                     | Yes                                            | No                                         | Sent on cross-site navigations using safe methods (like GET via link/new tab or redirects). Not sent on **cross-site subrequests** (iframe, fetch, or form POST), good default for sessions |
| `"none"`          | Yes (true or `"auto"`) | Yes                                            | Yes                                        | Required for cross-site use in embeds/third‑party contexts. Without Secure, browsers drop the cookie                                                                                        |

### Recommended Patterns

- Main session (first-party):
  - **sameSite: "lax"**, secure: true, httpOnly: true
  - Works with top-level redirects (e.g., auth callbacks) without needing SameSite="none".
- Embeds/widgets (third-party iframes):
  - For public cross‑site APIs, prefer tokens via the **Authorization** header over cookies, configure CORS appropriately and avoid cookies/CSRF.
  - If cookies are required, use a **separate, short‑lived cookie** with **SameSite="none" + Secure: true**, narrowly scoped permissions.
  - Include a per-embed CSRF token in the HTML and validate it on state-changing requests.

### Key Rotation

Array secrets enable rotation, but changes are applied on server startup. Recommended phased rollout:

1. Verify-only (optional): `secret: [oldKey, newKey]` — continue signing with `oldKey` (first), allow `newKey` to verify.
2. Flip signer: `secret: [newKey, oldKey]` — start signing with `newKey`, both keys verify.
3. Cleanup: `secret: [newKey]` — after old cookies naturally expire.

Notes:

- Use rolling restarts so all instances share the same array during transitions.
- Do not remove the old key until you are confident old cookies have expired or been refreshed.

Alternatively, use a custom dynamic signer to support runtime rotation without redeploys.

### Dynamic Signer (Advanced)

For runtime rotation without restarts, pass a custom signer object as `secret`. This lets you control signing/verification and read keys from a dynamic source.

```ts
// Example shape — implement according to @fastify/cookie's custom signer contract
// Unsign must return an UnsignResult object: { valid, renew, value }
const keysRef = { current: { primary: 'k2', all: ['k2', 'k1'] } };

const customSigner = {
  // Return the signed cookie value using the current primary key
  sign(value: string): string {
    // e.g., HMAC(value, keysRef.current.primary, "sha256") + value
    return signWithKey(value, keysRef.current.primary);
  },
  // Verify against all active keys, returning an UnsignResult
  unsign(signed: string): {
    valid: boolean;
    renew: boolean;
    value: string | null;
  } {
    // Try current primary first
    const primary = keysRef.current.primary;
    const primaryResult = unsignWithKey(signed, primary);

    if (primaryResult.valid) {
      return { valid: true, renew: false, value: primaryResult.value };
    }

    // Try fallback/older keys
    for (const key of keysRef.current.all) {
      if (key === primary) continue;

      const res = unsignWithKey(signed, key);

      if (res.valid) {
        // Consider it valid, but mark renew=true to reissue with primary key
        return { valid: true, renew: true, value: res.value };
      }
    }

    // Not valid under any known key
    return { valid: false, renew: false, value: null };
  },
};

const server = serveSSRDev(paths, {
  plugins: [cookies({ secret: customSigner })],
});

// Later (e.g., via admin task), rotate keys in memory without restart
keysRef.current = { primary: 'k3', all: ['k3', 'k2'] };
```

Considerations and rollout tips:

- Implement `sign`/`unsign` to match `@fastify/cookie`'s signer expectations (return `{ valid, renew, value }`).
- Coordinate updates across all instances so verification remains consistent cluster‑wide.
- Plan a window where both new and previous keys verify before fully retiring old keys.
- Store keys in a secure location (e.g., DB/secret manager/enclave). On config refresh, load the new key into the verification set (verify‑only) while retaining the current primary.
- After config propagation to every server, later promote the new key to primary for signing without restart (dynamic signer flow).
- Retire the previous key from the verification set once you are confident old cookies have expired.

### Reading and Setting Cookies

#### Reading Cookies

Values in `request.cookies` are not auto‑verified, if a cookie was set with `signed: true`, the stored value will be the signed payload. Use `reply.unsignCookie(raw)` to verify and recover the original value (and optionally reissue when `renew` is true, indicating the cookie was signed with an older key).

```ts
server.pageLoader.register('profile', (request) => {
  const cookies = (request as any).cookies; // added by @fastify/cookie
  const theme = cookies?.theme; // e.g., "dark"
  // ...
});
```

#### Setting Cookies

```ts
server.pageLoader.register('login', (request, reply) => {
  // Unsigned, JS-readable cookie (avoid for sensitive data)
  reply.setCookie?.('prefs', 'lang=en', { path: '/', sameSite: 'lax' });

  // Signed, httpOnly cookie (recommended for session identifiers)
  reply.setCookie?.('sid', '<opaque>', {
    path: '/',
    httpOnly: true,
    secure: 'auto', // sets Secure when over HTTPS
    sameSite: 'lax',
    signed: true,
  });

  return /* envelope */;
});
```

Notes:

- Signing is server-side, clients cannot create valid signatures. If you need a JS-readable cookie, omit `signed: true` and not setting `httpOnly`.
- For sensitive data, prefer `httpOnly: true` and avoid storing secrets in cookies altogether.

#### Verifying an incoming signed cookie

```ts
server.pageLoader.register('profile', (request, reply) => {
  const raw = (request as any).cookies?.sid;

  if (raw && reply.unsignCookie) {
    const res = reply.unsignCookie(raw);

    if (res.valid) {
      const sid = res.value;

      if (res.renew) {
        // Reissue with primary key
        reply.setCookie?.('sid', sid, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: 'auto',
          signed: true,
        });
      }
      // use sid
    } else {
      // invalid signature → ignore or clear
    }
  }

  return /* envelope */;
});
```

### Serialize Options for reply.setCookie

Common options you can pass to `reply.setCookie(name, value, options)`:

- `domain`: Value for the Domain attribute.
- `encode`: Custom encoder for the cookie value (default `encodeURIComponent`).
- `expires`: Date for the Expires attribute.
- `httpOnly`: When true, adds HttpOnly (blocks `document.cookie`).
- `maxAge`: Max-Age in seconds.
- `partitioned`: Adds the non-standard Partitioned attribute (experimental, limited browser support). Evaluate before use.
- `priority`: One of `"low" | "medium" | "high"`.
- `path`: Value for the Path attribute.
- `sameSite`: One of `true | false | "lax" | "none" | "strict"` (where `true` maps to Strict).
- `secure`: Boolean, or `"auto"` to set Secure automatically when TLS is used.
- `signed`: When true, the cookie value is signed using your configured secret(s).

### Manual Utilities (Re-exports)

For convenience, Unirend re-exports `@fastify/cookie` utilities via a curated `cookieUtils` object from `unirend/plugins` so you can use them without importing the upstream package directly:

```ts
import { cookieUtils } from 'unirend/plugins';

const raw = cookieUtils.serialize('lang', 'en', { maxAge: 60_000 });
const parsed = cookieUtils.parse('lang=en');

const signed = cookieUtils.sign('test', 'secret');
const result = cookieUtils.unsign(signed, 'secret'); // { valid, renew, value }

const signer = new cookieUtils.Signer(['k2', 'k1'], 'sha256');
const customSigned = signer.sign('hello');

// Equivalent factory usage (returns an object with sign/unsign)
const factorySigner = cookieUtils.signerFactory(['k2', 'k1'], 'sha256');
const factorySigned = factorySigner.sign('world');
const factoryResult = factorySigner.unsign(factorySigned);
```

Types exported for convenience:

- `CookieSerializeOptions` — options type for `reply.setCookie/clearCookie`
- `CookieUnsignResult` — return type of `reply.unsignCookie`/`cookieUtils.unsign`

For example, If you set `hook: false`, `request.cookies` will NOT be populated automatically, and you must parse cookies manually using the exported cookieUtils:

```ts
import { cookieUtils } from 'unirend/plugins';
const cookies = cookieUtils.parse(request.headers.cookie || '');
```

### Decorations and Runtime Access

Provided by this plugin:

- Server Instance:
  - `cookiePluginInfo`: `{ signingSecretProvided: boolean; algorithm: string }`

Provided by `@fastify/cookie` (available at runtime and inside plugins):

- Server Instance:
  - `serializeCookie(name, value, options)`
  - `parseCookie(cookieHeader)`
  - `signCookie(value)` / `unsignCookie(value)` (when a secret/signer is configured)
- Request:
  - `cookies: Record<string, string | undefined>`
  - `signCookie(value)` / `unsignCookie(value)`
- Reply:
  - `setCookie(name, value, options)` and alias `cookie(name, value, options)`
  - `clearCookie(name, options)`
  - `signCookie(value)` / `unsignCookie(value)`

Reading from code:

```ts
// From server object
const info = server.getDecoration<{
  signingSecretProvided: boolean;
  algorithm: string;
}>('cookiePluginInfo');

// From another plugin (declare dependsOn: "cookies")
const { cookiePluginInfo } = pluginHost as unknown as {
  cookiePluginInfo?: { signingSecretProvided: boolean; algorithm: string };
};
```

In Unirend request handlers, prefer `reply.setCookie/clearCookie` from the `ControlledReply` surface and `cookieUtils.parse/serialize` for manual tasks. Use `server.getDecoration("cookiePluginInfo")` (or `pluginHost.getDecoration`) to detect signing capability.

## Plugin Dependencies

This plugin returns metadata `{ name: "cookies" }`. Other plugins that require cookies can declare a dependency to ensure order:

```typescript
const myPlugin: ServerPlugin = async (pluginHost, options) => {
  return { name: 'my-plugin', dependsOn: 'cookies' };
};
```
