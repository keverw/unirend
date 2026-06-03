import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/** Templates that ship an app `consts.ts` (API has no error-demo routes). */
type ConstsTemplateID = 'ssg' | 'ssr';

/**
 * Build the source for a Vite app's `consts.ts`.
 *
 * The exported `ENABLE_TEST_ROUTES` flag is identical across SSG and SSR, but
 * the explanatory header differs: each template points at the scripts that
 * actually toggle the error-demo routes for it, and those scripts are
 * app-prefixed (`<appName>:…`), so the app name is injected here. This lives in
 * `templates-shared/` so both branches emit the same flag from one place.
 *
 * @param templateID - Which template's header to emit (`ssg` or `ssr`)
 * @param appName - The app's folder name under `src/apps/` (the project name)
 */
function buildConstsSrc(templateID: ConstsTemplateID, appName: string): string {
  let header: string;

  if (templateID === 'ssg') {
    header = `// Flip to true and run \`bun run ${appName}:build-and-generate:dev\` to enable the error demo routes.
// Useful for demoing error behavior and designing/previewing error pages.
// Note: failOn5xx is automatically set to false when this is true (see generate-ssg.ts).`;
  } else if (templateID === 'ssr') {
    header = `// Flip to true to enable the error demo routes.
// Run via \`bun run ${appName}:serve:dev\` (dev SSR server) or \`bun run ${appName}:build-and-serve:dev\` (built).
// Useful for demoing error behavior and designing/previewing error pages.`;
  } else {
    // Compile-time exhaustiveness — TS errors here if ConstsTemplateID gains a
    // member without a matching branch. JS callers can still land here, so cast
    // for the error message.
    const _exhaustive: never = templateID;
    throw new Error(`Unknown template: ${templateID as string}`);
  }

  return `${header}
export const ENABLE_TEST_ROUTES = true;
`;
}

/**
 * Ensure a Vite app's `consts.ts` exists at `${projectPath}/consts.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param templateID - Which template's header to emit (`ssg` or `ssr`)
 * @param appName - The app's folder name under `src/apps/` (the project name)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppConsts(
  root: FileRoot,
  projectPath: string,
  templateID: ConstsTemplateID,
  appName: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/consts.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildConstsSrc(templateID, appName),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
