import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for a Vite app's `EntryClient.tsx`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/` rather than being duplicated per template. It
 * mounts the app via `unirend/client`, imports the stylesheet and routes, wraps
 * the tree in `ThemeProvider`, and logs the hydration/render outcome. The API
 * template doesn't ship one — it has no client entry point.
 */
const fileSrc = `import { mountApp } from 'unirend/client';

// Import frontend styles
import './index.css';

// Import shared routes
import { routes } from './Routes';

// Import theme provider
import { ThemeProvider } from './components/theme/ThemeProvider';

// Pass routes directly - mountApp handles creating the router
const result = mountApp('root', routes, {
  strictMode: true,
  // Sits above the router — good for themes, modals, toast containers, etc.
  // Keep it stable — errors here bypass React Router's errorElement (SSR: server failure, SSG: page render fails)
  rootProviders: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
});

if (result === 'hydrated') {
  // eslint-disable-next-line no-console
  console.log('✅ Hydrated SSR/SSG content');
} else if (result === 'rendered') {
  // eslint-disable-next-line no-console
  console.log('✅ Rendered as SPA');
} else {
  // eslint-disable-next-line no-console
  console.error('❌ Container not found');
}
`;

/**
 * Ensure a Vite app's `EntryClient.tsx` exists at
 * `${projectPath}/EntryClient.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppEntryClient(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/EntryClient.tsx`;

  try {
    const didWrite = await vfsWriteIfNotExists(root, relPath, fileSrc);

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
