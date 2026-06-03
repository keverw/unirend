import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Build the source for an app's `vite.config.ts`.
 *
 * Identical across every Vite-based template (SSG, SSR) apart from the app
 * folder name that appears in the bundle-report and build output paths, so it
 * lives in `templates-shared/` rather than being duplicated per template.
 *
 * The only dynamic substitution is `appName` — the directory the app lives in
 * under `src/apps/`, which is also the segment used in `build/<appName>/` and
 * `dist/apps/<appName>/`. Everything else is emitted verbatim.
 *
 * @param appName - The app's folder name under `src/apps/` (the project name)
 */
function buildViteConfigSrc(appName: string): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { withUnirendViteConfig } from 'unirend/config-vite';

// https://vite.dev/config/
export default defineConfig((configEnv) => {
  // True when Vite is building the server-side entry point (EntrySSR/EntrySSG
  // via --ssr) rather than the browser client bundle. The bundle visualizers
  // below only apply to the client build, so they're skipped for it.
  const isServerEntryPoint = Boolean(configEnv.isSsrBuild);

  return withUnirendViteConfig({
    // run Vite's own dev server on port 8080 instead of port 5173
    // server: {
    //   host: '::',
    //   port: 8080,
    // },
    // Setup React and Tailwind plugins
    plugins: [
      react(),
      tailwindcss(),
      // Keep three client bundle reports:
      // - overall: quick top-level size view
      // - app: starter/app code only
      // - deps: framework and npm dependency cost only
      !isServerEntryPoint &&
        visualizer({
          filename: resolve(__dirname, '../../../build/${appName}/client-stats.html'),
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
        }),
      !isServerEntryPoint &&
        visualizer({
          filename: resolve(
            __dirname,
            '../../../build/${appName}/client-stats-app.html',
          ),
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
          exclude: [{ file: '**/node_modules/**' }],
        }),
      !isServerEntryPoint &&
        visualizer({
          filename: resolve(
            __dirname,
            '../../../build/${appName}/client-stats-deps.html',
          ),
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
          include: [{ file: '**/node_modules/**' }],
        }),
    ].filter(Boolean),
    root: __dirname, // app directory — absolute so it works regardless of CWD
    publicDir: 'public',
    resolve: {
      alias: {
        '@': resolve(__dirname, '../../../src'),
      },
    },
    build: {
      // Use --outDir in npm scripts for client/server builds instead of this config property
      outDir: resolve(__dirname, '../../../dist/apps/${appName}/set-via-cli-instead'),
      emptyOutDir: true,
      manifest: true, // Always generate manifest.json
      chunkSizeWarningLimit: 750,
    },
  });
});
`;
}

/**
 * Ensure an app's `vite.config.ts` exists at `${projectPath}/vite.config.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param appName - The app's folder name under `src/apps/` (the project name)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureViteConfig(
  root: FileRoot,
  projectPath: string,
  appName: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/vite.config.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildViteConfigSrc(appName),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
