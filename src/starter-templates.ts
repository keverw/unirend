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
  TEMPLATE_IDS,
  REPO_CONFIG_FILE,
  DEFAULT_REPO_NAME,
} from './lib/starter-templates/consts';
import type { TemplateID } from './lib/starter-templates/consts';
import type {
  TemplateInfo,
  RepoConfig,
  LoggerFunction,
  StarterTemplateOptions,
  InitRepoOptions,
  CreateProjectResult,
  RepoConfigResult,
  RepoConfigState,
  InitRepoResult,
  InitRepoSuccess,
  InitRepoFailure,
} from './lib/starter-templates/types';
import {
  createRepoConfigObject,
  addProjectToRepo,
  ensureBaseFiles,
  getTemplateConfig,
  createProjectSpecificFiles,
} from './lib/starter-templates/internal-helpers';
import {
  readRootPackageJSON,
  findScriptConflicts,
} from './lib/starter-templates/base-files/package-json';
import type { RootPackageJSONState } from './lib/starter-templates/base-files/package-json';
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

const STARTER_FILE_BASES = ['repoRoot', 'projectRoot'] as const;

function countStarterFiles(
  starterFiles: StarterTemplateOptions['starterFiles'],
): number {
  return STARTER_FILE_BASES.reduce(
    (count, base) => count + Object.keys(starterFiles?.[base] ?? {}).length,
    0,
  );
}

function getUnknownStarterFileBases(
  starterFiles: StarterTemplateOptions['starterFiles'],
): string[] {
  if (!starterFiles) {
    return [];
  }

  return Object.keys(starterFiles).filter(
    (key) =>
      !STARTER_FILE_BASES.includes(key as (typeof STARTER_FILE_BASES)[number]),
  );
}

/**
 * Create a new project from a starter template
 * @returns Promise<CreateProjectResult> - Result object with success status and metadata
 */
