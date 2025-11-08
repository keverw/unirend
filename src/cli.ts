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
 *   can still run under Node when bundled (e.g., `bun build --target node`).
 *
 *   Note: While other tooling (ts-node, tsc + node, esbuild/rollup) can work,
 *   we standardize on Bun to maximize value for the least effort and keep
 *   maintenance straightforward—avoiding a complex matrix of toolchains.
 *   As Node tooling evolves, we may revisit a Node-focused CLI path.
 */

import { join } from "path";
import {
  createProject,
  listAvailableTemplates,
  REPO_CONFIG_FILE,
  DEFAULT_REPO_NAME,
  type LogLevel,
  listAvailableTemplatesWithInfo,
  initRepo,
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

// Detect if running under Bun runtime
// Bun exposes a global `Bun` object that Node.js doesn't have
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// Enforce Bun runtime
if (!isBun) {
  // eslint-disable-next-line no-console
  console.error(
    "❌ Unirend CLI requires Bun.\n" +
      "\n" +
      "Why: Bun runs TypeScript directly and bundles to a single JS file, keeping the CLI simple and easy out of the box.\n" +
      "Note: Generated projects can still run under Node when bundled (e.g., `bun build --target node`).\n" +
      "\n" +
      "Install Bun: https://bun.sh\n" +
      "Run with:\n" +
      "  bunx unirend ...   # recommended (downloads if not installed)\n" +
      "  bun run unirend ...",
  );
  process.exit(1);
}

function showHelp(errorMessage?: string) {
  const availableTemplates = listAvailableTemplates();

  const commands: CommandInfo[] = [
    {
      command: "init-repo [path]",
      description: [
        "Initialize a directory as a unirend repo",
        "- [path]: Directory path (optional, defaults to current directory)",
        "- --name: Repo name (optional, defaults to 'unirend-projects')",
      ],
    },
    {
      command: "create <type> <name> [path] [--target bun|node]",
      description: [
        "Create a new project from template",
        `- <type>: Project template (${availableTemplates.join(", ")})`,
        "- <name>: Project name",
        "- [path]: Repo path (optional, defaults to current directory)",
        "- [--target bun|node]: Target runtime for server bundle/scripts (default: bun)",
        "- Auto-init: If the repo is not initialized here, it will be created automatically with a default name",
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
    "unirend init-repo",
    "unirend init-repo ./my-workspace",
    "unirend init-repo --name my-workspace",
    "unirend init-repo ./projects --name my-workspace",
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
  print("");
  print(
    "Notes:\n" +
      "  - The repository setup supports multiple projects in one workspace.\n" +
      "  - You can run 'init-repo' to set it up explicitly, or rely on auto-init during 'create'.\n" +
      ("  - The repo name is stored in " +
        REPO_CONFIG_FILE +
        " and identifies your workspace.\n") +
      "  - The repo root's package.json uses your chosen names and sets private=true to avoid accidental publishing.",
  );
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
  // Handle init-repo command
  else if (parsed.command === "init-repo") {
    // Determine target directory
    const targetDir = parsed.repoPath
      ? join(process.cwd(), parsed.repoPath)
      : process.cwd();

    const configFullPath = join(targetDir, REPO_CONFIG_FILE);

    // Determine repo name (from flag or default)
    const repoName = parsed.repoName || DEFAULT_REPO_NAME;

    // Initialize repo (validates and writes config)
    const initResult = await initRepo(targetDir, repoName);

    if (initResult.success) {
      colorPrint("success", `✅ Initialized repo: ${repoName}`);
      colorPrint("info", `Created ${REPO_CONFIG_FILE}`);
      colorPrint("info", "");
      colorPrint("info", "You can now create projects in this repo:");
      colorPrint("info", "  unirend create ssg my-blog");
    } else if (initResult.error === "invalid_name") {
      colorPrint(
        "error",
        `❌ Invalid repo name: ${initResult.errorMessage ?? "Invalid name"}`,
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
        `❌ This directory is already initialized (${configFullPath} exists)`,
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
      colorPrint("error", `❌ Failed to create repository configuration`);

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
    const repoRoot = parsed.repoPath
      ? join(process.cwd(), parsed.repoPath)
      : cwd;

    // Use starter-templates library to create project
    // Name and template validation are handled by the library
    // Repo config updates are handled by createProject internally
    const result = await createProject({
      templateID: parsed.projectType as string,
      projectName: parsed.projectName as string,
      repoRoot,
      logger: colorPrint,
      serverTarget: (parsed.target as "bun" | "node") ?? "bun",
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
