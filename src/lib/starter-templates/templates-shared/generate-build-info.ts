import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for the repo-level `scripts/generate-build-info.ts`.
 *
 * A single script services every app that opts into build info: it reads
 * `build-info.config.json` (a manifest of output paths those apps append
 * themselves to) and writes each one. Only the server templates (SSR, API) use
 * it — SSG doesn't — so it lives in `templates-shared/` and is written once per
 * repo (create-if-missing) regardless of how many of those apps are scaffolded.
 */
const fileSrc = `import { GenerateBuildInfo } from 'unirend/build-info';
import { promises as fs } from 'fs';
import path from 'path';

// Runs from the project root so GenerateBuildInfo picks up the version
// from the root package.json. Invoked via generate:build-info, which is
// which should be called by each app's build script as part of its build process.
//
// Output paths are listed in build-info.config.json (relative to the project
// root). Each generated file is gitignored.
//
// customProperties is intentionally not supported in build-info.config.json —
// static JSON cannot reference env vars, which is where custom properties get
// their real value (CI build numbers, deployment environment, etc.). To add
// custom properties, pass them directly to the GenerateBuildInfo constructor
// below: new GenerateBuildInfo({ customProperties: { ... } })

interface BuildInfoConfig {
  outputs: string[];
}

async function main() {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, 'build-info.config.json');

  const configRaw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(configRaw) as BuildInfoConfig;

  if (!Array.isArray(config.outputs)) {
    throw new TypeError(
      'build-info.config.json must define an "outputs" array',
    );
  }

  if (config.outputs.length === 0) {
    console.warn(
      'build-info.config.json has no outputs defined — nothing to generate.',
    );

    return;
  }

  const generator = new GenerateBuildInfo();
  const allWarnings: string[] = [];

  for (const outputPath of config.outputs) {
    // Resolve relative to project root and guard against path traversal
    const resolvedPath = path.resolve(rootDir, outputPath);

    if (!resolvedPath.startsWith(rootDir + path.sep)) {
      throw new Error(
        \`Output path "\${outputPath}" resolves outside the project root: \${resolvedPath}\`,
      );
    }

    // Infer output format from extension and save
    const ext = path.extname(resolvedPath);

    let result;

    if (ext === '.ts') {
      result = await generator.saveTS(outputPath);
    } else if (ext === '.json') {
      result = await generator.saveJSON(outputPath);
    } else {
      throw new Error(
        \`Unsupported output extension "\${ext}" for path "\${outputPath}". Only .ts and .json are supported.\`,
      );
    }

    allWarnings.push(...result.warnings);
  }

  // Report any warnings collected across all outputs
  if (allWarnings.length > 0) {
    console.warn('Build info warnings:\\n' + allWarnings.join('\\n'));
  }
}

main().catch((error) => {
  console.error('Failed to generate build info:', error);
  process.exit(1);
});
`;

/**
 * Ensure `scripts/generate-build-info.ts` exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites. Shared by the
 * server templates (SSR, API), so it's safe to call from each of their branches
 * — the second call is a no-op once the first app has written it.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureGenerateBuildInfo(
  root: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = 'scripts/generate-build-info.ts';

  try {
    const didWrite = await vfsWriteIfNotExists(root, relPath, fileSrc);

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
