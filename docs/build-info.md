# Build Info Utilities

This guide covers generating and loading build information (version, git hash/branch, timestamp) using Unirend's utilities as part of your build.

<!-- toc -->

- [What's Included?](#whats-included)
- [Generate Build Info (pre-build)](#generate-build-info-pre-build)
- [Load Build Info (runtime)](#load-build-info-runtime)
  - [Complete Example: SSR Server + publicAppConfig](#complete-example-ssr-server--publicappconfig)
  - [Plugin Pattern: For Non-Public Server State](#plugin-pattern-for-non-public-server-state)

<!-- tocstop -->

## What's Included?

Import from `unirend/build-info`:

- Types: `BuildInfo`, `BuildInfoStatus`, `GenerateBuildInfoOptions`, `GenerationResult`, `SaveResult`, `LoadResult`
- Generator: `GenerateBuildInfo`
- Loader: `loadBuildInfo`, `DEFAULT_BUILD_INFO`

Core `BuildInfo` fields:

- `build_timestamp: string`
- `version: string`
- `git_hash: string`
- `git_branch: string`

## Generate Build Info (pre-build)

Create a small script to generate a `current-build-info.ts` file during your build pipeline. The generator auto‑detects version from `package.json` when not provided. Custom properties can be provided via `customProperties`. Prefer environment variables for build‑machine/CI traceability data that can be read and inserted during the build process.

```ts
// scripts/generate-build-info.ts
import { GenerateBuildInfo } from 'unirend/build-info';
import os from 'os';

async function main() {
  const generator = new GenerateBuildInfo({
    // Optional: override working directory or version (otherwise version comes from package.json)
    // workingDir: process.cwd(),
    // version: process.env.APP_VERSION,
    // Prefer env-based custom properties for traceability (CI, build machine, etc.)
    customProperties: {
      build_machine: process.env.BUILD_MACHINE || os.hostname(),
      build_run_id: process.env.CI_RUN_ID,
      // add any other non-sensitive build-time metadata here
    },
  });

  const { warnings } = await generator.saveTS('current-build-info.ts');

  if (warnings.length) {
    console.warn('Build info warnings:\n' + warnings.join('\n'));
  }
}

main().catch((error) => {
  console.error('Failed to generate build info:', error);
  process.exit(1);
});
```

Add to `.gitignore` (recommended), since this file is meant to be auto-generated during the build process and should include the current Git hash/branch

```gitignore
# Build info for the current build (auto-generated)
current-build-info.ts
```

Add to your package.json scripts (run before your prod build as you could import the current build info file to reference in logs or health check endpoints, etc.):

```json
{
  "scripts": {
    "build:client": "vite build --outDir build/client --base=/ --ssrManifest",
    "build:server:ssr": "vite build --outDir build/server --ssr src/entry-ssr.tsx",
    "build:generate-info": "bun run scripts/generate-build-info.ts",
    "build:ssr": "bun run build:client && bun run build:server:ssr",
    "build:prod": "bun run build:generate-info && bun run build:ssr && bun build server.ts --outdir ./dist --external vite"
  }
}
```

Notes:

- Always include `--external vite` when bundling your server entry with `bun build`. Vite lazily imports `esbuild` at runtime, which Bun's bundler cannot statically resolve, keeping Vite external avoids a build error.
- You can also save JSON via `await generator.saveJSON("current-build-info.json")` if you prefer.
- Custom properties are allowed and preserved. The following core keys are reserved and cannot be overridden: `build_timestamp`, `version`, `git_hash`, `git_branch`. To include additional metadata, add your own keys via `customProperties` (e.g., from env vars or CLI args) rather than attempting to override the reserved keys.

## Load Build Info (runtime)

Use the loader to safely read the generated TypeScript module (`current-build-info.ts`) when running from a built artifact, and a default in development:

```ts
import { loadBuildInfo } from 'unirend/build-info';

// Use whatever signal tracks whether you ran the build (e.g. a mode enum, CLI arg,
// or env var). Do NOT use a runtime dev-mode flag — you can serve a built artifact
// in dev mode, and HMR mode never generates current-build-info.ts regardless.
const isBuilt = mode === 'built'; // 'built' | 'hmr'

const { info } = await loadBuildInfo(
  isBuilt,
  () => import('./current-build-info.ts'),
);

// info: BuildInfo
```

**Load Statuses:**

- `DEFAULT_NOT_BUILT`: `isBuilt` was false (e.g. HMR mode), returns a default build info object
- `LOADED_SUCCESSFULLY`: production load from module succeeded
- `MODULE_MISSING_DATA` | `MODULE_INVALID_DATA` | `IMPORT_ERROR`: load failed, default is returned

**Defaults:** When not built (or when loading fails in production), the loader returns `DEFAULT_BUILD_INFO`:

```json
{
  "version": "1.0.0",
  "git_hash": "dev",
  "git_branch": "dev",
  "build_timestamp": "1970-01-01T00:00:00.000Z"
}
```

### Complete Example: SSR Server + publicAppConfig

Load build info once at startup and pass selected fields to both the frontend and server-side handlers via `publicAppConfig`:

```ts
// server.ts
import { serveSSRDev, serveSSRProd } from 'unirend/server';
import { loadBuildInfo } from 'unirend/build-info';

// 'built' | 'hmr' — passed in from your CLI arg, env var, or startup script
type Mode = 'built' | 'hmr';

async function main(mode: Mode) {
  // Load build info before branching so it can feed shared config.
  // In HMR mode current-build-info.ts doesn't exist; loadBuildInfo skips the
  // import and returns DEFAULT_BUILD_INFO.
  const buildResult = await loadBuildInfo(
    mode === 'built',
    () => import('./current-build-info.ts'),
  );

  const sharedConfig = {
    publicAppConfig: {
      api_endpoint: process.env.API_URL || 'https://api.example.com',
      build: {
        version: buildResult.info.version,
        git_hash: buildResult.info.git_hash,
        git_branch: buildResult.info.git_branch,
      },
    },
    plugins: [],
  };

  const server =
    mode === 'hmr'
      ? serveSSRDev(
          {
            serverEntry: './src/entry-ssr.tsx',
            template: './src/index.html',
            viteConfig: './vite.config.ts',
          },
          sharedConfig,
        )
      : serveSSRProd('./build', sharedConfig);

  await server.listen(3000, 'localhost');
}
```

`publicAppConfig` is deep-cloned and deep-frozen per request, so it's available in all page data loaders, API route handlers, and `APIResponseHelpersClass` methods as `request.publicAppConfig`. Since it's typed as `Record<string, unknown>`, cast to your config shape before accessing nested fields:

```ts
type PublicAppConfig = {
  build: { version: string; git_hash: string; git_branch: string };
};

server.api.get('health', async (request) => {
  const { build } = request.publicAppConfig as PublicAppConfig;

  return APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { ok: true, version: build.version },
  });
});
```

This example shows how to:

- Load build info once at server startup
- Pass selected fields (version, git hash, git branch) to the frontend via `publicAppConfig` (available in both `serveSSRDev` and `serveSSRProd`)
- Read those same fields in any server-side handler via `request.publicAppConfig`

### Plugin Pattern: For Non-Public Server State

Use the `decorateRequest` + `addHook` plugin pattern when you need server-side-only state in handlers that **shouldn't** be in `publicAppConfig`, meaning any value that must not be serialized into the page. Build info itself is a good example: you might expose only a few fields publicly while making the full `BuildInfo` object (including internal custom properties like CI run IDs) available to handlers for logging or diagnostics:

```ts
// plugins/BuildInfoPlugin.ts
import type { ServerPlugin } from 'unirend/server';
import type { BuildInfo } from 'unirend/build-info';

export function BuildInfoPlugin(buildInfo: BuildInfo): ServerPlugin {
  return async (pluginHost) => {
    pluginHost.decorateRequest('buildInfo', null);

    pluginHost.addHook('onRequest', async (request) => {
      (request as any).buildInfo = buildInfo;
    });

    return { name: 'build-info' };
  };
}
```

Pass it at startup alongside the selected public fields in `publicAppConfig`:

```ts
plugins: [BuildInfoPlugin(buildResult.info)],
publicAppConfig: {
  build: {
    version: buildResult.info.version,
    git_hash: buildResult.info.git_hash,
    git_branch: buildResult.info.git_branch,
  },
},
```

Then handlers can access the full object for internal use:

```ts
server.api.get('health', async (request) => {
  const buildInfo = (request as any).buildInfo as BuildInfo;

  return APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { ok: true, ci_run_id: buildInfo.ci_run_id as string },
  });
});
```

The same pattern applies for other private server state, including database connections, internal auth context, service clients, etc.

In short:

- **`publicAppConfig`**: safe-to-share config for SSR/SSG projects, available via `usePublicAppConfig()` on both server (during rendering) and client (after HTML injection). Also readable server-side in handlers via `request.publicAppConfig`.
- **Plugin decoration**: server-side-only state that must stay private (full build info with internal properties, DB handles, auth sessions, etc.).
