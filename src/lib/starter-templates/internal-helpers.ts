/* eslint-disable @typescript-eslint/no-unused-vars */
// todo: reenable @typescript-eslint/no-unused-vars once getTemplateConfig and
// createProjectSpecificFiles bodies are filled in (serverBuildTarget and the
// getTemplateConfig params are not yet read by every branch).
import { ensurePackageJSON } from './base-files/package-json';
import type {
  EnsurePackageJSONOptions,
  RootPackageJSONState,
} from './base-files/package-json';
import { ensureGitignore } from './base-files/ensure-gitignore';
import { ensureGitkeep } from './base-files/ensure-gitkeep';
import { ensureTsConfig } from './base-files/ensure-tsconfig';
import { ensureEditorConfig } from './base-files/ensure-editor-config';
import { ensurePrettierConfig } from './base-files/ensure-prettier-config';
import { ensurePrettierIgnore } from './base-files/ensure-prettier-ignore';
import { ensureEslintConfig } from './base-files/ensure-eslint-config';
import { ensureVSCodeExtensions } from './base-files/ensure-vscode-extensions';
import { ensureVSCodeSettings } from './base-files/ensure-vscode-settings';
import { ensureAgentsMD } from './base-files/ensure-agents-md';
import { ensureCspell } from './base-files/ensure-cspell';
import { ensureCleanCspell } from './base-files/ensure-clean-cspell';
import type { RepoConfig, ServerBuildTarget, LoggerFunction } from './types';
import type { TemplateID } from './consts';
import type { FileRoot } from './vfs';
import {
  APPS_GIT_KEEP_FILE_SRC,
  LIBS_GIT_KEEP_FILE_SRC,
  SCRIPTS_GIT_KEEP_FILE_SRC,
} from './base-files/gitkeep-files-src';
import { ensureViteEnv } from './templates-shared/ensure-vite-env';
import { ensureViteConfig } from './templates-shared/vite-config';
import { ensureAppTsConfig } from './templates-shared/app-tsconfig';
import { ensureAppPrettierConfig } from './templates-shared/app-prettier-config';
import { ensureAppIndexHTML } from './templates-shared/app-index-html';
import { ensureAppConsts } from './templates-shared/app-consts';
import { ensureGenerateBuildInfo } from './templates-shared/generate-build-info';
import { ensureBuildInfoOutput } from './templates-shared/build-info-config';

export function createRepoConfigObject(name: string): RepoConfig {
  return {
    version: '1.0',
    name,
    created: new Date().toISOString(),
    projects: {},
  };
}

export function addProjectToRepo(
  config: RepoConfig,
  projectName: string,
  templateID: TemplateID,
  relativePath: string,
): RepoConfig {
  return {
    ...config,
    projects: {
      ...config.projects,
      [projectName]: {
        templateID,
        path: relativePath,
        createdAt: new Date().toISOString(),
      },
    },
  };
}

/**
 * Options for ensureBaseFiles function
 * Inherits package.json options, plus template-specific ignore entries:
 * - log: Logger function
 * - templateScripts: Template-specific scripts
 * - templateDependencies: Template-specific dependencies
 * - templateDevDependencies: Template-specific devDependencies
 * - templateGitignoreSectionHeader: Header for template-specific .gitignore entries
 * - templateGitignoreEntries: Template-specific .gitignore entries
 * - templatePrettierignoreSectionHeader: Header for template-specific .prettierignore entries
 * - templatePrettierignoreEntries: Template-specific .prettierignore entries
 */
export type EnsureBaseFilesOptions = EnsurePackageJSONOptions & {
  /** Header for template-specific .gitignore entries */
  templateGitignoreSectionHeader?: string;
  /** Template-specific .gitignore entries to append if missing */
  templateGitignoreEntries?: string[];
  /** Header for template-specific .prettierignore entries */
  templatePrettierignoreSectionHeader?: string;
  /** Template-specific .prettierignore entries to append if missing */
  templatePrettierignoreEntries?: string[];
  /** Template-specific cspell words to append/merge */
  templateCspellWords?: string[];
};

/** Result of {@link ensureBaseFiles}. */
export interface EnsureBaseFilesResult {
  /**
   * The resulting root package.json state after ensuring it (always `found`).
   * Returned so callers can thread it onward — e.g. a follow-up
   * `ensureBaseFiles`/`ensurePackageJSON` call — without re-reading the file.
   */
  packageJSON: RootPackageJSONState;
}

