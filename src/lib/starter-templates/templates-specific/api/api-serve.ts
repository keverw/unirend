import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Build the source for an API app's `serve.ts` — the standalone entry point
 * that wires the API server component into a Lifecycleion `LifecycleManager`
 * and handles signals/graceful shutdown.
 *
 * API-only and structurally unique (no SSG/SSR counterpart), so it lives in
 * `templates-specific/api/`. The only per-project substitution is the
 * `LifecycleManager` name: per the naming rule, the manager incorporates the
 * app name (`${appName}-api-server`) while the registered component keeps its
 * generic `api-server` name (see `api-component.ts`). Everything else — the
 * `{{name}}`/`{{msg}}`/`{{error}}` tokens are the Lifecycleion logger's own
 * param syntax — is emitted verbatim.
 *
 * @param appName - The app/project name to fold into the manager name
 */
function buildAPIServeSrc(appName: string): string {
  return `/**
 * Standalone API server demo.
 * Uses unirend's serveAPI with Lifecycleion for lifecycle management and logging.
 *
 * This demo mirrors the SSR server pattern but without React rendering — use it
 * when you need a JSON API server, a page data loader server separate from your SSR server,
 * or a general-purpose HTTP server with Unirend's plugin system.
 *
 * A common architecture is to run the API server separately from your SSR server,
 * with page data loaders hosted here and fetched over HTTP by the SSR server during
 * rendering. Request context, cookies, and correlation IDs are forwarded automatically
 * between the two servers. Handlers work the same whether co-located or separated.
 * See: https://github.com/keverw/unirend/blob/master/docs/ssr.md (Short-Circuit Data Handlers, Separated SSR/API Architecture)
 * See: https://github.com/keverw/unirend/blob/master/docs/data-loaders.md
 *
 * Signals:
 *   SIGINT / Ctrl+C / ESC — graceful shutdown
 *   SIGUSR1 / I key       — print component health
 */

import { assertSupportedRuntime } from 'unirend/utils';
import { LifecycleManager } from 'lifecycleion/lifecycle-manager';
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import { Logger, ConsoleSink, LogLevel } from 'lifecycleion/logger';
import { APIServerComponent } from './api-component';

// ─── Bootstrap ───────────────────────────────────────────────────────────────
assertSupportedRuntime();
initDevMode({ detect: 'cmd', strict: true });

// isDev controls runtime behavior (logging verbosity, error detail exposure, etc.).
// Use isDev in your own code for things like SSL enforcement, HTTP→HTTPS redirects,
// strict security headers, etc.
const isDev = getDevMode();

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger = new Logger({
  sinks: [
    new ConsoleSink({
      colors: true,
      timestamps: true,
      minLevel: isDev ? LogLevel.DEBUG : LogLevel.SUCCESS,
    }),
  ],
});

// ─── Lifecycle manager ───────────────────────────────────────────────────────

async function main() {
  const manager = new LifecycleManager({
    name: '${appName}-api-server',
    logger,
    // Attach signal handlers before startup so any signal queued during
    // startAllComponents() is handled correctly once the event loop resumes.
    attachSignalsBeforeStartup: true,
    // Detach signal handlers when the last component stops, otherwise the process hangs.
    detachSignalsOnStop: true,
    // Stop all components gracefully before the process exits when
    // logger.exit() fires (e.g. logger.error with exitCode).
    enableLoggerExitHook: true,
    // Force exit if shutdown requests keep arriving while shutdown is already running
    // (e.g. repeated Ctrl+C). Defaults: 3 requests within 2000ms triggers onForceShutdown.
    repeatedShutdownRequestPolicy: {
      onForceShutdown: () => {
        logger.warn('Multiple shutdown requests received — forcing exit');
        process.exit(1);
      },
    },
    onInfoRequested: async () => {
      const report = await manager.checkAllHealth();

      for (const { name, healthy: isHealthy, message } of report.components) {
        const msg = message ?? (isHealthy ? 'healthy' : 'unhealthy');

        if (isHealthy) {
          logger.success('[{{name}}] {{msg}}', { params: { name, msg } });
        } else {
          logger.warn('[{{name}}] {{msg}}', { params: { name, msg } });
        }
      }
    },
  });

  try {
    // Register the API server component.
    // To add a database or other services, register additional components here
    // before startAllComponents — they start in order, so infrastructure (DB, cache, etc.)
    // comes up before the API server. You can then inject them into APIServerComponent
    // or access them via middleware registered in plugins.
    await manager.registerComponent(new APIServerComponent(logger));

    // Start all components
    await manager.startAllComponents();
  } catch (error) {
    // Use exitCode so the logger flushes the sink before the process exits
    logger.error('Failed to start API server: {{error}}', {
      params: { error },
      exitCode: 1,
    });
  }
}

main().catch((error) => {
  // Use exitCode so the logger flushes the sink before the process exits
  logger.error('Failed to start server: {{error}}', {
    params: { error },
    exitCode: 1,
  });
});
`;
}

/**
 * Ensure an API app's `serve.ts` exists at `${projectPath}/serve.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-api")
 * @param appName - The app/project name, folded into the LifecycleManager name
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAPIServe(
  root: FileRoot,
  projectPath: string,
  appName: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/serve.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildAPIServeSrc(appName),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
