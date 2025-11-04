/**
 * Unirend Starter Templates
 *
 * Programmatic API for creating new projects from templates.
 * This is the same functionality used by the CLI, but available as a library.
 */

import {
  STARTER_TEMPLATES,
  MONOREPO_CONFIG_FILE,
  DEFAULT_MONOREPO_NAME,
} from "./lib/starter-templates/consts";
import type {
  TemplateInfo,
  MonorepoConfig,
  Logger,
  StarterTemplateOptions,
  CreateProjectResult,
  NameValidationResult,
  MonorepoConfigResult,
  InitMonorepoResult,
} from "./lib/starter-templates/types";
import {
  createMonorepoConfigObject,
  addProjectToMonorepo,
} from "./lib/starter-templates/internal-helpers";
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
  const { templateID, projectName, projectPath, logger, starterFiles } =
    options;
  const projectPathDisplay = vfsDisplayPath(projectPath);

  // Default logger that does nothing if none provided
  const log: Logger = logger || (() => {});

  try {
    log("info", "🚀 Starting project creation...");
    log("info", `Template: ${templateID}`);
    log("info", `Project Name: ${projectName}`);
    log("info", `Project Path: ${projectPathDisplay}`);

    if (starterFiles && Object.keys(starterFiles).length > 0) {
      log("info", `Custom starter files: ${Object.keys(starterFiles).length}`);
    }

    // Validate project name
    const nameValidation = validateName(projectName);

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
        metadata: { templateID, projectName, projectPath: projectPathDisplay },
      };
    }

    // Validate template exists
    if (!templateExists(templateID)) {
      const available = listAvailableTemplates();

      log(
        "error",
        `❌ Template "${templateID}" not found. Available templates: ${available.join(", ")}`,
      );

      return {
        success: false,
        error: `Template "${templateID}" not found`,
        metadata: { templateID, projectName, projectPath: projectPathDisplay },
      };
    }

    // projectPath is the root where the project/monorepo lives
    const projectBaseDir = projectPath;
    const configFullPathDisplay = vfsDisplayPath(
      projectBaseDir,
      MONOREPO_CONFIG_FILE,
    );

    const monorepoStatus = await readMonorepoConfig(projectBaseDir);
    const isMonorepo = monorepoStatus.status === "found";

    if (monorepoStatus.status === "parse_error") {
      log(
        "error",
        `❌ Found ${configFullPathDisplay} but it contains invalid JSON`,
      );

      if (monorepoStatus.errorMessage) {
        log("error", `   ${monorepoStatus.errorMessage}`);
      }

      return {
        success: false,
        error: `${MONOREPO_CONFIG_FILE} contains invalid JSON`,
        metadata: { templateID, projectName, projectPath: projectPathDisplay },
      };
    } else if (monorepoStatus.status === "read_error") {
      log("error", `❌ Found ${configFullPathDisplay} but cannot read it`);

      if (monorepoStatus.errorMessage) {
        log("error", `   ${monorepoStatus.errorMessage}`);
      }

      return {
        success: false,
        error: `Cannot read ${MONOREPO_CONFIG_FILE}`,
        metadata: { templateID, projectName, projectPath: projectPathDisplay },
      };
    }

    // Guard for unexpected future statuses
    if (
      monorepoStatus.status !== "found" &&
      monorepoStatus.status !== "not_found"
    ) {
      log(
        "error",
        `❌ Unsupported monorepo status: ${String(
          (monorepoStatus as Record<string, unknown>).status ?? "unknown",
        )}`,
      );

      return {
        success: false,
        error: "Unsupported monorepo status returned",
        metadata: { templateID, projectName, projectPath: projectPathDisplay },
      };
    }

    const result: CreateProjectResult = {
      success: true,
      metadata: {
        templateID,
        projectName,
        projectPath: projectPathDisplay,
      },
    };

    // If a monorepo exists in the target directory, update its config
    try {
      if (isMonorepo && monorepoStatus.status === "found") {
        const updated = addProjectToMonorepo(
          monorepoStatus.config,
          projectName,
          templateID,
          `./${projectName}`,
        );

        await vfsWrite(
          projectBaseDir,
          MONOREPO_CONFIG_FILE,
          JSON.stringify(updated, null, 2),
        );

        logger?.("info", `📝 Updated ${MONOREPO_CONFIG_FILE}`);
      }
    } catch (err) {
      logger?.(
        "error",
        `❌ Failed to update ${MONOREPO_CONFIG_FILE}, Aborting project creation`,
      );

      const errorMessage = err instanceof Error ? err.message : String(err);

      if (errorMessage) {
        logger?.("error", `   ${errorMessage}`);
      }

      return {
        success: false,
        error: `Failed to update ${MONOREPO_CONFIG_FILE}`,
        metadata: { templateID, projectName, projectPath: projectPathDisplay },
      };
    }
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("error", `❌ Failed to create project: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
      metadata: {
        templateID,
        projectName,
        projectPath: projectPathDisplay,
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
 * Validate a project or monorepo name
 * Returns an object with validation result and optional error message
 */
export function validateName(name: string): NameValidationResult {
  // Must not be empty
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Name cannot be empty" };
  }

  // Must not be only special characters (dashes, underscores, dots)
  if (/^[-_.]+$/.test(name)) {
    return {
      valid: false,
      error: "Name cannot consist only of dashes, underscores, or dots",
    };
  }

  // Must not start or end with special characters
  if (/^[-_.]/.test(name)) {
    return {
      valid: false,
      error: "Name cannot start with a dash, underscore, or dot",
    };
  }

  if (/[-_.]$/.test(name)) {
    return {
      valid: false,
      error: "Name cannot end with a dash, underscore, or dot",
    };
  }

  // Must contain at least one alphanumeric character
  if (!/[a-zA-Z0-9]/.test(name)) {
    return {
      valid: false,
      error: "Name must contain at least one alphanumeric character",
    };
  }

  // Must not contain invalid filesystem characters
  if (/[<>:"|?*\\/]/.test(name)) {
    return {
      valid: false,
      error: 'Name contains invalid characters (< > : " | ? * \\ /)',
    };
  }

  // Must not be reserved names
  const reserved = [".", "..", "con", "prn", "aux", "nul", "com1", "lpt1"];
  if (reserved.includes(name.toLowerCase())) {
    return { valid: false, error: "Name is a reserved system name" };
  }

  return { valid: true };
}

/**
 * Read monorepo configuration from a directory
 * Returns an object with status and config
 * - found: true, config: MonorepoConfig - Successfully read and parsed
 * - found: false - Config file doesn't exist
 * - found: false, error: "parse_error" - Config file exists but has invalid JSON
 * - found: false, error: "read_error" - Config file exists but can't be read
 */
export async function readMonorepoConfig(
  dirPath: FileRoot,
): Promise<MonorepoConfigResult> {
  try {
    const result = await vfsReadText(dirPath, MONOREPO_CONFIG_FILE);

    if (!result.ok) {
      if (result.code === "ENOENT") {
        return { status: "not_found" };
      }

      return { status: "read_error", errorMessage: result.message };
    }

    try {
      const config = JSON.parse(result.text) as MonorepoConfig;
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

export async function initMonorepo(
  dirPath: FileRoot,
  name?: string,
): Promise<InitMonorepoResult> {
  // Check for existing or problematic config first
  const existing = await readMonorepoConfig(dirPath);

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
      errorMessage: `Unsupported monorepo status: ${String(
        (existing as Record<string, unknown>).status ?? "unknown",
      )}`,
    };
  }

  const monorepoName = name || DEFAULT_MONOREPO_NAME;
  const validation = validateName(monorepoName);

  if (!validation.valid) {
    return {
      success: false,
      error: "invalid_name",
      errorMessage: validation.error,
    };
  }

  const config = createMonorepoConfigObject(monorepoName);

  try {
    // Ensure target directory exists (noop for in-memory)
    await vfsEnsureDir(dirPath);

    // Write monorepo config file
    await vfsWrite(
      dirPath,
      MONOREPO_CONFIG_FILE,
      JSON.stringify(config, null, 2),
    );

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
  MONOREPO_CONFIG_FILE,
  DEFAULT_MONOREPO_NAME,
} from "./lib/starter-templates/consts";

// Re-export types for public API consumers
export type {
  TemplateInfo,
  ProjectEntry,
  MonorepoConfig,
  LogLevel,
  Logger,
  StarterTemplateOptions,
  CreateProjectResult,
  NameValidationResult,
  MonorepoConfigResult,
  InitMonorepoResult,
} from "./lib/starter-templates/types";

export type {
  InMemoryDir,
  FileRoot,
  FileContent,
} from "./lib/starter-templates/vfs";