/**
 * Ensure base repo files exist at the workspace root.
 * Creates standard configuration files (.gitignore, package.json, tsconfig.json, .editorconfig, prettier.config.js, etc.)
 * Most files are only created if missing; configuration files like package.json, cspell.json, VS Code settings, .gitignore, and .prettierignore are updated/merged to ensure recommended setups exist.
 *
 * Like {@link ensurePackageJSON}, this does not read package.json itself — the
 * caller passes the already-read `packageJSONState` (read once up front via
 * `readRootPackageJSON`) and it's threaded down to `ensurePackageJSON`.
 *
 * @param packageJSONState - The pre-read package.json state to ensure from.
 * @returns The resulting base-file state (currently just the package.json
 *   state) so callers can thread it onward without re-reading.
 * @throws {Error} If any file creation/update fails
 */
export async function ensureBaseFiles(
  repoRoot: FileRoot,
  repoName: string,
  packageJSONState: RootPackageJSONState,
  options?: EnsureBaseFilesOptions,
): Promise<EnsureBaseFilesResult> {
  // Each separate helper function will throw on error, allowing errors to propagate to the caller

  // Ensure .gitignore exists (creates or updates with missing template entries)
  await ensureGitignore(repoRoot, {
    log: options?.log,
    templateSectionHeader: options?.templateGitignoreSectionHeader,
    templateEntries: options?.templateGitignoreEntries,
  });

  // Ensure standard directories have .gitkeep if empty (scripts, src/apps and src/libs)
  await ensureGitkeep(
    repoRoot,
    'scripts',
    SCRIPTS_GIT_KEEP_FILE_SRC,
    options?.log,
  );

  await ensureGitkeep(
    repoRoot,
    'src/apps',
    APPS_GIT_KEEP_FILE_SRC,
    options?.log,
  );

  await ensureGitkeep(
    repoRoot,
    'src/libs',
    LIBS_GIT_KEEP_FILE_SRC,
    options?.log,
  );

  // Ensure package.json exists with required fields. Capture the resulting
  // state so it can be threaded back to the caller (avoids a re-read when the
  // caller needs the post-ensure package.json, e.g. createProject's auto-init).
  const packageJSON = await ensurePackageJSON(
    repoRoot,
    repoName,
    packageJSONState,
    options,
  );

  // Ensure tsconfig.json exists (only creates if missing)
  await ensureTsConfig(repoRoot, options?.log);

  // Ensure .editorconfig exists (only creates if missing)
  await ensureEditorConfig(repoRoot, options?.log);

  // Ensure prettier.config.js exists (only creates if missing)
  await ensurePrettierConfig(repoRoot, options?.log);

  // Ensure .prettierignore exists (creates or updates with missing template entries)
  await ensurePrettierIgnore(repoRoot, {
    log: options?.log,
    templateSectionHeader: options?.templatePrettierignoreSectionHeader,
    templateEntries: options?.templatePrettierignoreEntries,
  });

  // Ensure eslint.config.js exists (only creates if missing)
  await ensureEslintConfig(repoRoot, options?.log);

  // Ensure cspell.json exists (creates or updates with missing words/settings)
  await ensureCspell(repoRoot, {
    log: options?.log,
    templateCspellWords: options?.templateCspellWords,
  });

  // Ensure scripts/clean-cspell.ts exists (only creates if missing)
  await ensureCleanCspell(repoRoot, options?.log);

  // Ensure .vscode/extensions.json exists (creates or updates with missing extensions)
  await ensureVSCodeExtensions(repoRoot, options?.log);

  // Ensure .vscode/settings.json exists (creates or updates with missing settings)
  await ensureVSCodeSettings(repoRoot, options?.log);

  // Ensure AGENTS.md exists (only creates if missing)
  await ensureAgentsMD(repoRoot, options?.log);

  // Return the resulting package.json state so callers can thread it onward
  // without re-reading the file.
  return { packageJSON };
}

/**
 * Template-specific configuration returned by getTemplateConfig
 */
