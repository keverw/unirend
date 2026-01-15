/**
 * Unirend Starter Templates
 *
 * Programmatic API for creating new projects from templates.
 * This is the same functionality used by the CLI, but available as a library.
 *
 * NOTE: These starter template utility functions and the files they generate
 * are Bun-focused since they power the CLI (src/cli.ts), which targets Bun
 * for a simple, out-of-the-box experience. The generated package.json scripts
 * use Bun commands, and the SSR server build uses Bun.build() for bundling.
 *
 * The framework itself avoids Bun-specific APIs and supports both Bun and Node
 * runtimes when bundled. See "Runtime requirements" in README.md for rationale
 * and Node setup thoughts (out-of-the-box Node tooling is currently out of scope).
 */

import {
  STARTER_TEMPLATES,
  REPO_CONFIG_FILE,
  DEFAULT_REPO_NAME,
} from './lib/starter-templates/consts';
import type {
  TemplateInfo,
  RepoConfig,
  Logger,
  StarterTemplateOptions,
  InitRepoOptions,
  CreateProjectResult,
  RepoConfigResult,
  InitRepoResult,
} from './lib/starter-templates/types';
import {
  createRepoConfigObject,
  addProjectToRepo,
  ensureBaseFiles,
  getTemplateConfig,
  createProjectSpecificFiles,
} from './lib/starter-templates/internal-helpers';
import { validateName } from './lib/starter-templates/validate-name';
import type { FileRoot } from './lib/starter-templates/vfs';
import {
  vfsDisplayPath,
  vfsEnsureDir,
  vfsExists,
  vfsReadJSON,
  vfsWrite,
  vfsWriteJSON,
} from './lib/starter-templates/vfs';
import {
  initGitRepo,
  installDependencies,
  autoFormatCode,
} from './lib/starter-templates/repo-utils';
import { isRepoDirEmptyish } from './lib/starter-templates/internal-utils';

/**
 * Create a new project from a starter template
 * @returns Promise<CreateProjectResult> - Result object with success status and metadata
 */
