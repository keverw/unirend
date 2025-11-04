/**
 * CLI argument parsing helpers
 */

export type ParsedCLIArgs =
  | { command: "help" }
  | { command: "version" }
  | { command: "list" }
  | {
      command: "init-monorepo";
      monorepoPath?: string;
      monorepoName?: string;
    }
  | {
      command: "create";
      projectType?: string;
      projectName?: string;
      projectPath?: string;
    }
  | {
      command: "unknown";
      unknownCommand: string;
    };

/**
 * Parse CLI arguments into structured command and options
 * @param args - Command line arguments (process.argv.slice(2))
 * @returns Parsed command and options
 */

export function parseCLIArgs(args: string[]): ParsedCLIArgs {
  // Handle empty args
  if (args.length === 0) {
    return { command: "help" };
  }

  // Handle version flags
  if (args.includes("--version") || args.includes("-v")) {
    return { command: "version" };
  }

  // Handle help flags
  if (args.includes("--help") || args.includes("-h")) {
    return { command: "help" };
  }

  const firstArg = args[0];

  // Handle help command
  if (firstArg === "help") {
    return { command: "help" };
  } else if (firstArg === "version") {
    // Handle version command
    return { command: "version" };
  } else if (firstArg === "list") {
    // Handle list command
    return { command: "list" };
  } else if (firstArg === "init-monorepo") {
    // Handle init-monorepo command
    return parseInitMonorepoArgs(args);
  } else if (firstArg === "create") {
    // Handle create command
    return parseCreateArgs(args);
  } else {
    // Unknown command
    return {
      command: "unknown",
      unknownCommand: firstArg,
    };
  }
}

/**
 * Parse init-monorepo command arguments
 */

function parseInitMonorepoArgs(args: string[]): ParsedCLIArgs {
  // Get --name flag value
  const nameIndex = args.indexOf("--name");
  const monorepoName =
    nameIndex !== -1 && args[nameIndex + 1] ? args[nameIndex + 1] : undefined;

  // Get path argument (first non-flag argument after command)
  const monorepoPath = args.find(
    (arg, i) => i > 0 && !arg.startsWith("--") && args[i - 1] !== "--name",
  );

  return {
    command: "init-monorepo",
    monorepoPath,
    monorepoName,
  };
}

/**
 * Parse create command arguments
 */

function parseCreateArgs(args: string[]): ParsedCLIArgs {
  const projectType = args[1];
  const projectName = args[2];
  const projectPath = args[3];

  return {
    command: "create",
    projectType,
    projectName,
    projectPath,
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
    const totalSpacing = " ".repeat(indent.length + commandWidth);
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
    lines.push("");
  }

  lines.push(title);
  lines.push("");

  // Calculate the longest command length and add padding
  const maxCommandLength = Math.max(...commands.map((c) => c.command.length));
  const commandWidth = maxCommandLength + 4; // Add 4 spaces padding

  // Commands section
  lines.push("Commands:");

  for (const { command, description } of commands) {
    lines.push(...formatCommandLine("  ", command, description, commandWidth));
  }

  lines.push("");

  // Examples section (only if examples provided)
  if (examples.length > 0) {
    lines.push("Examples:");

    for (const example of examples) {
      lines.push(`  ${example}`);
    }
  }

  return lines.join("\n");
}
