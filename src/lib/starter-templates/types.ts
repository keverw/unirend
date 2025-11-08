import type { FileRoot, FileContent } from "./vfs";

// Types for starter-templates APIs

export interface TemplateInfo {
  /** Template identifier */
  templateID: string;
  /** Display name */
  name: string;
  /** Template description */
  description: string;
}

export interface ProjectEntry {
  /** Template used for this project */
  templateID: string;
  /** Relative path to the project */
  path: string;
  /** ISO timestamp when project was created */
  createdAt: string;
}

export interface RepoConfig {
  /** Config version for future compatibility */
  version: string;
  /** Repository name */
  name: string;
  /** ISO timestamp when repository was created */
  created: string;
  /** Projects in this repository */
  projects: Record<string, ProjectEntry>;
}

export type LogLevel = "info" | "warning" | "error" | "success";

export interface Logger {
  (level: LogLevel, message: string): void;
}

export interface StarterTemplateOptions {
  /** Project template type */
  templateID: string;
  /** Project name */
  projectName: string;
  /** Repo root directory: real FS path or in-memory directory object */
  repoRoot: FileRoot;
  /** Overwrite existing directory if it exists */
  overwrite?: boolean;
  /** Optional logger function for output */
  logger?: Logger;
  /** Target runtime for generated server (affects scripts/config emitted by templates) */
  serverTarget?: "bun" | "node";
  /**
   * Custom starter files (UTF-8 strings or binary as Uint8Array).
   * File paths are relative to the project root. Strings are treated as UTF-8.
   * These files are written into the project for both root modes:
   * - in-memory directory object (mutates the object content)
   * - real filesystem directory (writes files to disk)
   */
  starterFiles?: Record<string, FileContent>;
}

export type CreateProjectResult =
  | {
      /** Project creation was successful */
      success: true;
      /** Project metadata */
      metadata: {
        templateID: string;
        projectName: string;
        repoPath: string;
      };
    }
  | {
      /** Project creation failed */
      success: false;
      /** Error message describing what went wrong */
      error: string;
      /** Project metadata (context of what was attempted) */
      metadata: {
        templateID: string;
        projectName: string;
        repoPath: string;
      };
    };

export interface NameValidationResult {
  valid: boolean;
  error?: string;
}

export type RepoConfigResult =
  | { status: "found"; config: RepoConfig }
  | { status: "not_found" }
  | { status: "parse_error"; errorMessage?: string }
  | { status: "read_error"; errorMessage?: string };

export type InitRepoResult =
  | { success: true; config: RepoConfig }
  | {
      success: false;
      error:
        | "invalid_name"
        | "write_error"
        | "already_exists"
        | "parse_error"
        | "read_error"
        | "unsupported_status";
      errorMessage?: string;
    };
