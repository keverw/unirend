# Starter Templates & CLI

The Unirend CLI (`unirend`) scaffolds new SSG, SSR, and API projects so you can
skip the boilerplate covered in the [main README](../README.md) and start with a
working app. Each generated project follows the same conventions the demos use,
routes in React Router, builds on Vite, and Unirend's server utilities wired up
for you.

Under the hood the CLI is a thin wrapper over the `unirend/starter-templates`
library. Everything the CLI does, you can do programmatically (including
generating into an in-memory filesystem). See the
[Starter Templates API](starter-templates-api.md) doc for integrating the
generator into your own tooling.

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
- [Import Alias Enforcement (`@/`)](#import-alias-enforcement-)
- [Build Target: Bun vs. Node](#build-target-bun-vs-node)
- [Adding More Apps to a Workspace](#adding-more-apps-to-a-workspace)
- [Using the Generator Programmatically](#using-the-generator-programmatically)

<!-- tocstop -->

## Requirements

The CLI **requires Bun**. Bun runs TypeScript directly and bundles to a single
JS file, which keeps the generator simple and out-of-the-box. If you run it under
plain Node it exits with an error and a pointer to [bun.sh](https://bun.sh).

Generated projects also use Bun for their development and build tooling, but they
**target Node by default at bundle time** (`bun build --target node --external vite`),
so your production server can run under Node. Each project's runtime target is set at creation time. Pass `--target bun` to
`create` to opt into Bun instead (see [Build target: Bun vs. Node](#build-target-bun-vs-node)).

> The framework itself avoids Bun-specific APIs and runs on both Bun and Node.
> The Bun requirement is for the generator/CLI tooling, not the runtime of what
> it produces.

## The Repo / Workspace Model

Unirend projects live inside a **workspace repo** that can hold multiple apps:

```
my-workspace/
├── unirend-repo.json        # workspace marker + project registry
├── package.json             # shared scripts/deps for every app (private: true)
├── tsconfig.json            # plus additional config files: prettier.config.js, eslint.config.js, cspell.json, .editorconfig, .vscode/ (settings.json, extensions.json), AGENTS.md
├── build-info.config.json   # (SSR/API only) build-info output manifest
├── scripts/
│   └── generate-build-info.ts   # SSR/API only
└── src/
    ├── apps/
    │   ├── my-blog/         # one app per template you create
    │   └── my-api/
    └── libs/                # shared code across apps
```

- `unirend-repo.json` marks the directory as a workspace and tracks every project
  you create (template + path + creation time). Its `name` identifies the
  workspace.
- The root `package.json` is shared by all apps, with `private: true` to avoid
  accidental publishing. Each app contributes its own `<app-name>:*` scripts (see
  the per-template script tables below).
- Apps are created under `src/apps/<name>`, and build output goes to `build/<name>`.
- `src/libs/` is for code shared across apps (import via the `@/` alias).

**Auto-init:** You can set up the workspace explicitly with `init-repo`, but if
it's missing when you run `create`, the CLI initializes it automatically with a
sensible default name (`unirend-projects`). So a single `bunx unirend create ...` in
an empty directory is enough to go from nothing to a runnable app.

## Quick Start

```bash
# Recommended: bunx downloads unirend if it isn't installed
bunx unirend create ssr my-app

# Then start the dev server from the workspace root (scripts are app-named)
bun install            # if not auto-installed
bun run my-app:serve:dev
```

That's it. `create` initializes the workspace (if needed), writes the project
files, wires up `package.json` scripts, runs `git init`, installs dependencies,
and formats the result.

## CLI Reference

```
bunx unirend <command> [args] [flags]
```

Run `bunx unirend help` (or no args) for the built-in help, and `bunx unirend version` for
the version number.

### `init-repo [path] [--name <repoName>]`

Initialize a directory as a Unirend workspace repo without creating a project
yet. Useful when you want to set the workspace name explicitly.

| Argument / flag     | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `[path]`            | Directory to initialize. Optional, defaults to the current directory. |
| `--name <repoName>` | Workspace name. Optional, defaults to `unirend-projects`.             |

```bash
bunx unirend init-repo
bunx unirend init-repo ./my-workspace
bunx unirend init-repo ./projects --name my-workspace
```

The target directory must be empty or contain only `.git`/`.gitignore`. Because
`create` auto-inits, `init-repo` is optional. Reach for it only when you want
control over the workspace name or want to set up the repo as a separate step.

### `create <type> <name> [path] [--target bun|node]`

Create a new project from a template.

| Argument / flag      | Description                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `<type>`             | Template ID, one of `ssg`, `ssr`, `api` (see [Templates](#available-templates)).                            |
| `<name>`             | Project name, in kebab-case, that becomes `src/apps/<name>` and the script prefix.                          |
| `[path]`             | Workspace repo path. Optional, defaults to the current directory. Supports `~` and absolute/relative paths. |
| `--target bun\|node` | Runtime the server bundle/scripts target. Optional, defaults to `node`.                                     |

Project names must be kebab-case: lowercase letters, numbers, and hyphens. They must start
with a letter, end with a letter or number, avoid consecutive hyphens, and not be a
reserved system name (for example, http, stream, fs, path, etc).

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

> **Collision safety:** the app-named scripts (`<name>:build`, etc.) must not
> already exist in the root `package.json`. If they do, `create` aborts before
> writing anything and tells you which names clashed. Pick a different project
> name or remove the conflicting scripts. Shared scripts like
> `generate:build-info` are added only when absent, so a second app never
> conflicts on those.

### `list`

List the available templates with their names and descriptions (the same
metadata used throughout this doc).

```bash
bunx unirend list
```

### `help` / `version`

```bash
bunx unirend help        # also: -h, --help, or no args
bunx unirend version     # also: -v, --version
```

`version` shows the running version. When a local `node_modules/unirend` is
present it also shows whether the versions match:

```
unirend v0.0.24
  local repo: v0.0.24 (matches)
```

### Local Version Delegation

When you run `bunx unirend` inside a repo that already has `unirend` installed
locally (in `node_modules`) and the versions differ, the CLI automatically
re-executes using the local binary, so you always use the version your project
was set up with, not whatever `bunx` pulled down.

After delegation, `version` shows both versions and flags if `bunx` has a newer
one available:

```
unirend v0.0.20
  source: local (node_modules/unirend)
  bunx version: v0.0.24 (newer — run: bun update unirend)
```

Set `UNIREND_NO_DELEGATE=1` to skip delegation and force the bunx version.

## Available Templates

These are the three template IDs `create` accepts. The one-line descriptions
match what `unirend list` prints.

| ID    | Name                         | Description                                                                     |
| ----- | ---------------------------- | ------------------------------------------------------------------------------- |
| `ssg` | Static Site Generation (SSG) | Pre-rendered static site with React Router and Vite build system                |
| `ssr` | Server-Side Rendering (SSR)  | Full-stack React app with server-side rendering, API routes, and plugin support |
| `api` | API Server                   | Standalone JSON API server with WebSocket and plugin support                    |

Each template is documented below with two parts: **files you'll customize**
(the handful you'll edit first, plus a next-steps checklist) and **what gets
generated** (the full file tree, explained).

---

## SSG Template

Pre-rendered static site. Pages are rendered to HTML at build time by invoking
your server entry, then served by any static file host or CDN. Includes a
client-side SPA page example, theme support, and error-page demos.

See [docs/ssg.md](ssg.md) for the underlying SSG concepts.

### SSG, Files You'll Customize

Start here:

- **`Routes.tsx`** is your route table (`RouteObject[]`). Add your pages here. The
  generated file includes the demo routes, a `Dashboard` SPA route, a static
  `404` route, and a commented-out wildcard `*` route.
- **`pages/Home.tsx`, `pages/About.tsx`, `pages/Dashboard.tsx`** are placeholders
  for your real pages. `Dashboard` is registered as a client-rendered SPA page.
  Delete it if you don't need a SPA route, since it's just an example. The rest are
  statically generated.
- **`generate-ssg.ts`** declares which pages to pre-render (SSG) vs. serve as
  SPA shells. Add an entry here for each new page.
- **`components/AppLayout.tsx`** is the root layout wrapper (nav, footer slot,
  global structure). Customize this to reshape the overall page shell.
- **`components/Header.tsx`, `components/Footer.tsx`** are your shared chrome.
- **`components/error-pages/ApplicationError.tsx`, `GenericError.tsx`,
  `NotFound.tsx`** are the React error and 404 UI. Swap these out with your own
  branded error pages.
- **`error-pages/500.html`** is the self-contained static 500 page (no React
  bundle), so it works even when the asset pipeline is down.
- **`index.html`** is the HTML template (title, meta, the `<!--ss-head-->` /
  `<!--ss-outlet-->` markers). Customize `<title>`, favicons, etc.
- **`consts.ts`** has toggles like `ENABLE_TEST_ROUTES` (the error-demo routes).

**Next steps checklist**

- [ ] Add your routes to `Routes.tsx` and register each pre-rendered page in `generate-ssg.ts`.
- [ ] Replace the `Home`/`About`/`Dashboard` pages with your own.
- [ ] Customize the `Header`/`Footer` and `index.html` (title, favicons, meta).
- [ ] Customize the static `error-pages/500.html` and the `404` route to match your branding.
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
├── consts.ts                      # ENABLE_TEST_ROUTES toggle for the error-demo routes
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

| Script                                      | What it does                              |
| ------------------------------------------- | ----------------------------------------- |
| `<name>:spa-dev`                            | Vite HMR dev server (SPA only, no SSG)    |
| `<name>:build:client`                       | Build client assets + manifests           |
| `<name>:build:server`                       | Build the `EntrySSG.tsx` server entry     |
| `<name>:build:serve`                        | Bundle `serve.ts` (the static server)     |
| `<name>:build`                              | All three builds above                    |
| `<name>:generate:dev` / `:prod`             | Run `generate-ssg.ts` to pre-render pages |
| `<name>:build-and-generate:dev` / `:prod`   | Build then generate                       |
| `<name>:serve:dev` / `:prod`                | Serve from source (`serve.ts`)            |
| `<name>:serve:built:dev` / `:prod`          | Serve the bundled static server           |
| `<name>:build-generate-serve:dev` / `:prod` | Build + generate + serve, end to end      |

---

## SSR Template

Full-stack React app with per-request server-side rendering, co-located API
routes, page-data loaders, plugins, and a runtime 500 error page. Includes theme
support seeded server-side for flash-free dark mode.

See [docs/ssr.md](ssr.md) for the underlying SSR concepts, and
[docs/server-plugins.md](server-plugins.md) for the plugin system.

### SSR, Files You'll Customize

Start here:

- **`Routes.tsx`** is your route table. Every route is wired through
  `createPageDataLoader` (fetching page data from the API, short-circuiting to
  the co-located handler). Includes the `API_BASE_URL` block and an active
  wildcard `*` route with a `not-found` loader.
- **`pages/Home.tsx`, `pages/About.tsx`** are placeholders for your real pages. These
  use `useLoaderData` to show server-seeded data.
- **`server/ssr-component.ts`** is the heart of the server: registers page data
  loader handlers, API routes, and plugins. Add your endpoints and plugins here.
- **`server/get-500-error-page.ts`** is the runtime 500 page (the SSR equivalent
  of the SSG `500.html`). Customize branding. It shows dev error details when
  running in development.
- **`server/plugins/theme.ts`** is an example plugin (seeds theme from a cookie). Use
  it as a model for your own plugins.
- **`components/AppLayout.tsx`** is the root layout wrapper (nav, footer slot,
  global structure). Customize this to reshape the overall page shell.
- **`components/Header.tsx`, `components/Footer.tsx`** are shared chrome. The footer
  reads `currentYear` from `usePublicAppConfig` (seeded server-side).
- **`components/error-pages/ApplicationError.tsx`, `GenericError.tsx`,
  `NotFound.tsx`** are the React error and 404 UI. Swap these out with your own
  branded error pages.
- **`index.html`**, **`consts.ts`** have the same roles as in SSG.

Environment variables the generated server reads (names derived from your app
name, in upper case):

- `<APP>_PORT` is the port to listen on.
- `<APP>_SRC_DIR` is the source dir for Vite in the Node dev-server workaround (set automatically by the `serve:dev` script when targeting Node).
- `<APP>_DIST_DIR` is the built-assets dir override.
- `INTERNAL_API_ENDPOINT` is the internal API URL when SSR and API run as separate pools.

**Next steps checklist**

- [ ] Add your routes to `Routes.tsx` and your pages under `pages/`.
- [ ] Register your page-data handlers, API routes, and plugins in `server/ssr-component.ts`.
- [ ] Customize `server/get-500-error-page.ts` and the `404` handling to match your branding.
- [ ] Customize the `Header`/`Footer` and `index.html`.
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
├── consts.ts                      # ENABLE_TEST_ROUTES toggle
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

`src/apps/<name>/current-build-info.ts` is **not** scaffolded. It's a
gitignored, per-build artifact produced by running `generate:build-info`. See
[docs/build-info.md](build-info.md).

### SSR, Scripts

| Script                                 | What it does                                                                |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `<name>:spa-dev`                       | Vite HMR dev server (SPA only, no SSR)                                      |
| `<name>:build:client`                  | Build client assets + manifests                                             |
| `<name>:build:server`                  | Build the `EntrySSR.tsx` server entry                                       |
| `<name>:build:serve`                   | Bundle `serve-built.ts` (`IS_BUILT=true`)                                   |
| `<name>:build`                         | generate build info → client → server → serve                               |
| `<name>:serve:dev`                     | SSR dev with HMR (Bun runs `serve-hmr.ts`, Node bundles it first, see note) |
| `<name>:serve:built:dev` / `:prod`     | Run the bundled server                                                      |
| `<name>:build-and-serve:dev` / `:prod` | Build then run the bundled server                                           |
| `generate:build-info`                  | (shared) generate build metadata for all server apps                        |

> **`serve:dev` and the Bun HMR workaround:** when targeting Node, `serve:dev`
> bundles the dev server with `bun build --target=node` and runs it under Node,
> sidestepping a Bun bug where the Vite HMR WebSocket can stall graceful
> shutdown. When targeting Bun it runs `serve-hmr.ts` directly. Either way the
> command name is the same. See [docs/websockets.md](websockets.md).

---

## API Template

Standalone JSON API server, with no Vite, no client bundle, and no React surface. Boots
the Unirend API server under a Lifecycleion `LifecycleManager`, with the same
plugin and page-data-handler conventions as the SSR server, plus WebSocket
support.

See [docs/ssr.md](ssr.md) (the standalone API server section) and
[docs/server-plugins.md](server-plugins.md).

### API, Files You'll Customize

Start here:

- **`api-component.ts`** is the component that boots the API server. Register your
  routes, page-data handlers, and plugins here.
- **`serve.ts`** is the standalone entry point that runs the component under a
  `LifecycleManager` and handles signals/graceful shutdown. You'll rarely need to
  edit this beyond the manager name (already set to `<name>-api-server`).

Environment variables the generated server reads:

- `<APP>_PORT` is the port to listen on.

**Next steps checklist**

- [ ] Register your API routes, page-data handlers, and plugins in `api-component.ts`.
- [ ] Override `<APP>_PORT` if the default (`3000`) doesn't suit your setup.
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

As with SSR, `current-build-info.ts` is a gitignored artifact produced by
`generate:build-info`, not scaffolded.

The API template ships no `prettier.config.js`, `index.html`, or CSS — it has no
Vite/client surface and uses the repo-root configs for those. It does ship a
minimal app-level `tsconfig.json` (extends the repo root, drops the
`vite/client` types). That config exists purely to establish a project boundary
so editor auto-imports resolve shared `src/libs/*` modules through the `@/` alias
rather than as long relative paths — matching the Vite templates. See
[Workspace files](#workspace-files-shared-across-all-templates) for the
`importModuleSpecifier` setting that drives this.

### API, Scripts

| Script                                 | What it does                                            |
| -------------------------------------- | ------------------------------------------------------- |
| `<name>:serve:dev`                     | Dev server (Bun runs `serve.ts`, Node bundles it first) |
| `<name>:build:serve`                   | Bundle `serve.ts` (`IS_BUILT=true`)                     |
| `<name>:build`                         | generate build info → bundle                            |
| `<name>:serve:built:dev` / `:prod`     | Run the bundled server                                  |
| `<name>:build-and-serve:dev` / `:prod` | Build then run the bundled server                       |
| `generate:build-info`                  | (shared) generate build metadata for all server apps    |

> **`serve:dev` and the Bun runtime workaround:** when targeting Node, `serve:dev`
> bundles the dev server with `bun build --target=node` and runs it under Node,
> sidestepping Bun-native runtime quirks. When targeting Bun it runs `serve.ts`
> directly. Either way the command name is the same. See [docs/websockets.md](websockets.md).

---

## Workspace Files (Shared Across All Templates)

Whether you run `init-repo` or `create` (which auto-inits), Unirend ensures these
shared workspace files exist at the repo root. They're created only if missing
(merge-aware files like `.gitignore`, `.prettierignore`, `cspell.json`, and
`package.json` are updated in place to add what's needed):

- `unirend-repo.json` is the workspace marker and project registry.
- `package.json` has shared scripts/deps, `private: true`.
- `tsconfig.json`, `prettier.config.js`, `eslint.config.js`, `cspell.json`, `.editorconfig`.
- `.gitignore`, `.prettierignore`.
- `.vscode/settings.json`, `.vscode/extensions.json`. The settings pin
  `importModuleSpecifier` to `project-relative`, so auto-imports stay relative
  within an app but switch to the `@/` alias when they reach into shared
  `src/libs/*` (the boundary is each app's own `tsconfig.json`).
- `AGENTS.md`.
- `scripts/clean-cspell.ts`.
- `.gitkeep` files for `scripts/`, `src/apps/`, `src/libs/`.

## Import Alias Enforcement (`@/`)

Generated projects import shared code through the `@/` alias (`@/*` → `./src/*`),
wired up consistently in `tsconfig.json`, every app's `vite.config.ts`, and the
ESLint import resolver. Two layers keep imports consistent:

1. **Editor (auto-imports)** — `.vscode/settings.json` pins
   `importModuleSpecifier` to `project-relative`, so VSCode keeps imports
   relative _within_ an app but emits `@/…` once they cross the app boundary
   (the boundary is each app's own `tsconfig.json`).
2. **Lint (hand-written/pasted)** — `eslint.config.js` enables
   `unirend/prefer-alias-imports` (from the `unirend/eslint-plugin` export). It
   flags a relative import only when it **escapes the importing file's nearest
   tsconfig directory** and the target lives under `src/` — e.g. a deep
   `../../../libs/format` from inside an app — and **autofixes** it to
   `@/libs/format`. Relative imports that stay within the same app, and targets
   outside `src/` (which have no alias form), are left alone. This deliberately
   mirrors the editor's `project-relative` boundary rather than a single static
   root, so `bun run lint:fix` and the editor agree.

The rule is autofixable (`severity: error`); run `lint:fix` to apply. It accepts
`rootDir` (default `"src"`) and `prefix` (default `"@/"`) options if you change
the alias. The plugin requires ESLint 9 flat config (already set up in the
template) and resolves through the `unirend` dependency every project gets.

If you maintain your own ESLint config (or tooling that wraps Unirend), the
plugin is a standalone export:

```js
import unirend from 'unirend/eslint-plugin';

export default [
  {
    plugins: { unirend },
    rules: { 'unirend/prefer-alias-imports': 'error' },
  },
];
```

The generated config also adds a `no-restricted-imports` guard against
`unirend/context`. That subpath is published only so the client and server
bundles resolve a single shared context singleton — it is not part of the
public API. If you hit the error, import from `unirend/client` or
`unirend/server` instead.

## Build Target: Bun vs. Node

The `--target` flag (default `node`) controls what the **server bundle and run
scripts** target. It doesn't change the framework code:

- **`node`** (default) bundles server scripts with `bun build --target=node --external vite`
  and run with `node`. Recommended for production runtime stability.
- **`bun`** scripts omit `--target node` and run the output with `bun`.

It also selects the right `serve:dev` variant for SSR/API (Bun runs the dev
entry directly. Node bundles it first to work around the Bun HMR WebSocket bug).

## Adding More Apps to a Workspace

Run `create` again with a different name. The workspace already exists, so it
just registers and scaffolds the new app. App-named scripts keep each app's
commands separate, and shared scripts (like `generate:build-info`) are reused.

## Using the Generator Programmatically

Everything here is also available as a library, which is useful if you're building a tool
that wraps Unirend, or want to generate into an in-memory filesystem. See the
[Starter Templates API](starter-templates-api.md) doc.