export interface TemplateConfig {
  /**
   * Project-specific package.json scripts — the ones tied to this app's name
   * (e.g. `<app>:build`, `<app>:dev`, `<app>:serve`). These are expected to be
   * unique per project, so `createProject` treats a collision with an existing
   * root script as a hard error and aborts before writing anything.
   */
  projectScripts?: Record<string, string>;
  /**
   * Generic scripts that may legitimately be shared across multiple apps in
   * the same repo (e.g. `generate:build-info`, which a single script services
   * for every app). These are merged with the existing scripts only when
   * absent — an existing definition wins and the template's copy is skipped
   * silently, so re-running for a second app doesn't conflict.
   */
  sharedScripts?: Record<string, string>;
  /** Template-specific dependencies */
  dependencies?: Record<string, string>;
  /** Template-specific devDependencies */
  devDependencies?: Record<string, string>;
  /** Template-specific .gitignore entries */
  gitignoreEntries?: string[];
  /** Header for template-specific .gitignore entries */
  gitignoreSectionHeader?: string;
  /** Template-specific .prettierignore entries */
  prettierignoreEntries?: string[];
  /** Header for template-specific .prettierignore entries */
  prettierignoreSectionHeader?: string;
  /** Template-specific cspell words to merge */
  cspellWords?: string[];
}

/**
 * Get template-specific configuration (scripts, dependencies, devDependencies)
 * based on the template type, project name, and project path.
 *
 * @param projectName - Name of the project being created
 * @param templateID - Template identifier (e.g., "basic-ssr", "basic-ssg")
 * @param projectPath - Relative path to the project (e.g., "src/apps/my-project")
 * @param serverBuildTarget - Target runtime for server build/bundle
 * @returns Template configuration object with optional scripts/deps
 */
export function getTemplateConfig(
  projectName: string,
  templateID: TemplateID,
  projectPath: string,
  serverBuildTarget: ServerBuildTarget,
): TemplateConfig {
  if (templateID === 'ssg') {
    // TODO: populate SSG config — projectScripts (app-named, collision = hard
    // error) and sharedScripts (generic, reusable across apps), dependencies,
    // devDependencies, gitignoreEntries + section header, prettierignoreEntries
    // + section header, cspellWords. See raw-src-files/package.json and
    // raw-src-files/readme.md for the populated shape to mirror.
    // `serverBuildTarget` matters here too: SSG ships a `serve.ts`
    // static-file server (useful for previewing the generated output and
    // for demos), and the bundle/runner choice for that script follows
    // the same pattern as SSR/API (`bun build --target=<bun|node>` +
    // `bun`-vs-`node` invocation against the built output).
    return {};
  } else if (templateID === 'ssr') {
    // TODO: populate SSR config — same fields as SSG (projectScripts vs
    // sharedScripts split included), plus scripts must honor
    // `serverBuildTarget`. In practice that means two things:
    //   1. the `bun build --target=<bun|node>` flag used to bundle the
    //      server entries (serve-built.ts and the HMR variant), and
    //   2. whether the run/serve scripts invoke `bun` or `node` against
    //      the built output.
    // The dev variant in particular is affected by the Bun HMR
    // graceful-shutdown bug — see the "Bun HMR graceful shutdown
    // workaround" section in raw-src-files/readme.md for which
    // `ssr:serve:dev` variant to emit per target.
    // gitignore/prettierignore entries should include
    // `src/apps/<projectName>/current-build-info.ts`.
    //
    // TODO: populate the app-specific `projectScripts` (the `<app>:build`,
    // `<app>:serve`, … entries) and the dependencies/cspell fields.
    return {
      // Generic build-info generator, shared by every server template (SSR,
      // API). Added only when absent (see `mergeScripts`) so a second app
      // doesn't conflict. The single `scripts/generate-build-info.ts` it runs
      // reads `build-info.config.json`, which each app appends its output to.
      sharedScripts: {
        'generate:build-info': 'bun run scripts/generate-build-info.ts',
      },
      // The generated build-info file is ignored by git and prettier (it's
      // produced by `generate:build-info`, not committed). Section header is
      // left default (`# Template-specific`).
      gitignoreEntries: [`${projectPath}/current-build-info.ts`],
      prettierignoreEntries: [`${projectPath}/current-build-info.ts`],
    };
  } else if (templateID === 'api') {
    // TODO: populate API config. `serverBuildTarget` applies here for the
    // same reasons as SSR (bun build target flag + node vs bun runner for
    // the built output), minus the Bun HMR concern since the API server
    // doesn't run a Vite dev server. gitignore/prettierignore entries
    // should include `src/apps/<projectName>/current-build-info.ts`.
    //
    // TODO: populate the app-specific `projectScripts` (the `<app>:build`,
    // `<app>:serve`, … entries) and the dependencies/cspell fields.
    return {
      // Generic build-info generator, shared by every server template (SSR,
      // API). See the SSR branch above for the rationale.
      sharedScripts: {
        'generate:build-info': 'bun run scripts/generate-build-info.ts',
      },
      // The generated build-info file is ignored by git and prettier (it's
      // produced by `generate:build-info`, not committed). Section header is
      // left default (`# Template-specific`).
      gitignoreEntries: [`${projectPath}/current-build-info.ts`],
      prettierignoreEntries: [`${projectPath}/current-build-info.ts`],
    };
  } else {
    // Compile-time exhaustiveness — TS errors here if a new TemplateID is
    // added without a matching branch above. JS callers can still land
    // here at runtime, so cast for the error message.
    const _exhaustive: never = templateID;
    throw new Error(`Unknown template: ${templateID as string}`);
  }
}

