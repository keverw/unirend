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
 * The `PUBLIC_FILES`/`PUBLIC_FOLDERS` comment also differs per template: SSR
 * output can only be served by the SSR server, so the declared list is simply
 * how production works, while SSG output may end up on a dumb static host or
 * CDN that serves everything regardless — there the list only governs the
 * bundled `serve.ts` and keeps local preview faithful. The PHP companion
 * follows the same declared-list model but reads its own config, so it is
 * called out as a mirror-by-hand target rather than a consumer.
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

  // Shared first half of the PUBLIC_FILES comment; the "who serves this"
  // half below differs per template.
  const publicFilesCommentBase = `// Files in public/ referenced by literal URL, served in production only when
// declared here. The distinction that trips people up:
//   - Assets you \`import\` from source go through Vite, get hashed, and land in
//     /assets, which is already served. Nothing to declare.
//   - Files in public/ are copied verbatim to the client build root and are
//     referenced by literal URL (from index.html or JSX). In dev, Vite's server
//     serves them; in production they are served ONLY if listed here.`;

  const publicFilesComment =
    templateID === 'ssg'
      ? `${publicFilesCommentBase}
// This list drives the bundled serve.ts. The PHP companion
// (unirend/php-static-server) follows the same declared-list model but reads
// its own config in index.php, so mirror any changes there by hand. A dumb
// static host or CDN serves the whole build output regardless — keeping the
// list in sync still keeps local preview faithful to what such a host would
// serve.
// \`bun run check:public-assets\` (part of \`bun run check\`) fails on drift
// in either direction.`
      : `${publicFilesCommentBase}
// Keep this in sync with the public/ folder — \`bun run check:public-assets\`
// (part of \`bun run check\`) fails on drift in either direction.`;

  return `${header}
export const ENABLE_TEST_ROUTES = true;

${publicFilesComment}
export const PUBLIC_FILES = ['/favicon.svg', '/favicon.ico', '/robots.txt'];

// Subfolders of public/ served whole (e.g. '/.well-known') — every file inside
// is served without listing each one in PUBLIC_FILES. Prefer PUBLIC_FILES for
// individual files: folder mounts stat the disk per request instead of using a
// fixed list. The check script treats files under these folders as covered.
export const PUBLIC_FOLDERS: string[] = [];
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
