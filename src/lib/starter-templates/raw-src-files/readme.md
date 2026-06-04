# Raw starter template source files

This directory holds the working source-of-truth versions of files that the
Unirend starter template generator is being refactored to emit. The refactor
turns each file here into string literals — plus dedicated functions for the
dynamic substitutions (project name, app name, runtime target, etc.) — inside
the generator itself.

This directory is essentially a burn down chart style repo reference: as files are absorbed into
the generator, they are deleted from here. What remains is what's left to do,
and the contents can be diffed against the generator's output to verify
parity.

This README documents:

1. The implementation plan for the scaffolding work (`createProjectSpecificFiles`).
2. Non-obvious runtime and build behavior that the generator must preserve or
   adapt when emitting code for a new project.

## Remaining raw app files snapshot

Snapshot taken June 3, 2026 at 4 PM MDT.

There are **4 raw app files** left to port under `src/apps/`:

- SSG: 0 files ✅
- SSR: 4 files
- API: 0 files

Remaining SSR files:

- `src/apps/ssr/server/get-500-error-page.ts`
- `src/apps/ssr/server/plugins/theme.ts`
- `src/apps/ssr/server/ssr-component.ts`
- `src/apps/ssr/server/start.ts`

## `createProjectSpecificFiles` — implementation plan

`createProjectSpecificFiles` is the function that writes template-specific
source files into a newly scaffolded project.

### What's already in the generator (not in this tree)

Several base files are already populated programmatically by `ensureBaseFiles`
and the helpers under `src/lib/starter-templates/base-files/`. These are
omitted from this directory so the tree only contains work still pending:

- Root `tsconfig.json` → `ensureTsConfig`
- Root `prettier.config.js` → `ensurePrettierConfig`
- Root `eslint.config.js` → `ensureEslintConfig`
- Root `cspell.json` (words + ignorePaths) → `ensureCspell`
- `unirend-repo.json` → `createRepoConfigObject` + `addProjectToRepo`
- `scripts/.gitkeep`, `src/apps/.gitkeep`, `src/libs/.gitkeep` →
  `ensureGitkeep` with the `*_GIT_KEEP_FILE_SRC` constants

### Shared vs. project-specific files

Of what remains, some files are identical across all template types and
should be written by a shared scaffold path:

- `entry-client.tsx`
- remaining `public/` directory contents

Already absorbed into the shared scaffold path (`templates-shared/`), called
from the SSG and SSR branches of `createProjectSpecificFiles`:

- `vite-env.d.ts` → `ensure-vite-env.ts` (`ensureViteEnv`).
- `vite.config.ts` → `vite-config.ts` (`ensureViteConfig`). The two raw copies
  were identical apart from the app slug in the bundle-report/build paths, so
  the generator interpolates the project name as `appName`. The `isSSRBuild`
  const was renamed to `isServerEntryPoint` (still reading
  `configEnv.isSsrBuild`) for clarity.
- `tsconfig.json` → `app-tsconfig.ts` (`ensureAppTsConfig`). Static and
  identical across SSG/SSR. API ships no app-level tsconfig — it has no
  Vite/client surface and just uses the repo-root config.
- `prettier.config.js` → `app-prettier-config.ts` (`ensureAppPrettierConfig`).
  Static and identical across SSG/SSR; extends the repo-root config and adds the
  Tailwind plugin. API ships none — no Tailwind/CSS surface, so it uses the
  repo-root config.
- `index.html` → `app-index-html.ts` (`ensureAppIndexHTML`). The two raw copies
  differed only in the `<title>`, which was a hardcoded "Unirend SSG/SSR
  Template" placeholder; the generator interpolates a real `title` (the project
  name) instead. Everything else is verbatim.
- `consts.ts` → `app-consts.ts` (`ensureAppConsts`). The exported
  `ENABLE_TEST_ROUTES` flag is identical; only the header comment differs per
  template (it names the scripts that toggle the error-demo routes), so the
  helper switches on `templateID` and injects the app-prefixed script names.
  API ships none — it has no error-demo routes.
- `index.css` → `app-index-css.ts` (`ensureAppIndexCSS`). The two raw copies
  were byte-identical, so it's static and shared — the Tailwind import,
  class-based dark-mode variant, base html background colors, and commented-out
  theme/`@utility`/`@layer`/class examples are all emitted verbatim. API ships
  none — it has no Tailwind/CSS surface.
- `EntryClient.tsx` → `app-entry-client.ts` (`ensureAppEntryClient`). The two
  raw copies were byte-identical, so it's static and shared — mounts the app
  via `unirend/client`, imports the stylesheet and routes, wraps the tree in
  `ThemeProvider`, and logs the hydration/render outcome. API ships none — it
  has no client entry point.
- `public/robots.txt` → `app-public-robots.ts` (`ensureAppPublicRobots`). The
  two raw copies were byte-identical, so it's static and shared — allows all
  bots. The API template doesn't ship one (no public/static-file surface).
- `public/favicon.svg` → `app-public-favicon.ts` (`ensureAppPublicFavicon`).
  The two raw copies were byte-identical, so it's static and shared — a simple
  dark-background SVG icon. The API template doesn't ship one (no
  public/static-file surface).
