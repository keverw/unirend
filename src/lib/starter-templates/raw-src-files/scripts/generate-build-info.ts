import { GenerateBuildInfo } from 'unirend/build-info';
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
        `Output path "${outputPath}" resolves outside the project root: ${resolvedPath}`,
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
        `Unsupported output extension "${ext}" for path "${outputPath}". Only .ts and .json are supported.`,
      );
    }

    allWarnings.push(...result.warnings);
  }

  // Report any warnings collected across all outputs
  if (allWarnings.length > 0) {
    console.warn('Build info warnings:\n' + allWarnings.join('\n'));
  }
}

main().catch((error) => {
  console.error('Failed to generate build info:', error);
  process.exit(1);
});
