import { defineConfig } from 'tsup';
import type { Options } from 'tsup';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Plugin } from 'esbuild';

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

const allExternals = [...getAllDependencies(), 'unirend/context'];

// Plugin that redirects ./context imports from UnirendContext/ and UnirendHead/
// to the shared `unirend/context` subpath so both client and server bundles
// reference the same createContext() call at runtime instead of each bundling
// their own copy.
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
  format: ['cjs', 'esm'],
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

  // CLI entry point (no shebang - run with bun/node)
  {
    ...baseConfig,
    entry: ['src/cli.ts'],
    outDir: 'dist/cli',
    format: ['esm'], // CLI only needs ESM since package.json has "type": "module"
    dts: false, // CLI is not consumed as a library so type definitions aren't needed
  },

  // Public utilities (StaticContentCache, HTML helpers)
  { ...baseConfig, entry: ['src/utils.ts'], outDir: 'dist/utils' },
]);
