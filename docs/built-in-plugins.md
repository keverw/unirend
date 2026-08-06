# Built-In Plugins

<!-- toc -->

- [Overview](#overview)
- [Catalog](#catalog)
- [Ordering](#ordering)
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

Only one property of a plugin decides whether its position matters: **can it end a request?**

- **A plugin that can end a request is a gate**, and a gate only covers what is registered after it. [`domainValidation`](built-in-plugins/domainValidation.md#plugin-order) is one, as is any auth or rate-limit plugin of your own. Register it before whatever it is meant to gate.
- **A plugin that only decorates, connects, or reads never ends a request**, so nothing can slip past it and its position is free. A database plugin that opens a connection and calls `decorate('db', db)` is the usual example, and it is perfectly safe above a gate, because a request that the gate rejects simply never uses the decoration. Use [`dependsOn`](server-plugins.md#plugin-dependencies) to keep it above whichever plugins read it.
- **[`securityHeaders`](built-in-plugins/security-headers.md#plugin-order-and-short-circuited-responses) is neither**, and its position is free for a different reason. It adds headers rather than ending requests, and an `onSend` backstop lets it fill them in on the way out, even for a response that ended before it ran.

So "`domainValidation` goes first" means first among the plugins that answer requests, not first in the array. A connection plugin above it changes nothing about what it gates:

```typescript
plugins: [
  databasePlugin, // decorates only, never answers a request
  domainValidation({ validProductionDomains: hostIsOurs }),
  securityHeaders({ resolve: lookupTenantPolicy }),
];
```

## When a Callback Fails

Several built-in callbacks are request-aware, which means several of them can reach a database, and a database can be down. What happens then is not uniform, and the difference is deliberate:

| Plugin | Callback | On throw |
| --- | --- | --- |
| `domainValidation` | `validProductionDomains` | Domain rejected, visitor gets the same 403 an unknown host gets |
| `domainValidation` | `invalidDomainHandler` | Default rejection response is sent, the rejection itself stands |
| `securityHeaders` | `cors.origin` | Origin denied, no `Access-Control-Allow-Origin` |
| `securityHeaders` | `cors.credentials` | Credentials withheld, the origin decision stands |
| `securityHeaders` | `resolve` | Propagates, Fastify turns it into a 500 |

**The first four answer a narrow yes-or-no question, and "no" is a safe answer.** It costs one caller its response and leaves the rest of the site working, which is why those fail closed instead of failing the request.

**`resolve` does not answer a question, it computes a policy, and there is no safe substitute for a policy.** Falling back to the baseline is a guess, and on the very domain whose lookup just failed it can be the wrong one, since the baseline is written for domains you own. So it propagates instead. See [Throwing on Purpose](built-in-plugins/security-headers.md#throwing-on-purpose).

<!-- prettier-ignore -->
> [!IMPORTANT]
> One outage can therefore produce a 403 from one callback and a 500 from another on the same request. Each default is defensible on its own, but together they are a mix nobody chose.

If a single store backs more than one of these, handle its failure inside each callback rather than letting the defaults decide for you. Only you can tell "not one of ours" from "the store is down", and only you know which of the two answers your deployment should give.

**None of this affects whether the response gets its headers.** These defaults decide what the response _is_, and the `onSend` hook in `securityHeaders` then applies headers to whatever that turned out to be. A 403 from a failed validator and a 500 from a failed `resolve` both go out fully covered, minus the HSTS that a [disclaimed host](built-in-plugins/security-headers.md#hsts-on-a-rejected-host) or a [failed resolve](built-in-plugins/security-headers.md#when-resolve-throws) deliberately drops. The two mechanisms are unrelated: one picks the response, the other dresses it.
