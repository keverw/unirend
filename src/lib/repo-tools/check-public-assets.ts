import { promises as fs } from 'fs';
import path from 'path';

/**
 * Public-assets drift check for scaffolded repos, exported via
 * `unirend/repo-tools`.
 *
 * A single call services every Vite app in the repo: it reads
 * `unirend-repo.json`, and for each SSR/SSG project compares the app's
 * declared public-asset lists (`PUBLIC_FILES`/`PUBLIC_FOLDERS` by default)
 * against the files actually present in its `public/` directory. Drift in
 * either direction is an error — declared but missing files make the built
 * server refuse to boot (or 404), and files present but undeclared 404
 * silently in production. The API template has no public-file surface, so
 * it's skipped.
 *
 * Why this exists: files in public/ are copied verbatim to the client build
 * root and are served in production ONLY if declared. Dev servers serve them
 * implicitly, so drift is invisible until production — this check makes it
 * fail CI instead.
 *
 * Where each app's lists and `public/` folder live is declared per project in
 * `public-assets.config.json` (scaffolded with a single `default` entry
 * mirroring the template conventions). That indirection exists for the
 * multi-app SSR pattern, where one project hosts several Vite roots in a
 * layout the framework has no opinion on, so the check can't find them by
 * convention. A project without the config file is skipped (logged, so the
 * opt-out shows in CI output).
 *
 * The function acts as a main: it prints its own progress and problem report
 * through the injectable loggers and returns a result instead of exiting, so
 * the scaffolded `scripts/check-public-assets.ts` stays a thin wrapper that
 * sets the exit code (and is the place to customize). Keeping the logic here
 * means repos pick up fixes by upgrading unirend instead of re-scaffolding a
 * frozen script.
 *
 * Runtime note: declared lists are loaded by dynamically importing the app's
 * consts module (a TypeScript file), so this must run under Bun — which is
 * how scaffolded repos invoke it (`bun run check:public-assets`).
 */

interface ProjectEntry {
  templateID: string;
  path: string;
}

interface RepoConfig {
  projects?: Record<string, ProjectEntry>;
}

/**
 * One entry in a project's public-assets.config.json. All paths are relative
 * to the project folder; every field is optional and defaults to the
 * scaffolded single-app convention.
 */
interface AppAssetsEntry {
  publicDir?: string;
  constsFile?: string;
  filesExport?: string;
  foldersExport?: string;
}

const APP_ENTRY_FIELDS = [
  'publicDir',
  'constsFile',
  'filesExport',
  'foldersExport',
];

/** Options for {@link checkPublicAssets}. */
export interface CheckPublicAssetsOptions {
  /** Repo root containing unirend-repo.json. Defaults to process.cwd(). */
  rootDir?: string;
  /** Sink for progress and skip notices. Defaults to console.log. */
  log?: (message: string) => void;
  /** Sink for the aggregated problem report. Defaults to console.error. */
  logError?: (message: string) => void;
}

/** Result of {@link checkPublicAssets}. */
export interface CheckPublicAssetsResult {
  /** True when no problems were found (including the nothing-to-check case). */
  success: boolean;
  /** Human-readable problems, one per finding. Empty on success. */
  problems: string[];
}

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

/**
 * Matches characters browsers percent-encode in request URLs (spaces, %, #,
 * ?, non-ASCII, ...). The static servers match raw, undecoded URLs, so an
 * asset whose URL contains one of these can never be requested successfully.
 * '[', ']', and '|' are allowed — the WHATWG URL path percent-encode set
 * leaves them raw, so '/icon[1].png' really is requested verbatim ('^' is
 * not in that group: the serializer encodes it as %5E).
 * Mirrors the SSR server's config-time validation.
 */
