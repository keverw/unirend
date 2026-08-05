import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { withUnirendViteConfig } from '../../src/config-vite';

export default defineConfig(
  withUnirendViteConfig(
    {
      plugins: [react()],
      root: import.meta.dirname,
      build: {
        outDir: 'build',
        manifest: true,
      },
    },
    // Both apps live in one repo, so without a key per app they would share a
    // single Vite dependency cache and keep invalidating each other's optimized
    // deps ("504 Outdated Optimize Dep" in the browser).
    { appKey: 'app-a' },
  ),
);
