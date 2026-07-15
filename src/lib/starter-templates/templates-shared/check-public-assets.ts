import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for the repo-level `scripts/check-public-assets.ts`.
 *
 * A single script services every Vite app in the repo: it reads
 * `unirend-repo.json`, and for each SSR/SSG project compares the app's
 * declared `PUBLIC_FILES`/`PUBLIC_FOLDERS` (in `consts.ts`) against the files actually present
 * in its `public/` directory. Drift in either direction is an error — declared
 * but missing files make the built server refuse to boot (or 404), and files
 * present but undeclared 404 silently in production. The API template has no
 * public-file surface, so it's skipped.
 *
 * Like `generate-build-info.ts`, the source lives in `templates-shared/` and
 * the file is written create-if-missing once per repo regardless of how many
 * apps are scaffolded. It's registered in `base-files/package-json.ts` (its
 * own script entry plus the `check` chain) and exits non-zero on drift so it
 * fails CI.
 */
const fileSrc = `import { promises as fs } from 'fs';
import path from 'path';

// Verifies each Vite app's declared PUBLIC_FILES/PUBLIC_FOLDERS (consts.ts) matches the
// files actually present in its public/ directory. Runs from the project root
// (invoked via check:public-assets, chained into \`bun run check\`).
//
// Why this exists: files in public/ are copied verbatim to the client build
// root and are served in production ONLY if declared. Dev servers serve them
// implicitly, so drift is invisible until production — this check makes it
// fail CI instead.

interface ProjectEntry {
  templateID: string;
  path: string;
}

interface RepoConfig {
  projects?: Record<string, ProjectEntry>;
}

const rootDir = process.cwd();

/**
 * Paths that must never be exposed as public assets: the raw HTML template
 * and Vite build metadata. For SSR apps, serving the template would bypass
 * SSR and the server rejects the declaration at boot. For SSG apps there is
 * no boot check, but a public/index.html collides with the built index.html
 * at build time and with the generated homepage after that — catching it
 * here in CI is the only guard. Case-insensitive, matching the SSR server:
 * on case-insensitive filesystems /INDEX.HTML is the same file.
 */
function isReservedPublicPath(urlPath: string): boolean {
  const lowered = urlPath.toLowerCase();
  return lowered === '/index.html' || lowered.split('/').includes('.vite');
}

/** Recursively list files under dir as URL-style paths ("/sub/file.ext"). */
async function listPublicFiles(dir: string, prefix = ''): Promise<string[]> {
  let entries;

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(
        ...(await listPublicFiles(
          path.join(dir, entry.name),
          \`\${prefix}/\${entry.name}\`,
        )),
      );
    } else if (entry.isFile()) {
      files.push(\`\${prefix}/\${entry.name}\`);
    }
  }

  return files;
}

async function main() {
  const configPath = path.join(rootDir, 'unirend-repo.json');

  let configRaw: string;

  try {
    configRaw = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('No unirend-repo.json found — nothing to check.');
      return;
    }

    throw error;
  }

  const config = JSON.parse(configRaw) as RepoConfig;
  const problems: string[] = [];

  for (const [name, project] of Object.entries(config.projects ?? {})) {
    // Only the Vite templates have a public-file surface; API apps don't.
    if (project.templateID !== 'ssr' && project.templateID !== 'ssg') {
      continue;
    }

    const projectDir = path.resolve(rootDir, project.path);
    const constsPath = path.join(projectDir, 'consts.ts');
    const relConstsPath = path.relative(rootDir, constsPath);

    let declaredFiles: unknown;
    let declaredFolders: unknown;

    try {
      const consts = (await import(constsPath)) as Record<string, unknown>;
      declaredFiles = consts.PUBLIC_FILES;
      declaredFolders = consts.PUBLIC_FOLDERS;
    } catch (error) {
      problems.push(
        \`\${name}: could not load \${relConstsPath}: \${String(error)}\`,
      );

      continue;
    }

    if (
      !Array.isArray(declaredFiles) ||
      !declaredFiles.every((entry) => typeof entry === 'string')
    ) {
      problems.push(
        \`\${name}: \${relConstsPath} does not export a PUBLIC_FILES string array. \` +
          \`Add one listing every file in public/, e.g. export const PUBLIC_FILES = ['/favicon.svg', '/robots.txt'];\`,
      );

      continue;
    }

    // The templates emit PUBLIC_FILES and PUBLIC_FOLDERS together, so
    // require both (an empty array is fine, a deleted export is not).
    if (
      !Array.isArray(declaredFolders) ||
      !declaredFolders.every((entry) => typeof entry === 'string')
    ) {
      problems.push(
        \`\${name}: \${relConstsPath} does not export a PUBLIC_FOLDERS string array. \` +
          \`Add one (empty is fine), e.g. export const PUBLIC_FOLDERS: string[] = ['/.well-known'];\`,
      );

      continue;
    }

    // Validate individual entries before diffing — a bad entry can never
    // match a file, so report it as its own problem instead of noise.
    const normalizedFiles: string[] = [];

    for (const entry of declaredFiles) {
      // Collapse repeated slashes before any check, like the server does —
      // '/assets//x' must hit the same checks as '/assets/x'. Reserved-path
      // comparisons are case-insensitive for the same reason: on
      // case-insensitive filesystems /INDEX.HTML is the same file.
      const collapsed = entry.trim().replace(/\\/+/g, '/');
      const withLead = collapsed.startsWith('/') ? collapsed : \`/\${collapsed}\`;

      if (collapsed === '' || withLead === '/' || withLead.endsWith('/')) {
        problems.push(
          \`\${name}: PUBLIC_FILES entry \${JSON.stringify(entry)} is a folder path — individual files only (folders go in PUBLIC_FOLDERS).\`,
        );
      } else if (
        withLead.split('/').includes('..') ||
        withLead.split('/').includes('.') ||
        withLead.includes('\\0') ||
        withLead.includes('\\\\')
      ) {
        problems.push(
          \`\${name}: PUBLIC_FILES entry \${JSON.stringify(entry)} contains a "." or ".." segment, backslash, or null byte — the server rejects it at boot (use forward-slash URL paths).\`,
        );
      } else if (isReservedPublicPath(withLead)) {
        problems.push(
          \`\${name}: PUBLIC_FILES entry \${JSON.stringify(entry)} exposes build internals (the HTML template or Vite metadata) — the SSR server rejects it at boot, and in an SSG app it collides with the build output. Remove it.\`,
        );
      } else if (
        withLead.toLowerCase() === '/assets' ||
        withLead.toLowerCase().startsWith('/assets/')
      ) {
        problems.push(
          \`\${name}: PUBLIC_FILES entry \${JSON.stringify(entry)} is under /assets, which Vite generates at build time and the default mount already serves — the server rejects it at boot. Remove it.\`,
        );
      } else {
        normalizedFiles.push(withLead);
      }
    }

    const normalizedFolders: string[] = [];

    for (const entry of declaredFolders) {
      // Same slash collapse and case-insensitive reserved checks as the
      // files loop — '//' must normalize to the root it actually mounts.
      const collapsed = entry.trim().replace(/\\/+/g, '/');
      const withLead =
        collapsed === '' || collapsed.startsWith('/')
          ? collapsed
          : \`/\${collapsed}\`;
      const trimmedSlash = withLead.endsWith('/')
        ? withLead.slice(0, -1)
        : withLead;

      if (trimmedSlash === '' || trimmedSlash === '/') {
        problems.push(
          \`\${name}: PUBLIC_FOLDERS entry \${JSON.stringify(entry)} mounts the whole public/ root — the server rejects it at boot. Declare subfolders only.\`,
        );
      } else if (
        trimmedSlash.split('/').includes('..') ||
        trimmedSlash.split('/').includes('.') ||
        trimmedSlash.includes('\\0') ||
        trimmedSlash.includes('\\\\')
      ) {
        problems.push(
          \`\${name}: PUBLIC_FOLDERS entry \${JSON.stringify(entry)} contains a "." or ".." segment, backslash, or null byte — the server rejects it at boot (use forward-slash URL paths).\`,
        );
      } else if (
        isReservedPublicPath(trimmedSlash) ||
        trimmedSlash.toLowerCase() === '/assets' ||
        trimmedSlash.toLowerCase().startsWith('/assets/')
      ) {
        problems.push(
          \`\${name}: PUBLIC_FOLDERS entry \${JSON.stringify(entry)} is reserved (/assets is served by default; .vite is build metadata) — the server rejects it at boot. Remove it.\`,
        );
      } else {
        normalizedFolders.push(trimmedSlash);
      }
    }

    const publicDir = path.join(projectDir, 'public');
    const actual = await listPublicFiles(publicDir);
    const actualSet = new Set(actual);
    const declaredSet = new Set(normalizedFiles);

    const isUnderDeclaredFolder = (filePath: string) =>
      normalizedFolders.some((prefix) => filePath.startsWith(\`\${prefix}/\`));

    // Declared file entries pointing at directories are their own class of
    // error — they'd otherwise show up confusingly as "missing"
    // (listPublicFiles only returns files).
    const missingFromPublic: string[] = [];

    for (const entry of normalizedFiles) {
      if (actualSet.has(entry)) {
        continue;
      }

      try {
        const stat = await fs.stat(path.join(publicDir, ...entry.split('/')));

        if (stat.isDirectory()) {
          problems.push(
            \`\${name}: PUBLIC_FILES entry "\${entry}" is a directory — move it to PUBLIC_FOLDERS or declare the individual files inside it.\`,
          );

          continue;
        }
      } catch {
        // Fall through — it's simply missing.
      }

      missingFromPublic.push(entry);
    }

    // Declared folders must exist as directories in public/ (the built
    // server refuses to boot otherwise).
    for (const prefix of normalizedFolders) {
      try {
        const stat = await fs.stat(path.join(publicDir, ...prefix.split('/')));

        if (!stat.isDirectory()) {
          problems.push(
            \`\${name}: PUBLIC_FOLDERS entry "\${prefix}" exists in public/ but is a file — declare it in PUBLIC_FILES instead.\`,
          );
        }
      } catch {
        problems.push(
          \`\${name}: PUBLIC_FOLDERS entry "\${prefix}" is missing from public/ (the built server refuses to boot on this).\`,
        );
      }
    }

    // Reserved names sitting in public/ get their own error — the usual
    // "declare it" advice would be wrong (the server rejects them), and a
    // public/index.html collides with the Vite-built index.html anyway.
    const reservedInPublic = actual.filter(isReservedPublicPath);

    // A public/assets/ folder is its own trap: Vite copies it INTO the
    // build's fingerprinted output dir (client/assets), where the default
    // /assets mount serves it with immutable-asset detection meant for
    // hashed bundles. Flag it for a rename instead of suggesting
    // declarations that can't work (PUBLIC_FOLDERS rejects /assets).
    // Case-insensitive like the declaration checks: on case-insensitive
    // filesystems public/ASSETS/ is the same collision, and the "declare
    // it" advice would point at a declaration the server rejects. An exact
    // /assets file collides with the output dir the same way.
    const isInBuildAssets = (filePath: string) => {
      const lowered = filePath.toLowerCase();
      return lowered === '/assets' || lowered.startsWith('/assets/');
    };

    const inAssetsDir = actual.filter(isInBuildAssets);

    if (inAssetsDir.length > 0) {
      problems.push(
        \`\${name}: public/assets/ collides with the build's fingerprinted asset output dir — Vite copies it into client/assets next to the hashed bundles:\\n\` +
          inAssetsDir.map((entry) => \`  - \${entry}\`).join('\\n') +
          \`\\n  Rename the folder (e.g. public/static/) and declare it via PUBLIC_FOLDERS.\`,
      );
    }

    // A file is covered if declared individually OR under a declared folder.
    const undeclaredInPublic = actual.filter(
      (filePath) =>
        !declaredSet.has(filePath) &&
        !isUnderDeclaredFolder(filePath) &&
        !isReservedPublicPath(filePath) &&
        !isInBuildAssets(filePath),
    );

    if (reservedInPublic.length > 0) {
      problems.push(
        \`\${name}: public/ contains files that must not be exposed as public assets (they collide with the build output or expose build internals):\\n\` +
          reservedInPublic.map((entry) => \`  - \${entry}\`).join('\\n') +
          \`\\n  Remove them from public/.\`,
      );
    }

    if (missingFromPublic.length > 0) {
      problems.push(
        \`\${name}: declared in PUBLIC_FILES but missing from public/ (the built server refuses to boot on these):\\n\` +
          missingFromPublic.map((entry) => \`  - \${entry}\`).join('\\n'),
      );
    }

    if (undeclaredInPublic.length > 0) {
      problems.push(
        \`\${name}: present in public/ but not declared (these 404 in production):\\n\` +
          undeclaredInPublic.map((entry) => \`  - \${entry}\`).join('\\n') +
          \`\\n  Add them to PUBLIC_FILES in \${relConstsPath} (or cover their folder via PUBLIC_FOLDERS).\`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(\`public-assets check failed:\\n\\n\${problems.join('\\n\\n')}\\n\`);
    process.exit(1);
  }

  console.log('public-assets check passed.');
}

main().catch((error) => {
  console.error('Failed to run public-assets check:', error);
  process.exit(1);
});
`;

/**
 * Ensure `scripts/check-public-assets.ts` exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites. Written for
 * every repo (the script no-ops without SSR/SSG projects), so it lives with
 * the base-file ensures and a second scaffold run is a no-op.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureCheckPublicAssets(
  root: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = 'scripts/check-public-assets.ts';

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
