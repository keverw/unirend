# Starter Templates & CLI

The Unirend CLI (`unirend`) scaffolds new SSG, SSR, and API projects so you can skip the boilerplate covered in the [main README](../README.md) and start with a working app. Each generated project follows the same conventions the demos use, routes in React Router, builds on Vite, and Unirend's server utilities wired up for you.

Under the hood the CLI is a thin wrapper over the `unirend/starter-templates` library. Everything the CLI does, you can do programmatically (including generating into an in-memory filesystem). See the [Starter Templates API](starter-templates-api.md) doc for integrating the generator into your own tooling.

<!-- toc -->

- [Requirements](#requirements)
- [The Repo / Workspace Model](#the-repo--workspace-model)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
  - [`init-repo [path] [--name <repoName>]`](#init-repo-path---name-reponame)
  - [`create <type> <name> [path] [--target bun|node]`](#create-type-name-path---target-bunnode)
  - [`list`](#list)
  - [`help` / `version`](#help--version)
  - [Local Version Delegation](#local-version-delegation)
- [Available Templates](#available-templates)
- [SSG Template](#ssg-template)
  - [SSG, Files You'll Customize](#ssg-files-youll-customize)
  - [SSG, What Gets Generated](#ssg-what-gets-generated)
  - [SSG, Scripts](#ssg-scripts)
- [SSR Template](#ssr-template)
  - [SSR, Files You'll Customize](#ssr-files-youll-customize)
  - [SSR, What Gets Generated](#ssr-what-gets-generated)
  - [SSR, Scripts](#ssr-scripts)
- [API Template](#api-template)
  - [API, Files You'll Customize](#api-files-youll-customize)
  - [API, What Gets Generated](#api-what-gets-generated)
  - [API, Scripts](#api-scripts)
- [Workspace Files (Shared Across All Templates)](#workspace-files-shared-across-all-templates)
  - [In-Range Updates Need a Fresh Resolve](#in-range-updates-need-a-fresh-resolve)
    - [Pins That Fall Behind Their Dependents](#pins-that-fall-behind-their-dependents)
    - [Pins the Lockfile Never Applied](#pins-the-lockfile-never-applied)
    - [Seeing What Each Pin Is Doing](#seeing-what-each-pin-is-doing)
    - [Checking Whether an Override Is Still Needed](#checking-whether-an-override-is-still-needed)
  - [Nested Overrides and Bun](#nested-overrides-and-bun)
  - [Version-Qualified Override Keys](#version-qualified-override-keys)
  - [Declaring the Same Pin Twice](#declaring-the-same-pin-twice)
- [Import Alias Enforcement (`@/`)](#import-alias-enforcement-)
- [Build Target: Bun vs. Node](#build-target-bun-vs-node)
- [Adding More Apps to a Workspace](#adding-more-apps-to-a-workspace)
- [Using the Generator Programmatically](#using-the-generator-programmatically)

<!-- tocstop -->

## Requirements

The CLI **requires Bun**. Bun runs TypeScript directly and bundles to a single JS file, which keeps the generator simple and out-of-the-box. If you run it under plain Node it exits with an error and a pointer to [bun.sh](https://bun.sh).

Generated projects also use Bun for their development and build tooling, but they **target Node by default at bundle time** (`bun build --target node --external vite`), so your production server can run under Node. Each project's runtime target is set at creation time. Pass `--target bun` to `create` to opt into Bun instead (see [Build target: Bun vs. Node](#build-target-bun-vs-node)).

> The framework itself avoids Bun-specific APIs and runs on both Bun and Node. The Bun requirement is for the generator/CLI tooling, not the runtime of what it produces.

## The Repo / Workspace Model

Unirend projects live inside a **workspace repo** that can hold multiple apps:

```
my-workspace/
├── unirend-repo.json        # workspace marker + project registry
├── package.json             # shared scripts/deps for every app (private: true)
├── README.md               # generic workspace readme + LICENSE (UNLICENSED placeholder)
├── tsconfig.json            # plus additional config files: prettier.config.js, eslint.config.js, cspell.json, .editorconfig, .vscode/ (settings.json, extensions.json), AGENTS.md, CLAUDE.md
├── build-info.config.json   # (SSR/API only) build-info output manifest
├── scripts/
│   ├── check-public-assets.ts   # verifies declared public-asset lists ↔ public/ sync per app (part of `bun run check`)
│   ├── check-overrides.ts       # fails on an override whose target left the dependency tree (part of `bun run check`)
│   ├── check-null-bytes.ts      # fails on NUL bytes in text files (part of `bun run check`)
│   ├── refresh-lockfile.ts      # regenerates bun.lock from scratch and reports what moved (`bun run install:fresh`)
│   └── generate-build-info.ts   # SSR/API only
└── src/
    ├── apps/
    │   ├── my-blog/         # one app per template you create
    │   └── my-api/
    └── libs/                # shared code across apps
```

- `unirend-repo.json` marks the directory as a workspace and tracks every project you create (template + path + creation time). Its `name` identifies the workspace.
- The root `package.json` is shared by all apps, with `private: true` to avoid accidental publishing. Each app contributes its own `<app-name>:*` scripts (see the per-template script tables below).
- Apps are created under `src/apps/<name>`, and build output goes to `build/<name>`.
- `src/libs/` is for code shared across apps (import via the `@/` alias).

**Auto-init:** You can set up the workspace explicitly with `init-repo`, but if it's missing when you run `create`, the CLI initializes it automatically with a sensible default name (`unirend-projects`). So a single `bunx unirend create ...` in an empty directory is enough to go from nothing to a runnable app.

## Quick Start

```bash
# Recommended: bunx downloads unirend if it isn't installed
bunx unirend create ssr my-app

# Then start the dev server from the workspace root (scripts are app-named)
bun install            # if not auto-installed
bun run my-app:serve:dev
```

That's it. `create` initializes the workspace (if needed), writes the project files, wires up `package.json` scripts, runs `git init`, installs dependencies, and formats the result.

## CLI Reference

```
bunx unirend <command> [args] [flags]
```

Run `bunx unirend help` (or no args) for the built-in help, and `bunx unirend version` for the version number.

### `init-repo [path] [--name <repoName>]`

Initialize a directory as a Unirend workspace repo without creating a project yet. Useful when you want to set the workspace name explicitly.

| Argument / flag | Description |
| --- | --- |
| `[path]` | Directory to initialize. Optional, defaults to the current directory. |
| `--name <repoName>` | Workspace name. Optional, defaults to `unirend-projects`. |

```bash
bunx unirend init-repo
bunx unirend init-repo ./my-workspace
bunx unirend init-repo ./projects --name my-workspace
```

The target directory must be empty, or contain only non-content entries: git/config files (`.git`, `.gitignore`, `.gitattributes`, `.gitkeep`) and common OS/cloud junk (like `.DS_Store`, `Thumbs.db`, or `.dropbox`). A README or LICENSE is also allowed and left untouched, including common variants like `README.txt` or `LICENSE.md` (init logs a notice when it finds one). Any other content aborts the init. Because `create` auto-inits, `init-repo` is optional. Reach for it only when you want control over the workspace name or want to set up the repo as a separate step.

### `create <type> <name> [path] [--target bun|node]`

Create a new project from a template.

| Argument / flag | Description |
| --- | --- |
| `<type>` | Template ID, one of `ssg`, `ssr`, `api` (see [Templates](#available-templates)). |
| `<name>` | Project name, in kebab-case, that becomes `src/apps/<name>` and the script prefix. |
| `[path]` | Workspace repo path. Optional, defaults to the current directory. Supports `~` and absolute/relative paths. |
| `--target bun\|node` | Runtime the server bundle/scripts target. Optional, defaults to `node`. |

Project names must be kebab-case: lowercase letters, numbers, and hyphens. They must start with a letter, end with a letter or number, avoid consecutive hyphens, and not be a reserved system name (for example, http, stream, fs, path, etc).

```bash
bunx unirend create ssg my-blog
bunx unirend create ssr my-app ./projects
bunx unirend create api my-api-server --target bun
```

**What `create` does**, in order:

1. Validates the project name and template ID.
2. Reads (or auto-initializes) `unirend-repo.json`, then registers the new project in it.
3. Checks that `src/apps/<name>` doesn't already exist and that the generated script names don't collide with existing ones in `package.json`. It aborts before writing anything if either check fails.
4. Ensures the shared workspace/base files exist (see [Workspace files](#workspace-files-shared-across-all-templates)).
5. Runs `git init` (if the repo isn't already a git repo).
6. Writes the template's project-specific files into `src/apps/<name>`.
7. Runs `bun install`.
8. Auto-formats with Prettier (if installed).

> **Collision safety:** the app-named scripts (`<name>:build`, etc.) must not already exist in the root `package.json`. If they do, `create` aborts before writing anything and tells you which names clashed. Pick a different project name or remove the conflicting scripts. Shared scripts like `generate:build-info` are added only when absent, so a second app never conflicts on those.

### `list`

List the available templates with their names and descriptions (the same metadata used throughout this doc).

```bash
bunx unirend list
```

### `help` / `version`

```bash
bunx unirend help        # also: -h, --help, or no args
bunx unirend version     # also: -v, --version
```

`version` shows the running version. When a local `node_modules/unirend` is present it also shows whether the versions match:

```
unirend v0.0.24
  local repo: v0.0.24 (matches)
```

### Local Version Delegation

When you run `bunx unirend` inside a repo that already has `unirend` installed locally (in `node_modules`) and the versions differ, the CLI automatically re-executes using the local binary, so you always use the version your project was set up with, not whatever `bunx` pulled down.

After delegation, `version` shows both versions and flags if `bunx` has a newer one available:

```
unirend v0.0.20
  source: local (node_modules/unirend)
  bunx version: v0.0.24 (newer — run: bun update unirend)
```

Set `UNIREND_NO_DELEGATE=1` to skip delegation and force the bunx version.

## Available Templates

These are the three template IDs `create` accepts. The one-line descriptions match what `unirend list` prints.

| ID | Name | Description |
| --- | --- | --- |
| `ssg` | Static Site Generation (SSG) | Pre-rendered static site with React Router and Vite build system |
| `ssr` | Server-Side Rendering (SSR) | Full-stack React app with server-side rendering, API routes, and plugin support |
| `api` | API Server | Standalone JSON API server with WebSocket and plugin support |

Each template is documented below with two parts: **files you'll customize** (the handful you'll edit first, plus a next-steps checklist) and **what gets generated** (the full file tree, explained).

---

## SSG Template

Pre-rendered static site. Pages are rendered to HTML at build time by invoking your server entry, then served by any static file host or CDN. Includes a client-side SPA page example, theme support, and error-page demos.

See [docs/ssg.md](ssg.md) for the underlying SSG concepts.

### SSG, Files You'll Customize

Start here:

- **`Routes.tsx`** is your route table (`RouteObject[]`). Add your pages here. The generated file includes the demo routes, a `Dashboard` SPA route, a static `404` route, and a commented-out wildcard `*` route.
- **`pages/Home.tsx`, `pages/About.tsx`, `pages/Dashboard.tsx`** are placeholders for your real pages. `Dashboard` is registered as a client-rendered SPA page. Delete it if you don't need a SPA route, since it's just an example. The rest are statically generated.
- **`generate-ssg.ts`** declares which pages to pre-render (SSG) vs. serve as SPA shells. Add an entry here for each new page.
- **`components/AppLayout.tsx`** is the root layout wrapper (nav, footer slot, global structure). Customize this to reshape the overall page shell.
- **`components/Header.tsx`, `components/Footer.tsx`** are your shared chrome.
- **`components/error-pages/ApplicationError.tsx`, `GenericError.tsx`, `NotFound.tsx`** are the React error and 404 UI. Swap these out with your own branded error pages.
- **`error-pages/500.html`** is the self-contained static 500 page (no React bundle), so it works even when the asset pipeline is down.
- **`index.html`** is the HTML template (title, meta, the `<!--ss-head-->` / `<!--ss-outlet-->` markers). Customize `<title>`, favicons, etc.
- **`consts.ts`** has toggles like `ENABLE_TEST_ROUTES` (the error-demo routes) and the `PUBLIC_FILES`/`PUBLIC_FOLDERS` lists. These drive the bundled `serve.ts`, which serves only declared `public/` content (the PHP companion follows the same model with its own config, and a plain static host or CDN serves the whole build output regardless). Declare every intended public asset, individually in `PUBLIC_FILES` or by subfolder in `PUBLIC_FOLDERS`, so local preview stays faithful. `.gitignore` OS junk instead of declaring it (the static server never serves it from a folder mount anyway). The `check:public-assets` script (part of `bun run check`) fails on drift in either direction and on un-gitignored OS junk under `public/` (gitignored junk is skipped, since git won't commit it, so it stays out of a clean checkout). It finds these lists via the app's `public-assets.config.json` (see [Workspace Files](#workspace-files-shared-across-all-templates)).

**Next steps checklist**

- [ ] Add your routes to `Routes.tsx` and register each pre-rendered page in `generate-ssg.ts`.
- [ ] Replace the `Home`/`About`/`Dashboard` pages with your own.
- [ ] Customize the `Header`/`Footer` and `index.html` (title, favicons, meta).
- [ ] Customize the static `error-pages/500.html` and the `404` route to match your branding.
- [ ] Keep `PUBLIC_FILES`/`PUBLIC_FOLDERS` in `consts.ts` in sync when you add or remove intended public assets (`bun run check:public-assets` catches drift and rejects un-gitignored OS junk).
- [ ] Decide whether to keep the error-demo routes (`ENABLE_TEST_ROUTES` in `consts.ts`). Set it to `false` or remove the `Simulate*` pages/loaders entirely for production.
- [ ] Optionally uncomment the wildcard `*` route in `Routes.tsx` if you want custom handling (e.g. a loader). The root `errorElement` already renders `NotFound` for unmatched client-side navigation.

### SSG, What Gets Generated

Written into `src/apps/<name>/`:

```
src/apps/<name>/
├── vite.config.ts                 # Vite config wrapped with withUnirendViteConfig()
├── vite-env.d.ts                  # Vite client type references
├── tsconfig.json                  # app-level TS config (extends repo root)
├── prettier.config.js             # extends repo root, adds the Tailwind plugin
├── index.html                     # HTML template with ss-head / ss-outlet markers
├── index.css                      # Tailwind import + dark-mode setup
├── consts.ts                      # ENABLE_TEST_ROUTES toggle + PUBLIC_FILES/PUBLIC_FOLDERS lists
├── public-assets.config.json      # points check:public-assets at the lists above
├── EntryClient.tsx                # client mount (mountApp) — hydrates the app
├── EntrySSG.tsx                   # server render entry used at build/generate time
├── Routes.tsx                     # route table (RouteObject[])
├── generate-ssg.ts                # drives generateSSG to pre-render all pages
├── serve.ts                       # StaticWebServer entry to serve build/<name>/client
├── error-pages/
│   └── 500.html                   # self-contained static 500 page
├── public/
│   ├── robots.txt
│   ├── favicon.svg
│   └── favicon.ico
├── components/
│   ├── AppLayout.tsx              # shared chrome; routes loader errors to NotFound/GenericError
│   ├── Header.tsx                 # nav (includes a Dashboard link)
│   ├── Footer.tsx                 # static footer (Home/About/Dashboard)
│   ├── error-pages/
│   │   ├── ApplicationError.tsx   # standalone boundary for thrown render errors
│   │   ├── GenericError.tsx       # non-404 loader error envelopes
│   │   └── NotFound.tsx           # 404 (router signal or loader envelope)
│   └── theme/
│       ├── context.ts             # ThemePreference / useTheme hook
│       ├── ThemeProvider.tsx      # cookie + OS dark-mode sync, BroadcastChannel
│       └── ThemeToggle.tsx        # auto → dark → light cycle button
├── pages/
│   ├── Home.tsx                   # static landing page
│   ├── About.tsx                  # static page (SSG model)
│   ├── Dashboard.tsx              # client-rendered SPA page (type: 'spa')
│   ├── SimulateComponentError.tsx # browser-only throw demo (guarded for the SSG pass)
│   ├── SimulateDataloader500.tsx  # fallback view for the 500-envelope demo
│   ├── SimulateDataloader503.tsx  # fallback view for the 503-envelope demo
│   └── SimulateDataloaderError.tsx# fallback view for the throw-from-loader demo
└── loaders/
    └── error-demo-loaders.ts      # local loaders backing the error-demo routes
```

It also ensures the [shared workspace files](#workspace-files-shared-across-all-templates) exist.

### SSG, Scripts

All app-named (`<name>` is your project name):

| Script | What it does |
| --- | --- |
| `<name>:spa-dev` | Vite HMR dev server (SPA only, no SSG) |
| `<name>:build:client` | Build client assets + manifests |
| `<name>:build:server` | Build the `EntrySSG.tsx` server entry |
| `<name>:build:serve` | Bundle `serve.ts` (the static server) |
| `<name>:build` | All three builds above |
| `<name>:generate:dev` / `:prod` | Run `generate-ssg.ts` to pre-render pages |
| `<name>:build-and-generate:dev` / `:prod` | Build then generate |
| `<name>:serve:dev` / `:prod` | Serve from source (`serve.ts`) |
| `<name>:serve:built:dev` / `:prod` | Serve the bundled static server |
| `<name>:build-generate-serve:dev` / `:prod` | Build + generate + serve, end to end |

---

## SSR Template

Full-stack React app with per-request server-side rendering, co-located API routes, page-data loaders, plugins, and a runtime 500 error page. Includes theme support seeded server-side for flash-free dark mode.

See [docs/ssr.md](ssr.md) for the underlying SSR concepts, and [docs/server-plugins.md](server-plugins.md) for the plugin system.

### SSR, Files You'll Customize

Start here:

- **`Routes.tsx`** is your route table. Every route is wired through `createPageDataLoader` (fetching page data from the API, short-circuiting to the co-located handler). Includes the `API_BASE_URL` block and an active wildcard `*` route with a `not-found` loader.
- **`pages/Home.tsx`, `pages/About.tsx`** are placeholders for your real pages. These use `useLoaderData` to show server-seeded data.
- **`server/ssr-component.ts`** is the heart of the server: registers page data loader handlers, API routes, and plugins. Add your endpoints and plugins here.
- **`server/get-500-error-page.ts`** is the runtime 500 page (the SSR equivalent of the SSG `500.html`). Customize branding. It shows dev error details when running in development.
- **`server/plugins/theme.ts`** is an example plugin (seeds theme from a cookie). Use it as a model for your own plugins.
- **`components/AppLayout.tsx`** is the root layout wrapper (nav, footer slot, global structure). Customize this to reshape the overall page shell.
- **`components/Header.tsx`, `components/Footer.tsx`** are shared chrome. The footer reads `currentYear` from `usePublicAppConfig` (seeded server-side).
- **`components/error-pages/ApplicationError.tsx`, `GenericError.tsx`, `NotFound.tsx`** are the React error and 404 UI. Swap these out with your own branded error pages.
- **`index.html`**, **`consts.ts`** have the same roles as in SSG, with one difference: here the `PUBLIC_FILES`/`PUBLIC_FOLDERS` lists are the production serving surface itself, not just a preview concern. `server/ssr-component.ts` passes them to `serveSSRBuilt` as `publicFiles`/`publicFolders`, and the built server serves exactly the declared content, so an undeclared `public/` file 404s in production. It also refuses to boot if a declared file is missing. In HMR mode Vite serves all of `public/` itself, which is why drift only shows up in the built app (or via `check:public-assets`).

Environment variables the generated server reads (names derived from your app name, in upper case):

- `<APP>_PORT` is the port to listen on.
- `<APP>_SRC_DIR` is the source dir for Vite in the Node dev-server workaround (set automatically by the `serve:dev` script when targeting Node).
- `<APP>_DIST_DIR` is the built-assets dir override.
- `INTERNAL_API_ENDPOINT` is the internal API URL when SSR and API run as separate pools.

**Next steps checklist**

- [ ] Add your routes to `Routes.tsx` and your pages under `pages/`.
- [ ] Register your page-data handlers, API routes, and plugins in `server/ssr-component.ts`.
- [ ] Customize `server/get-500-error-page.ts` and the `404` handling to match your branding.
- [ ] Customize the `Header`/`Footer` and `index.html`.
- [ ] Keep `PUBLIC_FILES`/`PUBLIC_FOLDERS` in `consts.ts` in sync when you add or remove intended public assets (`bun run check:public-assets` catches drift and rejects un-gitignored OS junk).
- [ ] Override `<APP>_PORT` if the default (`3000`) doesn't suit your setup. Set `INTERNAL_API_ENDPOINT` if the API runs as a separate process.
- [ ] Decide whether to keep the error-demo routes (`ENABLE_TEST_ROUTES` in `consts.ts`). Set it to `false` or remove the `Simulate*` pages/loaders entirely for production.
- [ ] Run `bun run generate:build-info` before production builds (the `<name>:build` script does this for you).

### SSR, What Gets Generated

Written into `src/apps/<name>/`:

```
src/apps/<name>/
├── vite.config.ts                 # Vite config wrapped with withUnirendViteConfig()
├── vite-env.d.ts
├── tsconfig.json
├── prettier.config.js
├── index.html
├── index.css
├── consts.ts                      # ENABLE_TEST_ROUTES toggle + PUBLIC_FILES/PUBLIC_FOLDERS lists
├── public-assets.config.json      # points check:public-assets at the lists above (multi-app: one entry per app)
├── EntryClient.tsx                # client mount (mountApp)
├── EntrySSR.tsx                   # server render entry used per request
├── Routes.tsx                     # routes wired through createPageDataLoader
├── serve-hmr.ts                   # dev entry (Vite HMR) → server/start.ts
├── serve-built.ts                 # prod entry (built assets) → server/start.ts
├── public/
│   ├── robots.txt
│   ├── favicon.svg
│   └── favicon.ico
├── server/
│   ├── start.ts                   # app factory: wires SSRServerComponent into a LifecycleManager
│   ├── ssr-component.ts           # boots the SSR server; registers handlers/routes/plugins
│   ├── get-500-error-page.ts      # runtime 500 page (theme-aware, dev details)
│   └── plugins/
│       └── theme.ts               # example plugin: cookie-seeded theme preference
├── components/
│   ├── AppLayout.tsx
│   ├── Header.tsx                 # nav
│   ├── Footer.tsx                 # reads currentYear from usePublicAppConfig
│   ├── error-pages/
│   │   ├── ApplicationError.tsx
│   │   ├── GenericError.tsx
│   │   └── NotFound.tsx
│   └── theme/
│       ├── context.ts
│       ├── ThemeProvider.tsx
│       └── ThemeToggle.tsx
└── pages/
    ├── Home.tsx                   # uses useLoaderData ("From Server" line)
    ├── About.tsx                  # uses useLoaderData
    ├── SimulateComponentError.tsx # throws on server + client (no window guard)
    ├── SimulateDataloader500.tsx
    ├── SimulateDataloader503.tsx
    └── SimulateDataloaderError.tsx
```

Plus, shared across the server templates and written once per workspace:

- `scripts/generate-build-info.ts` generates build metadata (version, git hash/branch, timestamp).
- `build-info.config.json` is the manifest of build-info outputs. This app's `current-build-info.ts` path is appended.

`src/apps/<name>/current-build-info.ts` is **not** scaffolded. It's a gitignored, per-build artifact produced by running `generate:build-info`. See [docs/build-info.md](build-info.md).

### SSR, Scripts

| Script | What it does |
| --- | --- |
| `<name>:spa-dev` | Vite HMR dev server (SPA only, no SSR) |
| `<name>:build:client` | Build client assets + manifests |
| `<name>:build:server` | Build the `EntrySSR.tsx` server entry |
| `<name>:build:serve` | Bundle `serve-built.ts` (`IS_BUILT=true`) |
| `<name>:build` | generate build info → client → server → serve |
| `<name>:serve:dev` | SSR dev with HMR (Bun runs `serve-hmr.ts`, Node bundles it first, see note) |
| `<name>:serve:built:dev` / `:prod` | Run the bundled server |
| `<name>:build-and-serve:dev` / `:prod` | Build then run the bundled server |
| `generate:build-info` | (shared) generate build metadata for all server apps |

> **`serve:dev` and the Bun HMR workaround:** when targeting Node, `serve:dev` bundles the dev server with `bun build --target=node` and runs it under Node, sidestepping a Bun bug where the Vite HMR WebSocket can stall graceful shutdown. When targeting Bun it runs `serve-hmr.ts` directly. Either way the command name is the same. See [docs/websockets.md](websockets.md).

---

## API Template

Standalone JSON API server, with no Vite, no client bundle, and no React surface. Boots the Unirend API server under a Lifecycleion `LifecycleManager`, with the same plugin and page-data-handler conventions as the SSR server, plus WebSocket support.

See [docs/ssr.md](ssr.md) (the standalone API server section) and [docs/server-plugins.md](server-plugins.md).

### API, Files You'll Customize

Start here:

- **`api-component.ts`** is the component that boots the API server. Register your routes, page-data handlers, and plugins here.
- **`serve.ts`** is the standalone entry point that runs the component under a `LifecycleManager` and handles signals/graceful shutdown. You'll rarely need to edit this beyond the manager name (already set to `<name>-api-server`).

Environment variables the generated server reads:

- `<APP>_PORT` is the port to listen on. Default: `3001`.
- `<APP>_SOCKET_PATH` is an optional Unix socket path. When set, the API server listens on that socket instead of TCP.

**Next steps checklist**

- [ ] Register your API routes, page-data handlers, and plugins in `api-component.ts`.
- [ ] Override `<APP>_PORT` if the default (`3001`) doesn't suit your setup, or set `<APP>_SOCKET_PATH` for same-host sidecar/internal traffic.
- [ ] Run `bun run generate:build-info` before production builds (the `<name>:build` script does this for you).
- [ ] Add WebSocket handlers if needed (see [docs/websockets.md](websockets.md)).

### API, What Gets Generated

Written into `src/apps/<name>/`:

```
src/apps/<name>/
├── tsconfig.json                  # minimal app-level TS config (extends repo root, no Vite types)
├── api-component.ts               # boots the Unirend API server; registers routes/handlers
└── serve.ts                       # standalone entry; runs the component under a LifecycleManager
```

Plus, shared across the server templates and written once per workspace:

- `scripts/generate-build-info.ts`
- `build-info.config.json` (this app's `current-build-info.ts` path appended)

As with SSR, `current-build-info.ts` is a gitignored artifact produced by `generate:build-info`, not scaffolded.

The API template ships no `prettier.config.js`, `index.html`, or CSS. It has no Vite/client surface and uses the repo-root configs for those. It does ship a minimal app-level `tsconfig.json` (extends the repo root, drops the `vite/client` types). That config exists purely to establish a project boundary so editor auto-imports resolve shared `src/libs/*` modules through the `@/` alias rather than as long relative paths, matching the Vite templates. See [Workspace files](#workspace-files-shared-across-all-templates) for the `importModuleSpecifier` setting that drives this.

### API, Scripts

| Script | What it does |
| --- | --- |
| `<name>:serve:dev` | Dev server (Bun runs `serve.ts`, Node bundles it first) |
| `<name>:build:serve` | Bundle `serve.ts` (`IS_BUILT=true`) |
| `<name>:build` | generate build info → bundle |
| `<name>:serve:built:dev` / `:prod` | Run the bundled server |
| `<name>:build-and-serve:dev` / `:prod` | Build then run the bundled server |
| `generate:build-info` | (shared) generate build metadata for all server apps |

> **`serve:dev` and the Bun runtime workaround:** when targeting Node, `serve:dev` bundles the dev server with `bun build --target=node` and runs it under Node, sidestepping Bun-native runtime quirks. When targeting Bun it runs `serve.ts` directly. Either way the command name is the same. See [docs/websockets.md](websockets.md).

---

## Workspace Files (Shared Across All Templates)

Whether you run `init-repo` or `create` (which auto-inits), Unirend ensures these shared workspace files exist at the repo root. They're created only if missing (merge-aware files like `.gitignore`, `.prettierignore`, `cspell.json`, and `package.json` are updated in place to add what's needed):

- `unirend-repo.json` is the workspace marker and project registry.
- `package.json` has shared scripts/deps, `private: true`, `license: UNLICENSED`.
- `README.md` (generic workspace readme) and `LICENSE` (an `UNLICENSED`/all-rights-reserved placeholder that reminds you to pick a real license before making the repo public).
- `tsconfig.json`, `prettier.config.js`, `eslint.config.js`, `cspell.json`, `.editorconfig`.
- `.gitignore`, `.prettierignore`.
- `.vscode/settings.json`, `.vscode/extensions.json`. The settings pin `importModuleSpecifier` to `project-relative`, so auto-imports stay relative within an app but switch to the `@/` alias when they reach into shared `src/libs/*` (the boundary is each app's own `tsconfig.json`).
- `AGENTS.md` and `CLAUDE.md` (bridges Claude Code to `AGENTS.md`).
- `scripts/clean-cspell.ts` reports custom words in `cspell.json` that no longer appear anywhere in the repo. It runs as `bun run cspell:clean`, and `bun run cspell:clean:fix` removes them. Its scan honors `ignorePaths` and, when the config sets `useGitignore` (the scaffolded default), your `.gitignore` rules too, so both tools make the same ignore decisions. Otherwise, a word found only in ignored build output could appear to be in use and remain in the dictionary even though CSpell never checks that output.
- `scripts/check-public-assets.ts` verifies each Vite app's `PUBLIC_FILES`/`PUBLIC_FOLDERS` (in `consts.ts`) against the files actually in its `public/` folder, in both directions (files under a declared folder are covered automatically). It also treats OS metadata such as `.DS_Store`, `._*`, `Thumbs.db`, `ehthumbs.db`, and `desktop.ini` as a hard error wherever it appears, including inside a declared folder, unless the file is gitignored: it runs `git check-ignore`, so junk git won't commit is skipped with a notice while junk git would commit (unignored, or already tracked) fails. The static server refuses to serve these from a folder mount, so they can't leak at runtime, but Vite still copies them into the client build where a plain static host or CDN can expose them unless your upload step filters them out, so add their file names to `.gitignore` (which also makes the check pass). Never declare them as public assets. The script runs as `bun run check:public-assets`, is chained into `bun run check` so drift and junk files fail CI, and no-ops in repos without SSR/SSG apps. Where each app's lists live is declared in the `public-assets.config.json` scaffolded into the app folder. Its `default` entry mirrors the template conventions, every field is optional with those defaults, and a fresh app never needs to touch it. Projects restructured for [multi-app SSR](./ssr.md#multi-app-ssr-support) add an entry per additional app, each pointing at that app's `public/` dir, consts file, and export names (and update the `default` entry's paths if the default app's source moved into a subfolder). Deleting the file opts the project out of the check, and the script logs the skip so the opt-out stays visible in CI output.
- `scripts/check-overrides.ts` fails when `package.json` declares an `overrides` (npm style) or `resolutions` (yarn style) entry for a package that is no longer anywhere in the dependency tree. An override is almost always a temporary pin around an upstream bug or advisory, and once its target drops out of the tree the pin silently does nothing, so it can outlive its reason for years while quietly holding a transitive dependency back. Bun does not warn about this, an override naming a package that isn't installed at all is accepted in complete silence, so this check is the only guard. Presence is probed with `bun why <name>`, and each finding is reported at its full declaration path (`overrides.minimatch.left-pad`) so the offending line is findable in a large `package.json`. It also rejects empty and whitespace-only values, which bun warns about but ignores while still exiting successfully, and the two npm-only spellings bun accepts without applying: the nested form, which bun ignores outright, and a key carrying a version selector (`"pkg@^2"`), which bun reads as a package name that matches nothing. In each case the pin does not exist at all. See [Nested Overrides and Bun](#nested-overrides-and-bun) and [Version-Qualified Override Keys](#version-qualified-override-keys) below, worth reading before writing either form. It also fails when `overrides` and `resolutions` declare the same package with different versions, since bun applies one and silently ignores the other: see [Declaring the Same Pin Twice](#declaring-the-same-pin-twice). It runs as `bun run check:overrides` and is chained into `bun run check`. One thing it does not catch: an override that is merely **redundant**, meaning the package is still present and normal resolution would land on that version anyway. Detecting that needs a second resolve with the override removed and a diff of the result, which this check does not do.
- `scripts/check-null-bytes.ts` fails when a file that should be plain text contains a NUL (0x00) byte. A stray NUL is invisible in every editor and slips past Prettier, ESLint, and spellcheck, but git then classifies the file as binary and stops diffing it, and grep silently finds nothing in it. That last one is the dangerous part, since it makes a file opt out of exactly the searches used to check it. Using a NUL as a value is fine, it makes a good separator, but write the escape in source rather than embedding the raw byte. Files count as text by extension or known exact name, covering extensionless ones like `Dockerfile`, `Makefile`, and `LICENSE` plus text lockfiles like `bun.lock`. That allowlist means an unknown file type is never flagged as broken source. Which files to scan comes from walking the tree and applying your repo's own ignore rules in memory rather than by running git. Nested `.gitignore` files use their normal deeper-rule precedence, and `.git/info/exclude` sits below the root `.gitignore`, matching Git. Ignore rules beat a directory-name list because they match per path, and the same name can be build output in one place and committed source in another. A few names (`node_modules`, `vendor`, and similar) are still skipped outright as insurance for a repo with no `.gitignore` yet, but `dist` and `build` deliberately are not. One consequence: a file force-added to git despite matching an ignore rule is not scanned, so add a negation if you want it covered. It runs as `bun run check:null-bytes` and goes first in the `check` chain, being the cheapest check there and the one whose failure would hamper debugging every later one. Pass `extraExtensions` or `extraFileNames` in the wrapper for a project-specific text format or exact file name.
- `scripts/refresh-lockfile.ts` deletes `bun.lock`, resolves it from scratch, and reports exactly which packages changed. It runs as `bun run install:fresh` and is deliberately **not** part of `bun run check`, since it mutates the lockfile. See [In-Range Updates Need a Fresh Resolve](#in-range-updates-need-a-fresh-resolve) below for why it exists.
- `.gitkeep` files for `scripts/`, `src/apps/`, `src/libs/`.

The `clean-cspell.ts`, `check-public-assets.ts`, `check-overrides.ts`, `check-null-bytes.ts`, and `refresh-lockfile.ts` scripts are thin wrappers over functions exported from `unirend/repo-tools` (`cleanCspell()`, `checkPublicAssets()`, `checkOverrides()`, `checkNullBytes()`, and `refreshLockfile()`, listed in the same order). Each function acts as the script's main, printing its own report and returning a result, and the wrapper turns that result into an exit code. The logic lives in the package, so upgrading unirend upgrades the checks, and the wrapper in your repo is the customization point: every function accepts a `rootDir` and logger overrides, `cleanCspell()` takes `fix` (the wrapper wires it to `--fix`/`--write`), `checkOverrides()` takes `isPackageInstalled` to replace the `bun why` probe, `verbose`, and `allowBackwardPins` for explicitly acknowledged downgrade pins, `checkNullBytes()` takes `extensions`, `extraExtensions`, `fileNames`, `extraFileNames`, and `skipDirectories` to adjust what it scans, and `refreshLockfile()` takes `install` to replace the `bun install` step. The scaffolded wrappers anchor `rootDir` to the repo root via `import.meta.dirname`, so running one directly from a subfolder behaves the same as the `bun run` script, which always executes from the `package.json` directory. All of them run under Bun, which is how the scaffolded `package.json` scripts invoke them (the public-assets check imports each app's TypeScript `consts.ts`). `generate-build-info.ts` follows the same idea. Its generator class comes from `unirend/build-info`, but it keeps its config-reading loop in the script and stays the place to pass `customProperties`.

### In-Range Updates Need a Fresh Resolve

A lockfile holds every resolved version steady, including versions that are merely in range, and a plain `bun install` will not move them. That is the point of a lockfile, not a bug. With `semver: "^7.0.0"` locked at `7.3.0`, `bun install` leaves it at `7.3.0` even though `7.8.5` is in range and published; deleting the lockfile first resolves it to `7.8.5` (verified against bun 1.3.14). So taking the in-range updates your ranges already permit means resolving from scratch, and nothing tells you what that would change until you do it.

<!-- prettier-ignore -->
> [!NOTE]
> This is **not** needed to make an `overrides` entry take effect. Bun applies an added, changed, or removed override on a plain `bun install` (verified against bun 1.3.14 for all three), and `check:overrides` fails the build if `bun.lock` ever disagrees with a declared pin, so that case is already covered without regenerating anything.

Where a fresh resolve does help with overrides is the opposite question, the one no offline check can answer: **is this pin still needed?** See [Checking Whether an Override Is Still Needed](#checking-whether-an-override-is-still-needed) below.

`bun run install:fresh` does the regeneration. A fresh resolve picks up **every** in-range update at once, not just the one you were after, and that blast radius is invisible in the raw diff of a large lockfile. So the script prints it as a list, making regeneration a deliberate review step:

```
Changed (1):
  ~ tldts-core 7.4.6 → 7.4.9
Added (16):
  + lightningcss@1.32.0
Removed (21):
  - rolldown@1.1.5
```

The previous lockfile is renamed to an on-disk backup before installation starts. If the install fails, writes no replacement, or the command receives `SIGINT`, `SIGTERM`, or `SIGHUP`, the backup is restored before exit. On a signal, the spawned installer is stopped and awaited before restoration, so an installer that received no signal itself cannot survive the wrapper and overwrite the recovered lockfile afterward. This keeps an interrupted resolve from leaving the repo without a lockfile, which would make the next install resolve from scratch silently rather than on purpose. A hard kill or power loss gives JavaScript no opportunity to restore anything, so the uniquely named backup is deliberately left for manual recovery and `.bun.lock.unirend-backup-*` is included in the scaffolded `.gitignore` and `.prettierignore` to keep it out of commits and formatting.

#### Pins That Fall Behind Their Dependents

There is one form of stale pin `check:overrides` **can** catch offline, and it is the one that bites hardest. If an override forces a package **below** a version its dependents declare they need, bun applies it without a word. Forcing `brace-expansion` to `1.1.11` under a `minimatch` that declares `^2.0.2` installs with no warning at all.

The check reads transitive dependency ranges from `bun.lock` and reads your repo's own ranges from the current root and workspace `package.json` files, so it costs no network and stays in the `check` chain. Bun copies workspace declarations into the lockfile too, but those copies can be stale after a manifest edit, so the manifests are authoritative. The lockfile's `workspaces` block identifies child workspace paths, and a missing child manifest falls back to its recorded declaration. Other read failures and malformed workspace manifests fail the check rather than silently analyzing stale ranges. A pin that undercuts one of your direct dependencies is therefore caught the same way as one undercutting a transitive dependent:

```
These overrides force a version outside what a dependent declares it supports, without
being an intentional forward override, which bun applies without any warning:
  - overrides.brace-expansion pins "brace-expansion" to 1.1.11
      minimatch@9.0.9 declares "^2.0.2"
```

Forcing a package **forward** past the whole declared range is usually the point of an override, since the advisory fix often lands in a major the parent has not adopted yet, so that remains allowed. A version below the range and a version in an unsupported gap between disjoint branches such as `^1 || ^3` are both reported by default. A downgrade can also be deliberate, for example to avoid an upstream regression. In that case, uncomment `allowBackwardPins` in `scripts/check-overrides.ts` and list the package name. The exception stays visible beside the check configuration, and `--verbose` still reports which ranges the acknowledged pin undercuts.

Ranges coming from your own `package.json` are labeled `<name> (this package.json)`, where `<name>` is that file's `name` field. In this repo, for example, a pin undercutting one of its direct dependencies reports as `unirend (this package.json) declares "^7.8.0"`. In a monorepo each additional workspace is named the same way, as `<name> (workspace <path>)`. The distinction is worth making because a pin undercutting your own declaration is far more actionable than one undercutting a package deep in the tree. A `package.json` with no `name` at all still works, and the label degrades to just `this package.json`.

Peer ranges count too, on both sides. Bun auto-installs peer dependencies, so a peer range is a live constraint rather than a wish: a package declaring peer `react >=19` alongside an override pinning React 18 is the same incompatible pin as any other, and it installs without a warning. Optional peers are left out, being the ones genuinely allowed to go unsatisfied. Resolved packages record them in `bun.lock`; workspace entries do not preserve `peerDependenciesMeta`, so the check reads each workspace's `package.json` to recover that distinction. When a package declares both a real dependency and an optional peer on the same name, the installed range is still compared, since it is the binding one. That combination is normal for a library, which develops against one version of what it broadly supports: this repo declares react as a devDependency at `^19.2.7` and a peer at `^19.0.0`.

Two cases are deliberately left alone by the compatibility comparison specifically. A package that resolved to more than one version is skipped, since attributing which dependent got which copy needs a dependency-graph walk this check does not do. Ranges semver cannot evaluate (`workspace:`, `npm:` aliases, git URLs) are skipped as legitimate and simply outside what the check answers. Neither exemption lets a broken pin through, because the outcome check below still compares what the override asked for against what the lockfile holds.

#### Pins the Lockfile Never Applied

The other checks all reason about the **declaration**, and each one encodes a belief about what bun does with it. This one reasons about the **result**: it compares the version the override asks for against what `bun.lock` actually resolved, so it still holds if one of those beliefs turns out to be wrong or bun's behavior changes.

```
These overrides are declared but not reflected in bun.lock, so the pin is not in
effect and the version you asked for is not what is installed:
  - overrides.brace-expansion asks for "1.1.16" but "brace-expansion" resolved to "5.0.7"
```

In practice this means `package.json` was edited without installing since, which is worth failing on because every other check passes in that state: the package is present, so `bun why` succeeds, and its resolved version can sit comfortably inside every declared range. The run would otherwise report the override as applied while the version you pinned is not the one installed. Running `bun install` fixes it. A pin that survives an install cannot be satisfied as written, so check for a conflicting range or a version that does not exist.

Only a resolved version falling **outside** the declared range is a finding, never the mere fact that a package resolved to several versions. A range pin like `^2.0.0` legitimately permits more than one, so failing on multiplicity alone would flag overrides doing their job. An exact pin that failed to collapse the tree to one version is still caught, since any version other than the pinned one fails to satisfy it. Specs semver cannot evaluate (`npm:` aliases, `workspace:`, `catalog:`, git URLs, file paths) are skipped, having no version to compare.

#### Seeing What Each Pin Is Doing

A passing run prints one line, since it runs on every build. Add `--verbose` to see what each surviving override is actually doing to the resolved tree, using the same lockfile and manifest data the check already loads, so it stays offline and costs nothing extra:

```
overrides check passed (2 declared, all still applied).

  esbuild → 0.28.1
      forcing past tsup@8.5.1 (declares "^0.27.0")
  js-yaml → 4.3.0
      within every declared range
      not currently forcing anything, so it may have outlived its reason —
      remove it and run install:fresh to see what actually moves
```

The split is the useful part. **Forcing past** means the pin is doing work right now, holding a dependent above the range it asked for, which is the normal reason an override exists. **Within every declared range** means it is not forcing anything at the moment, which is the strongest hint available offline that the pin may have outlived its reason.

That is a hint, never a verdict, and it never fails the check. A pin sitting inside every range can still be load-bearing by capping a future major that nothing in the tree has reached yet. Confirm it the on-demand way below before removing it.

#### Checking Whether an Override Is Still Needed

The section above catches a stale pin once its dependents have moved past it. One case still escapes offline detection: a pin that **satisfies every range declared on it**, while a newer version exists that would satisfy them too. If every dependent asks for `^2.0.0` and the override pins `2.0.1`, nothing on disk knows whether `2.1.2` was ever published, so the pin can sit there long after the advisory it was added for was fixed.

Every offline signal agrees it looks fine, which is what makes this one persistent: the package is in the tree and satisfies its ranges so `check:overrides` passes, `bun audit` is quiet because the advisory is resolved, and `bun outdated` lists only direct dependencies, so a pinned transitive never shows up there at all.

Answering it means resolving without the override, which is what `install:fresh` is for. Delete the suspect override, run it, and read the change report:

```
Changed (1):
  ~ brace-expansion 2.0.1 → 2.1.2
```

The pin was holding the package back, so the removal stands. If the report instead shows it dropping to a version you pinned away from, put the override back. This is deliberately an on-demand step rather than part of `bun run check`: it costs a real resolve, and the result is a judgment call rather than a pass/fail, since some pins exist to hold a version steady on purpose.

### Nested Overrides and Bun

npm's nested form scopes an override to one parent:

```json
"overrides": { "minimatch": { "brace-expansion": "1.1.16" } }
```

**Bun ignores that entry completely.** It does not scope the override the way npm does, and it does not flatten it and apply it globally either. Nothing is pinned. Bun's docs state the limitation directly, "Bun only supports top-level `overrides`, not nested overrides", with the same note for `resolutions`, and support is still open upstream as [oven-sh/bun#6608](https://github.com/oven-sh/bun/issues/6608).

A repo that pinned a CVE through a nested override believes it is patched and has no pin at all. Bun does print `warn: Bun currently does not support nested "overrides"` while installing, but that scrolls past in install output and fails nothing, so `check:overrides` turns it into a build failure and tells you to flatten it:

```
Bun does not support nested overrides and ignores these entirely, so they pin nothing:
  - overrides.minimatch.brace-expansion → "brace-expansion" is not pinned at all

  Flatten each one to a top-level entry, which is the only form bun applies:
    "overrides": { "brace-expansion": "<version>" }
```

Flattening changes the meaning, so it is worth a deliberate look. The top-level form applies the pin **everywhere** in the tree, not just under the parent you had nested it under. npm scopes the nested form instead, so a repo installed with both package managers resolves it differently.

Two details the check gets right as a result:

1. A nested entry is reported whether or not its target is installed. Bun drops it either way, so asking whether the package is in the tree is the wrong question. The parent key is only a selector and is never reported as a dead package in its own right.
2. npm's `"."` key, meaning "the parent package itself", **is** honored by bun. `{ "pkg": { ".": "1.2.3" } }` pins `pkg` exactly like the flat form, so the check treats it as a real, working target, while still flagging any non-`"."` sibling in the same block.

### Version-Qualified Override Keys

npm also lets an override key carry a version selector, meaning "override this package only where the requested range is that one":

```json
"overrides": { "brace-expansion@^2": "1.1.16" }
```

**Bun does not implement the selector.** It reads the whole key, `brace-expansion@^2`, as a package name, and no package is named that, so the override applies to nothing. Verified against bun 1.3.14: with a `minimatch` declaring `brace-expansion: "^5.0.5"`, the key above left `brace-expansion` resolved at `5.0.7`, byte-identical to the lockfile produced with no override at all, while the flat key `"brace-expansion"` pinned it to `1.1.16` as expected. Bun writes the entry into `bun.lock`'s `overrides` block either way, which makes it look applied.

This one is quieter than the nested form. There is no `warn:` line at all, so it behaves like a stale pin: nothing anywhere reports it. It is also easy to reach for, since npm genuinely supports it, and it fails in the direction that matters most, a security pin that reads as present and does nothing:

```
These declarations are malformed, so bun cannot apply them:
  - overrides.brace-expansion@^2 carries a version selector, which bun does not implement. It reads the whole key as a package name, so this override silently applies to nothing. Drop the selector: "brace-expansion": "<version>".
```

The check never strips the selector to recover the package name. Stripping would resolve the key to a package that generally **is** installed and report a dead override as working, which is precisely the false negative the check exists to prevent. A leading `@` is still treated as a scope marker rather than a selector, so `@scope/pkg` passes and `@scope/pkg@^1` does not.

### Declaring the Same Pin Twice

`overrides` and `resolutions` both work in bun, and a package can end up in both at once:

```json
"overrides": { "brace-expansion": "5.0.6" },
"resolutions": { "brace-expansion": "5.0.7" }
```

Using both fields is the only way to declare one package twice, since each is a single JSON object and an object cannot hold the same key twice. A repeated key inside one block is collapsed by the JSON parser long before any check sees it, keeping the last one, and bun prints its own `Duplicate key` warning for that.

The realistic way to arrive here is a yarn-era `resolutions` block left behind after moving to bun, or a fix pasted from a yarn-flavored issue thread landing next to an existing `overrides` entry. Both fields keep working and both read as authoritative, so the file gives no hint which one is in force.

**Bun applies the `overrides` entry and silently ignores the other.** Verified against bun 1.3.14: the pair above resolved to `5.0.6`, and swapping the two fields in the file did not change that, so it is precedence between the fields rather than document order. The install printed nothing and exited 0.

The danger is that the ignored entry still reads as a live pin. If the `resolutions` value is the one carrying a security fix, it looks applied and is not:

```
These declarations conflict, so only one of them is in force:
  - overrides.brace-expansion asks for "5.0.6" but resolutions.brace-expansion asks for "5.0.7" for the same package. Bun applies the overrides entry and silently ignores the other, so remove whichever one is wrong.
```

Two entries agreeing on the same version are deduped quietly rather than failing, since nothing is ambiguous about the outcome. Only a disagreement is reported, and the retained entry is the `overrides` one, matching what bun applies, so [Pins the Lockfile Never Applied](#pins-the-lockfile-never-applied) still compares against the version actually in force.

## Import Alias Enforcement (`@/`)

Generated projects import shared code through the `@/` alias (`@/*` → `./src/*`), wired up consistently in `tsconfig.json`, every app's `vite.config.ts`, and the ESLint import resolver. Two layers keep imports consistent:

1. **Editor (auto-imports):** `.vscode/settings.json` pins `importModuleSpecifier` to `project-relative`, so VSCode keeps imports relative _within_ an app but emits `@/…` once they cross the app boundary (the boundary is each app's own `tsconfig.json`).
2. **Lint (hand-written/pasted):** `eslint.config.js` enables `unirend/prefer-alias-imports` (from the `unirend/eslint-plugin` export). It flags a relative import only when it **escapes the importing file's nearest tsconfig directory** and the target lives under `src/`, for example a deep `../../../libs/format` from inside an app, and **autofixes** it to `@/libs/format`. Relative imports that stay within the same app, and targets outside `src/` (which have no alias form), are left alone. This deliberately mirrors the editor's `project-relative` boundary rather than a single static root, so `bun run lint:fix` and the editor agree.

The rule is autofixable (`severity: error`). Run `lint:fix` to apply. It accepts `rootDir` (default `"src"`) and `prefix` (default `"@/"`) options if you change the alias. It covers static `import`/`export … from` and dynamic `import()` specifiers. `require()` is out of scope since generated projects are ESM. The plugin requires ESLint 9 flat config (already set up in the template) and resolves through the `unirend` dependency every project gets.

If you maintain your own ESLint config (or tooling that wraps Unirend), the plugin is a standalone export:

```js
import unirend from 'unirend/eslint-plugin';

export default [
  {
    plugins: { unirend },
    rules: { 'unirend/prefer-alias-imports': 'error' },
  },
];
```

The generated config also adds a `no-restricted-imports` guard against `unirend/context`. That subpath is published only so the client and server bundles resolve a single shared context singleton. It is not part of the public API. If you hit the error, import from `unirend/client` or `unirend/server` instead.

## Build Target: Bun vs. Node

The `--target` flag (default `node`) controls what the **server bundle and run scripts** target. It doesn't change the framework code:

- **`node`** (default) bundles server scripts with `bun build --target=node --external vite` and run with `node`. Recommended for production runtime stability.
- **`bun`** scripts omit `--target node` and run the output with `bun`.

It also selects the right `serve:dev` variant for SSR/API (Bun runs the dev entry directly. Node bundles it first to work around the Bun HMR WebSocket bug).

## Adding More Apps to a Workspace

Run `create` again with a different name. The workspace already exists, so it just registers and scaffolds the new app. App-named scripts keep each app's commands separate, and shared scripts (like `generate:build-info`) are reused.

## Using the Generator Programmatically

Everything here is also available as a library, which is useful if you're building a tool that wraps Unirend, or want to generate into an in-memory filesystem. See the [Starter Templates API](starter-templates-api.md) doc.
