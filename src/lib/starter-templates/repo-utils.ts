import { spawn } from 'child_process';
import { FileRoot, isInMemoryFileRoot, vfsExists } from './vfs';
import { Logger } from './types';

/**
 * Run a command asynchronously, capturing stdout/stderr and surfacing spawn errors.
 * Resolves once, via either 'error' or 'close'.
 * Never throws; callers should inspect the returned shape.
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'pipe',
    });

    let isResolved = false;
    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8').on('data', (data: string) => {
      stdout += data;
    });

    child.stderr?.setEncoding('utf8').on('data', (data: string) => {
      stderr += data;
    });

    const safeResolve = (payload: {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      error?: Error;
    }) => {
      if (isResolved) {
        return;
      }
      isResolved = true;
      resolve(payload);
    };

    child.on('error', (err: Error) => {
      safeResolve({ exitCode: null, stdout, stderr, error: err });
    });

    child.on('close', (code: number | null) => {
      safeResolve({ exitCode: code, stdout, stderr });
    });
  });
}

/**
 * Initialize git repository if not already initialized.
 * Only works for filesystem mode - gracefully skips for in-memory.
 * Fails gracefully if git command is not found.
 * Never throws - all errors are logged as warnings.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 */
export async function initGitRepo(root: FileRoot, log?: Logger): Promise<void> {
  // Skip for in-memory mode
  if (isInMemoryFileRoot(root)) {
    return;
  }

  try {
    // Check if .git directory already exists
    const doesGitExist = await vfsExists(root, '.git');

    if (doesGitExist) {
      if (log) {
        log('info', 'Git repository already initialized');
      }

      return;
    }

    // Try to run `git init` in the repo root
    const result = await runCommand('git', ['init'], root);

    if (result.error) {
      const msg = result.error.message;

      if (log) {
        if (msg.includes('ENOENT') || msg.includes('not found')) {
          log('warning', '⚠️  Git not found - skipping git init');
          log(
            'warning',
            '   Install git to enable automatic repository initialization',
          );
        } else {
          log('warning', `⚠️  Failed to spawn git: ${msg}`);
        }
      }

      return;
    }

    if (result.exitCode === 0) {
      if (log) {
        log('info', '🔧 Initialized git repository');
      }
    } else {
      if (log) {
        log('warning', '⚠️  Failed to initialize git repository');
        if (result.stderr?.trim()) {
          log('warning', `   ${result.stderr.trim()}`);
        }
      }
    }
  } catch (err) {
    // Handle all errors gracefully - never throw
    if (log) {
      const msg = err instanceof Error ? err.message : String(err);

      // Check if git command not found
      if (
        msg.includes('ENOENT') ||
        msg.includes('not found') ||
        msg.includes('No such file')
      ) {
        log('warning', '⚠️  Git not found - skipping git init');
        log(
          'warning',
          '   Install git to enable automatic repository initialization',
        );
      } else {
        log('warning', `⚠️  Failed to initialize git: ${msg}`);
      }
    }
  }
}

/**
 * Install dependencies in a directory using bun install.
 * Gracefully handles errors (e.g., bun not found) by logging warnings.
 * Never throws - always returns successfully even if installation fails.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 */
export async function installDependencies(
  root: FileRoot,
  log?: Logger,
): Promise<void> {
  // Skip for in-memory mode
  if (isInMemoryFileRoot(root)) {
    return;
  }

  try {
    if (log) {
      log('info', '📦 Installing dependencies...');
    }

    // Run `bun install` in the directory
    const result = await runCommand('bun', ['install'], root);

    if (result.error) {
      const msg = result.error.message;

      if (log) {
        if (msg.includes('ENOENT') || msg.includes('not found')) {
          log(
            'warning',
            '⚠️  Bun not found - skipping dependency installation',
          );
          log(
            'warning',
            '   Run `bun install` manually to install dependencies',
          );
        } else {
          log('warning', `⚠️  Failed to spawn bun: ${msg}`);
        }
      }
      return;
    }

    if (result.exitCode === 0) {
      if (log) {
        log('info', '✅ Dependencies installed successfully');
      }
    } else {
      if (log) {
        log('warning', '⚠️  Failed to install dependencies');
        if (result.stderr?.trim()) {
          log('warning', `   ${result.stderr.trim()}`);
        }
      }
    }
  } catch (err) {
    // Handle all errors gracefully - never throw
    if (log) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warning', `⚠️  Failed to install dependencies: ${msg}`);
    }
  }
}

/**
 * Auto-format code in a directory using bun run format.
 *
 * Checks if node_modules/prettier exists before attempting to format.
 * Gracefully handles errors (e.g., prettier not installed) by logging warnings.
 * Never throws - always returns successfully even if formatting fails.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 */
export async function autoFormatCode(
  root: FileRoot,
  log?: Logger,
): Promise<void> {
  // Skip for in-memory mode
  if (isInMemoryFileRoot(root)) {
    return;
  }

  try {
    // Check if node_modules/prettier exists before attempting to format
    const hasPrettier = await vfsExists(root, 'node_modules/prettier');

    if (!hasPrettier) {
      if (log) {
        log(
          'info',
          '⏭️  Skipping auto-format (dependencies - prettier not installed)',
        );
      }

      return;
    }

    if (log) {
      log('info', '✨ Auto-formatting code...');
    }

    // Run `bun run format` in the directory
    const result = await runCommand('bun', ['run', 'format'], root);

    if (result.error) {
      const msg = result.error.message;

      if (log) {
        if (msg.includes('ENOENT') || msg.includes('not found')) {
          log('warning', '⚠️  Bun not found - skipping auto-format');
          log('warning', '   Run `bun run format` manually to format code');
        } else {
          log('warning', `⚠️  Failed to spawn bun: ${msg}`);
        }
      }

      return;
    }

    if (result.exitCode === 0) {
      if (log) {
        log('info', '✅ Code formatted successfully');
      }
    } else {
      if (log) {
        log('warning', '⚠️  Failed to format code');

        if (result.stderr?.trim()) {
          log('warning', `   ${result.stderr.trim()}`);
        }
      }
    }
  } catch (err) {
    // Handle all errors gracefully - never throw
    if (log) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warning', `⚠️  Failed to format code: ${msg}`);
    }
  }
}
