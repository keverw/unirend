import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSR app's `components/Footer.tsx`.
 *
 * SSR-specific — lives in `templates-specific/ssr/`. Reads `currentYear` from
 * `usePublicAppConfig` (seeded server-side at startup, updated at midnight via
 * a timer) to avoid a server/client mismatch if the year rolls over between
 * SSR and hydration. No Dashboard link (contrast with the SSG footer). Home
 * and About links only.
 */
const fileSrc = `import { Link } from 'react-router';
import { usePublicAppConfig } from 'unirend/client';

interface PublicAppConfig {
  site_info?: {
    current_year?: number;
  };
}

export function Footer() {
  const config = usePublicAppConfig() as PublicAppConfig | undefined;
  // current_year is set server-side at startup and updated at midnight via a timer.
  // The fallback should never trigger in practice, but if it did there would be a
  // risk of a server/client mismatch (e.g. the year rolling over between SSR and hydration).
  const currentYear =
    config?.site_info?.current_year ?? new Date().getFullYear();

  return (
    <footer className="rounded-lg border-4 border-dashed border-blue-500 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="rounded border-4 border-dashed border-teal-500 px-6 py-3">
          <span className="text-gray-700 dark:text-gray-300">
            &copy; {currentYear} SSR Starter Template
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
        </div>
      </div>
    </footer>
  );
}
`;

/**
 * Ensure the SSR app's `components/Footer.tsx` exists at
 * `${projectPath}/components/Footer.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRFooter(
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
