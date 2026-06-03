import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/** Templates that ship a server render entry point (both use `unirend/server`). */
type EntryServerTemplateID = 'ssg' | 'ssr';

/**
 * Build the source for a Vite app's server render entry point
 * (`EntrySSG.tsx` for SSG, `EntrySSR.tsx` for SSR).
 *
 * The two files are structurally identical — same imports, same `render`
 * export, same `unirendBaseRender` call — and differ only in two JSDoc comment
 * lines that name the template and its rendering model. Everything else,
 * including the `rootProviders`/`ThemeProvider` wiring, is emitted verbatim.
 *
 * @param templateID - Which template's comments to emit (`ssg` or `ssr`)
 */
function buildEntryServerSrc(templateID: EntryServerTemplateID): string {
  let entryLine: string;
  let callerLine: string;
  let timingLine: string;

  if (templateID === 'ssg') {
    entryLine = ' * SSG entry point for static site generation';
    callerLine =
      ' * This function is called by the Unirend SSG generator to render each page';
    timingLine =
      ' * at build time. It accepts a render request object and passes the routes';
  } else if (templateID === 'ssr') {
    entryLine = ' * SSR entry point for server-side rendering';
    callerLine =
      ' * This function is called by the Unirend SSR server to render each page';
    timingLine =
      ' * at runtime. It accepts a render request object and passes the routes';
  } else {
    // Compile-time exhaustiveness — TS errors here if EntryServerTemplateID
    // gains a member without a matching branch. JS callers can still land here,
    // so cast for the error message.
    const _exhaustive: never = templateID;
    throw new Error(`Unknown template: ${templateID as string}`);
  }

  return `import { unirendBaseRender, type RenderRequest } from 'unirend/server';

// Import shared routes
import { routes } from './Routes';

// Import theme provider
import { ThemeProvider } from './components/theme/ThemeProvider';

/**
${entryLine}
 *
${callerLine}
${timingLine}
 * to the base render function to handle all router creation and wrapping.
 *
 * @param renderRequest - The render request containing type and other options
 * @returns RenderResult with the rendered HTML and metadata
 */

export async function render(renderRequest: RenderRequest) {
  // Use the base render function - it handles router creation internally
  // including static handler/router creation, UnirendProvider, UnirendHeadProvider, StrictMode, and StaticRouterProvider

  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true,
    // Sits above the router — good for themes, modals, toast containers, etc.
    // Keep it stable — errors here bypass React Router's errorElement (SSR: server failure, SSG: page render fails)
    rootProviders: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
  });
}
`;
}

/**
 * Ensure a Vite app's server render entry point exists.
 * Writes `EntrySSG.tsx` for the SSG template and `EntrySSR.tsx` for SSR.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param templateID - Which template to emit (`ssg` or `ssr`)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppEntryServer(
  root: FileRoot,
  projectPath: string,
  templateID: EntryServerTemplateID,
  log?: LoggerFunction,
): Promise<void> {
  const fileName = templateID === 'ssg' ? 'EntrySSG.tsx' : 'EntrySSR.tsx';
  const relPath = `${projectPath}/${fileName}`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildEntryServerSrc(templateID),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
