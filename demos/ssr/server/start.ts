/**
 * App factory — creates and starts the full SSR server application lifecycle.
 * Used by both serve-dev.ts and serve-built.ts.
 *
 * mode: 'hmr'   → Vite HMR, source files served directly (serve-dev.ts)
 * mode: 'built' → pre-built assets from build/            (serve-built.ts)
 *
 * Both entry files are identical except for that mode. All lifecycle
 * wiring, signal handling, and health reporting live here so neither
 * serve file duplicates it.
 *
 * ServerMode ('hmr' vs 'built') controls asset serving — which file you run.
 * initDevMode controls Lifecycleion's dev/prod env (logging verbosity, etc.)
 * and is set independently via CLI arg, so you can mix them freely.
 * e.g. bun serve-dev.ts dev   → HMR + dev env
 *      bun serve-built.ts dev → built assets + dev env (useful for local prod testing)
 *
 * Signals:
 *   SIGINT / Ctrl+C / ESC — graceful shutdown
 *   SIGUSR1 / I key       — print component health
 */

import { Logger, ConsoleSink, LogLevel } from 'lifecycleion/logger';
import { LifecycleManager } from 'lifecycleion/lifecycle-manager';
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import { assertSupportedRuntime } from '../../../src/utils';
import { SSRServerComponent } from './ssr-component';

export type ServerMode = 'hmr' | 'built';

export async function startApp(mode: ServerMode) {
  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  assertSupportedRuntime();
  initDevMode({ detect: 'cmd', strict: true });

  // isDev is separate from mode ('hmr' vs 'built') — mode controls asset serving,
  // isDev controls runtime behavior. Use isDev in your own code for things like
  // SSL enforcement, HTTP→HTTPS redirects, strict security headers, etc.
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

  // ─── Lifecycle manager ────────────────────────────────────────────────────────

  const manager = new LifecycleManager({
    name: 'ssr-server',
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
