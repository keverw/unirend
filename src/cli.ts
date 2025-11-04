/**
 * Unirend CLI - Project Generator
 *
 * How to run this CLI:
 *
 * 1. End users (after npm/bun install):
 *    npx unirend create ssg my-blog        (downloads if not installed)
 *    bunx unirend create ssg my-blog       (bun equivalent to npx, downloads if not installed)
 *    bun run unirend create ssg my-blog    (if installed with bun)
 *    node run unirend create ssg my-blog   (if installed with npm)
 *
 * 2. Development (run TypeScript source directly):
 *    bun run run-dev-cli create ssg my-blog
 *
 * 3. Test built version (after bun run build):
 *    bun run run-dist-cli create ssg my-blog
 */

import { join } from "path";
import {
  createProject,
  listAvailableTemplates,
  MONOREPO_CONFIG_FILE,
  DEFAULT_MONOREPO_NAME,
  type LogLevel,
  listAvailableTemplatesWithInfo,
  initMonorepo,
} from "./starter-templates";
import { CLI_VERSION } from "./version";
import {
  parseCLIArgs,
  generateHelpText,
  type CommandInfo,
} from "./lib/cli-helpers";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

// Print function wrapper for console.log (CLI tools need console output)
// eslint-disable-next-line no-console
const print = console.log;

// Colored print function for different log levels
const colorPrint = (level: LogLevel, message: string) => {
  switch (level) {
    case "error":
      // eslint-disable-next-line no-console
      console.log(`${colors.red}${message}${colors.reset}`);
      break;
    case "warning":
      // eslint-disable-next-line no-console
      console.log(`${colors.yellow}${message}${colors.reset}`);
      break;
    case "success":
      // eslint-disable-next-line no-console
      console.log(`${colors.green}${message}${colors.reset}`);
      break;
    case "info":
    default:
      // eslint-disable-next-line no-console
      console.log(`${colors.cyan}${message}${colors.reset}`);
      break;
  }
};

// Parse command line arguments
const args = process.argv.slice(2);

function showHelp(errorMessage?: string) {
  const availableTemplates = listAvailableTemplates();

  const commands: CommandInfo[] = [
    {
      command: "init-monorepo [path]",
      description: [
        "Initialize a directory as a monorepo",
        "- [path]: Directory path (optional, defaults to current directory)",
        "- --name: Monorepo name (optional, defaults to 'unirend-project-monorepo')",
      ],
    },
    {
      command: "create <type> <name> [path]",
      description: [
        "Create a new project from template",
        `- <type>: Project template (${availableTemplates.join(", ")})`,
        "- <name>: Project name",
        "- [path]: Project path (optional, defaults to current directory)",
      ],
    },
    {
      command: "list",
      description: "List all available templates with descriptions",
    },
    { command: "help, -h, --help", description: "Show this help message" },
    { command: "version, -v, --version", description: "Show version number" },
  ];

  const examples = [
    "unirend init-monorepo",
    "unirend init-monorepo ./my-workspace",
    "unirend init-monorepo --name my-workspace",
    "unirend init-monorepo ./projects --name my-workspace",
    "unirend create ssg my-blog",
    "unirend create ssr my-app ./projects",
    "unirend create api my-api-server",
    "unirend list",
    "unirend help",
    "unirend version",
  ];

  const helpText = generateHelpText(
    {
      title: "🚀 Unirend CLI - Generate starter projects for SSG, SSR, and API",
      commands,
      examples,
    },
    errorMessage,
  );

  print(helpText);
}

function showVersion() {
  print(`unirend v${CLI_VERSION}`);
}

