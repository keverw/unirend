import type { FileRoot, FileContent } from './vfs';
import type { TemplateID } from './consts';

// Types for starter-templates APIs

/**
 * Target runtime for server build/bundle.
 * Affects scripts and configuration emitted by templates.
 */
export type ServerBuildTarget = 'bun' | 'node';

export interface TemplateInfo {
  /** Template identifier */
  templateID: TemplateID;
  /** Display name */
  name: string;
  /** Template description */
  description: string;
}

export interface ProjectEntry {
  /** Template used for this project */
  templateID: TemplateID;
  /** Relative path to the project */
  path: string;
  /** ISO timestamp when project was created */
  createdAt: string;
  /**
   * Unirend version that scaffolded this project. Optional because manifests
   * generated before this field existed won't record it.
   */
  createdWith?: string;
}

export interface RepoConfig {
  /** Manifest schema version, for parse compatibility */
  manifestVersion: string;
  /**
   * Unirend version that ran `init`. Optional because manifests generated
   * before this field existed won't record it.
   */
  createdWith?: string;
  /** Repository name */
  name: string;
  /** ISO timestamp when repository was created */
  created: string;
  /** Projects in this repository */
  projects: Record<string, ProjectEntry>;
}

export type LogLevel = 'info' | 'warning' | 'error' | 'success';

/**
 * Function logger used by starter-template helpers.
 */
export type LoggerFunction = (level: LogLevel, message: string) => void;

/**
 * Additional files to write during template generation.
 *
 * Workspace base files are ensured before these files are written. Project-specific
 * generated files are written afterward, so avoid paths that match generated files.
 */
export interface StarterFiles {
  /**
   * Files written relative to the repository root.
   * Use this for workspace-level files such as README.md or tool config.
   */
  repoRoot?: Record<string, FileContent>;
  /**
   * Files written relative to the generated project root
   * (`src/apps/<projectName>`).
   * Use this for app files that should live inside the new project.
   */
  projectRoot?: Record<string, FileContent>;
}

export interface StarterTemplateOptions {
  /** Project template type */
  templateID: TemplateID;
  /** Project name */
  projectName: string;
  /** Repo root directory: real FS path or in-memory directory object */
  repoRoot: FileRoot;
  /** Optional logger function for output */
  logger?: LoggerFunction;
  /**
   * Target runtime for server build/bundle (affects scripts/config emitted
   * by templates). Required at the library boundary so each consumer makes
   * a conscious choice — this library is meant to be usable directly by
   * other tools, not just the bundled CLI. The bundled CLI happens
   * to default to `'node'` before calling `createProject`; other tools
   * are free to pick their own default based on their needs.
   */
  serverBuildTarget: ServerBuildTarget;
  /**
   * Install dependencies after project creation (only for filesystem mode).
   * Runs `bun install` in the project directory.
   * @default true
   */
  installDependencies?: boolean;
  /**
   * Auto-format code after project creation (only for filesystem mode).
   * Runs `bun run format` in the repo root if node_modules/prettier exists.
   * Runs independently of installDependencies - checks for prettier before formatting.
   * @default true
   */
  autoFormat?: boolean;
  /**
   * Initialize git repository if not already initialized (only for filesystem mode).
   * Runs `git init` in the repo root if git is available.
   * Fails gracefully with a warning if git command is not found.
   * @default true
   */
  initGit?: boolean;
  /**
   * Custom starter files (UTF-8 strings or binary as Uint8Array).
   * File paths are grouped by their path base:
   * - `repoRoot`: paths are relative to the repository root
   * - `projectRoot`: paths are relative to the generated project root
   *   (`src/apps/<projectName>`)
   * Strings are treated as UTF-8.
   * These files are written into the project for both root modes:
   * - in-memory directory object (mutates the object content)
   * - real filesystem directory (writes files to disk)
   */
  starterFiles?: StarterFiles;
}

export interface InitRepoOptions {
  /** Repository name (defaults to 'unirend-projects') */
  name?: string;
  /** Optional logger function for output */
  logger?: LoggerFunction;
  /**
   * Initialize git repository if not already initialized (only for filesystem mode).
   * Runs `git init` in the repo root if git is available.
   * Fails gracefully with a warning if git command is not found.
   * @default true
   */
  initGit?: boolean;
  /**
   * Install dependencies after repo initialization (only for filesystem mode).
   * Runs `bun install` in the repo root.
   * @default true
   */
  installDependencies?: boolean;
  /**
   * Auto-format code after repo initialization (only for filesystem mode).
   * Runs `bun run format` in the repo root if node_modules/prettier exists.
   * Runs independently of installDependencies - checks for prettier before formatting.
   * @default true
   */
  autoFormat?: boolean;
}

export type CreateProjectResult =
  | {
      /** Project creation was successful */
      success: true;
      /** Project metadata */
      metadata: {
        templateID: TemplateID;
        projectName: string;
        repoPath: string;
      };
    }
  | {
      /** Project creation failed */
      success: false;
      /** Error message describing what went wrong */
      error: string;
      /**
       * Project metadata (context of what was attempted).
       *
       * `templateID` is widened to `string` here because a JS caller can
       * reach the failure path with an unknown template identifier — TS
       * users get the narrow `TemplateID` only on the success branch, where
       * the value has been runtime-validated.
       */
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
  | { status: 'found'; config: RepoConfig }
  | { status: 'not_found' }
  | { status: 'parse_error'; errorMessage?: string }
  | { status: 'read_error'; errorMessage?: string };

/**
 * A *known* (error-free) repo config state — the `found`/`not_found` subset of
 * {@link RepoConfigResult}, i.e. what you have once parse/read errors have been
 * handled. Mirrors `RootPackageJSONState`: it's threaded into `initRepoInternal`
 * as the already-read config so it doesn't re-read `unirend-repo.json`. (See the
 * `Extract` explainer on `RootPackageJSONState` for how this filters a union.)
 */
export type RepoConfigState = Extract<
  RepoConfigResult,
  { status: 'found' } | { status: 'not_found' }
>;

/** Error codes returned when repo initialization fails. */
export type InitRepoErrorCode =
  | 'invalid_name'
  | 'write_error'
  | 'already_exists'
  | 'parse_error'
  | 'read_error'
  | 'unsafe_directory';

/** The success shape of repo initialization. */
export type InitRepoSuccess = {
  success: true;
  config: RepoConfig;
};

/**
 * The failure shape shared by `initRepo`'s public result and the internal
 * result, pulled out so both reference one definition instead of re-typing it
 * (and so the internal result can return it straight through the public wrapper).
 */
export type InitRepoFailure = {
  success: false;
  error: InitRepoErrorCode;
  errorMessage?: string;
};

export type InitRepoResult = InitRepoSuccess | InitRepoFailure;
