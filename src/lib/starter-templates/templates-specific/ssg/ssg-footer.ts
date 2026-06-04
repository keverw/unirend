import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSG app's `components/Footer.tsx`.
 *
 * SSG-specific — lives in `templates-specific/ssg/`. Static footer with Home,
 * About, and Dashboard links. No dynamic data — title is a plain string and
 * there is no current-year logic (contrast with the SSR footer, which reads
 * `currentYear` from `usePublicAppConfig` seeded server-side at startup).
 */
const fileSrc = `import { Link } from 'react-router';

export function Footer() {
  return (
    <footer className="rounded-lg border-4 border-dashed border-blue-500 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="rounded border-4 border-dashed border-teal-500 px-6 py-3">
          <span className="text-gray-700 dark:text-gray-300">
            SSG Starter Template
          </span>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link
            to="/"
            className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
          >
            Home
          </Link>
          <Link
            to="/about"
            className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
          >
            About
          </Link>
          <Link
            to="/dashboard"
            className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </footer>
  );
}
`;

/**
 * Ensure the SSG app's `components/Footer.tsx` exists at
 * `${projectPath}/components/Footer.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSGFooter(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/components/Footer.tsx`;

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
