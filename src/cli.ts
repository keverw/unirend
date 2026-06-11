/**
 * Unirend CLI - Project Generator
 *
 * How to run this CLI:
 *
 * 1. End users (after install):
 *    bunx unirend create ssg my-blog       (recommended; downloads if not installed)
 *    bun run unirend create ssg my-blog    (if installed with bun)
 *
 * 2. Development (run TypeScript source directly):
 *    bun run run-dev-cli create ssg my-blog
 *
 * 3. Test built version (after bun run build):
 *    bun run run-dist-cli create ssg my-blog
 *
 * Runtime:
 * - This CLI requires Bun. If not running under Bun, it will exit with an error.
 *
 *   Rationale: Bun can run TypeScript directly and bundle to a single JS file,
 *   which keeps the generator simple and easy out of the box. Generated projects
 *   can still run under Node when bundled (e.g., `bun build --target node --external vite`).
 *
 *   Note: While other tooling (ts-node, tsc + node, esbuild/rollup) can work,
 *   we standardize on Bun to maximize value for the least effort and keep
 *   maintenance straightforward—avoiding a complex matrix of toolchains.
 *   As Node tooling evolves, we may revisit a Node-focused CLI path.
 */

import { join, dirname, parse as parsePath, resolve, isAbsolute } from 'path';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { spawnSync } from 'child_process';
import { homedir } from 'os';
import {
  createProject,
  listAvailableTemplates,
  REPO_CONFIG_FILE,
  DEFAULT_REPO_NAME,
  listAvailableTemplatesWithInfo,
  initRepo,
} from './starter-templates';
import type { LogLevel, TemplateID } from './starter-templates';
import { PKG_VERSION } from './version';
import { parseCLIArgs, generateHelpText } from './lib/cli-helpers';
import type { CommandInfo } from './lib/cli-helpers';
import { gt as semverGt } from 'semver';
// ANSI color codes
const colors = {
  reset: '\u001b[0m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
} as const;

/**
 * Resolves a path that may contain ~ or be relative/absolute
 * - Expands ~ to home directory
 * - Resolves absolute paths as-is
 * - Resolves relative paths from current working directory
 */
function resolvePath(inputPath: string): string {
  // Expand ~ to home directory
  if (inputPath === '~') {
    return homedir();
  } else if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }

  // If already absolute, use as-is
  if (isAbsolute(inputPath)) {
    return resolve(inputPath);
  }

  // Otherwise treat as relative to cwd
  return resolve(process.cwd(), inputPath);
}

// Print function wrapper for console.log (CLI tools need console output)
// eslint-disable-next-line no-console
const print = console.log;

// Colored print function for different log levels
const colorPrint = (level: LogLevel, message: string) => {
  switch (level) {
    case 'error':
      // eslint-disable-next-line no-console
      console.error(`${colors.red}${message}${colors.reset}`);
      break;
    case 'warning':
      // eslint-disable-next-line no-console
      console.warn(`${colors.yellow}${message}${colors.reset}`);
      break;
    case 'success':
      // eslint-disable-next-line no-console
      console.log(`${colors.green}${message}${colors.reset}`);
      break;
    case 'info':
    default:
      // eslint-disable-next-line no-console
      console.log(`${colors.cyan}${message}${colors.reset}`);
      break;
  }
};

// Walk up from CWD to find a local node_modules/unirend installation.
// Returns the binary path and version string, or null if none is found.
// Walking up (rather than just checking CWD) handles the case where the
// CLI is run from a subdirectory of the workspace root.
function findLocalUnirend(): { binPath: string; version: string } | null {
  let dir = process.cwd();
  const { root } = parsePath(dir);

  while (true) {
    const binPath = join(dir, 'node_modules', '.bin', 'unirend');
    const pkgPath = join(dir, 'node_modules', 'unirend', 'package.json');

    // Require both so we can read the version — bin alone isn't enough.
    if (existsSync(binPath) && existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
          version?: string;
        };

        if (typeof pkg.version === 'string') {
          return { binPath, version: pkg.version };
        }
      } catch {
        // unreadable package.json — skip this directory and keep walking up
      }
    }

    if (dir === root) {
      break;
    }

    const parent = dirname(dir);

    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  return null;
}

// Parse command line arguments
const args = process.argv.slice(2);

// Detect if running under Bun runtime
// Bun exposes a global `Bun` object that Node.js doesn't have
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

// Enforce Bun runtime
if (!isBun) {
  colorPrint(
    'error',
    '❌ Unirend CLI requires Bun.\n' +
      '\n' +
      'Why: Bun runs TypeScript directly and bundles to a single JS file, keeping the CLI simple and easy out of the box.\n' +
      'Note: Generated projects can still run under Node when bundled (e.g., `bun build --target node --external vite`).\n' +
      '\n' +
      'Install Bun: https://bun.sh\n' +
      'Run with:\n' +
      '  bunx unirend ...   # recommended (downloads if not installed)\n' +
      '  bun run unirend ...',
  );

  process.exit(1);
}

