import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for a Vite app's `tsconfig.json` (SSG, SSR).
 *
 * Identical across the Vite-based templates, so it lives in `templates-shared/`
 * rather than being duplicated per template. It extends the repo-root tsconfig
 * and layers on the Vite-specific bits (the `vite/client` ambient types and a
 * `baseUrl` pointing back at the repo root).
 */
const viteFileSrc = `{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "types": ["vite/client"],
    "baseUrl": "../../.."
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
`;

/**
 * Source for an API app's `tsconfig.json`.
 *
 * The API template has no Vite/client surface, so it drops the `vite/client`
 * types (inheriting the repo-root `["node"]` types instead) and only includes
 * `.ts` files. It still ships a per-app config purely to establish a project
 * boundary: VSCode's `importModuleSpecifier: "project-relative"` keys off the
 * directory of the importing file's nearest tsconfig, so without this the
 * boundary would collapse to the repo root and shared `src/libs/*` imports
 * would auto-complete as relative paths instead of the `@/` alias — diverging
 * from how the Vite apps behave. The `baseUrl` points back at the repo root so
 * the inherited `@/*` alias resolves.
 */
const apiFileSrc = `{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "baseUrl": "../../.."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
`;

/**
 * Ensure a Vite app's `tsconfig.json` exists at `${projectPath}/tsconfig.json`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppTsConfig(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  await writeAppTsConfig(root, projectPath, viteFileSrc, log);
}

/**
 * Ensure an API app's `tsconfig.json` exists at `${projectPath}/tsconfig.json`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-api")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAPITsConfig(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  await writeAppTsConfig(root, projectPath, apiFileSrc, log);
}

async function writeAppTsConfig(
  root: FileRoot,
  projectPath: string,
  fileSrc: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/tsconfig.json`;

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
