import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { promises as fs } from 'fs';
import type {
  BuildInfo,
  GenerateBuildInfoOptions,
  GenerationResult,
  SaveResult,
} from './types';

const execAsync = promisify(exec);

// Fallback value for when build info cannot be determined
const FALLBACK_VALUE = '(unknown)';

// Core BuildInfo property names that cannot be overridden by custom properties
const CORE_BUILD_INFO_PROPERTIES = new Set([
  'build_timestamp',
  'version',
  'git_hash',
  'git_branch',
]);

// Get the current timestamp
function getBuildTimestamp(): string {
  return new Date().toISOString();
}

// Check if git CLI is available
async function isGitAvailable(): Promise<boolean> {
  try {
    await execAsync('git --version');
    return true;
  } catch {
    return false;
  }
}

// Get the current git hash
async function getGitHash(workingDir: string): Promise<{
  value: string;
  warning?: string;
}> {
  try {
    // Get the short hash (7 characters)
    const { stdout } = await execAsync('git rev-parse --short HEAD', {
      cwd: workingDir,
      encoding: 'utf8',
    });

    return { value: stdout.trim() };
  } catch (error) {
    return {
      value: FALLBACK_VALUE,
      warning: `Error getting git hash: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Get the current git branch
async function getGitBranch(workingDir: string): Promise<{
  value: string;
  warning?: string;
}> {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: workingDir,
      encoding: 'utf8',
    });

    return { value: stdout.trim() };
  } catch (error) {
    return {
      value: FALLBACK_VALUE,
      warning: `Error getting git branch: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export class GenerateBuildInfo {
  private workingDir: string;
  private version?: string;
  private customProperties: Record<string, unknown>;
  private lastGeneratedResults?: GenerationResult;

  /**
   * Creates a new build info generator
   *
   * @param options - Configuration options for the build info generator
   */
  constructor(options: GenerateBuildInfoOptions = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.version = options.version;
    this.customProperties = options.customProperties || {};
  }

  /**
   * Generates build information and stores it internally
   *
   * @returns The generated build info results with warnings
   */
  public async generateInfo(): Promise<GenerationResult> {
    const buildTimestamp = getBuildTimestamp();
    const warnings: string[] = [];

    // Check if git is available first
    const gitAvailable = await isGitAvailable();

    if (!gitAvailable) {
      warnings.push('Git CLI not found. Build info will use fallback values.');
    }

    // Check project version if needed
    let version = this.version;

    if (!version) {
      // no version provided, try to read from package.json
      try {
        const packageJsonPath = path.join(this.workingDir, 'package.json');
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonContent);

        // version found in package.json
        if (packageJson.version) {
          version = packageJson.version;
        }
      } catch (error) {
        warnings.push(
          `Error reading package.json: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Get git hash and branch
    let gitHash = FALLBACK_VALUE;
    let gitBranch = FALLBACK_VALUE;

    if (gitAvailable) {
      // get git hash
      const gitHashResult = await getGitHash(this.workingDir);

      if (gitHashResult.warning) {
        warnings.push(gitHashResult.warning);
      }

      gitHash = gitHashResult.value;

      // get git branch
      const gitBranchResult = await getGitBranch(this.workingDir);

      if (gitBranchResult.warning) {
        warnings.push(gitBranchResult.warning);
      }

      gitBranch = gitBranchResult.value;
    }

    // Filter custom properties to prevent conflicts with core BuildInfo properties
    const filteredCustomProperties: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(this.customProperties)) {
      if (CORE_BUILD_INFO_PROPERTIES.has(key)) {
        warnings.push(
          `Custom property "${key}" conflicts with core BuildInfo property and will be ignored`,
        );
      } else {
        filteredCustomProperties[key] = value;
      }
    }

    // create build info object
    const buildInfo: BuildInfo = {
      build_timestamp: buildTimestamp,
      version: version ?? FALLBACK_VALUE,
      git_hash: gitHash,
      git_branch: gitBranch,
      // Spread filtered custom properties
      ...filteredCustomProperties,
    };

    // create results object
    const results: GenerationResult = {
      buildInfo,
      warnings,
    };

    // save results and return
    this.lastGeneratedResults = results;
    return results;
  }

  /**
   * Generates the TypeScript source code for build info. Uses last generated results if available,
   * otherwise calls generateInfo() first.
   *
   * @returns Promise that resolves to the generated TypeScript source code
   */
  public async generateSourceCode(): Promise<string> {
    const resultsToSave =
      this.lastGeneratedResults || (await this.generateInfo());

    // Indentation for object properties
    const indent = '  ';

    // Core properties that always exist
    const coreProperties = [
      {
        key: 'build_timestamp',
        value: resultsToSave.buildInfo.build_timestamp,
        exportName: 'BUILD_TIMESTAMP',
      },
      {
        key: 'version',
        value: resultsToSave.buildInfo.version,
        exportName: 'APP_VERSION',
      },
      {
        key: 'git_hash',
        value: resultsToSave.buildInfo.git_hash,
        exportName: 'GIT_HASH',
      },
      {
        key: 'git_branch',
        value: resultsToSave.buildInfo.git_branch,
        exportName: 'GIT_BRANCH',
      },
    ];

    // Build the BUILD_INFO object content
    const buildInfoObjectLines: string[] = [];

    // Add core properties
    for (const prop of coreProperties) {
      buildInfoObjectLines.push(indent + prop.key + ": '" + prop.value + "',");
    }

    // Add custom properties
    for (const [key, value] of Object.entries(resultsToSave.buildInfo)) {
      // Skip core properties we already handled
      if (!coreProperties.some((p) => p.key === key)) {
        const serializedValue = JSON.stringify(value);
        buildInfoObjectLines.push(indent + key + ': ' + serializedValue + ',');
      }
    }

    // Build the complete file content as lines array
    const lines: string[] = [];

    // Header comments
    lines.push('// This file is auto-generated. Do not edit manually.');
    lines.push('// Generated on ' + resultsToSave.buildInfo.build_timestamp);
    lines.push('');

    // BUILD_INFO object
    lines.push('export const BUILD_INFO = {');
    lines.push(...buildInfoObjectLines);
    lines.push('};');
    lines.push('');

    // Individual exports for core properties
    lines.push('// Export individual properties for convenience');

    for (const prop of coreProperties) {
      lines.push(
        'export const ' + prop.exportName + " = '" + prop.value + "';",
      );
    }

    // Return the generated source code
    return lines.join('\n');
  }

  /**
   * Generates human-readable JSON representation of build info. Uses last generated results if available,
   * otherwise calls generateInfo() first.
   *
   * @returns Promise that resolves to the formatted JSON string
   */
  public async generateJSON(): Promise<string> {
    const resultsToSave =
      this.lastGeneratedResults || (await this.generateInfo());

    return JSON.stringify(resultsToSave.buildInfo, null, 2);
  }

  /**
   * Saves build info as TypeScript file. Uses last generated results if available,
   * otherwise calls generateInfo() first.
   *
   * @param fileName File name to save (will be joined with workingDir). Defaults to 'current-build-info.ts'
   * @returns Promise that resolves to save result with warnings
   */
  public async saveTS(
    fileName: string = 'current-build-info.ts',
  ): Promise<SaveResult> {
    const resultsToSave =
      this.lastGeneratedResults || (await this.generateInfo());

    const sourceCode = await this.generateSourceCode();
    const filePath = path.join(this.workingDir, fileName);
    await fs.writeFile(filePath, sourceCode, 'utf8');

    return {
      saved: true,
      warnings: resultsToSave.warnings,
    };
  }

  /**
   * Saves build info as JSON file. Uses last generated results if available,
   * otherwise calls generateInfo() first.
   *
   * @param fileName File name to save (will be joined with workingDir). Defaults to 'current-build-info.json'
   * @returns Promise that resolves to save result with warnings
   */
  public async saveJSON(
    fileName: string = 'current-build-info.json',
  ): Promise<SaveResult> {
    const resultsToSave =
      this.lastGeneratedResults || (await this.generateInfo());

    const jsonContent = await this.generateJSON();
    const filePath = path.join(this.workingDir, fileName);
    await fs.writeFile(filePath, jsonContent, 'utf8');

    return {
      saved: true,
      warnings: resultsToSave.warnings,
    };
  }

  /**
   * Gets the last generated build info results without regenerating
   *
   * @returns The last generated build info results, or undefined if none generated yet
   */
  public getLastGeneratedInfo(): GenerationResult | undefined {
    return this.lastGeneratedResults;
  }
}
