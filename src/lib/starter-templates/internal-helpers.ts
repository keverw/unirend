import {
  ensurePackageJSON,
  type EnsurePackageJSONOptions,
} from './base-files/package-json';
import { ensureGitignore } from './base-files/ensure-gitignore';
import { ensureTsConfig } from './base-files/ensure-tsconfig';
import { ensureEditorConfig } from './base-files/ensure-editor-config';
import { ensurePrettierConfig } from './base-files/ensure-prettier-config';
import { ensurePrettierIgnore } from './base-files/ensure-prettier-ignore';
import { ensureEslintConfig } from './base-files/ensure-eslint-config';
import { ensureVSCodeExtensions } from './base-files/ensure-vscode-extensions';
import { ensureVSCodeSettings } from './base-files/ensure-vscode-settings';
import type { RepoConfig, ServerBuildTarget, Logger } from './types';
import { type FileRoot } from './vfs';

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
  templateID: string,
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
 * Currently inherits all options from EnsurePackageJSONOptions:
 * - log: Logger function
 * - templateScripts: Template-specific scripts
 * - templateDependencies: Template-specific dependencies
 * - templateDevDependencies: Template-specific devDependencies
 */
export type EnsureBaseFilesOptions = EnsurePackageJSONOptions;

/**
 * Ensure base repo files exist at the workspace root.
 * Creates standard configuration files (.gitignore, package.json, tsconfig.json, .editorconfig, prettier.config.js, etc.)
 * Most files are only created if missing, package.json is updated to ensure required fields exist.
 *
 * @throws {Error} If any file creation/update fails
 */
export async function ensureBaseFiles(
  repoRoot: FileRoot,
  repoName: string,
  options?: EnsureBaseFilesOptions,
): Promise<void> {
  // Each separate helper function will throw on error, allowing errors to propagate to the caller

  // Ensure .gitignore exists first (only creates if missing)
  await ensureGitignore(repoRoot, options?.log);

  // Ensure package.json exists with required fields
  await ensurePackageJSON(repoRoot, repoName, options);

  // Ensure tsconfig.json exists (only creates if missing)
  await ensureTsConfig(repoRoot, options?.log);

  // Ensure .editorconfig exists (only creates if missing)
  await ensureEditorConfig(repoRoot, options?.log);

  // Ensure prettier.config.js exists (only creates if missing)
  await ensurePrettierConfig(repoRoot, options?.log);

  // Ensure .prettierignore exists (only creates if missing)
  await ensurePrettierIgnore(repoRoot, options?.log);

  // Ensure eslint.config.js exists (only creates if missing)
  await ensureEslintConfig(repoRoot, options?.log);

  // Ensure .vscode/extensions.json exists (creates or updates with missing extensions)
  await ensureVSCodeExtensions(repoRoot, options?.log);

  // Ensure .vscode/settings.json exists (creates or updates with missing settings)
  await ensureVSCodeSettings(repoRoot, options?.log);
}

/**
 * Template-specific configuration returned by getTemplateConfig
 */
export interface TemplateConfig {
  /** Template-specific package.json scripts */
  scripts?: Record<string, string>;
  /** Template-specific dependencies */
  dependencies?: Record<string, string>;
  /** Template-specific devDependencies */
  devDependencies?: Record<string, string>;
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
  templateID: string,
  projectPath: string,
  serverBuildTarget?: ServerBuildTarget,
): TemplateConfig {

  return {};
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
// eslint-disable-next-line @typescript-eslint/require-await
export async function createProjectSpecificFiles(
  root: FileRoot,
  projectPath: string,
  projectName: string,
  templateID: string,
  serverBuildTarget: ServerBuildTarget | undefined,
  log?: Logger,
): Promise<void> {
}
