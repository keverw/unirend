# Built-In Plugins

<!-- toc -->

- [Overview](#overview)
- [Catalog](#catalog)
- [Ordering](#ordering)
  - [A Hook That Throws Above the Gate](#a-hook-that-throws-above-the-gate)
- [When a Callback Fails](#when-a-callback-fails)

<!-- tocstop -->

## Overview

Unirend provides a collection of built-in plugins that handle common server functionality. These plugins are available through the `unirend/plugins` namespace and can be easily integrated into your SSR or API servers.

> Note: This page lists the ready-to-use, maintained plugins that ship with Unirend. If you want to build your own plugin or learn how the plugin system works, see the server plugin system guide: [docs/server-plugins.md](./server-plugins.md).

Some built-in plugins also cooperate with Unirend's internal hijacked/raw response paths. For example, the built-in `securityHeaders` plugin shares its header application logic so static-content responses that use `reply.hijack()` still receive the expected CORS/security headers.

## Catalog

- [securityHeaders](built-in-plugins/security-headers.md)
- [cookies](built-in-plugins/cookies.md)
- [domainValidation](built-in-plugins/domainValidation.md)
- [staticContent](built-in-plugins/staticContent.md)

## Ordering

Only one property of a plugin decides whether its position matters: **does it add a per-request hook?**

- **A plugin that can end a request is a gate**, and a gate only covers what is registered after it. [`domainValidation`](built-in-plugins/domainValidation.md#plugin-order) is one, as is any auth or rate-limit plugin of your own. Register it before whatever it is meant to gate.
- **A hook that throws counts as ending the request**, even though it never meant to. The error handler answers on its behalf, and that answer is a fully rendered response on a host the gate had not reached yet. This is the part that is easy to miss, so it has its own section below.
- **A plugin that does its work at registration time never touches a request at all**, so its position is free. A database plugin that opens a connection and calls `decorate('db', db)` is the usual example, and it is safe above a gate because it adds no hook that could run, or fail, ahead of one.
- **[`securityHeaders`](built-in-plugins/security-headers.md#plugin-order-and-short-circuited-responses) has hooks but is still free to move**, for a different reason. It adds headers rather than ending requests, and an `onSend` backstop lets it fill them in on the way out, even for a response that ended before it ran.

So "`domainValidation` goes first" means first among the plugins with per-request hooks, not first in the array. A connection plugin above it changes nothing:

```typescript
plugins: [
  databasePlugin, // connects and decorates at registration, adds no hook
  domainValidation({ validProductionDomains: hostIsOurs }),
  sessionPlugin, // has a preHandler that can throw, so it belongs below
  securityHeaders({ resolve: lookupTenantPolicy }),
];
```

### A Hook That Throws Above the Gate

Use [`dependsOn`](server-plugins.md#plugin-dependencies) to keep a plugin above whatever reads its decoration, but do not let that push a plugin with hooks above `domainValidation`. Declaring a dependency and registering a hook are separate things, and only the hook is a problem.

The reason is worth seeing concretely. Given a hook that throws, on a host that is not in `validProductionDomains`:

| Throwing hook            | What the visitor gets           |
| ------------------------ | ------------------------------- |
| Below `domainValidation` | `403`, plain text, no HSTS      |
| Above `domainValidation` | `500`, your error page, no HSTS |

**The header is no longer the part that costs you, provided `domainValidation` is registered before `securityHeaders`.** The gate never runs here, so it never sets [`request.domainValidationRejected`](built-in-plugins/domainValidation.md#requestdomainvalidationrejected). When the gate sits above it, `securityHeaders` can read that unset verdict for what it is — the request died before the gate — and [withholds HSTS](built-in-plugins/security-headers.md#hsts-on-a-host-the-server-has-not-claimed) rather than pinning a domain nobody checked to HTTPS for the full `maxAge`. Register the gate below it and the verdict is ambiguous instead, because a preflight or a static asset answered higher up would look identical, so the header goes out as it always did.

What ordering still buys you is the request being refused at all. A gate only covers what was registered after it, so a hook above `domainValidation` turns a clean `403` into a `500` and runs your application's error handling on a host that was never confirmed.

The error page matters much less. Unirend's default is a generic shell, and a custom one is [advised to stay standalone](error-handling.md) rather than wrapped in your usual layout, so there is usually little in it to give away. Where you have customized it, [`isHostUnverified`](built-in-plugins/domainValidation.md#telling-an-unchecked-host-from-a-rejected-one) lets it recognize this case and hold back.

Nothing downstream can repair the header, though, because by the time anything else runs the request has already failed. Ordering is the only fix there: put `domainValidation` above every plugin that adds a hook.

## When a Callback Fails

Several built-in callbacks are request-aware, which means several of them can reach a database, and a database can be down. What happens then is not uniform, and the difference is deliberate:

| Plugin | Callback | On throw |
| --- | --- | --- |
| `securityHeaders` | `cors.origin` | Origin denied, no `Access-Control-Allow-Origin` |
| `securityHeaders` | `cors.credentials` | Credentials withheld, the origin decision stands |
| `domainValidation` | `invalidDomainHandler` | Default rejection response is sent, the rejection itself stands |
| `domainValidation` | `validProductionDomains` | Propagates, your error handler renders the 500 |
| `securityHeaders` | `resolve` | Propagates, your error handler renders the 500 |

**The first three answer a narrow question that still has a safe answer without them.** Denying an origin costs one cross-origin caller its response and leaves the rest of the site working. Falling back to the default rejection wording costs nothing at all, because the rejection was already decided. So those degrade rather than fail the request.

**The last two could not answer at all, so the request fails.** A `500` is the honest status for both: nothing was decided about the caller, only that the server could not do its job. Neither is refused a `403`, which would claim the caller was understood and turned away, file an outage in your logs as an authorization failure, and send whoever reads it looking for bad credentials.

Both propagate rather than answering from inside their plugin, so a store outage behaves like any other server-side failure and reaches the error handling you already have, rather than being swallowed by a canned response nothing reports on.

The difference between them is what the request knows by that point. `resolve` fails after the host passed whatever gate you have, so your error page is simply the right page. `validProductionDomains` fails while the host is still unconfirmed, so it marks the host [disclaimed](built-in-plugins/domainValidation.md#requestdomainvalidationrejected) first: the response gets no HSTS, and [`isHostUnverified`](built-in-plugins/domainValidation.md#telling-an-unchecked-host-from-a-rejected-one) lets your error page recognize this as a special kind of 500 and say less.

See [Throwing on Purpose](built-in-plugins/security-headers.md#throwing-on-purpose) for treating that as a deliberate choice.

Whatever the default, only you can tell a genuine "not one of ours" from "the store is down". If a single store backs more than one of these, handle its failure inside each callback rather than letting the defaults decide for you.

**None of this affects whether the response gets its headers.** These defaults decide what the response _is_, and the `onSend` hook in `securityHeaders` then applies headers to whatever that turned out to be. A denied origin, and the 500s from a failed validator or a failed `resolve`, all go out fully covered, minus the HSTS that a [disclaimed host](built-in-plugins/security-headers.md#hsts-on-a-host-the-server-has-not-claimed) or a [failed resolve](built-in-plugins/security-headers.md#when-resolve-throws) deliberately drops. The two mechanisms are unrelated: one picks the response, the other dresses it.
