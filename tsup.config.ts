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
]);
