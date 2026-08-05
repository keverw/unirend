import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { withUnirendViteConfig } from '../../../src/config-vite';

export default defineConfig(
  withUnirendViteConfig(
    {
      plugins: [react()],
      root: import.meta.dirname,
      build: {
        outDir: '../build-app-b',
        emptyOutDir: true,
        manifest: true,
      },
    },
    // See the app-a config: each app needs its own Vite dependency cache.
    { appKey: 'app-b' },
  ),
);
