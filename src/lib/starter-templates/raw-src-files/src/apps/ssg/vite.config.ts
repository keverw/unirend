import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { withUnirendViteConfig } from 'unirend/config-vite';

// https://vite.dev/config/
export default defineConfig((configEnv) => {
  const isSSRBuild = Boolean(configEnv.isSsrBuild);

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
      !isSSRBuild &&
        visualizer({
          filename: resolve(__dirname, '../../../build/ssg/client-stats.html'),
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
        }),
      !isSSRBuild &&
        visualizer({
          filename: resolve(
            __dirname,
            '../../../build/ssg/client-stats-app.html',
          ),
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
          exclude: [{ file: '**/node_modules/**' }],
        }),
      !isSSRBuild &&
        visualizer({
          filename: resolve(
            __dirname,
            '../../../build/ssg/client-stats-deps.html',
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
      outDir: resolve(__dirname, '../../../dist/apps/ssg/set-via-cli-instead'),
      emptyOutDir: true,
      manifest: true, // Always generate manifest.json
      chunkSizeWarningLimit: 750,
    },
  });
});
