import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { withUnirendViteConfig } from '../../../src/config-vite';

const appRoot = path.resolve(import.meta.dirname, '..');

export default defineConfig(
  withUnirendViteConfig(
    {
      plugins: [react()],
      // App B has a separate Vite configuration and dependency cache while
      // sharing the demonstration routes with the default app.
      root: appRoot,
      publicDir: path.join(appRoot, 'public-b'),
      build: { manifest: true },
    },
    { appKey: 'asset-request-paths-b' },
  ),
);