const URL_UNSAFE_PATTERN = /[^A-Za-z0-9\-._~!$&'()*+,;=:@/[\]|]/;

/** Recursively list files under dir as URL-style paths ("/sub/file.ext"). */
async function listPublicFiles(
  dir: string,
  prefix = '',
  seenDirs = new Set<string>(),
  cycles?: string[],
  dangling?: string[],
): Promise<string[]> {
  // Track the real paths of the CURRENT recursion branch so a directory
  // symlink pointing at itself or an ancestor (e.g. public/loop -> public/)
  // cannot recurse forever. Ancestry only, not a global visited set: two
  // sibling symlinks resolving to the same directory are two distinct URL
  // trees and both must be listed, so each directory is released again once
  // its subtree is done. A detected cycle is reported, not skipped — Vite's
  // public-directory copier follows symlinks with no cycle guard, so the
  // build itself would recurse until it fails.
  let realDir: string;

  try {
    realDir = await fs.realpath(dir);
  } catch {
    return [];
  }

  if (seenDirs.has(realDir)) {
    cycles?.push(prefix || '/');
    return [];
  }

  seenDirs.add(realDir);

  // The finally-release keeps every exit path (including the ENOENT return
  // below, when the directory vanishes between realpath and readdir) from
  // leaking ancestry state — only the branch currently being walked counts
  // as a cycle, so other branches must see this directory released.
  try {
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
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();

      // readdir dirents report symlinks as neither file nor directory, which
      // would silently drop symlinked assets from the listing. Stat through
      // the link and classify by its target instead. A dangling symlink is
      // reported, not skipped: Vite's public copier stats each entry and the
      // build fails on the same broken link.
      if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          dangling?.push(`${prefix}/${entry.name}`);
        }
      }

      if (isDirectory) {
        files.push(
          ...(await listPublicFiles(
            path.join(dir, entry.name),
            `${prefix}/${entry.name}`,
            seenDirs,
            cycles,
            dangling,
          )),
        );
      } else if (isFile) {
        files.push(`${prefix}/${entry.name}`);
      }
    }

    return files;
  } finally {
    seenDirs.delete(realDir);
  }
}

/**
 * Resolve a config-relative path against the project folder, rejecting
 * values that escape it (absolute paths or ".." traversal) or resolve to the
 * project folder itself. The config is committed to the repo, so this is a
 * correctness guard against typos pointing the check at an unrelated
 * directory, not a security boundary.
 */
function resolveInsideProject(
  projectDir: string,
  relPath: string,
): string | null {
  const resolved = path.resolve(projectDir, relPath);
  const back = path.relative(projectDir, resolved);

  if (
    back === '' ||
    back === '..' ||
    back.startsWith(`..${path.sep}`) ||
    path.isAbsolute(back)
  ) {
    return null;
  }

  return resolved;
}

interface CheckAppOptions {
  /** Label used in problem messages (project name, or name/appKey). */
  label: string;
  templateID: string;
  /** Absolute path to the app's consts module. */
  constsPath: string;
  /** Repo-relative consts path for messages. */
  relConstsPath: string;
  filesExport: string;
  foldersExport: string;
  /** Absolute path to the app's public/ directory. */
  publicDir: string;
}

