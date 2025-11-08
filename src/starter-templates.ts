/**
 * Unirend Starter Templates
 *
 * Programmatic API for creating new projects from templates.
 * This is the same functionality used by the CLI, but available as a library.
 */

import {
  STARTER_TEMPLATES,
  REPO_CONFIG_FILE,
  DEFAULT_REPO_NAME,
} from "./lib/starter-templates/consts";
import type {
  TemplateInfo,
  RepoConfig,
  Logger,
  StarterTemplateOptions,
  CreateProjectResult,
  RepoConfigResult,
  InitRepoResult,
} from "./lib/starter-templates/types";
import {
  createRepoConfigObject,
  addProjectToRepo,
  ensureBaseFiles,
} from "./lib/starter-templates/internal-helpers";
import { validateName } from "./lib/starter-templates/validate-name";
import {
  vfsDisplayPath,
  vfsEnsureDir,
  vfsReadText,
  vfsWrite,
  type FileRoot,
} from "./lib/starter-templates/vfs";

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

  try {
    log("info", "🚀 Starting project creation...");
    log("info", `Template: ${options.templateID}`);
    log("info", `Project Name: ${options.projectName}`);
    log("info", `Repo Path: ${repoRootDisplay}`);

    if (options.starterFiles && Object.keys(options.starterFiles).length > 0) {
      log(
        "info",
        `Custom starter files: ${Object.keys(options.starterFiles).length}`,
      );
    }

    // Validate project name
    const nameValidation = validateName(options.projectName);

    if (!nameValidation.valid) {
      log(
        "error",
        `❌ Invalid project name: ${nameValidation.error ?? "Invalid name"}`,
      );
      log("info", "");
      log("info", "Valid names must:");
      log("info", "  - Contain at least one alphanumeric character");
      log("info", "  - Not start or end with special characters");
      log("info", "  - Not contain invalid filesystem characters");
      log("info", "  - Not be reserved system names");

      return {
        success: false,
        error: nameValidation.error ?? "Invalid project name",
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
        "error",
        `❌ Template "${options.templateID}" not found. Available templates: ${available.join(", ")}`,
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

    // Repo root directory is the workspace root where projects live
    const configFullPathDisplay = vfsDisplayPath(
      options.repoRoot,
      REPO_CONFIG_FILE,
    );

    // Step 1: Read repository configuration (if present)
    let repoStatus = await readRepoConfig(options.repoRoot);

    if (repoStatus.status === "parse_error") {
      log(
        "error",
        `❌ Found ${configFullPathDisplay} but it contains invalid JSON`,
      );

      if (repoStatus.errorMessage) {
        log("error", `   ${repoStatus.errorMessage}`);
      }

      return {
        success: false,
        error: `${REPO_CONFIG_FILE} contains invalid JSON`,
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
          repoPath: repoRootDisplay,
        },
      };
    } else if (repoStatus.status === "read_error") {
      log("error", `❌ Found ${configFullPathDisplay} but cannot read it`);

      if (repoStatus.errorMessage) {
        log("error", `   ${repoStatus.errorMessage}`);
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
    } else if (repoStatus.status === "not_found") {
      // Auto-initialize repo if missing to keep flow simple
      const repoName = DEFAULT_REPO_NAME;
      const initResult = await initRepo(options.repoRoot, repoName);

      if (initResult.success) {
        log("info", `🛠️  Created ${REPO_CONFIG_FILE} (repo: ${repoName})`);
        repoStatus = { status: "found", config: initResult.config };
      } else {
        log("error", "❌ Failed to initialize repository configuration");

        if (initResult.errorMessage) {
          log("error", `   ${initResult.errorMessage}`);
      }

      return {
        success: false,
          error: "Failed to initialize repository configuration",
        metadata: {
          templateID: options.templateID,
          projectName: options.projectName,
            repoPath: repoRootDisplay,
        },
      };
    }
    } else if (repoStatus.status !== "found") {
      log("error", "❌ Unsupported repository status returned");

      return {
        success: false,
        error: "Unsupported repository status returned",
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
      if (repoStatus.status === "found") {
        const updated = addProjectToRepo(
          repoStatus.config,
          options.projectName,
          options.templateID,
          `./${options.projectName}`,
        );

        await vfsWrite(
          options.repoRoot,
          REPO_CONFIG_FILE,
          JSON.stringify(updated, null, 2),
        );

        log("info", `📝 Updated ${REPO_CONFIG_FILE}`);
      }
    } catch (err) {
      log(
        "error",
        `❌ Failed to update ${REPO_CONFIG_FILE}, Aborting project creation`,
      );

      const errorMessage = err instanceof Error ? err.message : String(err);

      if (errorMessage) {
        log("error", `   ${errorMessage}`);
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
        (repoStatus.status === "found"
          ? repoStatus.config.name
          : DEFAULT_REPO_NAME) as string,
        (message) => log("info", message),
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log("error", "❌ Failed to ensure base files, aborting project creation");

      if (errorMessage) {
        log("error", `   ${errorMessage}`);
      }

      return {
        success: false,
        error: "Failed to ensure base files",
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
          "info",
          `📄 Writing ${Object.keys(options.starterFiles).length} starter files`,
        );

        for (const [relPath, content] of Object.entries(options.starterFiles)) {
          await vfsWrite(options.repoRoot, relPath, content);
          log("info", `   ${vfsDisplayPath(options.repoRoot, relPath)}`);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log("error", "❌ Failed to write starter files");

        if (errorMessage) {
          log("error", `   ${errorMessage}`);
        }

        return {
          success: false,
          error: "Failed to write starter files",
          metadata: {
            templateID: options.templateID,
            projectName: options.projectName,
            repoPath: repoRootDisplay,
          },
        };
      }
    }
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("error", `❌ Failed to create project: ${errorMessage}`);

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
  try {
    const result = await vfsReadText(dirPath, REPO_CONFIG_FILE);

    if (!result.ok) {
      if (result.code === "ENOENT") {
        return { status: "not_found" };
      }

      return { status: "read_error", errorMessage: result.message };
    }

    try {
      const config = JSON.parse(result.text) as RepoConfig;
      return { status: "found", config };
    } catch (parseError) {
      return {
        status: "parse_error",
        errorMessage:
          parseError instanceof Error ? parseError.message : "Invalid JSON",
      };
    }
  } catch (error: unknown) {
    return {
      status: "read_error",
      errorMessage:
        error instanceof Error ? error.message : "Failed to read file",
    };
  }
}

export async function initRepo(
  dirPath: FileRoot,
  name?: string,
): Promise<InitRepoResult> {
  // Check for existing or problematic config first
  const existing = await readRepoConfig(dirPath);

  if (existing.status === "found") {
    return { success: false, error: "already_exists" };
  } else if (existing.status === "parse_error") {
    return {
      success: false,
      error: "parse_error",
      errorMessage: existing.errorMessage,
    };
  } else if (existing.status === "read_error") {
    return {
      success: false,
      error: "read_error",
      errorMessage: existing.errorMessage,
    };
  } else if (existing.status !== "not_found") {
    // Guard for any future status values we don't explicitly handle yet
    return {
      success: false,
      error: "unsupported_status",
      errorMessage: `Unsupported repo status: ${String(
        (existing as Record<string, unknown>).status ?? "unknown",
      )}`,
    };
  }

  const repoName = name || DEFAULT_REPO_NAME;
  const validation = validateName(repoName);

  if (!validation.valid) {
    return {
      success: false,
      error: "invalid_name",
      errorMessage: validation.error,
    };
  }

  const config = createRepoConfigObject(repoName);

  try {
    // Ensure target directory exists (noop for in-memory)
    await vfsEnsureDir(dirPath);

    // Write repo config file
    await vfsWrite(dirPath, REPO_CONFIG_FILE, JSON.stringify(config, null, 2));

    // Try to ensure base files exist, otherwise createProject will run this again once a project is created within the repo
    try {
      await ensureBaseFiles(dirPath, repoName);
    } catch {
      // best-effort; ignore
    }

    // Return success result
    return { success: true, config };
  } catch (error) {
    // Return error result
    return {
      success: false,
      error: "write_error",
      errorMessage:
        error instanceof Error ? error.message : "Failed to write file",
    };
  }
}

// Re-export constants for public API consumers
export {
  STARTER_TEMPLATES,
  REPO_CONFIG_FILE,
  DEFAULT_REPO_NAME,
} from "./lib/starter-templates/consts";

// Re-export types for public API consumers
export type {
  TemplateInfo,
  ProjectEntry,
  RepoConfig,
  LogLevel,
  Logger,
  StarterTemplateOptions,
  CreateProjectResult,
  NameValidationResult,
  RepoConfigResult,
  InitRepoResult,
} from "./lib/starter-templates/types";

export type {
  InMemoryDir,
  FileRoot,
  FileContent,
} from "./lib/starter-templates/vfs";

// Re-export validation function
export { validateName } from "./lib/starter-templates/validate-name";
