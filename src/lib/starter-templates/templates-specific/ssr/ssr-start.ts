import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Build the source for an SSR app's `server/start.ts` — the app factory used
 * by both `serve-built.ts` and `serve-hmr.ts`.
 *
 * SSR-specific; lives in `templates-specific/ssr/`. The only per-project
 * substitution is the `LifecycleManager` name: per the naming rule, the manager
 * incorporates the app name (`${appName}-ssr-server`) while the registered
 * component keeps its generic name (see `ssr-component.ts`). Everything else is
 * emitted verbatim — `{{mode}}`/`{{error}}`/`{{name}}`/`{{msg}}` tokens are
 * Lifecycleion logger param syntax, not template-literal interpolations.
 *
 * @param appName - The app/project name to fold into the manager name
 */
function buildSSRStartSrc(appName: string): string {
  return `/**
 * App factory — creates and starts the full SSR server application lifecycle.
 * Used by both serve-hmr.ts and serve-built.ts.
 *
 * mode: 'hmr'   → Vite HMR, source files served directly (serve-hmr.ts)
 * mode: 'built' → pre-built assets from build/            (serve-built.ts)
 *
 * Both entry files are identical except for that mode. All lifecycle
 * wiring, signal handling, and health reporting live here so neither
 * serve file duplicates it.
 *
 * ServerMode ('hmr' vs 'built') controls asset serving — which file you run.
 * initDevMode controls Lifecycleion's dev/prod env (logging verbosity, etc.)
 * and is set independently via CLI arg, so you can mix them freely.
 * e.g. bun serve-hmr.ts dev   → HMR + dev env
 *      bun serve-built.ts dev → built assets + dev env (useful for local prod testing)
 *
 * Signals:
 *   SIGINT / Ctrl+C / ESC — graceful shutdown
 *   SIGUSR1 / I key       — print component health
 */

import { Logger, ConsoleSink, LogLevel } from 'lifecycleion/logger';
import { LifecycleManager } from 'lifecycleion/lifecycle-manager';
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import { assertSupportedRuntime } from 'unirend/utils';
import { SSRServerComponent } from './ssr-component';

export type ServerMode = 'hmr' | 'built';

// ─── App factory ─────────────────────────────────────────────────────────────

export async function startApp(mode: ServerMode) {
  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  assertSupportedRuntime();
  initDevMode({ detect: 'cmd', strict: true });

  // isDev is separate from mode ('hmr' vs 'built') — mode controls asset serving,
  // isDev controls runtime behavior. Use isDev in your own code for things like
  // SSL enforcement, HTTP→HTTPS redirects, strict security headers, etc.
  const isDev = getDevMode();

  // ─── Logger ────────────────────────────────────────────────────────────────

  const logger = new Logger({
    sinks: [
      new ConsoleSink({
        colors: true,
        timestamps: true,
        minLevel: isDev ? LogLevel.DEBUG : LogLevel.SUCCESS,
      }),
    ],
  });

  // ─── Lifecycle manager ─────────────────────────────────────────────────────

  const manager = new LifecycleManager({
    name: '${appName}-ssr-server',
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
    // Register the SSR server component.
    // To add a database or other services, register additional components here
    // before startAllComponents — they start in order, so infrastructure (DB, cache, etc.)
    // comes up before the SSR server. You can then inject them into SSRServerComponent
    // or access them via middleware registered in ssr-component.ts.
    await manager.registerComponent(new SSRServerComponent(logger, { mode }));

    // Start all components
    await manager.startAllComponents();
  } catch (error) {
    // Use exitCode so the logger flushes the sink before the process exits
    logger.error('Failed to start {{mode}} server: {{error}}', {
      params: { mode, error },
      exitCode: 1,
    });
  }
}
`;
}

/**
 * Ensure an SSR app's `server/start.ts` exists at
 * `${projectPath}/server/start.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param appName - The app/project name, folded into the LifecycleManager name
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRStart(
  root: FileRoot,
  projectPath: string,
  appName: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/server/start.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildSSRStartSrc(appName),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
