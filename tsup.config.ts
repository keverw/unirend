import { defineConfig } from 'tsup';
import type { Options } from 'tsup';
import { chmodSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { Plugin } from 'esbuild';

// Shebang prepended to the built CLI so package managers can execute the `bin`.
// Bun (not Node) because src/cli.ts enforces a Bun runtime at startup.
const CLI_SHEBANG = '#!/usr/bin/env bun';

// Read package.json to get all dependencies
const packageJSON = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
);

// Get all dependencies (regular + peer + dev) for external list
const getAllDependencies = () => {
  const deps = new Set<string>();

  // Add regular dependencies
  if (packageJSON.dependencies) {
    for (const dep of Object.keys(packageJSON.dependencies)) {
      deps.add(dep);
    }
  }

  // Add peer dependencies
  if (packageJSON.peerDependencies) {
    for (const dep of Object.keys(packageJSON.peerDependencies)) {
      deps.add(dep);
    }
  }

  // Add dev dependencies (in case they're used in build)
  if (packageJSON.devDependencies) {
    for (const dep of Object.keys(packageJSON.devDependencies)) {
      deps.add(dep);
    }
  }

  return Array.from(deps).sort();
};

// 'unirend/api-envelope' is listed alongside 'unirend/context' so that rollup-plugin-dts
// emits a cross-reference in server.d.ts / plugins.d.ts instead of inlining independent
// copies. Unlike plain interfaces which duck type fine, independent copies of a class with
// predicate methods have different nominal identities and break TypeScript 5.5 strict
// predicate checking for APIResponseHelpers (via PluginHostInstance → ServerPlugin).
//
// 'unirend/utils' is externalized for the same reason: the StaticContentCache class has
// `private` fields (nominal identity in TypeScript) AND is checked with `instanceof` inside
// the staticContent() plugin, so cross-entry duplication would break both type compatibility
// and runtime instanceof. Internal modules import the class via `unirend/utils` (mapped to
// ./src/utils.ts during typecheck via tsconfig paths) so a single class definition lives
// in the utils bundle and every other entry imports it externally.
const allExternals = [
  ...getAllDependencies(),
  'unirend/context',
  'unirend/api-envelope',
  'unirend/utils',
];

// Plugin that redirects ./context imports from UnirendContext/ and UnirendHead/
// to the shared `unirend/context` subpath so both client and server bundles
// reference the same createContext() call at runtime instead of each bundling
// their own copy.
//
// NOTE: this is a runtime JS singleton concern (esbuild), not a type declaration concern.
// For the type declaration equivalent (nominal identity across bundles), see the
// 'unirend/api-envelope' entry in allExternals and the import comment in src/lib/types.ts.
const sharedContextPlugin: Plugin = {
  name: 'externalize-shared-contexts',
  setup(build) {
    build.onResolve({ filter: /^\.\/context$/ }, (args) => {
      const resolveDir = args.resolveDir.replaceAll('\\', '/');

      if (
        resolveDir.endsWith('/UnirendContext') ||
        resolveDir.endsWith('/UnirendHead')
      ) {
        return { path: 'unirend/context', external: true };
      }
    });
  },
};

// NOTE: This configuration externalizes ALL dependencies for NPM distribution
// By default, tsup only excludes "dependencies" and "peerDependencies" but bundles "devDependencies"
// For a library published to NPM, we want EVERYTHING external so users install their own deps
// This approach automatically stays in sync with package.json changes
const baseConfig: Options = {
  // ESM only. The dist/context entry is a runtime singleton (one createContext()
  // call shared by client + server). Shipping CJS alongside ESM would reintroduce
  // the Node dual-package hazard: a consumer mixing require() and import would get
  // two copies of the context module, two createContext() instances, and broken
  // Provider/hook communication. ESM-only guarantees a single instance.
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: allExternals,
  esbuildPlugins: [sharedContextPlugin],
};

