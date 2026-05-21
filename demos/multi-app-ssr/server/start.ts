// App factory — creates and starts the full multi-app SSR server lifecycle.
// Used by both serve-dev.ts (HMR) and serve-built.ts (pre-built assets).
//
// ServerMode ('hmr' vs 'built') controls asset serving.
// initDevMode controls runtime behavior (logging verbosity, error detail, etc.)
// and is set independently via CLI arg, so they can be mixed freely.
//
// Signals:
//   SIGINT / Ctrl+C / ESC — graceful shutdown
//   SIGUSR1 / I key       — print component health

import { Logger, ConsoleSink, LogLevel } from 'lifecycleion/logger';
import { LifecycleManager } from 'lifecycleion/lifecycle-manager';
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import { assertSupportedRuntime } from '../../../src/utils';
import { MultiAppSSRServerComponent } from './ssr-component';

export type ServerMode = 'hmr' | 'built';

export async function startApp(mode: ServerMode) {
  assertSupportedRuntime();
  initDevMode({ detect: 'cmd', strict: true });

  const isDev = getDevMode();

  const logger = new Logger({
    sinks: [
      new ConsoleSink({
        colors: true,
        timestamps: true,
        minLevel: isDev ? LogLevel.DEBUG : LogLevel.SUCCESS,
      }),
    ],
  });

  const manager = new LifecycleManager({
    name: 'multi-app-ssr',
    logger,
    attachSignalsBeforeStartup: true,
    detachSignalsOnStop: true,
    enableLoggerExitHook: true,
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
    await manager.registerComponent(
      new MultiAppSSRServerComponent(logger, { mode }),
    );
    await manager.startAllComponents();
  } catch (error) {
    logger.error('Failed to start {{mode}} server: {{error}}', {
      params: { mode, error },
      exitCode: 1,
    });
  }
}
