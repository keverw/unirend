import { SSRServer } from "./internal/SSRServer";
import { ServeSSRDevOptions, ServeSSRProdOptions } from "./types";

/**
 * Development server handler for SSR applications using Vite's HMR and middleware.
 * Simplifies dev workflow while preserving React Router SSR consistency.
 *
 * For development, we take a string path to the source entry file which will be processed
 * by Vite's dev server with HMR support.
 *
 * @param serverSourceEntryPath String path to the source entry file (e.g. "./src/entry-server.tsx")
 * @param options Development SSR options
 */

export async function serveSSRDev(
  serverSourceEntryPath: string,
  options: ServeSSRDevOptions = {},
): Promise<SSRServer> {
  return new SSRServer({
    mode: "development",
    serverSourceEntryPath,
    options,
  });
}

/**
 * Production server handler for SSR applications.
 *
 * Uses dynamic imports to prevent bundlers from re-bundling the already built
 * Vite application. This approach ensures proper code splitting and avoids
 * duplicate bundling of the server entry point.
 *
 * @param buildDir Directory containing built assets (HTML template, static files, manifest, etc.)
 * @param importFn Dynamic import function that returns a module with a render function.
 *                 This should point to the built/bundled server entry file, not the source file.
 *                 (e.g. () => import('./dist/server/entry-server.js'))
 * @param options Production SSR options
 */

export async function serveSSRProd(
  buildDir: string,
  importFn: () => Promise<{ render: (req: Request) => Promise<Response> }>,
  options: ServeSSRProdOptions = {},
): Promise<SSRServer> {
  return new SSRServer({
    mode: "production",
    buildDir,
    importFn,
    options,
  });
}