// Delegate to a local unirend installation when the version differs from the
// one bunx downloaded. Set UNIREND_NO_DELEGATE=1 to skip (escape hatch, and
// also prevents re-exec loops when the local binary calls back into itself).
// Skip delegation when running from a .ts source file (dev mode).
if (
  !process.env.UNIREND_NO_DELEGATE &&
  !(process.argv[1] ?? '').endsWith('.ts')
) {
  // Look for a local unirend install. If one is found and its version differs
  // from the version bunx pulled down (in either direction), delegate to it so
  // the project always uses the version it was scaffolded with.
  const local = findLocalUnirend();

  // Any version difference triggers delegation — not just "local is older".
  // This ensures the project's pinned version is always what actually runs.
  if (local && local.version !== PKG_VERSION) {
    let isSelf = false;

    try {
      isSelf =
        realpathSync(local.binPath) === realpathSync(process.argv[1] ?? '');
    } catch {
      // can't resolve — assume not self, proceed with delegation
    }

    if (!isSelf) {
      const result = spawnSync(local.binPath, process.argv.slice(2), {
        stdio: 'inherit',
        // UNIREND_NO_DELEGATE prevents re-exec loops.
        // UNIREND_DELEGATED_FROM lets the local binary show which bunx version
        // invoked it (useful in `version` output to flag if bunx is newer).
        env: {
          ...process.env,
          UNIREND_NO_DELEGATE: '1',
          UNIREND_DELEGATED_FROM: PKG_VERSION,
        },
      });

      if (result.error) {
        colorPrint(
          'error',
          `Failed to run local unirend at ${local.binPath}: ${result.error.message}`,
        );
        process.exit(1);
      }

      // Forward the delegated process status; if it was terminated without a
      // numeric exit code, treat delegation as failed.
      process.exit(result.status ?? 1);
    }
  }
}

function showHelp(errorMessage?: string) {
  const availableTemplates = listAvailableTemplates();

  const commands: CommandInfo[] = [
    {
      command: 'init-repo [path]',
      description: [
        'Initialize a directory as a unirend repo',
        '- [path]: Directory path (optional, defaults to current directory)',
        "- --name: Repo name (optional, defaults to 'unirend-projects')",
      ],
    },
    {
      command: 'create <type> <name> [path] [--target bun|node]',
      description: [
        'Create a new project from template',
        `- <type>: Project template (${availableTemplates.join(', ')})`,
        '- <name>: Project name',
        '- [path]: Repo path (optional, defaults to current directory)',
        '- [--target bun|node]: Target runtime for server bundle/scripts (default: node)',
        '- Auto-init: If the repo is not initialized here, it will be created automatically with a default name',
      ],
    },
    {
      command: 'list',
      description: 'List all available templates with descriptions',
    },
    { command: 'help, -h, --help', description: 'Show this help message' },
    { command: 'version, -v, --version', description: 'Show version number' },
  ];

  const examples = [
    'bunx unirend init-repo',
    'bunx unirend init-repo ./my-workspace',
    'bunx unirend init-repo --name my-workspace',
    'bunx unirend init-repo ./projects --name my-workspace',
    'bunx unirend create ssg my-blog',
    'bunx unirend create ssr my-app ./projects',
    'bunx unirend create api my-api-server',
    'bunx unirend list',
    'bunx unirend help',
    'bunx unirend version',
  ];

  const helpText = generateHelpText(
    {
      title: '🚀 Unirend CLI - Generate starter projects for SSG, SSR, and API',
      commands,
      examples,
    },
    errorMessage,
  );

  print(helpText);
  print('');
  print(
    'Notes:\n' +
      '  - The repository setup supports multiple projects in one workspace.\n' +
      "  - You can run 'init-repo' to set it up explicitly, or rely on auto-init during 'create'.\n" +
      ('  - The repo name is stored in ' +
        REPO_CONFIG_FILE +
        ' and identifies your workspace.\n') +
      "  - The repo root's package.json uses your chosen names and sets private=true to avoid accidental publishing.",
  );
}

function showVersion() {
  print(`unirend v${PKG_VERSION}`);

  const delegatedFrom = process.env.UNIREND_DELEGATED_FROM;

  if (delegatedFrom) {
    // We are the local binary — show which bunx version invoked us.
    print(`  source: local (node_modules/unirend)`);
    if (semverGt(delegatedFrom, PKG_VERSION)) {
      print(
        `  bunx version: v${delegatedFrom} (newer — run: bun update unirend)`,
      );
    } else if (delegatedFrom !== PKG_VERSION) {
      print(`  bunx version: v${delegatedFrom}`);
    }
  } else {
    // Running directly without delegation — check for a local install and show
    // the comparison.
    const local = findLocalUnirend();
    if (local && local.version === PKG_VERSION) {
      print(`  local repo: v${local.version} (matches)`);
    } else if (local) {
      // Versions differ but delegation was skipped (such as dev mode).
      // Warn so it's obvious the running version isn't the local one.
      print(
        `  local repo: v${local.version} (differs — running bunx version, not local)`,
      );
    }
  }
}

