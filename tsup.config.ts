import { defineConfig } from "tsup";

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
    external: ["react", "react-dom", "react-helmet-async", "react-router"],
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
    external: [
      "react",
      "react-dom",
      "react-helmet-async",
      "react-router",
      "vite",
      "fastify",
      "fastify-plugin",
      "@fastify/middie",
      "cheerio",
    ],
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
    external: ["react", "react-router"],
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
    external: ["fastify"],
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
    external: [], // No external dependencies for pure types and helpers
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
    external: [],
  },
]);