/** Check one app's declared lists against its public/ directory. */
async function checkApp(
  options: CheckAppOptions,
  problems: string[],
): Promise<void> {
  const {
    label,
    templateID,
    constsPath,
    relConstsPath,
    filesExport,
    foldersExport,
    publicDir,
  } = options;

  // SSR servers validate the declared lists at boot and refuse to start on
  // a bad or missing entry. The SSG static server does no boot-time
  // validation — the same drift just 404s at request time — so each app
  // type gets the failure prediction that actually matches it.
  const isSSR = templateID === 'ssr';
  const badEntryNote = isSSR
    ? 'the server rejects it at boot'
    : 'the SSG static server does no boot-time validation, so requests for it just 404';
  const badFolderNote = isSSR
    ? 'the server rejects it at boot'
    : 'the SSG static server does no boot-time validation, so requests under it just 404';
  const missingFolderNote = isSSR
    ? 'the built server refuses to boot on this'
    : 'requests under it 404 in production — the SSG static server has no boot check';
  const missingFilesNote = isSSR
    ? 'the built server refuses to boot on these'
    : 'these 404 in production — the SSG static server has no boot check';

  let declaredFiles: unknown;
  let declaredFolders: unknown;

  try {
    // Importing a TypeScript module directly requires Bun, which is how the
    // scaffolded repo script invokes this check.
    const consts = (await import(constsPath)) as Record<string, unknown>;
    declaredFiles = consts[filesExport];
    declaredFolders = consts[foldersExport];
  } catch (error) {
    problems.push(
      `${label}: could not load ${relConstsPath}: ${String(error)}`,
    );

    return;
  }

  if (
    !Array.isArray(declaredFiles) ||
    !declaredFiles.every((entry) => typeof entry === 'string')
  ) {
    problems.push(
      `${label}: ${relConstsPath} does not export a ${filesExport} string array. ` +
        `Add one listing every file in public/, e.g. export const ${filesExport} = ['/favicon.svg', '/robots.txt'];`,
    );

    return;
  }

  // The templates emit PUBLIC_FILES and PUBLIC_FOLDERS together, so
  // require both (an empty array is fine, a deleted export is not).
  if (
    !Array.isArray(declaredFolders) ||
    !declaredFolders.every((entry) => typeof entry === 'string')
  ) {
    problems.push(
      `${label}: ${relConstsPath} does not export a ${foldersExport} string array. ` +
        `Add one (empty is fine), e.g. export const ${foldersExport}: string[] = ['/.well-known'];`,
    );

    return;
  }

  // Validate individual entries before diffing — a bad entry can never
  // match a file, so report it as its own problem instead of noise.
  const normalizedFiles: string[] = [];

  for (const entry of declaredFiles) {
    // Collapse repeated slashes before any check, like the server does —
    // '/assets//x' must hit the same checks as '/assets/x'. Reserved-path
    // comparisons are case-insensitive for the same reason: on
    // case-insensitive filesystems /INDEX.HTML is the same file.
    const collapsed = entry.trim().replace(/\/+/g, '/');
    const withLead = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;

    if (collapsed === '' || withLead === '/' || withLead.endsWith('/')) {
      problems.push(
        `${label}: ${filesExport} entry ${JSON.stringify(entry)} is a folder path — individual files only (folders go in ${foldersExport}).`,
      );
    } else if (
      withLead.split('/').includes('..') ||
      withLead.split('/').includes('.') ||
      withLead.includes('\0') ||
      withLead.includes('\\')
    ) {
      problems.push(
        `${label}: ${filesExport} entry ${JSON.stringify(entry)} contains a "." or ".." segment, backslash, or null byte — ${badEntryNote} (use forward-slash URL paths).`,
      );
    } else if (URL_UNSAFE_PATTERN.test(withLead)) {
      // Mirrors the SSR server's config-time check: the static router
      // matches raw request URLs, and browsers percent-encode these
      // characters, so the entry could never match a request.
      problems.push(
        `${label}: ${filesExport} entry ${JSON.stringify(entry)} contains characters browsers percent-encode in URLs (like spaces, %, #, ?, or non-ASCII) — ${badEntryNote}. Rename the file in public/ to URL-safe characters.`,
      );
    } else if (isReservedPublicPath(withLead)) {
      problems.push(
        `${label}: ${filesExport} entry ${JSON.stringify(entry)} exposes build internals (the HTML template or Vite metadata) — the SSR server rejects it at boot, and in an SSG app it collides with the build output. Remove it.`,
      );
    } else if (
      withLead.toLowerCase() === '/assets' ||
      withLead.toLowerCase().startsWith('/assets/')
    ) {
      problems.push(
        `${label}: ${filesExport} entry ${JSON.stringify(entry)} is under /assets, which Vite generates at build time and the default mount already serves — ${badEntryNote}. Remove it.`,
      );
    } else {
      normalizedFiles.push(withLead);
    }
  }

  const normalizedFolders: string[] = [];

  for (const entry of declaredFolders) {
    // Same slash collapse and case-insensitive reserved checks as the
    // files loop — '//' must normalize to the root it actually mounts.
    const collapsed = entry.trim().replace(/\/+/g, '/');
    const withLead =
      collapsed === '' || collapsed.startsWith('/')
        ? collapsed
        : `/${collapsed}`;
    const trimmedSlash = withLead.endsWith('/')
      ? withLead.slice(0, -1)
      : withLead;

    if (trimmedSlash === '' || trimmedSlash === '/') {
      problems.push(
        `${label}: ${foldersExport} entry ${JSON.stringify(entry)} mounts the whole public/ root — ${badFolderNote}. Declare subfolders only.`,
      );
    } else if (
      trimmedSlash.split('/').includes('..') ||
      trimmedSlash.split('/').includes('.') ||
      trimmedSlash.includes('\0') ||
      trimmedSlash.includes('\\')
    ) {
      problems.push(
        `${label}: ${foldersExport} entry ${JSON.stringify(entry)} contains a "." or ".." segment, backslash, or null byte — ${badFolderNote} (use forward-slash URL paths).`,
      );
    } else if (URL_UNSAFE_PATTERN.test(trimmedSlash)) {
      problems.push(
        `${label}: ${foldersExport} entry ${JSON.stringify(entry)} contains characters browsers percent-encode in URLs (like spaces, %, #, ?, or non-ASCII) — ${badFolderNote}. Rename the folder in public/ to URL-safe characters.`,
      );
    } else if (
      isReservedPublicPath(trimmedSlash) ||
      trimmedSlash.toLowerCase() === '/assets' ||
      trimmedSlash.toLowerCase().startsWith('/assets/')
    ) {
      problems.push(
        `${label}: ${foldersExport} entry ${JSON.stringify(entry)} is reserved (/assets is served by default; .vite is build metadata) — ${badFolderNote}. Remove it.`,
      );
    } else {
      normalizedFolders.push(trimmedSlash);
    }
  }

  const symlinkCycles: string[] = [];
  const danglingLinks: string[] = [];
  const actual = await listPublicFiles(
    publicDir,
    '',
    new Set(),
    symlinkCycles,
    danglingLinks,
  );

  // A symlink cycle is an error in its own right: Vite's public copier
  // follows symlinks without a cycle guard, so the build would recurse
  // until it fails even though this check terminated safely.
  for (const cyclePath of symlinkCycles) {
    problems.push(
      `${label}: public/ contains a symlinked directory cycle at ${JSON.stringify(cyclePath)} (it resolves to its own ancestor). Vite's build follows symlinks when copying public/ and would recurse until it fails — remove the symlink.`,
    );
  }

  // Same reasoning for dangling symlinks: Vite stats each entry when
  // copying public/, so the build fails on a broken link even though
  // there is nothing servable behind it.
  for (const danglingPath of danglingLinks) {
    problems.push(
      `${label}: public/ contains a dangling symlink at ${JSON.stringify(danglingPath)} (its target does not exist). Vite's build fails when copying public/ over broken links — fix the target or remove the symlink.`,
    );
  }
  const actualSet = new Set(actual);
  const declaredSet = new Set(normalizedFiles);

  const isUnderDeclaredFolder = (filePath: string) =>
    normalizedFolders.some((prefix) => filePath.startsWith(`${prefix}/`));

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
          `${label}: ${filesExport} entry "${entry}" is a directory — move it to ${foldersExport} or declare the individual files inside it.`,
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
          `${label}: ${foldersExport} entry "${prefix}" exists in public/ but is a file — declare it in ${filesExport} instead.`,
        );
      }
    } catch {
      problems.push(
        `${label}: ${foldersExport} entry "${prefix}" is missing from public/ (${missingFolderNote}).`,
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
    // The offender can also be a bare FILE named public/assets (listed as
    // exactly '/assets'), which collides with the output dir the same way
    // — say file vs folder correctly in the advice.
    const isAssetsFile = inAssetsDir.every(
      (entry) => entry.toLowerCase() === '/assets',
    );

    problems.push(
      `${label}: public/assets${isAssetsFile ? '' : '/'} collides with the build's fingerprinted asset output dir — Vite copies it into client/${isAssetsFile ? '' : 'assets'} next to the hashed bundles:\n` +
        inAssetsDir.map((entry) => `  - ${entry}`).join('\n') +
        (isAssetsFile
          ? `\n  Rename the file (e.g. public/assets.txt) and declare it via ${filesExport}.`
          : `\n  Rename the folder (e.g. public/static/) and declare it via ${foldersExport}.`),
    );
  }

  // Files under a declared folder are served by URL too, so a filename
  // with URL-unsafe characters still 404s — no boot check catches these
  // (the folder declaration itself is valid), making CI the only guard.
  for (const filePath of actual) {
    if (isUnderDeclaredFolder(filePath) && URL_UNSAFE_PATTERN.test(filePath)) {
      problems.push(
        `${label}: ${JSON.stringify(filePath)} is covered by ${foldersExport} but its name contains characters browsers percent-encode in URLs (like spaces, %, #, ?, or non-ASCII), so requests for it 404 in production. Rename it in public/ to URL-safe characters.`,
      );
    }
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
      `${label}: public/ contains files that must not be exposed as public assets (they collide with the build output or expose build internals):\n` +
        reservedInPublic.map((entry) => `  - ${entry}`).join('\n') +
        `\n  Remove them from public/.`,
    );
  }

  if (missingFromPublic.length > 0) {
    problems.push(
      `${label}: declared in ${filesExport} but missing from public/ (${missingFilesNote}):\n` +
        missingFromPublic.map((entry) => `  - ${entry}`).join('\n'),
    );
  }

  if (undeclaredInPublic.length > 0) {
    problems.push(
      `${label}: present in public/ but not declared (these 404 in production):\n` +
        undeclaredInPublic.map((entry) => `  - ${entry}`).join('\n') +
        `\n  Add them to ${filesExport} in ${relConstsPath} (or cover their folder via ${foldersExport}).`,
    );
  }
}