/**
 * Create project-specific files and directory structure based on template identifier.
 * Writes all template-specific starter files to the project directory.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g., "src/apps/my-project")
 * @param projectName - Name of the project being created
 * @param templateID - Template identifier (e.g., "ssg", "ssr", "api")
 * @param serverBuildTarget - Target runtime for server build/bundle
 * @param log - Optional logger function for output
 */

export async function createProjectSpecificFiles(
  root: FileRoot,
  projectPath: string,
  projectName: string,
  templateID: TemplateID,
  serverBuildTarget: ServerBuildTarget,
  log?: LoggerFunction,
): Promise<void> {
  if (templateID === 'ssg') {
    // TODO: emit SSG files — EntryClient.tsx, EntrySSG.tsx, Routes.tsx,
    // generate-ssg.ts, components/, pages/, public/,
    // index.css.
    // See raw-src-files/src/apps/ssg/** for the reference source.

    // Shared across all Vite-based templates (SSG, SSR).
    await ensureViteEnv(root, projectPath, log);
    await ensureViteConfig(root, projectPath, projectName, log);
    await ensureAppTsConfig(root, projectPath, log);
    await ensureAppPrettierConfig(root, projectPath, log);
    await ensureAppIndexHTML(root, projectPath, projectName, log);
    await ensureAppConsts(root, projectPath, 'ssg', projectName, log);
  } else if (templateID === 'ssr') {
    // TODO: emit SSR files — EntryClient.tsx, EntrySSR.tsx, Routes.tsx,
    // serve-built.ts, serve-hmr.ts, server/start.ts,
    // server/ssr-component.ts, server/plugins/**,
    // components/, pages/, public/,
    // index.css.
    // See raw-src-files/src/apps/ssr/** for reference source.
    // `serverBuildTarget` affects the build scripts and runner choice —
    // see the SSR branch of `getTemplateConfig` above for what it
    // controls in practice.

    // Shared across all Vite-based templates (SSG, SSR).
    await ensureViteEnv(root, projectPath, log);
    await ensureViteConfig(root, projectPath, projectName, log);
    await ensureAppTsConfig(root, projectPath, log);
    await ensureAppPrettierConfig(root, projectPath, log);
    await ensureAppIndexHTML(root, projectPath, projectName, log);
    await ensureAppConsts(root, projectPath, 'ssr', projectName, log);

    // Shared across server templates (SSR, API): the build-info generator
    // script plus this app's entry in build-info.config.json. The generated
    // current-build-info.ts itself is produced by running the script — it
    // captures the repo's version and git state (hash/branch) at build time,
    // so it's a gitignored, per-build artifact rather than something
    // scaffolded here.
    await ensureGenerateBuildInfo(root, log);
    await ensureBuildInfoOutput(
      root,
      `${projectPath}/current-build-info.ts`,
      log,
    );
  } else if (templateID === 'api') {
    // TODO: emit API files — api-component.ts, serve.ts.
    // See raw-src-files/src/apps/api/** for the reference source.

    // Shared across server templates (SSR, API): the build-info generator
    // script plus this app's entry in build-info.config.json. The generated
    // current-build-info.ts itself is produced by running the script — it
    // captures the repo's version and git state (hash/branch) at build time,
    // so it's a gitignored, per-build artifact rather than something
    // scaffolded here.
    await ensureGenerateBuildInfo(root, log);
    await ensureBuildInfoOutput(
      root,
      `${projectPath}/current-build-info.ts`,
      log,
    );
  } else {
    // Compile-time exhaustiveness — TS errors here if a new TemplateID is
    // added without a matching branch above. JS callers can still land
    // here at runtime, so cast for the error message.
    const _exhaustive: never = templateID;
    throw new Error(`Unknown template: ${templateID as string}`);
  }
}
