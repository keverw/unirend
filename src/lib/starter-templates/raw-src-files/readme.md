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
- `public/` directory contents

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
     own branch.
2. **Pick a home.** `base-files/` = every template needs it. `templates-shared/`
   = a _subset_ needs it (most are SSG+SSR or SSR+API). API frequently opts out
   (no Vite/Tailwind/build-info surface) — note that in the doc comment.
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
- **API** gets a single `serve` script.

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
- [ ] Delete the per-template directory from this tree once parity is
      verified against the generator's output.

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