export default defineConfig([
  // Shared context objects — must be its own entry so client and server can
  // reference it as an external, ensuring a single createContext() instance
  // when both are imported in the same SSR bundle.
  { ...baseConfig, entry: ['src/context.ts'], outDir: 'dist/context' },

  // Client-only entry point
  { ...baseConfig, entry: ['src/client.ts'], outDir: 'dist/client' },

  // Server-only entry point
  { ...baseConfig, entry: ['src/server.ts'], outDir: 'dist/server' },

  // Shared router utilities (client + server)
  {
    ...baseConfig,
    entry: ['src/router-utils.ts'],
    outDir: 'dist/router-utils',
  },

  // Public plugins (server-side)
  { ...baseConfig, entry: ['src/plugins.ts'], outDir: 'dist/plugins' },

  // API envelope types and helpers (universal)
  {
    ...baseConfig,
    entry: ['src/api-envelope.ts'],
    outDir: 'dist/api-envelope',
  },

  // Starter templates (project generation)
  {
    ...baseConfig,
    entry: ['src/starter-templates.ts'],
    outDir: 'dist/starter-templates',
  },

  // Build info (server-side)
  { ...baseConfig, entry: ['src/build-info.ts'], outDir: 'dist/build-info' },

  // Vite config helpers
  {
    ...baseConfig,
    entry: ['src/config-vite/config-vite.ts'],
    outDir: 'dist/config-vite',
  },

  // CLI entry point. The `bin` field points package managers (bunx/npx and the
  // .bin/ symlink) at dist/cli/cli.js, so the built file needs a shebang on line 1
  // and the executable bit — otherwise the kernel has no interpreter to hand it to
  // and it exits 1 silently. The interpreter is Bun (not Node): the CLI enforces a
  // Bun runtime at startup, so `#!/usr/bin/env bun` keeps `unirend --help` exiting
  // 0 wherever Bun is installed. The shebang lives ONLY in the build output (banner
  // below), not in src/cli.ts, and only on this CLI entry — never on the library
  // bundles. onSuccess chmods +x and asserts both invariants so this can't regress.
  {
    ...baseConfig,
    entry: ['src/cli.ts'],
    outDir: 'dist/cli',
    dts: false, // CLI is not consumed as a library so type definitions aren't needed
    banner: { js: CLI_SHEBANG },
    onSuccess: async () => {
      // Builds (and therefore publishes) must run on a POSIX system. The bin
      // needs the executable bit set on dist/cli/cli.js so it works when a
      // consumer on macOS/Linux symlinks it into node_modules/.bin. Windows does
      // not model that bit (its package-manager shims parse the shebang instead),
      // so a tarball packed on Windows would ship the CLI without the exec bit
      // and break for every *nix consumer. Fail the build here — not at module
      // load — so importing this config (e.g. from src/package-exports.test.ts)
      // still works on Windows and only an actual build is refused.
      if (process.platform === 'win32') {
        throw new Error(
          'unirend must be built on macOS or Linux, not Windows: the published ' +
            'CLI bin (dist/cli/cli.js) needs the POSIX executable bit, which ' +
            'Windows cannot set. Build/publish from a *nix environment (e.g. WSL ' +
            'or CI).',
        );
      }

      const cliPath = join(process.cwd(), 'dist/cli/cli.js');

      // Make the bin executable so it works when symlinked into .bin/.
      chmodSync(cliPath, 0o755);

      // Regression guard: fail the build loudly if the shebang or the executable
      // bit ever goes missing again.
      const firstLine = readFileSync(cliPath, 'utf-8').split('\n', 1)[0];

      if (firstLine !== CLI_SHEBANG) {
        throw new Error(
          `Build guard: dist/cli/cli.js must start with "${CLI_SHEBANG}" ` +
            `but starts with "${firstLine}". The bin cannot be executed by ` +
            `bunx/npx without a shebang on line 1.`,
        );
      }

      const isExecutable = (statSync(cliPath).mode & 0o111) !== 0;

      if (!isExecutable) {
        throw new Error(
          'Build guard: dist/cli/cli.js is not executable. The bin cannot be ' +
            'run when symlinked into .bin/ without the executable bit.',
        );
      }
    },
  },

  // Public utilities (StaticContentCache, HTML helpers)
  { ...baseConfig, entry: ['src/utils.ts'], outDir: 'dist/utils' },

  // ESLint plugin (prefer-alias-imports rule)
  {
    ...baseConfig,
    entry: ['src/eslint-plugin.ts'],
    outDir: 'dist/eslint-plugin',
  },
]);
