import type { ServerPlugin, PluginHostInstance } from '../types';
import fastifyCookie, { type FastifyCookieOptions } from '@fastify/cookie';

// Public type alias to align our plugin options with @fastify/cookie options
export type CookiesConfig = FastifyCookieOptions;

/**
 * Built-in cookies plugin that registers @fastify/cookie and exposes dependency metadata.
 *
 * Usage:
 *   plugins: [cookies({ secret: "your-secret" })]
 *
 * Other plugins can declare a dependency on "cookies" in their PluginMetadata.dependsOn
 * to ensure this plugin is registered first.
 */
export function cookies(config: CookiesConfig = {}): ServerPlugin {
  return async (pluginHost: PluginHostInstance) => {
    await pluginHost.register(fastifyCookie, config as Record<string, unknown>);

    // Expose simple runtime metadata so other plugins/handlers can check
    // whether a signing secret/signer is configured and which algorithm is set.
    pluginHost.decorate('cookiePluginInfo', {
      signingSecretProvided: !!(config as FastifyCookieOptions).secret,
      algorithm:
        (config as FastifyCookieOptions & { algorithm?: string }).algorithm ??
        'sha256',
    });

    return {
      name: 'cookies',
    } as const;
  };
}
