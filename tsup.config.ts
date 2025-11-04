import { defineConfig } from "tsup";
import { readFileSync } from "fs";
import { join } from "path";

// Read package.json to get all dependencies
const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf-8"),
);

// Get all dependencies (regular + peer + dev) for external list
const getAllDependencies = () => {
  const deps = new Set<string>();

  // Add regular dependencies
  if (packageJson.dependencies) {
    for (const dep of Object.keys(packageJson.dependencies)) {
      deps.add(dep);
    }
  }

  // Add peer dependencies
  if (packageJson.peerDependencies) {
    for (const dep of Object.keys(packageJson.peerDependencies)) {
      deps.add(dep);
    }
  }

  // Add dev dependencies (in case they're used in build)
  if (packageJson.devDependencies) {
    for (const dep of Object.keys(packageJson.devDependencies)) {
      deps.add(dep);
    }
  }

  return Array.from(deps).sort();
};

const allExternals = getAllDependencies();

// NOTE: This configuration externalizes ALL dependencies for NPM distribution
// By default, tsup only excludes "dependencies" and "peerDependencies" but bundles "devDependencies"
// For a library published to NPM, we want EVERYTHING external so users install their own deps
// This approach automatically stays in sync with package.json changes

export default defineConfig([
  // Client-only entry point
  {
    entry: ["src/client.ts"],
    outDir: "dist/client",
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true, // Safe to clean since it's in its own subdirectory
    external: allExternals,
  },

  // Server-only entry point
  {
    entry: ["src/server.ts"],
    outDir: "dist/server",
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true, // Safe to clean since it's in its own subdirectory
    external: allExternals,
  },

  // Shared router utilities (client + server)
  {
    entry: ["src/router-utils.ts"],
    outDir: "dist/router-utils",
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true, // Safe to clean since it's in its own subdirectory
    external: allExternals,
  },

  // Public plugins (server-side)
  {
    entry: ["src/plugins.ts"],
    outDir: "dist/plugins",
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true, // Safe to clean since it's in its own subdirectory
    external: allExternals,
  },

  // API envelope types and helpers (universal)
  {
    entry: ["src/api-envelope.ts"],
    outDir: "dist/api-envelope",
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true, // Safe to clean since it's in its own subdirectory
    external: allExternals, // Externalize everything for NPM distribution
  },

  // Starter templates (project generation)
  {
    entry: ["src/starter-templates.ts"],
    outDir: "dist/starter-templates",
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true, // Safe to clean since it's in its own subdirectory
    external: allExternals,
  },

  // Build info (server-side)
  {
    entry: ["src/build-info.ts"],
    outDir: "dist/build-info",
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true, // Safe to clean since it's in its own subdirectory
    external: allExternals,
  },

  // CLI entry point (no shebang - run with bun/node)
  {
    entry: ["src/cli.ts"],
    outDir: "dist/cli",
    format: ["esm"], // CLI only needs ESM since package.json has "type": "module"
    dts: false, // CLI doesn't need type definitions
    splitting: false,
    sourcemap: false, // CLI doesn't need sourcemaps
    clean: true,
    external: allExternals,
  },
]);
