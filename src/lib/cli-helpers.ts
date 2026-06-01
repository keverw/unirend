/**
 * CLI argument parsing helpers
 */

export type ParsedCLIArgs =
  | { command: 'help' }
  | { command: 'version' }
  | { command: 'list' }
  | {
      command: 'init-repo';
      repoPath?: string;
      repoName?: string;
    }
  | {
      command: 'create';
      projectType?: string;
      projectName?: string;
      repoPath?: string;
      target?: 'bun' | 'node';
    }
  | {
      command: 'unknown';
      unknownCommand: string;
    }
  // Recognized command, but the arguments it received were malformed.
  // The parser returns the raw facts (which reason fired and any
  // accompanying data). The CLI is responsible for turning each `reason`
  // into a user-facing error message. Same split as `unknown`: parser =
  // what was seen, CLI = how to talk to the user.
  | { command: 'invalid_args'; reason: 'missing_target_value' }
  | { command: 'invalid_args'; reason: 'missing_name_value' }
  | { command: 'invalid_args'; reason: 'invalid_target_value'; value: string }
  | {
      command: 'invalid_args';
      reason: 'extra_positional';
      extras: string[];
    }
  | { command: 'invalid_args'; reason: 'duplicate_flag'; flag: string };

/**
 * Parse CLI arguments into structured command and options
 * @param args - Command line arguments (process.argv.slice(2))
 * @returns Parsed command and options
 */

export function parseCLIArgs(args: string[]): ParsedCLIArgs {
  // Handle empty args
  if (args.length === 0) {
    return { command: 'help' };
  }

  // Handle version flags
  if (args.includes('--version') || args.includes('-v')) {
    return { command: 'version' };
  }

  // Handle help flags
  if (args.includes('--help') || args.includes('-h')) {
    return { command: 'help' };
  }

  const firstArg = args[0];

  // Handle help command
  if (firstArg === 'help') {
    return { command: 'help' };
  } else if (firstArg === 'version') {
    // Handle version command
    return { command: 'version' };
  } else if (firstArg === 'list') {
    // Handle list command
    return { command: 'list' };
  } else if (firstArg === 'init-repo') {
    // Handle init-repo command
    return parseInitRepoArgs(args);
  } else if (firstArg === 'create') {
    // Handle create command
    return parseCreateArgs(args);
  } else {
    // Unknown command
    return {
      command: 'unknown',
      unknownCommand: firstArg,
    };
  }
}

/**
 * Parse init-repo command arguments
 */

/**
 * Parse arguments for the `init-repo` command.
 *
 * Expected shape: `init-repo [path] [--name <repoName>]`
 *
 * - `--name` captures the next arg as the repo name. A missing value (flag
 *   at end of args or immediately followed by another flag) returns
 *   `invalid_args` rather than silently falling back to the default name.
 *   Duplicate `--name` is also rejected.
 * - The first non-flag arg (skipping `--name`'s value) is treated as
 *   `[path]`. Any additional non-flag args are rejected as extras so the
 *   user knows their input wasn't ignored.
 */

function parseInitRepoArgs(args: string[]): ParsedCLIArgs {
  // Reject duplicate flags up front so the rest of the parser can assume each appears at most once.
  if (args.filter((a) => a === '--name').length > 1) {
    return {
      command: 'invalid_args',
      reason: 'duplicate_flag',
      flag: '--name',
    };
  }

  // --name <repoName> — capture the value following --name if present.
  // Done with a simple indexOf because --name appears at most once.
  const nameIndex = args.indexOf('--name');

  // --name with nothing after it (or another flag immediately following): surface as an
  // error rather than silently falling back to the default repo name.
  if (
    nameIndex !== -1 &&
    (args[nameIndex + 1] === undefined || args[nameIndex + 1].startsWith('--'))
  ) {
    return { command: 'invalid_args', reason: 'missing_name_value' };
  }

  const repoName =
    nameIndex !== -1 && args[nameIndex + 1] ? args[nameIndex + 1] : undefined;

  // Walk every arg after the 'init-repo' command word and collect anything
  // that's a positional (i.e. not a flag and not the value attached to
  // --name). The first positional becomes [path]; any further ones are
  // extras and get rejected below.
  const positional: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    // Skip flags themselves (--name, --whatever).
    if (arg.startsWith('--')) {
      continue;
    }

    // Skip the value that follows --name; the indexOf above already
    // claimed it as the repo name.
    if (args[i - 1] === '--name') {
      continue;
    }

    positional.push(arg);
  }

  const [repoPath, ...extras] = positional;

  if (extras.length > 0) {
    return {
      command: 'invalid_args',
      reason: 'extra_positional',
      extras,
    };
  }

  return {
    command: 'init-repo',
    repoPath,
    repoName,
  };
}

/**
 * Parse create command arguments
 */

