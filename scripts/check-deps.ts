/**
 * Script to validate dependency consistency across three surfaces:
 * 1. Starter template — every peerDependency must be present with a compatible version.
 * 2. Our own devDependencies — every peerDependency must also be in devDependencies so we
 *    test against the same version range we tell consumers to use.
 * 3. Template/dev overlap — devDependencies that also appear in the starter template must
 *    stay in sync so we don't ship a template that doesn't match what we develop against.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import semver from 'semver';
import {
  dependencies as templateDependencies,
  devDependencies as templateDevDependencies,
} from '../src/lib/starter-templates/base-files/package-json';

type IssueKind =
  | 'template_missing'
  | 'template_peer_mismatch'
  | 'template_dev_mismatch'
  | 'package_peer_missing_dev'
  | 'package_peer_dev_mismatch';

interface ValidationError {
  package: string;
  issue: IssueKind;
  /** The version from the surface being checked (peerDep, devDep, etc.) */
  foundVersion: string;
  templateVersion?: string;
  devVersion?: string;
}

const REPO_ROOT = join(import.meta.dir, '..');

/**
 * Check whether the minimum of `candidateRange` satisfies `requiredRange`.
 * Used to verify that a version in one surface (template, devDep) is compatible
 * with a version range declared in another (peerDep, devDep).
 */
function isVersionCompatible(
  requiredRange: string,
  candidateRange: string,
): boolean {
  try {
    // Get the minimum version from the candidate range
    const candidateMin = semver.minVersion(candidateRange);

    if (!candidateMin) {
      return false;
    }

    // Check if the minimum version satisfies the required range
    return semver.satisfies(candidateMin, requiredRange);
  } catch {
    // If semver parsing fails, fall back to exact string comparison
    return requiredRange === candidateRange;
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

    for (const [pkg, foundVersion] of Object.entries(
      mainPkg.peerDependencies,
    )) {
      // Check if this peer dependency exists in either dependencies or devDependencies of the starter template
      const templateVersion =
        (templateDependencies as Record<string, string>)[pkg] ||
        (templateDevDependencies as Record<string, string>)[pkg];

      if (!templateVersion) {
        errors.push({
          package: pkg,
          issue: 'template_missing',
          foundVersion,
        });

        continue;
      }

      // Check if template version satisfies the peer dependency range
      if (!isVersionCompatible(foundVersion, templateVersion)) {
        errors.push({
          package: pkg,
          issue: 'template_peer_mismatch',
          foundVersion,
          templateVersion,
        });
      }
    }
  }

  // Check that each peerDependency is also in devDependencies — if we tell consumers to use a version range,
  // we should be testing against it locally, not whatever happens to be installed
  if (mainPkg.peerDependencies && mainPkg.devDependencies) {
    console.log('🔗 Checking peer/dev dependency consistency...');

    for (const [pkg, foundVersion] of Object.entries(
      mainPkg.peerDependencies,
    )) {
      const devVersion = mainPkg.devDependencies[pkg];

      if (!devVersion) {
        errors.push({
          package: pkg,
          issue: 'package_peer_missing_dev',
          foundVersion,
        });

        continue;
      }

      if (!isVersionCompatible(foundVersion, devVersion)) {
        errors.push({
          package: pkg,
          issue: 'package_peer_dev_mismatch',
          foundVersion,
          devVersion,
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
          issue: 'template_dev_mismatch',
          foundVersion: devVersion,
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
    if (error.issue === 'template_missing') {
      console.error(
        `  • ${error.package}: peerDependency (${error.foundVersion}) is missing from the starter template (src/lib/starter-templates/base-files/package-json.ts)`,
      );
    } else if (error.issue === 'template_peer_mismatch') {
      console.error(
        `  • ${error.package}: peerDependency (${error.foundVersion}) is incompatible with starter template version (${error.templateVersion}) — fix in src/lib/starter-templates/base-files/package-json.ts`,
      );
    } else if (error.issue === 'template_dev_mismatch') {
      console.error(
        `  • ${error.package}: devDependency (${error.foundVersion}) is incompatible with starter template version (${error.templateVersion}) — fix in src/lib/starter-templates/base-files/package-json.ts`,
      );
    } else if (error.issue === 'package_peer_missing_dev') {
      console.error(
        `  • ${error.package}: peerDependency (${error.foundVersion}) is not listed in devDependencies — you're telling consumers to use ${error.foundVersion} but not testing against it`,
      );
    } else if (error.issue === 'package_peer_dev_mismatch') {
      console.error(
        `  • ${error.package}: testing against ${error.devVersion} (devDependency) but telling consumers to use ${error.foundVersion} (peerDependency) — these should be compatible`,
      );
    }
  }

  console.error(
    '\n💡 Fix: Update package.json devDependencies or src/lib/starter-templates/base-files/package-json.ts\n',
  );

  process.exit(1);
}

main().catch((error) => {
  console.error('❌ Script error:', error);
  process.exit(1);
});
