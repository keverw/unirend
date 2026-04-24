import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { withUnirendViteConfig } from '../../src/config-vite';

// https://vite.dev/config/
export default defineConfig(
  withUnirendViteConfig({
    plugins: [react()],
    root: '.', // Current directory (demos/ssr)
    build: {
      outDir: 'build',
      manifest: true, // Always generate manifest.json
    },
  }),
);
