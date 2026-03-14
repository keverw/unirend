import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import semver from 'semver';
import { $ } from 'bun';

interface ComposerPackageConfig {
  require?: Record<string, string>;
}

const projectRoot = join(import.meta.dir, '..');
const phpDir = join(projectRoot, 'unirend-php');
const composerPath = join(phpDir, 'composer.json');
const vendorAutoloadPath = join(phpDir, 'vendor', 'autoload.php');
const phpUnitBinaryPath = join(phpDir, 'vendor', 'bin', 'phpunit');

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

async function commandExists(command: string): Promise<boolean> {
  const result = await $`which ${command}`.quiet().nothrow();
  return result.exitCode === 0;
}

async function main() {
  console.log('Checking PHP test prerequisites...\n');

  if (!existsSync(composerPath)) {
    fail(`Missing composer.json at ${composerPath}`);
  }

  const hasPhp = await commandExists('php');

  if (!hasPhp) {
    fail('php is not installed or not in PATH');
  }

  console.log('OK: php is available');

  const hasComposer = await commandExists('composer');

  if (!hasComposer) {
    fail('composer is not installed or not in PATH');
  }

  console.log('OK: composer is available');

  const phpVersionRaw = (await $`php -r "echo PHP_VERSION;"`.text()).trim();
  const phpVersion = semver.coerce(phpVersionRaw);

  if (!phpVersion) {
    fail(`Could not parse PHP version: "${phpVersionRaw}"`);
  }

  const composerPackageConfig = JSON.parse(
    readFileSync(composerPath, 'utf-8'),
  ) as ComposerPackageConfig | undefined;
  const requiredPhpRange = composerPackageConfig?.require?.php;

  if (requiredPhpRange) {
    const normalizedRange = semver.validRange(requiredPhpRange, {
      loose: true,
    });

    if (!normalizedRange) {
      console.warn(
        `WARN: Could not semver-parse composer PHP requirement "${requiredPhpRange}", skipping strict version check`,
      );
    } else if (
      !semver.satisfies(phpVersion.version, normalizedRange, {
        includePrerelease: true,
      })
    ) {
      fail(
        `PHP ${phpVersion.version} does not satisfy unirend-php requirement ${requiredPhpRange}`,
      );
    } else {
      console.log(
        `OK: PHP ${phpVersion.version} satisfies requirement ${requiredPhpRange}`,
      );
    }
  } else {
    console.warn(
      'WARN: No "require.php" constraint found in unirend-php/composer.json',
    );
  }

  const composerVersionCheck =
    await $`composer --working-dir ${phpDir} --no-ansi --version`
      .quiet()
      .nothrow();

  if (composerVersionCheck.exitCode !== 0) {
    fail('composer command failed when executed in unirend-php/');
  }

  console.log('OK: composer runs successfully inside unirend-php');

  const hasVendorAutoload = existsSync(vendorAutoloadPath);

  if (!hasVendorAutoload) {
    fail(
      'PHP dependencies are not installed (missing unirend-php/vendor/autoload.php). Run: bun run php-install-deps',
    );
  }

  const hasPHPUnitBinary = existsSync(phpUnitBinaryPath);

  if (!hasPHPUnitBinary) {
    fail(
      'PHPUnit binary not found at unirend-php/vendor/bin/phpunit. Run: bun run php-install-deps',
    );
  }

  console.log('\nOK: PHP test setup check passed');
}

main().catch((error) => {
  console.error('ERROR: Script error:', error);
  process.exit(1);
});