// Main CLI function
async function main() {
  const parsed = parseCLIArgs(args);

  // Handle version command
  if (parsed.command === "version") {
    showVersion();
    process.exit(0);
  }
  // Handle help command
  else if (parsed.command === "help") {
    showHelp();
    process.exit(0);
  }
  // Handle list command
  else if (parsed.command === "list") {
    print("🚀 Available Unirend Templates");
    print("");

    const templates = listAvailableTemplatesWithInfo();

    for (const template of templates) {
      print(`  ${template.templateID.padEnd(8)} ${template.name}`);
      print(`           ${template.description}`);
      print("");
    }

    process.exit(0);
  }
  // Handle init-monorepo command
  else if (parsed.command === "init-monorepo") {
    // Determine target directory
    const targetDir = parsed.monorepoPath
      ? join(process.cwd(), parsed.monorepoPath)
      : process.cwd();

    const configFullPath = join(targetDir, MONOREPO_CONFIG_FILE);

    // Determine monorepo name (from flag or default)
    const monorepoName = parsed.monorepoName || DEFAULT_MONOREPO_NAME;

    // Initialize monorepo (validates and writes config)
    const initResult = await initMonorepo(targetDir, monorepoName);

    if (initResult.success) {
      colorPrint("success", `✅ Initialized monorepo: ${monorepoName}`);
      colorPrint("info", `Created ${MONOREPO_CONFIG_FILE}`);
      colorPrint("info", "");
      colorPrint("info", "You can now create projects in this monorepo:");
      colorPrint("info", "  unirend create ssg my-blog");
    } else if (initResult.error === "invalid_name") {
      colorPrint(
        "error",
        `❌ Invalid monorepo name: ${initResult.errorMessage ?? "Invalid name"}`,
      );
      colorPrint("info", "");
      colorPrint("info", "Valid names must:");
      colorPrint("info", "  - Contain at least one alphanumeric character");
      colorPrint("info", "  - Not start or end with special characters");
      colorPrint("info", "  - Not contain invalid filesystem characters");
      colorPrint("info", "  - Not be reserved system names");

      process.exit(1);
    } else if (initResult.error === "already_exists") {
      colorPrint(
        "error",
        `❌ This directory is already a monorepo (${configFullPath} exists)`,
      );

      process.exit(1);
    } else if (initResult.error === "parse_error") {
      colorPrint(
        "error",
        `❌ Found ${configFullPath} but it contains invalid JSON`,
      );

      if (initResult.errorMessage) {
        colorPrint("error", `   ${initResult.errorMessage}`);
      }

      colorPrint("info", "");
      colorPrint(
        "info",
        "Please fix the JSON syntax or delete the file to start fresh.",
      );

      process.exit(1);
    } else if (initResult.error === "read_error") {
      colorPrint("error", `❌ Found ${configFullPath} but cannot read it`);

      if (initResult.errorMessage) {
        colorPrint("error", `   ${initResult.errorMessage}`);
      }

      process.exit(1);
    } else {
      colorPrint("error", `❌ Failed to create monorepo configuration`);

      if (initResult.errorMessage) {
        colorPrint("error", `   ${initResult.errorMessage}`);
      }

      process.exit(1);
    }

    process.exit(0);
  }
  // Handle create command
  else if (parsed.command === "create") {
    if (!parsed.projectType || !parsed.projectName) {
      showHelp("Missing required arguments");
      process.exit(1);
    }

    const cwd = process.cwd();

    // CLI handles default path logic - defaults to current working directory
    const projectPath = parsed.projectPath
      ? join(parsed.projectPath, parsed.projectName)
      : join(cwd, parsed.projectName);

    // Use starter-templates library to create project
    // Name and template validation are handled by the library
    // Monorepo config updates are handled by createProject internally
    const result = await createProject({
      templateID: parsed.projectType as string,
      projectName: parsed.projectName as string,
      projectPath,
      logger: colorPrint,
    });

    if (!result.success) {
      process.exit(1);
    }
  }
  // Handle unknown command
  else if (parsed.command === "unknown") {
    showHelp(`Unknown command "${parsed.unknownCommand}"`);
    process.exit(1);
  } else {
    // Unhandled command, which should never happen as something wasn't implemented
    // show a helpful error message about the command that was not implemented
    const details = JSON.stringify(parsed as unknown, null, 2);
    showHelp(`Command not implemented. Parser output:\n${details}`);
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  print(
    `❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