// Main CLI function
async function main() {
  const parsed = parseCLIArgs(args);

  // Handle version command
  if (parsed.command === 'version') {
    showVersion();
    process.exit(0);
  }
  // Handle help command
  else if (parsed.command === 'help') {
    showHelp();
    process.exit(0);
  }
  // Handle list command
  else if (parsed.command === 'list') {
    print('🚀 Available Unirend Templates');
    print('');

    const templates = listAvailableTemplatesWithInfo();

    for (const template of templates) {
      print(`  ${template.templateID.padEnd(8)} ${template.name}`);
      print(`           ${template.description}`);
      print('');
    }

    process.exit(0);
  }
  // Handle init-repo command
  else if (parsed.command === 'init-repo') {
    // Determine target directory (with ~ expansion and absolute path support)
    const targetDir = parsed.repoPath
      ? resolvePath(parsed.repoPath)
      : process.cwd();

    // Determine repo name (from flag or default)
    const repoName = parsed.repoName || DEFAULT_REPO_NAME;

    // Initialize repo (validates and writes config) with logger
    const initResult = await initRepo(targetDir, {
      name: repoName,
      logger: colorPrint,
    });

    if (initResult.success) {
      colorPrint('info', '');
      colorPrint('info', 'You can now create projects in this repo:');
      colorPrint('info', '  bunx unirend create ssg my-blog');
      process.exit(0);
    } else {
      // initRepo already logged the error details, just exit with error code
      process.exit(1);
    }
  }
  // Handle create command
  else if (parsed.command === 'create') {
    if (!parsed.projectType || !parsed.projectName) {
      showHelp('Missing required arguments');
      process.exit(1);
    }

    // CLI handles default path logic - defaults to current working directory
    // Properly resolves ~ expansion and absolute paths
    const repoRoot = parsed.repoPath
      ? resolvePath(parsed.repoPath)
      : process.cwd();

    // Use starter-templates library to create project.
    // Name validation is handled by the library; template validation is too
    // (createProject runs templateExists at runtime). We cast templateID at
    // this seam because the parser only knows it's a `string`. `parsed.target`
    // is already typed `'bun' | 'node' | undefined`, so no cast is needed —
    // just defaults to `'node'` when omitted.
    const result = await createProject({
      templateID: parsed.projectType as TemplateID,
      projectName: parsed.projectName,
      repoRoot,
      logger: colorPrint,
      serverBuildTarget: parsed.target ?? 'node',
    });

    if (!result.success) {
      process.exit(1);
    }
  }
  // Handle unknown command
  else if (parsed.command === 'unknown') {
    showHelp(`Unknown command "${parsed.unknownCommand}"`);
    process.exit(1);
  }
  // Handle invalid arguments to a known command (bad --target value,
  // extra positional args, etc.). The parser hands back the raw facts
  // (which reason and any accompanying data); message wording lives here
  // so it stays consistent with the rest of the CLI's user-facing copy.
  else if (parsed.command === 'invalid_args') {
    let message: string;

    if (parsed.reason === 'missing_target_value') {
      message = 'Missing value for --target; expected "bun" or "node".';
    } else if (parsed.reason === 'missing_name_value') {
      message = 'Missing value for --name.';
    } else if (parsed.reason === 'invalid_target_value') {
      message = `Invalid --target value "${parsed.value}"; expected "bun" or "node".`;
    } else if (parsed.reason === 'extra_positional') {
      const label = parsed.extras.length === 1 ? 'argument' : 'arguments';
      const quoted = parsed.extras.map((a) => `"${a}"`).join(', ');
      message = `Unexpected positional ${label}: ${quoted}.`;
    } else if (parsed.reason === 'duplicate_flag') {
      message = `Flag ${parsed.flag} was provided more than once.`;
    } else {
      // Exhaustiveness — TS errors here if a new `invalid_args` reason
      // is added without a matching branch above.
      const _exhaustive: never = parsed;
      void _exhaustive;
      message = 'Invalid arguments.';
    }

    showHelp(message);
    process.exit(1);
  } else {
    // Unhandled command, which should never happen as something wasn't implemented
    // show a helpful error message about the command that was not implemented
    const details = JSON.stringify(parsed, null, 2);
    showHelp(`Command not implemented. Parser output:\n${details}`);
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  colorPrint(
    'error',
    `❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );

  process.exit(1);
});
