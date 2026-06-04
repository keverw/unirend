import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for a Vite app's `components/theme/ThemeToggle.tsx`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/react-components/`. Renders a button that cycles
 * through the three theme preferences (`auto` → `dark` → `light`) by calling
 * `cycleTheme` from the `useTheme` hook. The API template doesn't ship one —
 * it has no client-side rendering.
 */
const fileSrc = `import { useTheme } from './context';

const labels: Record<string, string> = {
  auto: 'Theme: Auto',
  dark: 'Theme: Dark',
  light: 'Theme: Light',
};

export function ThemeToggle() {
  const { preference, cycleTheme } = useTheme();

  return (
    <button
      onClick={cycleTheme}
      className="rounded border-4 border-dashed border-gray-400 px-6 py-3 font-medium text-gray-700 transition-colors hover:border-gray-600 dark:border-gray-500 dark:text-gray-300 dark:hover:border-gray-400"
    >
      {labels[preference]}
    </button>
  );
}
`;

/**
 * Ensure a Vite app's `components/theme/ThemeToggle.tsx` exists at
 * `${projectPath}/components/theme/ThemeToggle.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppThemeToggle(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/components/theme/ThemeToggle.tsx`;

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