- `public/favicon.ico` → `app-public-favicon-ico.ts` (`ensureAppPublicFaviconICO`).
  The two raw copies were byte-identical. Embedded as a base64 string literal
  (decoded to `Buffer`/`Uint8Array` at write time) — base64 was chosen over hex
  for ~33% overhead vs 100%. Parity verified by MD5 of in-memory VFS output vs.
  original file. The API template doesn't ship one (no public/static-file
  surface).
- `EntrySSG.tsx` / `EntrySSR.tsx` → `app-entry-server.ts`
  (`ensureAppEntryServer`). The two files are structurally identical — same
  imports, same `render` export, same `unirendBaseRender` call — differing only
  in two JSDoc comment lines that name the template and its rendering model
  ("SSG generator / build time" vs "SSR server / runtime"). The output filename
  also varies (`EntrySSG.tsx` vs `EntrySSR.tsx`), so `templateID` drives both
  the comment text and the filename. API ships none — it has no server render
  entry point.

Already absorbed into a single template's path (`templates-specific/<template>/`),
called only from that template's branch of `createProjectSpecificFiles`:

- `src/apps/api/api-component.ts` → `templates-specific/api/api-component.ts`
  (`ensureAPIComponent`). The Lifecycleion component that boots the Unirend API
  server, registers routes/page-data handlers, and wires graceful start/stop.
  API-only and structurally unique, so it has no shared counterpart. The one
  per-project substitution is an inline comment naming the build script
  (`${appName}:build` — see _Build info generator design_ below), kept accurate
  so it tracks the generated app's actual script names. Note the component's own
  `name: 'api-server'` (passed to `BaseComponent`) is intentionally **not**
  injected: per _Lifecycle and component naming consistency_ below, the
  component keeps its generic name and only the manager name (in `serve.ts`)
  gets the app name. The `{{port}}` token is the Lifecycleion logger's own param
  syntax, not a scaffold variable. No extra cspell words needed; `Lifecycleion`
  is already a default.