export async function createProject(
  options: StarterTemplateOptions,
): Promise<CreateProjectResult> {
  const repoRootDisplay = vfsDisplayPath(options.repoRoot);

  // Default logger that does nothing if none provided
  const log: Logger = options.logger || (() => {});

  // Compute project path: src/apps/{projectName}
  const projectPath = `src/apps/${options.projectName}`;
  const projectPathDisplay = vfsDisplayPath(options.repoRoot, projectPath);

  // Get template-specific configuration (scripts, dependencies, devDependencies)
  const templateConfig = getTemplateConfig(
    options.projectName,
    options.templateID,
    projectPath,
    options.serverBuildTarget,
  );

  try {
    log('info', '🚀 Starting project creation...');
    log('info', `Template: ${options.templateID}`);
    log('info', `Project Name: ${options.projectName}`);
    log('info', `Repo Path: ${repoRootDisplay}`);
    log('info', `Project Path: ${projectPathDisplay}`);

    if (options.starterFiles && Object.keys(options.starterFiles).length > 0) {
      log(
        'info',
        `Custom starter files: ${Object.keys(options.starterFiles).length}`,
      );
    }

    // Validate project name
    const nameValidation = validateName(options.projectName);

    if (!nameValidation.valid) {
      log(
        'error',
        `❌ Invalid project name: ${nameValidation.error ?? 'Invalid name'}`,
      );
      log('info', '');
      log('info', 'Valid names must:');
      log('info', '  - Contain at least one alphanumeric character');
      log('info', '  - Not start or end with special characters');
      log('info', '  - Not contain invalid filesystem characters');
      log('info', '  - Not be reserved system names');

      return {
        success: false,
        error: nameValidation.error ?? 'Invalid project name',
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    // Validate template exists
    if (!templateExists(options.templateID)) {
      const available = listAvailableTemplates();

      log(
        'error',
        `❌ Template "${options.templateID}" not found. Available templates: ${available.join(', ')}`,
      );

      return {
        success: false,
        error: `Template "${options.templateID}" not found`,
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    // Check if project path already exists
    const doesProjectExist = await vfsExists(options.repoRoot, projectPath);

    if (doesProjectExist) {
      log(
        'error',
        `❌ Project directory already exists: ${projectPathDisplay}`,
      );
      log('info', '');
      log(
        'info',
        'Please choose a different project name or remove the existing directory.',
      );

      return {
        success: false,
        error: `Project directory already exists: ${projectPath}`,
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    // Repo root directory is the workspace root where projects live
    const configFullPathDisplay = vfsDisplayPath(
      options.repoRoot,
      REPO_CONFIG_FILE,
    );

    // Step 1: Read repository configuration (if present)
    let repoStatus = await readRepoConfig(options.repoRoot);

    if (repoStatus.status === 'parse_error') {
      log(
        'error',
        `❌ Found ${configFullPathDisplay} but it contains invalid JSON`,
      );

      if (repoStatus.errorMessage) {
        log('error', `   ${repoStatus.errorMessage}`);
      }

      log('info', '');
      log(
        'info',
        'Please fix the JSON syntax or delete the file to start fresh.',
      );

      return {
        success: false,
        error: `${REPO_CONFIG_FILE} contains invalid JSON`,
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    } else if (repoStatus.status === 'read_error') {
      log('error', `❌ Found ${configFullPathDisplay} but cannot read it`);

      if (repoStatus.errorMessage) {
        log('error', `   ${repoStatus.errorMessage}`);
      }

      return {
        success: false,
        error: `Cannot read ${REPO_CONFIG_FILE}`,
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    } else if (repoStatus.status === 'not_found') {
      // Auto-initialize repo if missing to keep flow simple
      // (initRepo will perform safety checks on its own)
      const repoName = DEFAULT_REPO_NAME;
      log(
        'info',
        `📦 No repository found, auto-initializing as "${repoName}"...`,
      );
      log('info', '');

      // Skip git init, dependency installation, and auto-format here.
      // createProject will handle these in Steps 5, 7, and 8
      const initResult = await initRepo(options.repoRoot, {
        name: repoName,
        logger: log,
        initGit: false,
        installDependencies: false,
        autoFormat: false,
      });

      if (initResult.success) {
        repoStatus = { status: 'found', config: initResult.config };
      } else {
        log('error', '❌ Failed to initialize repository configuration');

        if (initResult.errorMessage) {
          log('error', `   ${initResult.errorMessage}`);
        }

        return {
          success: false,
          error: 'Failed to initialize repository configuration',
          metadata: {
            templateID: options.templateID,
            projectName: options.projectName,
            repoPath: repoRootDisplay,
          },
        };
      }
    } else if (repoStatus.status !== 'found') {
      log('error', '❌ Unsupported repository status returned');

      return {
        success: false,
        error: 'Unsupported repository status returned',
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    const result: CreateProjectResult = {
      success: true,
      metadata: {
        templateID: options.templateID,
        projectName: options.projectName,
        repoPath: repoRootDisplay,
      },
    };

    // Step 2: Update repo config to add project entry
    try {
      if (repoStatus.status === 'found') {
        const updated = addProjectToRepo(
          repoStatus.config,
          options.projectName,
          options.templateID,
          projectPath,
        );

        await vfsWriteJSON(options.repoRoot, REPO_CONFIG_FILE, updated);

        log('info', `📝 Updated ${REPO_CONFIG_FILE}`);
      }
    } catch (error) {
      log(
        'error',
        `❌ Failed to update ${REPO_CONFIG_FILE}, Aborting project creation`,
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage) {
        log('error', `   ${errorMessage}`);
      }

      return {
        success: false,
        error: `Failed to update ${REPO_CONFIG_FILE}`,
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    // Step 3: Ensure base workspace files (root package.json, etc.)
    try {
      await ensureBaseFiles(
        options.repoRoot,
        repoStatus.status === 'found'
          ? repoStatus.config.name
          : DEFAULT_REPO_NAME,
        {
          log,
          templateScripts: templateConfig.scripts,
          templateDependencies: templateConfig.dependencies,
          templateDevDependencies: templateConfig.devDependencies,
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log('error', '❌ Failed to ensure base files, aborting project creation');

      if (errorMessage) {
        log('error', `   ${errorMessage}`);
      }

      return {
        success: false,
        error: 'Failed to ensure base files',
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    // Step 4: Write provided starter files
    if (options.starterFiles && Object.keys(options.starterFiles).length > 0) {
      try {
        log(
          'info',
          `📄 Writing ${Object.keys(options.starterFiles).length} starter files`,
        );

        for (const [relPath, content] of Object.entries(options.starterFiles)) {
          await vfsWrite(options.repoRoot, relPath, content);
          log('info', `   ${vfsDisplayPath(options.repoRoot, relPath)}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        log('error', '❌ Failed to write starter files');

        if (errorMessage) {
          log('error', `   ${errorMessage}`);
        }

        return {
          success: false,
          error: 'Failed to write starter files',
          metadata: {
            templateID: options.templateID,
            projectName: options.projectName,
            repoPath: repoRootDisplay,
          },
        };
      }
    }

    // Step 5: Initialize git repository (optional, default: true)
    if (options.initGit !== false) {
      await initGitRepo(options.repoRoot, log);
    }

    // Step 6: Create project-specific files from template
    try {
      await createProjectSpecificFiles(
        options.repoRoot,
        projectPath,
        options.projectName,
        options.templateID,
        options.serverBuildTarget,
        log,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      log(
        'error',
        '❌ Failed to create project-specific files, aborting project creation',
      );

      if (errorMessage) {
        log('error', `   ${errorMessage}`);
      }

      return {
        success: false,
        error: 'Failed to create project-specific files',
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    // Step 7: Install dependencies (optional, default: true)
    if (options.installDependencies !== false) {
      await installDependencies(options.repoRoot, log);
    }

    // Step 8: Auto-format code (optional, default: true)
    // Runs independently - checks if prettier is installed before formatting
    if (options.autoFormat !== false) {
      await autoFormatCode(options.repoRoot, log);
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `❌ Failed to create project: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
      metadata: {
        templateID: options.templateID,
        projectName: options.projectName,
        repoPath: repoRootDisplay,
      },
    };
  }
}

/**
 * Check if a template exists in the registry
 */
export function templateExists(templateID: string): boolean {
  return templateID in STARTER_TEMPLATES;
}

/**
 * Get list of available starter template IDs
 */
export function listAvailableTemplates(): string[] {
  return Object.keys(STARTER_TEMPLATES);
}

/**
 * Get template information by ID
 */
export function getTemplateInfo(templateID: string): TemplateInfo | undefined {
  return STARTER_TEMPLATES[templateID] as TemplateInfo | undefined;
}

/**
 * Get available template IDs with info objects
 */
export function listAvailableTemplatesWithInfo(): TemplateInfo[] {
  return Object.values(STARTER_TEMPLATES) as TemplateInfo[];
}

/**
 * Read repository configuration from a directory
 * Returns an object with status and config
 * - found: true, config: RepoConfig - Successfully read and parsed
 * - found: false - Config file doesn't exist
 * - found: false, error: "parse_error" - Config file exists but has invalid JSON
 * - found: false, error: "read_error" - Config file exists but can't be read
 */
export async function readRepoConfig(
  dirPath: FileRoot,
): Promise<RepoConfigResult> {
  const result = await vfsReadJSON<RepoConfig>(dirPath, REPO_CONFIG_FILE);

  if (!result.ok) {
    if (result.code === 'ENOENT') {
      return { status: 'not_found' };
    } else if (result.code === 'PARSE_ERROR') {
      return { status: 'parse_error', errorMessage: result.message };
    } else {
      return { status: 'read_error', errorMessage: result.message };
    }
  }

  return { status: 'found', config: result.data };
}

export async function initRepo(
  dirPath: FileRoot,
  options: InitRepoOptions = {},
): Promise<InitRepoResult> {
  // Default logger that does nothing if none provided
  const log: Logger = options.logger || (() => {});
  const repoRootDisplay = vfsDisplayPath(dirPath);

  log('info', '🏗️  Initializing repository...');
  log('info', `Repo Path: ${repoRootDisplay}`);

  // Check for existing or problematic config first
  const existing = await readRepoConfig(dirPath);

  if (existing.status === 'found') {
    log('error', `❌ Repository already initialized at ${repoRootDisplay}`);
    return { success: false, error: 'already_exists' };
  } else if (existing.status === 'parse_error') {
    log('error', `❌ Found ${REPO_CONFIG_FILE} but it contains invalid JSON`);

    if (existing.errorMessage) {
      log('error', `   ${existing.errorMessage}`);
    }

    log('info', '');
    log(
      'info',
      'Please fix the JSON syntax or delete the file to start fresh.',
    );

    return {
      success: false,
      error: 'parse_error',
      errorMessage: existing.errorMessage,
    };
  } else if (existing.status === 'read_error') {
    log('error', `❌ Found ${REPO_CONFIG_FILE} but cannot read it`);

    if (existing.errorMessage) {
      log('error', `   ${existing.errorMessage}`);
    }

    return {
      success: false,
      error: 'read_error',
      errorMessage: existing.errorMessage,
    };
  } else if (existing.status !== 'not_found') {
    // Guard for any future status values we don't explicitly handle yet
    const statusValue = (existing as Record<string, unknown>).status;
    const statusString =
      typeof statusValue === 'string' || typeof statusValue === 'number'
        ? String(statusValue)
        : 'unknown';

    log('error', `❌ Unsupported repository status: ${statusString}`);
    return {
      success: false,
      error: 'unsupported_status',
      errorMessage: `Unsupported repo status: ${statusString}`,
    };
  }

  // Check if directory is empty or empty-ish (only .git/.gitignore)
  const emptyCheck = await isRepoDirEmptyish(dirPath);

  if (!emptyCheck.safe) {
    log('error', '❌ Cannot initialize repository in this directory');
    log('error', `   ${emptyCheck.reason}`);
    log('info', '');
    log(
      'info',
      'Please use an empty directory or a directory with only .git/.gitignore.',
    );

    return {
      success: false,
      error: 'unsafe_directory',
      errorMessage: emptyCheck.reason,
    };
  }

  const repoName = options.name || DEFAULT_REPO_NAME;
  log('info', `Repo Name: ${repoName}`);

  const validation = validateName(repoName);

  if (!validation.valid) {
    log(
      'error',
      `❌ Invalid repository name: ${validation.error ?? 'Invalid name'}`,
    );
    log('info', '');
    log('info', 'Valid names must:');
    log('info', '  - Contain at least one alphanumeric character');
    log('info', '  - Not start or end with special characters');
    log('info', '  - Not contain invalid filesystem characters');
    log('info', '  - Not be reserved system names');

    return {
      success: false,
      error: 'invalid_name',
      errorMessage: validation.error,
    };
  }

  const config = createRepoConfigObject(repoName);

  try {
    // Ensure target directory exists (noop for in-memory)
    await vfsEnsureDir(dirPath);

    // Write repo config file
    await vfsWriteJSON(dirPath, REPO_CONFIG_FILE, config);
    log('info', `🛠️  Created ${REPO_CONFIG_FILE}`);

    // Ensure base files exist (package.json, tsconfig.json, .editorconfig, etc.)
    try {
      await ensureBaseFiles(dirPath, repoName, { log });
      log('info', '✅ Repository initialized successfully');
    } catch (error) {
      // Log warning but don't fail - createProject will retry
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      log(
        'warning',
        '⚠️  Failed to create some base files (will retry when creating first project)',
      );

      if (errorMessage) {
        log('warning', `   ${errorMessage}`);
      }
    }

    // Initialize git repository (optional, default: true)
    if (options.initGit !== false) {
      await initGitRepo(dirPath, log);
    }

    // Install dependencies (optional, default: true)
    if (options.installDependencies !== false) {
      await installDependencies(dirPath, log);
    }

    // Auto-format code (optional, default: true)
    // Runs independently - checks if prettier is installed before formatting
    if (options.autoFormat !== false) {
      await autoFormatCode(dirPath, log);
    }

    // Return success result
    return { success: true, config };
  } catch (error) {
    // Return error result
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to write file';
    log('error', `❌ Failed to initialize repository: ${errorMessage}`);

    return {
      success: false,
      error: 'write_error',
      errorMessage,
    };
  }
}

// Re-export constants for public API consumers
export {
  STARTER_TEMPLATES,
  REPO_CONFIG_FILE,
  DEFAULT_REPO_NAME,
} from './lib/starter-templates/consts';

// Re-export types for public API consumers
export type {
  TemplateInfo,
  ProjectEntry,
  RepoConfig,
  Logger,
  LogLevel,
  ServerBuildTarget,
  StarterTemplateOptions,
  InitRepoOptions,
  NameValidationResult,
  CreateProjectResult,
  RepoConfigResult,
  InitRepoResult,
} from './lib/starter-templates/types';

export type {
  InMemoryDir,
  FileRoot,
  FileContent,
} from './lib/starter-templates/vfs';

// Re-export validation function
export { validateName } from './lib/starter-templates/validate-name';
