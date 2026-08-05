import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { withUnirendViteConfig } from '../../src/config-vite';

// https://vite.dev/config/
export default defineConfig(
  withUnirendViteConfig(
    {
      plugins: [react()],
      root: import.meta.dirname,
      build: {
        outDir: 'build',
        manifest: true, // Always generate manifest.json
      },
    },
    // Every demo in this repo shares one node_modules, so each names its own
    // Vite dependency cache directory rather than sharing the default one.
    { appKey: 'ssg' },
  ),
);