- `src/apps/api/serve.ts` → `templates-specific/api/api-serve.ts`
  (`ensureAPIServe`). The standalone entry point that runs `APIServerComponent`
  under a Lifecycleion `LifecycleManager` and handles signals/graceful
  shutdown. The one per-project substitution is the manager name: per _Lifecycle
  and component naming consistency_ below, it's injected as
  `` `${appName}-api-server` `` (vs. the raw template's `api-server-app`), while
  the registered component keeps its generic `api-server` name. Everything else
  is verbatim (the `{{name}}`/`{{msg}}`/`{{error}}` tokens are logger param
  syntax). No extra cspell words needed.

With both files done, the **API template is fully ported** — `raw-src-files/src/apps/api/`
no longer exists.

Already absorbed into the SSG-specific path (`templates-specific/ssg/`):

- `src/apps/ssg/error-pages/500.html` → `templates-specific/ssg/ssg-500-html.ts`
  (`ensureSSG500HTML`). A self-contained static error page — no React bundle, no
  external assets — so it survives real server failures where the asset pipeline
  may be unavailable. Includes inline CSS with light/dark variants and the same
  cookie-first dark-mode theme sync script as `index.html` (extended with
  `matchMedia` OS tracking, `BroadcastChannel` cross-tab sync, and
  `visibilitychange` cookie re-read). SSG-only: the SSR equivalent is the
  `get500ErrorPage` callback in `ssr-component.ts`.
- `src/apps/ssg/Routes.tsx` → `templates-specific/ssg/ssg-routes.ts`
  (`ensureSSGRoutes`). SSG-specific: uses static loaders from
  `./loaders/error-demo-loaders` for the error-demo test routes, includes a
  `Dashboard` route and a static `404` route (generated as a normal SSG page so
  it shares the app chrome), and leaves the wildcard `*` route commented out.
  No `API_BASE_URL` block or `createPageDataLoader` wiring. Fully static — no
  per-project substitutions needed.

Already absorbed into the SSG-specific path (`templates-specific/ssg/`), continued:

- `src/apps/ssg/serve.ts` → `templates-specific/ssg/ssg-serve.ts`
  (`ensureSSGServe`). The static file server entry point — boots a
  `StaticWebServer` under a Lifecycleion `LifecycleManager` and handles
  signals/graceful shutdown. Three per-project substitutions: the
  `LifecycleManager` name (`${appName}-ssg-serve`), the build directory
  (`build/${appName}/client`), and the port env var
  (`${UPPER_APP_NAME}_PORT` — used for both the JS const name and the
  `process.env` lookup). The component keeps its generic `static-web-server`
  name per the lifecycle naming rule.

Already absorbed into the shared scaffold path (`templates-shared/`), continued:

- `src/apps/ssg/components/AppLayout.tsx` / `src/apps/ssr/components/AppLayout.tsx` →
  `templates-shared/react-components/app-layout.ts` (`ensureAppLayout`). The two
  raw copies were byte-identical, so it's static and shared — handles both thrown
  router errors (via `RouteErrorBoundary`) and page-data loader error envelopes,
  delegating to `NotFound` or `GenericError` as appropriate. Scrolls to top on
  route change. API ships none — it has no client-side layout.
- `src/apps/ssg/components/error-pages/ApplicationError.tsx` /
  `src/apps/ssr/components/error-pages/ApplicationError.tsx` →
  `templates-shared/react-components/application-error.ts`
  (`ensureAppApplicationError`). The two raw copies were byte-identical, so it's
  static and shared — standalone (not wrapped in AppLayout) to avoid cascading
  failures if the layout itself throws; shows a dev-only error details panel.
  API ships none — it has no client-side rendering.
- `src/apps/ssg/components/error-pages/GenericError.tsx` /
  `src/apps/ssr/components/error-pages/GenericError.tsx` →
  `templates-shared/react-components/generic-error.ts`
  (`ensureAppGenericError`). The two raw copies were byte-identical, so it's
  static and shared — rendered by AppLayout when a page-data loader returns a
  non-404 error envelope; shows error code, message, and a dev-only stack
  trace. API ships none — it has no client-side rendering.
- `src/apps/ssg/components/error-pages/NotFound.tsx` /
  `src/apps/ssr/components/error-pages/NotFound.tsx` →
  `templates-shared/react-components/not-found.ts`
  (`ensureAppNotFound`). The two raw copies were byte-identical, so it's
  static and shared — rendered by AppLayout when the router signals a 404;
  accepts both `error` (for thrown router errors) and `data` (for loader error
  envelopes) props but only uses `data` to populate the page. API ships none —
  it has no client-side rendering.
- `src/apps/ssg/components/theme/context.ts` /
  `src/apps/ssr/components/theme/context.ts` →
  `templates-shared/react-components/theme-context.ts`
  (`ensureAppThemeContext`). The two raw copies were byte-identical, so it's
  static and shared — defines `ThemePreference`, `ResolvedTheme`,
  `ThemeContextValue`, `ThemeContext`, and the `useTheme` hook. Consumed by
  `ThemeProvider` (writes to the context) and any component that reads the
  current theme. API ships none — it has no client-side rendering.
- `src/apps/ssg/components/theme/ThemeProvider.tsx` /
  `src/apps/ssr/components/theme/ThemeProvider.tsx` →
  `templates-shared/react-components/theme-provider.ts`
  (`ensureAppThemeProvider`). The two raw copies were byte-identical, so it's
  static and shared. Seeds preference from request context, syncs with the
  cookie on mount, tracks OS dark/light changes via `matchMedia`, toggles the
  `dark` class on `<html>`, cycles the preference cookie, and cross-tab syncs
  via `BroadcastChannel`. Requires template-literal escaping: `\s` in two
  regex patterns and `${...}` in three cookie-string template literals. API
  ships none — it has no client-side rendering.
- `src/apps/ssg/components/theme/ThemeToggle.tsx` /
  `src/apps/ssr/components/theme/ThemeToggle.tsx` →
  `templates-shared/react-components/theme-toggle.ts`
  (`ensureAppThemeToggle`). The two raw copies were byte-identical, so it's
  static and shared — renders a button that cycles through `auto` → `dark` →
  `light` by calling `cycleTheme` from `useTheme`. API ships none — it has no
  client-side rendering.
- `src/apps/ssg/components/Header.tsx` /
  `src/apps/ssr/components/Header.tsx` →
  `templates-shared/react-components/header.ts`
  (`ensureAppHeader`). Two differences: the title text ("SSG Starter" /
  "SSR Starter") and the Dashboard nav link (SSG only). Uses a
  `buildHeaderSrc(templateID)` builder with an `if`/`else if`/exhaustive-check
  pattern (same as `app-consts.ts`). Requires template-literal escaping for
  the `navClass` arrow function's backtick template literal and its
  `${isActive ? ...}` interpolation.
- `src/apps/ssg/pages/SimulateDataloader500.tsx` /
  `src/apps/ssr/pages/SimulateDataloader500.tsx` →
  `templates-shared/react-components/simulate-dataloader-500.ts`
  (`ensureAppSimulateDataloader500`). The two raw copies were byte-identical,
  so it's static and shared — a fallback view shown only if the demo loader
  unexpectedly does not return a 500 error envelope (in practice the envelope
  is always returned and intercepted by `AppLayout`). No template-literal
  escaping needed. API ships none — it has no client-side rendering.
- `src/apps/ssg/pages/SimulateDataloader503.tsx` /
  `src/apps/ssr/pages/SimulateDataloader503.tsx` →
  `templates-shared/react-components/simulate-dataloader-503.ts`
  (`ensureAppSimulateDataloader503`). The two raw copies were byte-identical,
  so it's static and shared — same structure as the 500 variant but for 503
  envelopes. No template-literal escaping needed. API ships none — it has no
  client-side rendering.
- `src/apps/ssg/pages/SimulateDataloaderError.tsx` /
  `src/apps/ssr/pages/SimulateDataloaderError.tsx` →
  `templates-shared/react-components/simulate-dataloader-error.ts`
  (`ensureAppSimulateDataloaderError`). The two raw copies were byte-identical,
  so it's static and shared — fallback view for the throw-from-loader demo
  route; shown only if the loader unexpectedly does not throw (in practice it
  always throws and the result is a 500 envelope). No template-literal escaping
  needed. API ships none — it has no client-side rendering.

Already absorbed into the SSG-specific path (`templates-specific/ssg/`), continued:

- `src/apps/ssg/pages/SimulateComponentError.tsx` →
  `templates-specific/ssg/ssg-simulate-component-error.ts`
  (`ensureSSGSimulateComponentError`). Guards the throw behind a
  `typeof window !== 'undefined'` check so the SSG build can render a static
  placeholder without failing. In the browser it throws on hydration, triggering
  the `ApplicationError` boundary. Requires template-literal escaping for the
  backtick around `window` in the opening comment. Contrast with the SSR
  version, which always throws (no pre-render phase).
- `src/apps/ssg/components/Footer.tsx` →
  `templates-specific/ssg/ssg-footer.ts` (`ensureSSGFooter`). Static footer
  with Home, About, and Dashboard links. No dynamic data — title is a plain
  string and there is no current-year logic (contrast with the SSR footer,
  which reads `currentYear` from `usePublicAppConfig` seeded server-side).
- `src/apps/ssg/pages/Home.tsx` →
  `templates-specific/ssg/ssg-home.ts` (`ensureSSGHome`). Fully static at
  build time — no loader data. Feature cards cover "SSG Pages", "SPA Pages"
  (with Dashboard link), and "Theme Support". Error simulation section notes
  that "Throw from Component" is browser-only and includes a comment explaining
  /404 hard-navigation behavior in production.
- `src/apps/ssg/pages/About.tsx` →
  `templates-specific/ssg/ssg-about.ts` (`ensureSSGAbout`). Fully static —
  no loader data. Describes the SSG rendering model. Contrast with the SSR
  version which uses `useLoaderData` and shows a "From Server" line.
- `src/apps/ssg/pages/Dashboard.tsx` →
  `templates-specific/ssg/ssg-dashboard.ts` (`ensureSSGDashboard`). A
  client-rendered SPA page (registered as `{ type: 'spa', ... }` in
  `generate-ssg.ts`). The server serves a minimal HTML shell; React renders
  entirely on the client. SSR has no equivalent — all SSR pages are
  server-rendered on each request.
- `src/apps/ssg/generate-ssg.ts` →
  `templates-specific/ssg/ssg-generate-ssg.ts` (`ensureSSGGenerate`). The
  script that drives `generateSSG` to pre-render all pages at build time.
  Three per-project substitutions: build directory path in code
  (`'../../../build/${appName}'`), the same path in the JSDoc header comment,
  and the dashboard SPA page `title` field (`'Dashboard - ${appName}'`). Four
  template-literal escapes: three in the `pageInfo` ternary (path/filename
  interpolation) and one in the error-count string (`errorCount` interpolation).
  The dashboard title is an intentional change from `'Dashboard - My App'` in
  the raw file — the generator substitutes the real project name instead.
- `src/apps/ssg/loaders/error-demo-loaders.ts` →
  `templates-specific/ssg/ssg-error-demo-loaders.ts`
  (`ensureSSGErrorDemoLoaders`). Three local page-data loaders for the
  error-simulation routes: one that throws (Unirend converts it to a 500
  envelope), one that returns an explicit 500 envelope, and one that returns an
  explicit 503 envelope. SSG-only — SSR wires its error-demo loaders directly
  in `Routes.tsx` via `createPageDataLoader` and ships no separate loaders
  file. Requires template-literal escaping for the `request_id` backtick
  strings (`\`local_500_\${Date.now()}\`` and `\`local_503_\${Date.now()}\``).

Already absorbed into the SSR-specific path (`templates-specific/ssr/`):

- `src/apps/ssr/pages/SimulateComponentError.tsx` →
  `templates-specific/ssr/ssr-simulate-component-error.ts`
  (`ensureSSRSimulateComponentError`). Throws unconditionally on both server and
  client — no `window` guard needed because SSR renders per-request, not at
  build time. Return type is `never`. Contrast with the SSG version, which needs
  a `typeof window` check to avoid throwing during the static generation pass.
  No template-literal escaping needed.
- `src/apps/ssr/Routes.tsx` → `templates-specific/ssr/ssr-routes.ts`
  (`ensureSSRRoutes`). SSR-specific: wires every route through
  `createPageDataLoader` so page data is fetched from the API (short-circuiting
  to the registered handler when co-located). Includes the `API_BASE_URL` block
  (`window.__PUBLIC_APP_CONFIG__` on client, `INTERNAL_API_ENDPOINT` on server)
  and `pageDataLoaderConfig`. The wildcard `*` route is active with a
  `not-found` loader. No `Dashboard`/`404` SSG routes or `error-demo-loaders`
  import. Fully static — no per-project substitutions needed.
- `src/apps/ssr/serve-built.ts` → `templates-specific/ssr/ssr-serve-built.ts`
  (`ensureSSRServeBuilt`). Thin entry point — delegates to `server/start.ts`
  with `startApp('built')`. Fully static; no per-project substitutions.
- `src/apps/ssr/serve-hmr.ts` → `templates-specific/ssr/ssr-serve-hmr.ts`
  (`ensureSSRServeHMR`). Thin entry point — delegates to `server/start.ts`
  with `startApp('hmr')`. Fully static; no per-project substitutions.
- `src/apps/ssr/components/Footer.tsx` →
  `templates-specific/ssr/ssr-footer.ts` (`ensureSSRFooter`). Reads
  `currentYear` from `usePublicAppConfig` (seeded server-side at startup,
  updated at midnight) to avoid a server/client year-rollover mismatch. Home
  and About links only — no Dashboard link (contrast with the SSG footer).
- `src/apps/ssr/pages/Home.tsx` →
  `templates-specific/ssr/ssr-home.ts` (`ensureSSRHome`). Uses `useLoaderData`
  to display a "From Server" line seeded by the page-data loader. Feature cards
  cover "SSR Pages", "Data Loaders", and "Theme Support". Error simulation
  section explains that "Throw from Component" fires on both server and client:
  hard refresh triggers `get500ErrorPage`, client-side navigation after
  hydration is caught by `RouteErrorBoundary`'s `ApplicationErrorComponent`.
- `src/apps/ssr/pages/About.tsx` →
  `templates-specific/ssr/ssr-about.ts` (`ensureSSRAbout`). Uses
  `useLoaderData` and displays a "From Server" line. Describes the SSR
  rendering model. Contrast with the SSG version which is fully static.

Intentionally deferred from the SSR-specific path:

- `src/apps/ssr/server/start.ts` — the app factory used by both `serve-built.ts`
  and `serve-hmr.ts`. Only per-project substitution is the `LifecycleManager`
  name (`${appName}-ssr-server`). Held off pending a decision on 500 error page
  handling in `ssr-component.ts` — port once that design is settled so both
  files can be absorbed together. Reference `templates-specific/api/api-serve.ts`
  (`ensureAPIServe`) and `templates-specific/ssg/ssg-serve.ts` (`ensureSSGServe`)
  for the LifecycleManager wiring pattern.
- `src/apps/ssr/server/ssr-component.ts` — the SSR server component. When
  porting, substitute `SSR_PORT`, `SSR_SRC_DIR`, and `SSR_DIST_DIR` with
  app-name-derived equivalents (e.g. `MY_APP_PORT`, `MY_APP_SRC_DIR`,
  `MY_APP_DIST_DIR`) using `buildAppEnvVarName`, matching the app-scoped env
  vars in `api-component.ts` and `ssg-serve.ts`. Reference
  `templates-specific/api/api-component.ts` (`ensureAPIComponent`) for the
  server component pattern and `buildAppEnvVarName` for app-scoped env vars.
  Do not edit the raw file — the generator's output should be diffed against
  this reference as-is.

Project-specific files (entry points, routes, build configuration, server
scripts, generated build info) vary by template type and must be emitted by
`createProjectSpecificFiles`.

### Conversion playbook (per file)

The repeatable process for absorbing a file from this tree into the generator.
The core question is always: **diff the same file across templates and decide
whether it's shared (identical or near-identical) or project-specific.**

1. **Compare across templates.** `diff` the file between `ssg`/`ssr`/`api`.
   Outcomes:
   - _Identical_ → shared, static (e.g. `tsconfig.json`, `prettier.config.js`).
   - _Differs only in small, predictable spots_ → shared with a substitution
     (e.g. `vite.config.ts`'s app slug, `index.html`'s `<title>`,
     `consts.ts`'s per-template header). Inject those via a builder argument.
   - _Structurally different_ → project-specific; emit it from the template's
     own branch, with the literal living in `templates-specific/<template>/`.
2. **Pick a home.** `base-files/` = every template needs it. `templates-shared/`
   = a _subset_ needs it (most are SSG+SSR or SSR+API). API frequently opts out
   (no Vite/Tailwind/build-info surface) — note that in the doc comment.
   `templates-specific/` = structurally different, emitted from a single
   template's branch; place it under the owning template's subfolder
   (`templates-specific/ssg/`, `templates-specific/ssr/`,
   `templates-specific/api/`).
3. **Implement the pattern.** A private builder (or `const fileSrc`) returning
   the whole file as one template literal, plus an exported `ensure*` that
   writes it create-if-missing via `vfsWriteIfNotExists` (or read-merge for JSON
   manifests like `cspell.json` / `build-info.config.json`). Pass
   repo-root-relative paths; the VFS resolves them against the root.
4. **Mind template-literal escaping.** Escape backticks, `${`, and backslashes
   when embedding source — e.g. a regex `\s` becomes `\\s`, a literal `\n`
   becomes `\\n`. The parity check (step 6) catches mistakes.
5. **Honor repo conventions.** Acronyms written uppercase in identifiers
   (`ensureAppIndexHTML`, not `...Html`); preserve all comments verbatim; match
   the original's trailing newline.
6. **Verify byte-for-byte parity.** Generate into an in-memory root and compare
   against the original (still in git history after `git rm` — read it with
   `git show HEAD:<path>`), passing the reference's own substitution values
   (e.g. the slug as `appName`). For intentional changes (a rename, a real
   title), diff only the structural remainder.
7. **cspell.** Any word that lands in _scaffolded output_ that is detected by
   `cspell` and needs to be added to the dictionary goes in `ensureCspell`
   `defaultWords` **and** its test — not just the repo's own `cspell.json`. A
   word that only appears in generator source (not emitted) goes in the repo
   `cspell.json` only, or just reword to avoid it. Audit by scaffolding a
   project into a temp dir, running `ensureCspell`, then `cspell lint`.
8. **Close out.** `git rm` the raw file(s), move them to the _Already absorbed_
   list above, and run type-check + lint + prettier + spellcheck + tests.

### Implementation order

1. **SSG** — easiest; no server, just routes and static generation. Do first.
2. **SSR** — shares most files with SSG, but adds a server entry, build info
   wiring, and the Bun HMR considerations documented below.
3. **API** — separate script-style app with a small surface area, but distinct
   enough to do last.

### Function outline

`createProjectSpecificFiles` should:

1. Switch on `templateID` to determine which files to emit.
2. Generate template-specific files into the project directory via `vfsWrite`
   and `vfsWriteJSON`.
3. Process template variables (e.g. `{{projectName}}`, app name, runtime
   target).
4. Create any required directory structure.

Sketch:

```typescript
switch (templateID) {
  case 'ssg':
    // SSG entry, routes, generate-ssg script
    break;
  case 'ssr':
    await vfsWrite(root, `${projectPath}/src/index.tsx`, ssrEntryTemplate);
    await vfsWrite(root, `${projectPath}/vite.config.ts`, viteConfigTemplate);
    await vfsWriteJSON(root, `${projectPath}/package.json`, {
      name: projectName,
      version: '0.1.0',
      type: 'module',
      scripts: {
        /* ... */
      },
      dependencies: {
        /* ... */
      },
    });
    break;
  case 'api':
    // API entry, serve script
    break;
  default:
    throw new Error(`Unknown template: ${templateID}`);
}
```

### `package.json` script injection

Existing scripts follow an `<app-name>:<verb>` convention, with colons
separating further sub-steps:

```
ssg:spa-dev
ssg:build
ssg:build-and-generate:prod
ssr:spa-dev
ssr:build
ssr:serve:prod
```

When generating a new app, inject scripts that follow the same pattern into the
root `package.json`. An app named `my-app` would receive entries such as:

```json
{
  "my-app:dev": "cd src/apps/my-app && vite",
  "my-app:build": "...",
  "my-app:serve": "..."
}
```

The exact set of scripts depends on the template type:

- **SSG** gets `generate` and `serve` scripts.
- **SSR** gets `serve:dev` and `serve:prod` scripts (see the Bun HMR notes
  below for which `serve:dev` variant to emit).
- **API** gets `serve` and `build` scripts. A **single** `serve:dev` is
  emitted, chosen by `serverBuildTarget` (not both): for Bun it runs `serve.ts`
  directly (`bun run serve.ts dev`); for Node it bundles `serve.ts` with Bun and
  runs the output under `node` (the old `serve:dev-node` form — bundling for
  Node sidesteps the Bun-native runtime quirks). The rest: `build:serve` /
  `build`, `serve:built:dev` / `serve:built:prod`, and the `build-and-serve`
  combos. No client/generate steps since there's no Vite build. (Implemented —
  see the API branch of `getTemplateConfig`.)

When populating these in `getTemplateConfig`, split them into its two script
buckets:

- `projectScripts` — app-named commands (`<app>:build`, `<app>:dev`, …),
  expected to be unique per project. `createProject` aborts early if any
  collide with an existing root script.
- `sharedScripts` — generic commands a single script services for every app
  (e.g. `generate:build-info`). Added only when absent, so a second app
  doesn't conflict.

### Related work

`getTemplateConfig` is the source of truth that `createProjectSpecificFiles`
will read from. Its return type already covers everything that needs to vary
per template — `projectScripts`, `sharedScripts`, `dependencies`,
`devDependencies`, `gitignoreEntries`, `prettierignoreEntries`, `cspellWords`
(and their section headers) — and `ensureBaseFiles` already routes each field
into the right `ensure*` helper. The body currently returns `{}`; the work is
to populate it per template type, not to wire any new plumbing.

## Bun HMR graceful shutdown workaround

`ssr:serve:dev-node` is a temporary workaround for a Bun bug where the Vite HMR
WebSocket server stalls during graceful shutdown.

The script bundles the SSR dev server with `bun build --target=node` to
`build/ssr/serve-hmr.js` and runs the output under Node.js, which handles
WebSocket shutdown cleanly. The `SSR_SRC_DIR` environment variable is passed so
Vite can still locate the original source files even though the bundle lives in
`build/ssr/`.

Once the upstream Bun issue is resolved, `ssr:serve:dev` (which runs directly
under Bun with no build step) can be used again, and both `ssr:serve:dev-node`
and the `SSR_SRC_DIR` fallback in `ssr-component.ts` can be removed.

**Generator note:** when the generated project targets Bun, emit `ssr:serve:dev`.
Otherwise, emit the `ssr:serve:dev-node` variant under the same script name
(`ssr:serve:dev`) so end users get a consistent command regardless of runtime.

## Build info generator design

The project uses a single `scripts/generate-build-info.ts` script (renamed from
`ssr-generate-build-info.ts`) that reads `build-info.config.json` — a manifest
listing all output paths (e.g. `src/apps/ssr/current-build-info.ts`,
`src/apps/api/current-build-info.ts`) — and writes each one.

The generator script only reads the JSON config; it never writes or edits it.
The Unirend starter template generator tool is responsible for:

- Detecting which apps exist in the project.
- Adding entries to `build-info.config.json`.
- Wiring up the relevant `package.json` build scripts.
- Appending each new `current-build-info.ts` path to `.gitignore` and
  `.prettierignore` when scaffolding or adding a new app.

When emitting component templates, the generator should interpolate the actual
generated script names into inline comments that reference them (for example,
the "which always runs first in `api:build`" comment in the `loadBuildInfo`
block) rather than hardcoding the names. This keeps comments accurate when an
app uses a different script naming convention.

### IS_BUILT build-time constant

Both the SSR and API components use an `IS_BUILT` constant to decide whether to
load real build info or fall back to safe defaults. It is injected at bundle
time via `bun build --define 'IS_BUILT=true|false'` and accessed in source via
a `typeof` guard (since it is undeclared when running directly from source):

```typescript
// @ts-expect-error IS_BUILT is a build-time constant injected via bun build --define
const isBuilt = typeof IS_BUILT !== 'undefined' && IS_BUILT === true;
```

The three execution modes:

- **Production builds** (`ssr:build:serve`, `api:build:serve`):
  `--define 'IS_BUILT=true'`. The build info file is bundled inline (generated
  beforehand by `generate:build-info`).
- **Dev-node builds** (`ssr:serve:dev-node`, `api:serve:dev-node`):
  `--define 'IS_BUILT=false'` plus
  `--external "$(pwd)/src/apps/<app>/current-build-info.ts"`. The `--external`
  flag is required because Bun resolves and bundles all dynamic imports at
  build time regardless of whether the conditional branch can ever execute at
  runtime — without it, the build fails when the generated file is missing. An
  absolute path is required because Bun matches externals against resolved
  absolute paths, not the original import specifier. The `$(pwd)/...`
  expansion in `package.json` scripts provides this.
- **Direct-from-source** (`api:serve:dev`, `ssr:serve:dev`): `IS_BUILT` is
  undefined at runtime, so the `typeof` guard returns `false` and the safe
  defaults apply — no bundle step needed.

The `--external` absolute path requirement was identified through testing: Bun
resolves relative import paths to absolute paths before checking the external
list, so only the full absolute path form matches.

### Build script naming

The SSR app splits its build into granular sub-scripts (`ssr:build:client`,
`ssr:build:server`, `ssr:build:serve`) because it produces three separate
artifacts. `ssr:build` orchestrates all of them along with the
`generate:build-info` step.

The API app only produces one artifact, so `api:build:serve` is essentially
just that one bundle step. `api:build` wraps it together with the
`generate:build-info` step for consistency with the SSR pattern.

When generating scripts for new apps, the generator should mirror this
convention where it makes sense, and may simplify or document the distinction
for apps that only produce a single artifact.

## Lifecycle and component naming consistency

In the Unirend repository's demos, the `LifecycleManager` name uses a `-demo`
suffix; the starter templates use `-app` or `-serve` suffixes. For example:

| App | Demo name         | Starter template name |
| --- | ----------------- | --------------------- |
| SSR | `ssr-server-demo` | `ssr-server-app`      |
| API | `api-server-demo` | `api-server-app`      |
| SSG | `ssg-serve-demo`  | `ssg-serve-app`       |

The underlying components retain their generic server names
(`ssr-server`, `api-server`, `static-web-server`). This separation prevents
name collisions between the application lifecycle manager and the registered
component that share its base name.

**Generator note:** when emitting code for a new project, derive the
`LifecycleManager` name from the user-provided project or app name rather than
hardcoding it:

- The `LifecycleManager` name should incorporate the project or app name
  (e.g. `<app-name>-ssr-server`, `<app-name>-api-server`,
  `<app-name>-ssg-serve`).
- The corresponding server component should retain its generic component name
  (`ssr-server`, `api-server`, `static-web-server`).

This keeps generated projects consistent with the demos and starter templates
while avoiding the duplicate/collision issues that arise from hardcoded names.

## Closeout checklist

This tree is "done" when every file here has been absorbed into the generator
and the directory can be deleted. 

Working list:

### Per template (do SSG first, then SSR, then API)

- [ ] Port each file under `src/apps/<template>/` into the generator as string
      literals + dedicated functions for the dynamic substitutions (project
      name, app name, runtime target, etc.).
- [ ] Populate the `getTemplateConfig` body for the template with the
      `projectScripts`, `sharedScripts`, `dependencies`, `devDependencies`,
      `gitignoreEntries` (+ section header), `prettierignoreEntries` (+ section
      header), and `cspellWords` it needs. The plumbing is already wired
      through `ensureBaseFiles`.
- [ ] Add a branch in `createProjectSpecificFiles` for the template (if/else
      if pattern with a trailing `const _exhaustive: never = templateID` so
      TS catches missing branches).
- [ ] Add tests covering `getTemplateConfig(<template>)` output and the
      `createProjectSpecificFiles` branch.
- [ ] Delete the raw template's directory from this `raw-src-files/` tree once
      parity is verified against the generator's output.

### Generator-level work

- [ ] Pick a home for cross-template-but-not-all-templates string literals
      and helpers. `base-files/` is for files every template needs (root
      `tsconfig.json`, `prettier.config.js`, etc.) — but several pieces are
      shared by a _subset_ of templates and don't fit there:
  - ~~`generate-build-info.ts`~~ (done —
    `templates-shared/generate-build-info.ts`) → SSR + API.
    `current-build-info.ts` is a generated/gitignored artifact, not
    scaffolded — running the script produces it.
  - ~~`vite.config.ts`~~ (done — `templates-shared/vite-config.ts`) + Vite-related
    deps → SSG + SSR
  - React component scaffolding (theme, layout, error pages) → SSG + SSR
  - API server scaffolding → API only (effectively single-template, but
    still doesn't belong in `base-files/`)

  A sibling `templates-shared/` directory houses these literals so each
  template's branch in `createProjectSpecificFiles` can import the same source
  rather than duplicating it. It already exists — `ensure-vite-env.ts`
  (`ensureViteEnv`) and `vite-config.ts` (`ensureViteConfig`) are the first
  occupants; add the rest alongside them. The established pattern: a private
  builder that returns the whole file as one template literal with the dynamic
  bits interpolated (e.g. `${appName}`), plus an exported `ensure*` function
  that writes it create-if-missing via `vfsWriteIfNotExists`.

  Files that are structurally different per template (emitted from a single
  branch, not shared) live in `templates-specific/<template>/` instead — one
  subfolder per template ID (`templates-specific/ssg/`, `.../ssr/`,
  `.../api/`), mirroring `templates-shared/` as a sibling. Same builder +
  `ensure*` pattern; the only difference is that exactly one branch imports it.
- [x] Port `scripts/generate-build-info.ts` into a string literal under the
      shared-helpers home (it's used by the SSR and API branches of
      `createProjectSpecificFiles`, not all three). Done —
      `templates-shared/generate-build-info.ts` (`ensureGenerateBuildInfo`),
      written once per repo (create-if-missing). The `generate:build-info`
      script is added to `getTemplateConfig`'s `sharedScripts` for SSR/API.
- [x] Wire the generator to emit and amend `build-info.config.json`. Done —
      `templates-shared/build-info-config.ts` (`ensureBuildInfoOutput`) creates
      the manifest if missing and appends each app's
      `current-build-info.ts` output path when absent.
- [ ] Use the `package.json` in this tree as the reference for the populated
      per-app scripts/deps/devDeps shape; mirror those values in
      `getTemplateConfig` (splitting scripts into `projectScripts` vs
      `sharedScripts` — see _Script buckets_ above).

### Documentation

- [ ] Write user docs for the `unirend create ...` CLI — supported
      template IDs, flags (`--target`, repo path), behavior when run in
      a fresh vs. existing repo, what gets generated, and how to extend.
- [ ] Write API docs for the starter-template library surface exposed
      from `src/starter-templates.ts` — `createProject`,
      `initRepo`, `templateExists`, `getTemplateInfo`,
      `listAvailableTemplates(WithInfo)`, `readRepoConfig`, plus the
      public types (`StarterTemplateOptions`, `TemplateID`,
      `TemplateInfo`, `ProjectEntry`, `RepoConfig`,
      `CreateProjectResult`, `InitRepoResult`, etc.). Cover the
      direct-consumption use case (other tools wrapping the lib), not
      just the CLI flow.

### Cleanup once the tree is empty

The `src/lib/starter-templates/raw-src-files/**` entry has been added to the
repo's tooling configs so this tree doesn't get type-checked, formatted, or
linted (the files reference subpath exports like `unirend/server` and
`unirend/client` that only resolve in downstream consumers). All three
entries need to come back out once the directory is gone:

- [ ] Remove `"src/lib/starter-templates/raw-src-files/**"` from the
      `exclude` list in the repo-root `tsconfig.json`.
- [ ] Remove `src/lib/starter-templates/raw-src-files/**` from
      `.prettierignore`.
- [ ] Remove `src/lib/starter-templates/raw-src-files/**` from the
      `ignores` list in the repo-root `eslint.config.js`.
- [ ] Delete this directory (including this README).
