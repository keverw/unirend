import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSG app's `pages/SimulateComponentError.tsx`.
 *
 * SSG-specific — lives in `templates-specific/ssg/`. During SSG build the
 * component renders a static placeholder (the `window` check prevents throwing
 * at build time). In the browser it throws on hydration, triggering the
 * `ApplicationError` boundary. The SSR version (no `window` check, always
 * throws) is handled separately in `templates-specific/ssr/`.
 */
const fileSrc = `// During SSG build (no \`window\`), this component renders a static placeholder so the
// generator doesn't fail. In the browser, it throws immediately on hydration, which
// triggers the ApplicationError boundary.
export function SimulateComponentError() {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line unicorn/prefer-type-error
    throw new Error('Simulated component error');
  }

  return (
    <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
      <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
        Simulate Component Error
      </h1>
      <p className="text-gray-600 dark:text-gray-400">
        This page throws a React component error in the browser to demo the{' '}
        <code>ApplicationError</code> boundary. Open it in a browser to trigger
        it. It won't throw during pre-render.
      </p>
    </div>
  );
}
`;

/**
 * Ensure the SSG app's `pages/SimulateComponentError.tsx` exists at
 * `${projectPath}/pages/SimulateComponentError.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSGSimulateComponentError(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/pages/SimulateComponentError.tsx`;

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
