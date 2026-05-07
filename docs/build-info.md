# Build Info Utilities

This guide covers generating and loading build information (version, git hash/branch, timestamp) using Unirend's utilities as part of your build.

<!-- toc -->

- [What's Included?](#whats-included)
- [Generate Build Info (pre-build)](#generate-build-info-pre-build)
- [Load Build Info (runtime)](#load-build-info-runtime)
  - [Complete Example: SSR Server + Plugin Example + Frontend Config](#complete-example-ssr-server--plugin-example--frontend-config)

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

### Complete Example: SSR Server + Plugin Example + Frontend Config

Load build info once at startup, pass selected fields to frontend, and decorate requests for server-side helpers:

```ts
// server.ts
import { serveSSRDev, serveSSRProd } from 'unirend/server';
import { loadBuildInfo } from 'unirend/build-info';
import { BuildInfoPlugin } from './plugins/BuildInfoPlugin';
import { AppResponseHelpers } from './helpers/AppResponseHelpers';

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
    frontendAppConfig: {
      api_endpoint: process.env.API_URL || 'https://api.example.com',
      build: {
        version: buildResult.info.version,
        git_hash: buildResult.info.git_hash,
        git_branch: buildResult.info.git_branch,
      },
    },
    plugins: [BuildInfoPlugin(buildResult.info)], // pass full info to plugin
    APIResponseHelpersClass: AppResponseHelpers, // use custom helpers for error responses
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

This example shows how to:

- Load build info once at server startup
- Pass selected fields (version, git hash, git branch) to the frontend via `frontendAppConfig` (available in both `serveSSRDev` and `serveSSRProd`)
- Use a plugin to make full build info available to all server-side handlers
- Configure custom response helpers for automatic build info in error responses

The plugin approach is useful when you want server-side handlers to access build info for logging, debugging, or API responses. Here's how you could implement such a plugin:

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

With the plugin in place, you can create custom response helpers that automatically include build info in API responses. When configured via `APIResponseHelpersClass`, these helpers are also used by the server's built-in error handlers:

```ts
// helpers/AppResponseHelpers.ts - Custom response helpers that auto-merge build info
import { APIResponseHelpers } from 'unirend/api-envelope';
import type { BaseMeta } from 'unirend/api-envelope';
import type { FastifyRequest } from 'unirend/server';

interface AppMeta extends BaseMeta {
  build?: { version: string };
}

export class AppResponseHelpers extends APIResponseHelpers {
  // Helper method to merge build info into meta (reduces repetition)
  private static enhanceMetaWithBuildInfo<M extends BaseMeta>(
    request: FastifyRequest,
    meta?: Partial<M>,
  ): M {
    const buildInfo = (request as any).buildInfo;
    const version = buildInfo?.version;

    return {
      ...(meta as Partial<M>),
      ...(version ? { build: { version } } : {}),
    } as M;
  }

  // Override API error response to auto-include build info
  static createAPIErrorResponse<M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    statusCode: number;
    errorCode: string;
    errorMessage: string;
    errorDetails?: Record<string, unknown>;
    meta?: Partial<M>;
  }) {
    return super.createAPIErrorResponse<M>({
      ...params,
      meta: this.enhanceMetaWithBuildInfo<M>(params.request, params.meta),
    });
  }

  // Override API success response to auto-include build info
  static createAPISuccessResponse<T, M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    data: T;
    statusCode?: number;
    meta?: Partial<M>;
  }) {
    return super.createAPISuccessResponse<T, M>({
      ...params,
      meta: this.enhanceMetaWithBuildInfo<M>(params.request, params.meta),
    });
  }

  // Override page error response to auto-include build info
  static createPageErrorResponse<M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    statusCode: number;
    errorCode: string;
    errorMessage: string;
    pageMetadata: { title: string; description: string };
    errorDetails?: Record<string, unknown>;
    meta?: Partial<M>;
  }) {
    return super.createPageErrorResponse<M>({
      ...params,
      meta: this.enhanceMetaWithBuildInfo<M>(params.request, params.meta),
    });
  }

  // Override page success response to auto-include build info
  static createPageSuccessResponse<T, M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    data: T;
    pageMetadata: { title: string; description: string };
    statusCode?: number;
    meta?: Partial<M>;
  }) {
    return super.createPageSuccessResponse<T, M>({
      ...params,
      meta: this.enhanceMetaWithBuildInfo<M>(params.request, params.meta),
    });
  }
}
```

Benefits:

- Load build info once at startup (no repeated imports)
- Frontend gets selected fields for display/troubleshooting
- Server handlers get full build info via the decorated request
- Custom helpers auto-merge selected fields into response meta
- Built-in Unirend framework error handlers automatically include build info when using custom response helpers
