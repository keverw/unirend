# Built-in Plugins

<!-- toc -->

- [Overview](#overview)
- [Catalog](#catalog)

<!-- tocstop -->

## Overview

Unirend provides a collection of built-in plugins that handle common server functionality. These plugins are available through the `unirend/plugins` namespace and can be easily integrated into your SSR or API servers.

> Note: This page lists the ready-to-use, maintained plugins that ship with Unirend. If you want to build your own plugin or learn how the plugin system works, see the server plugin system guide: [docs/server-plugins.md](./server-plugins.md).

Some built-in plugins also cooperate with Unirend's internal hijacked/raw response paths. For example, the built-in `cors` plugin shares its header application logic so static-content responses that use `reply.hijack()` still receive the expected CORS/security headers.

## Catalog

- [cors](built-in-plugins/cors.md)
- [clientInfo](built-in-plugins/clientInfo.md)
- [cookies](built-in-plugins/cookies.md)
- [domainValidation](built-in-plugins/domainValidation.md)
- [staticContent](built-in-plugins/staticContent.md)
