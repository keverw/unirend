import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/** Templates that ship a `components/Header.tsx`. */
type HeaderTemplateID = 'ssg' | 'ssr';

/**
 * Build the source for a Vite app's `components/Header.tsx`.
 *
 * Two things differ between SSG and SSR: the title text in the home NavLink
 * ("SSG Starter" / "SSR Starter") and the Dashboard nav link, which only
 * ships in SSG. Everything else — imports, navClass, layout, ThemeToggle — is
 * identical. Lives in `templates-shared/react-components/` so both branches
 * emit from one place.
 *
 * @param templateID - Which template to emit (`ssg` or `ssr`)
 */
function buildHeaderSrc(templateID: HeaderTemplateID): string {
  let title: string;
  let dashboardLink: string;

  if (templateID === 'ssg') {
    title = 'SSG Starter';
    dashboardLink = `
          <NavLink to="/dashboard" className={navClass}>
            Dashboard
          </NavLink>`;
  } else if (templateID === 'ssr') {
    title = 'SSR Starter';
    dashboardLink = '';
  } else {
    // Compile-time exhaustiveness — TS errors here if HeaderTemplateID gains a
    // member without a matching branch.
    const _exhaustive: never = templateID;
    throw new Error(`Unknown template: ${templateID as string}`);
  }

  return `import { NavLink } from 'react-router';
import { ThemeToggle } from './theme/ThemeToggle';

export function Header() {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    \`border-4 border-dashed border-yellow-500 px-6 py-3 rounded text-gray-700 dark:text-gray-300 font-medium\${isActive ? ' bg-yellow-50 dark:bg-yellow-950' : ''}\`;

  return (
    <header className="mb-8 rounded-lg border-4 border-dashed border-cyan-500 p-8">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="rounded border-4 border-dashed border-pink-500 px-6 py-3">
          <NavLink
            to="/"
            end
            className="text-2xl font-bold text-gray-800 dark:text-gray-100"
          >
            ${title}
          </NavLink>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-4">
          <NavLink to="/" end className={navClass}>
            Home
          </NavLink>
          <NavLink to="/about" className={navClass}>
            About
          </NavLink>${dashboardLink}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
`;
}

/**
 * Ensure a Vite app's `components/Header.tsx` exists at
 * `${projectPath}/components/Header.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param templateID - Which template to emit (`ssg` or `ssr`)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppHeader(
  root: FileRoot,
  projectPath: string,
  templateID: HeaderTemplateID,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/components/Header.tsx`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildHeaderSrc(templateID),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
