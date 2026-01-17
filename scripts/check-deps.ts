/**
 * Script to validate that all peerDependencies and devDependencies in package.json
 * are included in the starter template dependencies with matching or compatible versions.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import semver from 'semver';
import {
  dependencies as templateDependencies,
  devDependencies as templateDevDependencies,
} from '../src/lib/starter-templates/base-files/package-json';

interface ValidationError {
  package: string;
  issue: string;
  peerVersion: string;
  templateVersion?: string;
}

const REPO_ROOT = join(import.meta.dir, '..');

/**
 * Check if the template version satisfies the peer dependency version range
 */
function isVersionCompatible(
  peerVersion: string,
  templateVersion: string,
): boolean {
  try {
    // Get the minimum version from the template version range
    const templateMin = semver.minVersion(templateVersion);
    if (!templateMin) {
      return false;
    }

    // Check if the template's minimum version satisfies the peer dependency range
    return semver.satisfies(templateMin, peerVersion);
  } catch {
    // If semver parsing fails, fall back to exact string comparison
    return peerVersion === templateVersion;
  }
}

async function main() {
  console.log(
    '🔍 Checking that starter template includes all unirend dependencies...\n',
  );

  // Read main package.json
  const mainPkgPath = join(REPO_ROOT, 'package.json');
  const mainPkgContent = await readFile(mainPkgPath, 'utf-8');
  const mainPkg = JSON.parse(mainPkgContent) as {
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const errors: ValidationError[] = [];

  // Check peer dependencies
  if (mainPkg.peerDependencies) {
    console.log('📦 Checking peer dependencies...');
    for (const [pkg, peerVersion] of Object.entries(mainPkg.peerDependencies)) {
      // Check if this peer dependency exists in either dependencies or devDependencies of the starter template
      const templateVersion =
        (templateDependencies as Record<string, string>)[pkg] ||
        (templateDevDependencies as Record<string, string>)[pkg];

      if (!templateVersion) {
        errors.push({
          package: pkg,
          issue: 'missing',
          peerVersion,
        });
        continue;
      }

      // Check if template version satisfies the peer dependency range
      if (!isVersionCompatible(peerVersion, templateVersion)) {
        errors.push({
          package: pkg,
          issue: 'version_mismatch',
          peerVersion,
          templateVersion,
        });
      }
    }
  }

  // Check dev dependencies (only if they exist in both places)
  if (mainPkg.devDependencies) {
    console.log('🔧 Checking dev dependencies (shared with template)...');
    for (const [pkg, devVersion] of Object.entries(mainPkg.devDependencies)) {
      // Check if this dev dependency exists in either dependencies or devDependencies of the starter template
      const templateVersion =
        (templateDependencies as Record<string, string>)[pkg] ||
        (templateDevDependencies as Record<string, string>)[pkg];

      // Skip if not in template (dev deps are often just for the lib itself)
      if (!templateVersion) {
        continue;
      }

      // Check if template version satisfies the dev dependency range
      if (!isVersionCompatible(devVersion, templateVersion)) {
        errors.push({
          package: pkg,
          issue: 'version_mismatch',
          peerVersion: devVersion,
          templateVersion,
        });
      }
    }
  }

  if (!mainPkg.peerDependencies && !mainPkg.devDependencies) {
    console.log('✅ No dependencies to check');
    return;
  }

  // Report results
  if (errors.length === 0) {
    console.log(
      '✅ All dependencies are properly configured in the starter template\n',
    );

    process.exit(0);
  }

  console.error('❌ Dependency validation failed:\n');

  for (const error of errors) {
    if (error.issue === 'missing') {
      console.error(
        `  • ${error.package}: Missing from starter template (required: ${error.peerVersion})`,
      );
    } else if (error.issue === 'version_mismatch') {
      console.error(
        `  • ${error.package}: Version mismatch (required: ${error.peerVersion}, template: ${error.templateVersion})`,
      );
    }
  }

  console.error(
    '\n💡 Fix: Update src/lib/starter-templates/base-files/package-json.ts\n',
  );

  process.exit(1);
}

main().catch((error) => {
  console.error('❌ Script error:', error);
  process.exit(1);
});