/**
 * Parse arguments for the `create` command.
 *
 * Expected shape: `create <type> <name> [path] [--target bun|node]`
 *
 * - `<type>` and `<name>` are taken from `args[1]` and `args[2]` directly
 *   (positional, in order). They're left as `undefined` if absent; the
 *   CLI surfaces the "missing required arguments" case via `showHelp`.
 * - `--target` accepts only `bun` or `node`. A missing value, unrecognized
 *   value, or duplicate flag returns `invalid_args` rather than silently
 *   defaulting, so typos surface as errors instead of getting masked by
 *   the CLI's `'node'` fallback.
 * - The first non-flag arg after `<name>` becomes `[path]`. Any further
 *   non-flag args are rejected as extras.
 */

function parseCreateArgs(args: string[]): ParsedCLIArgs {
  // Reject duplicate flags up front so the rest of the parser can assume each appears at most once.
  if (args.filter((a) => a === '--target').length > 1) {
    return {
      command: 'invalid_args',
      reason: 'duplicate_flag',
      flag: '--target',
    };
  }

  let projectType: string | undefined;
  let projectName: string | undefined;
  let repoPath: string | undefined;
  let target: 'bun' | 'node' | undefined;

  // <type> and <name> are positional, taken straight from args[1..2].
  if (args.length > 1) {
    projectType = args[1];
  }

  if (args.length > 2) {
    projectName = args[2];
  }

  // Walk anything after <name>: pick up --target's value (validated), claim
  // the first non-flag as [path], collect any further non-flag args into
  // `extras` so we can reject them below.
  const extras: string[] = [];

  for (let i = 3; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--target') {
      const value = args[i + 1];

      // --target with nothing after it: surface as an error rather than
      // silently letting the CLI's default kick in.
      if (value === undefined) {
        return { command: 'invalid_args', reason: 'missing_target_value' };
      }

      // Only 'bun' and 'node' are accepted. Anything else (typo, etc.)
      // surfaces as an error so the user knows their value was rejected
      // instead of silently swapped for the default.
      if (value !== 'bun' && value !== 'node') {
        return {
          command: 'invalid_args',
          reason: 'invalid_target_value',
          value,
        };
      }

      target = value;
      i++; // skip past the value we just consumed
    } else if (!arg.startsWith('--') && repoPath === undefined) {
      // First unclaimed positional becomes [path].
      repoPath = arg;
    } else if (!arg.startsWith('--')) {
      // Additional positional args aren't part of the `create` shape.
      extras.push(arg);
    }
  }

  if (extras.length > 0) {
    return {
      command: 'invalid_args',
      reason: 'extra_positional',
      extras,
    };
  }

  return {
    command: 'create',
    projectType,
    projectName,
    repoPath,
    target,
  };
}

/**
 * Format a command/option line with consistent indentation and alignment
 * @param indent - Initial indentation (e.g., "  ")
 * @param command - Command name/signature (e.g., "create" or "help, -h, --help")
 * @param description - Description text (can be single or multi-line)
 * @param commandWidth - Width to pad command to for alignment (default: 24)
 * @returns Formatted lines as an array
 */
export function formatCommandLine(
  indent: string,
  command: string,
  description: string | string[],
  commandWidth = 24,
): string[] {
  const lines: string[] = [];
  const descLines = Array.isArray(description) ? description : [description];

  // Handle empty description array
  if (descLines.length === 0) {
    const paddedCommand = command.padEnd(commandWidth);
    lines.push(`${indent}${paddedCommand}(no description)`);
    return lines;
  }

  // First line: indent + command (padded) + first description line
  const paddedCommand = command.padEnd(commandWidth);
  lines.push(`${indent}${paddedCommand}${descLines[0]}`);

  // Additional lines: indent + spaces (matching indent + command width) + description
  for (let i = 1; i < descLines.length; i++) {
    const totalSpacing = ' '.repeat(indent.length + commandWidth);
    lines.push(`${totalSpacing}${descLines[i]}`);
  }

  return lines;
}

export interface CommandInfo {
  command: string;
  description: string | string[];
}

export interface HelpTextConfig {
  title: string;
  commands: CommandInfo[];
  examples?: string[];
}

/**
 * Generate help text for a CLI
 * @param config - Help text configuration
 * @param errorMessage - Optional error message to display
 * @returns Help text as a string
 */
export function generateHelpText(
  config: HelpTextConfig,
  errorMessage?: string,
): string {
  const { title, commands, examples = [] } = config;
  const lines: string[] = [];

  if (errorMessage) {
    lines.push(`❌ Error: ${errorMessage}`);
    lines.push('');
  }

  lines.push(title);
  lines.push('');

  // Calculate the longest command length and add padding
  const maxCommandLength = Math.max(...commands.map((c) => c.command.length));
  const commandWidth = maxCommandLength + 4; // Add 4 spaces padding

  // Commands section
  lines.push('Commands:');

  for (const { command, description } of commands) {
    lines.push(...formatCommandLine('  ', command, description, commandWidth));
  }

  lines.push('');

  // Examples section (only if examples provided)
  if (examples.length > 0) {
    lines.push('Examples:');

    for (const example of examples) {
      lines.push(`  ${example}`);
    }
  }

  return lines.join('\n');
}