/**
 * Run the public-assets drift check over every SSR/SSG project registered in
 * `unirend-repo.json`. Prints its report through the injected loggers and
 * returns the outcome instead of exiting — the caller decides the exit code.
 *
 * @throws On unexpected filesystem or JSON errors outside a project's own
 * validation (e.g. an unreadable unirend-repo.json that does exist).
 */
export async function checkPublicAssets(
  options?: CheckPublicAssetsOptions,
): Promise<CheckPublicAssetsResult> {
  const rootDir = options?.rootDir ?? process.cwd();
  // eslint-disable-next-line no-console
  const log = options?.log ?? console.log;
  // eslint-disable-next-line no-console
  const logError = options?.logError ?? console.error;

  const configPath = path.join(rootDir, 'unirend-repo.json');

  let configRaw: string;

  try {
    configRaw = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log('No unirend-repo.json found — nothing to check.');
      return { success: true, problems: [] };
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
    const assetsConfigPath = path.join(projectDir, 'public-assets.config.json');
    const relAssetsConfigPath = path.relative(rootDir, assetsConfigPath);

    // No config file means the project opted out (the scaffold writes one, so
    // it was deliberately deleted). Log the skip so it shows in CI output
    // instead of silently checking nothing.
    let assetsConfigRaw: string;

    try {
      assetsConfigRaw = await fs.readFile(assetsConfigPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log(
          `${name}: no ${relAssetsConfigPath} — skipping this project (restore the file to re-enable the check).`,
        );

        continue;
      }

      throw error;
    }

    let assetsConfigParsed: unknown;

    try {
      assetsConfigParsed = JSON.parse(assetsConfigRaw);
    } catch (error) {
      problems.push(
        `${name}: could not parse ${relAssetsConfigPath}: ${String(error)}`,
      );

      continue;
    }

    if (
      assetsConfigParsed === null ||
      typeof assetsConfigParsed !== 'object' ||
      Array.isArray(assetsConfigParsed)
    ) {
      problems.push(
        `${name}: ${relAssetsConfigPath} must be a JSON object mapping app labels to entries, e.g. { "default": { "publicDir": "public", "constsFile": "consts.ts" } }.`,
      );

      continue;
    }

    const appEntries = Object.entries(
      assetsConfigParsed as Record<string, unknown>,
    );

    // An empty object checks nothing — say so rather than passing silently.
    if (appEntries.length === 0) {
      log(
        `${name}: ${relAssetsConfigPath} defines no apps — nothing to check for this project.`,
      );

      continue;
    }

    for (const [appKey, rawEntry] of appEntries) {
      // The key is only a label for messages. Single-app projects keep the
      // scaffolded "default" key, so their messages stay just the project
      // name; multi-app entries are qualified as name/appKey.
      const label = appKey === 'default' ? name : `${name}/${appKey}`;

      if (
        rawEntry === null ||
        typeof rawEntry !== 'object' ||
        Array.isArray(rawEntry)
      ) {
        problems.push(
          `${label}: entry ${JSON.stringify(appKey)} in ${relAssetsConfigPath} must be a JSON object (fields: ${APP_ENTRY_FIELDS.join(', ')}; all optional).`,
        );

        continue;
      }

      // Unknown keys are almost certainly typos, and a typo'd field name
      // silently falls back to its default — flag them instead.
      const entryRecord = rawEntry as Record<string, unknown>;
      let isEntryValid = true;

      for (const [field, value] of Object.entries(entryRecord)) {
        if (!APP_ENTRY_FIELDS.includes(field)) {
          problems.push(
            `${label}: unknown field ${JSON.stringify(field)} in ${relAssetsConfigPath} — valid fields are ${APP_ENTRY_FIELDS.join(', ')}.`,
          );

          isEntryValid = false;
        } else if (typeof value !== 'string' || value.trim() === '') {
          problems.push(
            `${label}: field ${JSON.stringify(field)} in ${relAssetsConfigPath} must be a non-empty string.`,
          );

          isEntryValid = false;
        }
      }

      if (!isEntryValid) {
        continue;
      }

      const entry = entryRecord as AppAssetsEntry;
      const publicDirRel = entry.publicDir ?? 'public';
      const constsFileRel = entry.constsFile ?? 'consts.ts';

      const publicDir = resolveInsideProject(projectDir, publicDirRel);
      const constsPath = resolveInsideProject(projectDir, constsFileRel);

      // Report both bad paths in one run rather than stopping at the first.
      if (publicDir === null) {
        problems.push(
          `${label}: publicDir ${JSON.stringify(publicDirRel)} in ${relAssetsConfigPath} must be a relative path inside the project folder.`,
        );
      }

      if (constsPath === null) {
        problems.push(
          `${label}: constsFile ${JSON.stringify(constsFileRel)} in ${relAssetsConfigPath} must be a relative path inside the project folder.`,
        );
      }

      if (publicDir === null || constsPath === null) {
        continue;
      }

      // The configured publicDir must actually exist: listPublicFiles treats
      // an unreadable directory as empty, so a typo'd path plus empty (or
      // stale) declared arrays would otherwise pass while the real public/
      // goes unchecked — the exact silent failure this check exists to
      // catch. An app with no public surface opts out by deleting the config
      // file (or this entry), not by pointing at a directory that isn't
      // there. stat follows symlinks, so a symlinked directory still counts.
      try {
        const publicDirStat = await fs.stat(publicDir);

        if (!publicDirStat.isDirectory()) {
          problems.push(
            `${label}: publicDir ${JSON.stringify(publicDirRel)} in ${relAssetsConfigPath} exists but is not a directory.`,
          );

          continue;
        }
      } catch {
        problems.push(
          `${label}: publicDir ${JSON.stringify(publicDirRel)} in ${relAssetsConfigPath} does not exist — fix the path, create the directory, or remove the entry to stop checking this app.`,
        );

        continue;
      }

      await checkApp(
        {
          label,
          templateID: project.templateID,
          constsPath,
          relConstsPath: path.relative(rootDir, constsPath),
          filesExport: entry.filesExport ?? 'PUBLIC_FILES',
          foldersExport: entry.foldersExport ?? 'PUBLIC_FOLDERS',
          publicDir,
        },
        problems,
      );
    }
  }

  if (problems.length > 0) {
    logError(`public-assets check failed:\n\n${problems.join('\n\n')}\n`);
    return { success: false, problems };
  }

  log('public-assets check passed.');
  return { success: true, problems: [] };
}