export async function createProject(
  options: StarterTemplateOptions,
): Promise<CreateProjectResult> {
  const repoRootDisplay = vfsDisplayPath(options.repoRoot);

  // Default logger that does nothing if none provided
  const log: LoggerFunction = options.logger || (() => {});

  // Compute project path: src/apps/{projectName}
  const projectPath = `src/apps/${options.projectName}`;
  const projectPathDisplay = vfsDisplayPath(options.repoRoot, projectPath);
  const starterFileCount = countStarterFiles(options.starterFiles);

  try {
    log('info', '🚀 Starting project creation...');
    log('info', `Template: ${options.templateID}`);
    log('info', `Project Name: ${options.projectName}`);
    log('info', `Repo Path: ${repoRootDisplay}`);
    log('info', `Project Path: ${projectPathDisplay}`);

    if (starterFileCount > 0) {
      log('info', `Custom starter files: ${starterFileCount}`);
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
      log(
        'info',
        '  - Use kebab-case: lowercase letters, numbers, and hyphens',
      );
      log('info', '  - Start with a lowercase letter');
      log('info', '  - End with a lowercase letter or number');
      log('info', '  - Not contain consecutive hyphens');
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
      // TS narrows `options.templateID` to `never` here (the negated branch
      // of a TemplateID type guard), but a JS caller can absolutely land
      // here with a garbage string — read the value as `string` for the
      // error path so we can echo it back to the caller.
      const invalidTemplateID = options.templateID as string;
      const available = listAvailableTemplates();

      log(
        'error',
        `❌ Template "${invalidTemplateID}" not found. Available templates: ${available.join(', ')}`,
      );

      return {
        success: false,
        error: `Template "${invalidTemplateID}" not found`,
        metadata: {
          templateID: invalidTemplateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    const unknownStarterFileBases = getUnknownStarterFileBases(
      options.starterFiles,
    );

    if (unknownStarterFileBases.length > 0) {
      return {
        success: false,
        error: `Unknown starterFiles base(s): ${unknownStarterFileBases.join(', ')}`,
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    // Get template-specific configuration (scripts, dependencies, devDependencies)
    const templateConfig = getTemplateConfig(
      options.projectName,
      options.templateID,
      projectPath,
      options.serverBuildTarget,
    );

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

    // Read the root package.json once, up front. This serves two purposes:
    //   1. Detect script-name collisions before writing anything, so we can
    //      fail early with a clear message instead of silently dropping the
    //      template's intended command.
    //   2. Thread the parsed contents into `ensureBaseFiles`/`ensurePackageJSON`
    //      so package.json isn't read twice.
    // Invalid/unreadable JSON is handled here (moved up from ensurePackageJSON)
    // so the early-exit happens before any files are created.
    const packageJSONPathDisplay = vfsDisplayPath(
      options.repoRoot,
      'package.json',
    );

    const rootPkgStatus = await readRootPackageJSON(options.repoRoot);

    if (rootPkgStatus.status === 'parse_error') {
      log(
        'error',
        `❌ Found ${packageJSONPathDisplay} but it contains invalid JSON`,
      );

      if (rootPkgStatus.errorMessage) {
        log('error', `   ${rootPkgStatus.errorMessage}`);
      }

      log('info', '');
      log(
        'info',
        'Please fix the JSON syntax or delete the file to start fresh.',
      );

      return {
        success: false,
        error: 'Root package.json contains invalid JSON',
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    } else if (rootPkgStatus.status === 'read_error') {
      log('error', `❌ Found ${packageJSONPathDisplay} but cannot read it`);

      if (rootPkgStatus.errorMessage) {
        log('error', `   ${rootPkgStatus.errorMessage}`);
      }

      return {
        success: false,
        error: 'Cannot read root package.json',
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    }

    // Combine the template's project-specific and shared scripts for merging.
    // Project-specific scripts go last so they take precedence if a key ever
    // overlaps (they shouldn't in practice).
    const templateProjectScripts = templateConfig.projectScripts ?? {};
    const combinedTemplateScripts = {
      ...templateConfig.sharedScripts,
      ...templateProjectScripts,
    };

    // Collision check: only project-specific scripts are guarded. Shared
    // scripts are allowed to already exist (an existing definition wins; see
    // mergeScripts), so they're intentionally excluded here. Note the
    // conflicting names come from the project name + template combo (e.g.
    // `<projectName>:build`), not the template ID alone — so a different
    // project name produces different script names and can sidestep a clash.
    if (rootPkgStatus.status === 'found') {
      const existingScripts = rootPkgStatus.data.scripts as
        Record<string, unknown> | undefined;

      const conflicts = findScriptConflicts(
        existingScripts,
        templateProjectScripts,
      );

      if (conflicts.length > 0) {
        log(
          'error',
          `❌ Cannot scaffold "${options.projectName}" from the "${options.templateID}" template: ${conflicts.length} of the script name(s) it would add already exist in ${packageJSONPathDisplay}`,
        );

        for (const name of conflicts) {
          log('error', `   - ${name}`);
        }

        log('info', '');
        log(
          'info',
          'These names come from the project name + template, so rename or remove the conflicting script(s), or pick a different project name, then try again.',
        );

        return {
          success: false,
          error: `Script name conflict in package.json: ${conflicts.join(', ')}`,
          metadata: {
            templateID: options.templateID,
            projectName: options.projectName,
            repoPath: repoRootDisplay,
          },
        };
      }
    }

    // The parse/read error cases returned above, so `rootPkgStatus` is now a
    // known found/not_found state — exactly a RootPackageJSONState. Thread it
    // down so package.json is read only this once. The auto-init branch below
    // refreshes it with whatever state initRepo ended up writing.
    let preloadedPackageJSON: RootPackageJSONState = rootPkgStatus;

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
      // (initRepo will perform the remaining safety checks on its own)
      const repoName = DEFAULT_REPO_NAME;
      log(
        'info',
        `📦 No repository found, auto-initializing as "${repoName}"...`,
      );
      log('info', '');

      // Skip git init, dependency installation, and auto-format here.
      // createProject will handle these in Steps 5, 7, and 8.
      // Use the internal variant so we can (a) hand it the repo config we
      // already read in Step 1 (so it doesn't re-read unirend-repo.json) and
      // (b) get back the package.json state it wrote, so Step 3 doesn't have to
      // re-read that across the auto-init.
      const initResult = await initRepoInternal(options.repoRoot, repoStatus, {
        name: repoName,
        logger: log,
        initGit: false,
        installDependencies: false,
        autoFormat: false,
      });

      if (initResult.success) {
        repoStatus = { status: 'found', config: initResult.config };

        // Refresh the threaded state with whatever initRepo ended up writing
        // (a fresh `found`, or `not_found` if its non-fatal base-file pass
        // failed — in which case Step 3 retries the create).
        preloadedPackageJSON = initResult.packageJSON;
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
        preloadedPackageJSON,
        {
          log,
          templateScripts: combinedTemplateScripts,
          templateDependencies: templateConfig.dependencies,
          templateDevDependencies: templateConfig.devDependencies,
          templateGitignoreSectionHeader: templateConfig.gitignoreSectionHeader,
          templateGitignoreEntries: templateConfig.gitignoreEntries,
          templatePrettierignoreSectionHeader:
            templateConfig.prettierignoreSectionHeader,
          templatePrettierignoreEntries: templateConfig.prettierignoreEntries,
          templateCspellWords: templateConfig.cspellWords,
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
    if (starterFileCount > 0) {
      try {
        log('info', `📄 Writing ${starterFileCount} starter files`);

        for (const [relPath, content] of Object.entries(
          options.starterFiles?.repoRoot ?? {},
        )) {
          await vfsWrite(options.repoRoot, relPath, content);
          log('info', `   ${vfsDisplayPath(options.repoRoot, relPath)}`);
        }

        for (const [relPath, content] of Object.entries(
          options.starterFiles?.projectRoot ?? {},
        )) {
          const projectRelPath = `${projectPath}/${relPath}`;
          await vfsWrite(options.repoRoot, projectRelPath, content);
          log('info', `   ${vfsDisplayPath(options.repoRoot, projectRelPath)}`);
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
 * Check if a template exists in the registry.
 * Returns a type predicate so callers can narrow `string` to `TemplateID`
 * after a successful check (used by `createProject` to flow the narrowed
 * value into `getTemplateConfig` and `createProjectSpecificFiles`).
 */
export function templateExists(templateID: string): templateID is TemplateID {
  return (TEMPLATE_IDS as readonly string[]).includes(templateID);
}

/**
 * Get list of available starter template IDs
 */
export function listAvailableTemplates(): TemplateID[] {
  return Object.keys(STARTER_TEMPLATES) as TemplateID[];
}

/**
 * Get template information by ID. Caller must have a valid `TemplateID`
 * (narrow with `templateExists` first if you only have a raw string).
 */
export function getTemplateInfo(templateID: TemplateID): TemplateInfo {
  return STARTER_TEMPLATES[templateID];
}

/**
 * Get available template IDs with info objects
 */
export function listAvailableTemplatesWithInfo(): TemplateInfo[] {
  return Object.values(STARTER_TEMPLATES);
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

  return { status: 'found', config: normalizeRepoConfig(result.data) };
}

/**
 * Backfill fields that legacy `unirend-repo.json` manifests may be missing, so a
 * config returned by {@link readRepoConfig} always satisfies the current
 * `RepoConfig` type. Manifests generated before the `version` → `manifestVersion`
 * rename carry a top-level `version` instead, which we map over (and drop) so a
 * re-written manifest doesn't keep both keys. `createdWith` is left absent when a
 * legacy manifest lacks it, since the generating version genuinely isn't recorded.
 */
function normalizeRepoConfig(raw: RepoConfig): RepoConfig {
  const legacy = raw as RepoConfig & { version?: unknown };
  const config: RepoConfig & { version?: unknown } = { ...legacy };

  if (typeof config.manifestVersion !== 'string') {
    config.manifestVersion =
      typeof legacy.version === 'string' ? legacy.version : '1.0';
  }

  delete config.version;

  return config;
}

/**
 * Like {@link InitRepoResult}, but success also carries the package.json state
 * `initRepoInternal` ensured — so `createProject` can thread it onward across
 * the auto-init without re-reading package.json.
 */
type InitRepoInternalResult =
  (InitRepoSuccess & { packageJSON: RootPackageJSONState }) | InitRepoFailure;

/**
 * Internal repo-init core. Public {@link initRepo} is a thin wrapper over this.
 *
 * It works from already-read state rather than reading config files itself:
 * - `repoConfigState` is the caller's read of `unirend-repo.json` (public
 *   initRepo reads it, or createProject threads its Step 1 read). Parse/read
 *   errors are the caller's job — this only sees the `found`/`not_found` subset.
 * - It returns the resulting package.json state for the caller to thread
 *   onward, and doesn't need a package.json passed in: the emptiness gate below
 *   guarantees the directory has none by the time base files are written, so it
 *   ensures from `{ status: 'not_found' }`.
 */
async function initRepoInternal(
  dirPath: FileRoot,
  repoConfigState: RepoConfigState,
  options: InitRepoOptions = {},
): Promise<InitRepoInternalResult> {
  // Default logger that does nothing if none provided
  const log: LoggerFunction = options.logger || (() => {});
  const repoRootDisplay = vfsDisplayPath(dirPath);

  log('info', '🏗️  Initializing repository...');
  log('info', `Repo Path: ${repoRootDisplay}`);

  // The caller already read the repo config (and handled any parse/read error),
  // so we only need to distinguish an existing repo from a fresh one.
  if (repoConfigState.status === 'found') {
    log('error', `❌ Repository already initialized at ${repoRootDisplay}`);
    return { success: false, error: 'already_exists' };
  }

  // repoConfigState is `not_found` → proceed with a fresh init.

  // Check if directory is empty or empty-ish (only .git/.gitignore, OS junk, etc.)
  const emptyCheck = await isRepoDirEmptyish(dirPath);

  // Surface real content (README.md, LICENSE) that was found but not blocking,
  // so the user knows it was left untouched rather than silently ignored.
  for (const noticeFile of emptyCheck.notices ?? []) {
    log('info', `📄 Found ${noticeFile} and left it untouched.`);
  }

  if (!emptyCheck.safe) {
    log('error', '❌ Cannot initialize repository in this directory');
    log('error', `   ${emptyCheck.reason}`);
    log('info', '');
    log(
      'info',
      'Please use an empty directory. Existing git/config files (.git, .gitignore, .gitattributes, .gitkeep), common OS/cloud junk (like .DS_Store or Thumbs.db), and a README.md/LICENSE are allowed, but other content is not.',
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
    log('info', '  - Use kebab-case: lowercase letters, numbers, and hyphens');
    log('info', '  - Start with a lowercase letter');
    log('info', '  - End with a lowercase letter or number');
    log('info', '  - Not contain consecutive hyphens');
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
    // The emptiness gate above guarantees no package.json is present, so we
    // ensure from `not_found` rather than reading. Capture the resulting state
    // so the caller can thread it on without re-reading; if this (non-fatal)
    // pass fails it stays `not_found` and Step 3 retries the create.
    let ensuredPackageJSON: RootPackageJSONState = { status: 'not_found' };

    try {
      const baseResult = await ensureBaseFiles(
        dirPath,
        repoName,
        { status: 'not_found' },
        { log },
      );

      ensuredPackageJSON = baseResult.packageJSON;
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

    // Success. Thread back both files we just wrote so the caller doesn't
    // re-read either: `config` is the object written to unirend-repo.json above,
    // and `packageJSON` is the state ensureBaseFiles ensured.
    return { success: true, config, packageJSON: ensuredPackageJSON };
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

/**
 * Initialize a new Unirend repository at the given directory.
 */
export async function initRepo(
  dirPath: FileRoot,
  options: InitRepoOptions = {},
): Promise<InitRepoResult> {
  const log: LoggerFunction = options.logger || (() => {});

  // This is the public entry point over the shared `initRepoInternal` core.
  // Its job here is to own the repo-config read + error surfacing and expose
  // the stable InitRepoResult contract; the core does the actual init from an
  // already-read state. (createProject is the other caller of the core — it
  // does its own read up front, which is why the core takes the state in.)

  // Read the repo config once here and surface any parse/read error, so
  // initRepoInternal can work from a known found/not_found state. This mirrors
  // createProject's Step 1 — `configFullPathDisplay` and `repoStatus` are named
  // to match there so both blocks' error messages line up for a Ctrl-F/diff
  // parity check (only the success/return shape legitimately differs between them).
  const configFullPathDisplay = vfsDisplayPath(dirPath, REPO_CONFIG_FILE);
  const repoStatus = await readRepoConfig(dirPath);

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
      error: 'parse_error',
      errorMessage: repoStatus.errorMessage,
    };
  } else if (repoStatus.status === 'read_error') {
    log('error', `❌ Found ${configFullPathDisplay} but cannot read it`);

    if (repoStatus.errorMessage) {
      log('error', `   ${repoStatus.errorMessage}`);
    }

    return {
      success: false,
      error: 'read_error',
      errorMessage: repoStatus.errorMessage,
    };
  }

  // `repoStatus` is now the found/not_found subset (RepoConfigState). Run the
  // core, then return only the public InitRepoResult: the core additionally
  // hands back the package.json state it ensured (for createProject to thread
  // on), which isn't part of this public contract, so we omit it below.
  const result = await initRepoInternal(dirPath, repoStatus, options);

  if (result.success) {
    return { success: true, config: result.config };
  }

  return result;
}

// Re-export constants for public API consumers
export {
  STARTER_TEMPLATES,
  TEMPLATE_IDS,
  REPO_CONFIG_FILE,
  DEFAULT_REPO_NAME,
} from './lib/starter-templates/consts';
export type { TemplateID } from './lib/starter-templates/consts';

// Re-export types for public API consumers
export type {
  TemplateInfo,
  ProjectEntry,
  RepoConfig,
  LoggerFunction,
  LogLevel,
  ServerBuildTarget,
  StarterFiles,
  StarterTemplateOptions,
  InitRepoOptions,
  NameValidationResult,
  CreateProjectResult,
  RepoConfigResult,
  InitRepoResult,
  InitRepoSuccess,
  InitRepoErrorCode,
  InitRepoFailure,
} from './lib/starter-templates/types';

export type {
  InMemoryDir,
  FileRoot,
  FileContent,
} from './lib/starter-templates/vfs';

// Re-export validation function
export { validateName } from './lib/starter-templates/validate-name';
