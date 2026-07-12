# Change Log

<!-- toc -->

- [0.0.1 (July 10, 2025)](#001-july-10-2025)
- [0.1.0 (June 19, 2026)](#010-june-19-2026)
- [0.1.1 (July 3, 2026)](#011-july-3-2026)
- [0.1.2 (July 3, 2026)](#012-july-3-2026)
- [0.1.3 (July 3, 2026)](#013-july-3-2026)
- [0.1.4 (July 3, 2026)](#014-july-3-2026)
- [0.1.5 (July 8, 2026)](#015-july-8-2026)
- [Unreleased](#unreleased)

<!-- tocstop -->

## 0.0.1 (July 10, 2025)

- Initial package creation
- Only implemented the mount app function for now

## 0.1.0 (June 19, 2026)

First milestone release. The `0.0.x` line was rapid prerelease iteration that wasn't logged per version; `0.1.0` marks the point where the core APIs are stabilizing. Still pre-1.0, future minor releases may include breaking changes until 1.0.

**Rendering**

- SSR, SSG, and multi-app SSR with a shared base render helper and `mountApp` hydration.
- `UnirendHead` document head manager (title/meta/link plus `<html>`/`<body>` attributes), identical across SSR, SSG, and SPA modes.

**Server**

- Fastify-based SSR, API, redirect, and static-file servers with a plugin system and standardized API/Page response envelopes.
- Page data loaders (HTTP fetch, local, and same-instance short-circuit), including private page-data endpoints and a server-side hook for customizing loader fetches.
- File upload helpers with streaming validation and cleanup, WebSocket support, and a `StaticContentCache` with ETag/LRU caching.
- Native request IDs (ULID) with `getRequestID`, resolved client identity (`connectionIP`/`clientIP` split with a secure forwarded-trust default), and access logging.
- `publicAppConfig`, request context, CDN base URL, and domain info exposed via context hooks on both server and client.

**Tooling**

- `unirend` CLI project generator with SSG/SSR/API starter templates. Generated projects scaffold `AGENTS.md` and a `CLAUDE.md` that imports it, so agent guidelines work across tools.
- ESLint plugin: `prefer-alias-imports` (covering dynamic `import()`), `@/` alias enforcement, and blocking `unirend/context` imports in generated projects.
- Build info utilities (version, Git hash/branch, timestamp).

**Platform**

- ESM-only package on React Router 8, Vite 8, and Node >= 25.
- Dependency upgrades and transitive security fixes; dropped the deprecated `@types/cheerio` stub in favor of cheerio's bundled types.

## 0.1.1 (July 3, 2026)

- Added Unix socket listening support for `APIServer`/`servePlain()` via `server.listen({ path })`, plus generated API starter support through `<APP>_SOCKET_PATH`.
- Fixed the published `unirend` CLI failing to run via `bunx`/`npx` (silent exit 1): the built `dist/cli/cli.js` now starts with a `#!/usr/bin/env bun` shebang and is marked executable, so package managers can execute the `bin`. A post-build guard fails the build if the shebang or executable bit ever goes missing again. Builds now require a POSIX host (macOS/Linux); building on Windows is refused so a tarball can't ship the CLI without its executable bit.
- Set `proseWrap: 'never'` in the repo-root Prettier config and the generated starter's root `prettier.config.js`, so Prettier no longer reflows prose in Markdown and similar files.
- Added a "Markdown & Prose Style" section to `AGENTS.md` and the generated starter's `AGENTS.md`, covering the `proseWrap: 'never'` convention, avoiding em dashes and semicolons in prose, title-case subheadings, and writing GitHub alerts as a `<!-- prettier-ignore -->` guarded two-line block so `proseWrap: 'never'` doesn't collapse them.
- Enabled Markdown-only editor soft-wrap (`"[markdown]": { "editor.wordWrap": "on" }`) in the repo's `.vscode/settings.json` and the generated starter's settings, so the now-single-line Markdown paragraphs stay readable in the editor.
- The starter generator now deep-merges recommended `.vscode/settings.json` values, so re-running it fills missing sub-keys inside existing nested blocks (e.g. adding `editor.wordWrap` to a `[markdown]` block you already have) without overwriting any value you set.
- Updated dependencies to their latest in-range versions (`fastify` 5.9.0, `vite` 8.1.3, `prettier` 3.9.4, `react-router` 8.1.0, `typescript-eslint`/`@typescript-eslint/*` 8.62.1, `@vitejs/plugin-react` 6.0.3, `picomatch` 4.0.5, `qs` 6.15.3, `semver` 7.8.5), and bumped the matching pins in the starter template's generated `package.json`.
- Dropped the `undici` override: `cheerio` now resolves `undici` to a patched 7.28.0 on its own, so forcing it is no longer needed. Kept the `esbuild` override, which is still required because `tsup`/`vite` cap `esbuild` at `^0.27.0` and `bun audit` flags a low-severity Windows dev-server file-read advisory without it.

## 0.1.2 (July 3, 2026)

- Fixed a TypeScript error (`Property 'dir' does not exist on type 'ImportMeta'`) in the generated starter's `scripts/clean-cspell.ts`. It used the Bun-only `import.meta.dir`, whose type is only known to `@types/bun`. Generated projects rely on `@types/node` instead, so the script now uses the standard `import.meta.dirname` (supported by both Node and Bun at runtime).
- Added an `@ts-ignore` (with an `eslint-disable-next-line @typescript-eslint/ban-ts-comment`) directly on the `import('current-build-info.ts')` line to suppress the "cannot find module" error. Because `current-build-info.ts` is generated at build time and gitignored, it may or may not exist at type-check time, and `@ts-ignore` silences the error either way, unlike an `@ts-expect-error`, which would itself fail as an "unused directive" whenever the file is present. The existing `@ts-expect-error` on the `IS_BUILT` line is unchanged, since that suppression is still needed. Applied to the generated SSR and API starters, the SSR demo, and the build-info docs.

## 0.1.3 (July 3, 2026)

- The repo-init empty-directory check now ignores OS/cloud junk files, so `init`/`create` no longer aborts just because a directory contains things like a macOS `.DS_Store` (very common on Mac and in Dropbox folders). The ignore set is matched case-insensitively and covers macOS (`.DS_Store`, `._*`, `.AppleDouble`, `.LSOverride`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`, `Icon\r`), Windows (`Thumbs.db`, `ehthumbs.db`, `Desktop.ini`), Linux (`.directory`, `.Trash-*`), and cloud (`.dropbox`, `.dropbox.attr`), plus git/config files (`.git`, `.gitignore`, `.gitattributes`, `.gitkeep`). A README or LICENSE (bare, or a `.md`/`.txt`/`.markdown` variant) no longer blocks init either, but is logged as a notice so you know it was found and left untouched. Genuinely unexpected content (source files, other configs) still aborts with the existing error, which now lists only the offending files so the message never mentions ignored junk.
- The generator now ensures a root `README.md` and `LICENSE` as base files (only created when missing, like the other base files, so an existing one is never overwritten). The `README.md` is a generic workspace readme titled with the repo name, and the `LICENSE` is a placeholder that matches the generated `package.json` defaults (`"private": true`, `"license": "UNLICENSED"`), reserving all rights and reminding you to pick a real SPDX license before making the repo public.
- The generated starter's `AGENTS.md` (and this repo's own) now spells out that the read-only git default is not absolute: a direct user request to branch, stage, or commit authorizes the agent to run that command. This keeps stricter agent tools from refusing an explicitly requested commit.
- Added `Avenir`, `Bstatus`, and `phpunit` to the generated `cspell.json` word list, so a freshly generated project's `bun run spellcheck` no longer flags the sample words baked into the bundled `scripts/clean-cspell.ts`.

## 0.1.4 (July 3, 2026)

- **Breaking:** Renamed the `version` field in the generated `unirend-repo.json` manifest to `manifestVersion` (still `"1.0"`), making it clearer that the field is the manifest schema version rather than the tool or repo version. `readRepoConfig` normalizes legacy manifests on read, mapping an existing top-level `version` onto `manifestVersion` (and dropping the old key), so pre-rename manifests keep working and get migrated the next time a project is added.
- The generated `unirend-repo.json` manifest now records a `createdWith` field holding the Unirend version that generated it, both at the repo level (the version that ran `init`) and on each project entry (the version that scaffolded that project). This is purely for debugging and traceability, since projects can be added incrementally across different Unirend releases. The field is optional on the exported `RepoConfig`/`ProjectEntry` types, since legacy manifests don't record which version created them.
- Added `bunx` to the generated `cspell.json` word list, so a freshly generated project's `bun run spellcheck` no longer flags the `bunx unirend create ...` commands in the generated `README.md`.

## 0.1.5 (July 8, 2026)

- Fixed `serveSSRWithHMR` allocating a separate HMR WebSocket port per app. Previously each app's Vite instance opened a dedicated HMR port computed as `port + 1000 + index` (so a server on `4000` opened HMR on `5000`, a server on `3000` opened HMR on `4000`, etc.). That scheme collided with macOS AirPlay Receiver (which binds port `5000`) and, when running more than one Unirend project, with another project's main server port, surfacing as `WebSocket server error: Port 5000 is already in use` and stray `426 Upgrade Required` responses. HMR now shares the main HTTP server and disambiguates apps by path (`/__hmr/<appKey>`) using Vite's `server.ws.server` option, so no extra ports are opened and the browser connects back to the page's own port automatically. No configuration changes are required. If you had dev tooling, firewall rules, or proxies that assumed the old `port + 1000` HMR ports existed, they are no longer opened. When `enableWebSockets` is enabled, `@fastify/websocket` is bound to a private proxy emitter and a single upgrade dispatcher on the shared server routes `vite-hmr`/`vite-ping` upgrades to Vite and all other upgrades to your handlers, so HMR and application WebSockets coexist on one port.
- Added the `demos/ssr-ws-chat` demo: a single-page SSR app served with Vite HMR that also hosts an application WebSocket (an echo endpoint powering an in-page chat), demonstrating that HMR and your own WebSocket handlers coexist on one port. Run it with `bun run ssr-ws-chat:serve:dev`, open http://localhost:3005, then edit `components/EditMeBanner.tsx` to see HMR update the page while the chat (owned by a separate module) stays connected.
- **Breaking (types):** The page data loader's `ErrorDefaults` interface gained a required `httpError` field, so the loader's `http_error` code (emitted for non-envelope JSON responses whose status is not 404 or 500) is now customizable through `errorDefaults` like every other loader code, instead of being hard-coded. TypeScript consumers who pass a complete `errorDefaults` override must add an `httpError` entry (`title`, `description`, `message`, `code`). The loader falls back to the built-in default at runtime when the field is absent, so existing JavaScript configs and partial overrides keep working. The `message` is used as a prefix and the loader appends the status code, so the default still renders as `HTTP Error: 418`.
- The generated starter's `index.html` (and the SSR/SSG/multi-app demos) now loads the client entry with a root-absolute `src="/EntryClient.tsx"` instead of the relative `src="./EntryClient.tsx"`. With the relative path, deep routes like `/blog/:slug` resolve the entry against the current URL (for example `/blog/EntryClient.tsx`) and fail to load. The root-absolute path always points at the app root regardless of route depth.
- Documented the full set of framework-emitted error codes in `docs/api-envelope-structure.md`. Added the server error-handler codes (`internal_server_error`, `request_error`, `service_unavailable`), a new "Data Loader Error Codes" table for the codes the page data loader generates when transforming upstream errors (`access_denied`, `unknown_error`, `invalid_response`, `invalid_redirect`, `unsafe_redirect`, `api_redirect_not_followed`), an "Internal Diagnostic Codes" note for the error-object annotations that are not returned as client `error.code` (`handler_timeout`, `invalid_handler_response`, `handler_returned_false_without_sending`, `websocket_invalid_prevalidation_envelope`), and a "Customizing or Localizing Framework Messages" section covering the two override points (a custom `APIResponseHelpersClass` and the loader's `errorDefaults`/`statusCodeHandlers`). Also aligned the "Recommended conventional codes" list with the names the framework actually emits (`access_denied` instead of `permission_denied`, `internal_server_error` instead of `internal_error`), and updated the `docs/ssr.md` custom error-handler examples and the SSR/static-content demos to use `internal_server_error` so their sample codes match the framework.

## Unreleased

- Fixed template processing stripping nearly every named `<meta>` tag from `index.html`, including `<meta name="viewport">`. Only `apple-mobile-web-app-title` survived, so pages shipped without a viewport meta and mobile browsers laid them out at desktop width and scaled down, defeating responsive CSS. The starter templates ship a viewport meta and were affected. Applies to SSR (dev and built) and SSG alike.

  Head tags are now split by ownership. `UnirendHead` owns the per-page SEO tags, and the template's copies are always stripped: `<title>`, `<meta name="description">`, `og:*`, and `twitter:*` (except `og:site_name`, which names the site rather than the page). Everything else in the template is a baseline served as-is, including `viewport`, `charset`, `theme-color`, `robots`, and any custom tags. A page overrides a baseline by declaring the same `name`, `property`, or `http-equiv` through `UnirendHead`, and the override now holds across client-side navigation, the same way `<html>`/`<body>` attributes already did. See [UnirendHead](docs/unirendhead.md) for the full ownership rules.

  **Action:** if you worked around the missing viewport by redeclaring it through `UnirendHead`, drop the workaround. If your `index.html` carried OpenGraph or Twitter tags, move them into `UnirendHead`, as they are now stripped rather than silently kept.

- Added `templateSlots`, an optional per-app SSR option for adding content to an app's HTML template from server config instead of the template file. Three slots are available: `headInlineScripts` (inline scripts at the end of `<head>`), `bodyPrepend` (HTML before the container element), and `bodyAppend` (HTML at the end of `<body>`). It can be set on `serveSSRWithHMR()`, `serveSSRBuilt()`, `registerHMRApp()`, and `registerBuiltApp()`, and like other per-app options it does not inherit from the default app.

  It exists for reuse across a monorepo: export the boilerplate that belongs at the edges of every page once, such as a theme flash-prevention script, a `<noscript>` warning, or an analytics snippet, and hand it to every app or hand a variant to one, instead of maintaining a near-duplicate `index.html` per app. Nothing here is required. A template that hard-codes this content keeps working unchanged, and an app that sets no slots produces byte-for-byte the same HTML as before this option existed. See [Template Slots](docs/ssr.md#template-slots) for where each slot lands and the constraints on its content.

- Fixed template processing reformatting the contents of whitespace-sensitive elements. `<pre>`, `<textarea>`, and `<listing>` in `index.html` were run through the same prettifier as the rest of the document, which trims text and adds indentation, so a `<pre>` block was re-indented and rendered with whitespace it was never authored with, and a `<textarea>` default value gained leading and trailing spaces that were then submitted with the form. These elements are now serialized byte-for-byte, including a leading newline after the open tag, which the HTML parser drops and which had to be restored to survive the round trip. Applies to SSR and SSG alike.

- Fixed `CDNBaseURL` rewriting protocol-relative asset URLs in `index.html` as if they were local. The rewrite treated any `src`/`href` starting with `/` as a local asset, but a protocol-relative URL like `//widget.vendor.com/w.js` starts with one too while pointing at another origin, so it was rewritten to `https://your-cdn.example.com//widget.vendor.com/w.js` and failed to load. Such URLs are now left alone, like fully-qualified `https://` ones already were. Only affected production builds with `CDNBaseURL` set, and only templates carrying a `//` URL, which some older third-party analytics and font embeds still use.
