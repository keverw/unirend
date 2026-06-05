import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * cspell words that appear in the generated SSR `pages/Home.tsx` and so must be
 * in the generated project's dictionary. Co-located with the file that emits
 * them so the two stay in sync; the SSR `getTemplateConfig` branch folds these
 * into its template-specific `cspellWords`.
 *
 * - `noreferrer` — the `rel="noreferrer"` attribute on the Unirend link.
 */
export const SSR_HOME_CSPELL_WORDS: string[] = ['noreferrer'];

/**
 * Source for the SSR app's `pages/Home.tsx`.
 *
 * SSR-specific — lives in `templates-specific/ssr/`. Uses `useLoaderData` to
 * display a "From Server" line seeded by the page-data loader. Feature cards
 * cover "SSR Pages", "Data Loaders", and "Theme Support". The error simulation
 * section explains that "Throw from Component" fires on both server and client:
 * a hard refresh triggers `get500ErrorPage`, while a client-side navigation
 * after hydration is caught by `RouteErrorBoundary`'s `ApplicationErrorComponent`.
 */
const fileSrc = `import { useLoaderData, Link } from 'react-router';
import { UnirendHead } from 'unirend/client';
import { ENABLE_TEST_ROUTES } from '../consts';

interface HomeLoaderEnvelope {
  data: {
    serverLine: string;
  };
}

export function Home() {
  const { data } = useLoaderData<HomeLoaderEnvelope>();

  return (
    <>
      <UnirendHead>
        <title>Home - Unirend SSR Starter</title>
        <meta
          name="description"
          content="Welcome to the Unirend SSR starter homepage"
        />
      </UnirendHead>

      <div className="mb-6 rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
          Unirend SSR Starter
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          A starter template powered by{' '}
          <a
            href="https://github.com/keverw/unirend"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Unirend
          </a>{' '}
          , a lightweight toolkit for unified SSG and SSR workflows, powered by
          Vite and React.
        </p>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          From Server: {data.serverLine}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-lg border-4 border-dashed border-purple-500 p-6">
          <h3 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
            SSR Pages
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Pages like this one are rendered on the server on each request and
            hydrated on the client for dynamic, SEO-friendly delivery.
          </p>
        </div>
        <div className="rounded-lg border-4 border-dashed border-purple-500 p-6">
          <h3 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
            Data Loaders
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Loaders run on the server before rendering. The data is embedded in
            the page and reused during hydration, so no extra fetch is needed on
            load. Client-side navigation calls the API directly, and if both run
            on the same server instance, the round-trip short-circuits.
          </p>
        </div>
        <div className="rounded-lg border-4 border-dashed border-purple-500 p-6">
          <h3 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
            Theme Support
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Dark, light, and auto mode with cookie persistence and cross-tab
            sync. No flash on load.
          </p>
        </div>
      </div>

      {ENABLE_TEST_ROUTES && (
        <div className="rounded-lg border-4 border-dashed border-red-500 p-8">
          <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-gray-100">
            Error Simulation Routes
          </h2>
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            These routes are enabled because{' '}
            <code>ENABLE_TEST_ROUTES = true</code> in <code>consts.ts</code>.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/simulate-component-error"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              Throw from Component
            </Link>
            <Link
              to="/404"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              404 Page
            </Link>
            <Link
              to="/simulate-dataloader-500-error"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              Throw Error in Loader
            </Link>
            <Link
              to="/simulate-dataloader-500-status"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              500 Status Envelope
            </Link>
            <Link
              to="/simulate-dataloader-503-status"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              503 Status Envelope
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            <strong>Throw from Component</strong> throws on both server and
            client. Navigating directly (hard refresh) triggers the server-side{' '}
            <code>get500ErrorPage</code> handler, while clicking the link after
            hydration is caught client-side by <code>RouteErrorBoundary</code>'s{' '}
            <code>ApplicationErrorComponent</code>.
          </p>
        </div>
      )}
    </>
  );
}
`;

/**
 * Ensure the SSR app's `pages/Home.tsx` exists at
 * `${projectPath}/pages/Home.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRHome(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/pages/Home.tsx`;

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
