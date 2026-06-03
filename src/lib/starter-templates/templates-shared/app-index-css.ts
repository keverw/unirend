import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for a Vite app's `index.css`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/` rather than being duplicated per template. It
 * imports Tailwind, wires up the class-based dark-mode variant, sets the base
 * html background colors (so the overscroll gutter doesn't flash white in dark
 * mode), and leaves commented-out examples for custom theme colors, `@utility`,
 * `@layer`, and plain classes. The API template doesn't ship one — it has no
 * Tailwind/CSS surface.
 */
const fileSrc = `@import 'tailwindcss';

/* Configure dark mode to use class strategy */
@custom-variant dark (&:where(.dark, .dark *));

/* Prevent the overscroll area from flashing white in dark mode — matches the
   app background so the gutter looks seamless when bouncing past the edge.
   Keep these in sync with your base background theme colors below. */
html {
  background-color: #fff; /* light background */
}

html.dark {
  background-color: #111827; /* dark background — gray-900 */
}

/* Define custom theme colors */
@theme {
  /* --color-primary: #6366f1; */
  /* --color-accent: #f59e0b; */
}

/* Override primary color for dark mode */
/*
.dark {
  --color-primary: #818cf8;
  --color-accent: #fbbf24;
}
*/

/* ===== Generic @utility example ===== */
/*
@utility glass-effect {
  backdrop-filter: blur(10px);
  background-color: rgba(255, 255, 255, 0.7);
}
*/

/* ===== Generic @layer example ===== */
/*
@layer components {
  .btn-example {
    @apply rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600;
  }
}
*/

/* ===== Generic class example ===== */
/*
.card-example {
  @apply rounded-xl bg-white p-6 shadow-lg dark:bg-gray-800;
}
*/
`;

/**
 * Ensure a Vite app's `index.css` exists at `${projectPath}/index.css`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppIndexCSS(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/index.css`;

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
