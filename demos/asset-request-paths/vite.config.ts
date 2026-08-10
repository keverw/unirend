import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { withUnirendViteConfig } from '../../src/config-vite';

export default defineConfig(
  withUnirendViteConfig(
    {
      plugins: [react()],
      root: import.meta.dirname,
      // App A is the default built app.
      publicDir: `${import.meta.dirname}/public-a`,
      build: { manifest: true },
    },
    { appKey: 'asset-request-paths-a' },
  ),
);
