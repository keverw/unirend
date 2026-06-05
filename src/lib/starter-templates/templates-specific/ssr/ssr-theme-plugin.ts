import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSR app's `server/plugins/theme.ts`.
 *
 * SSR-specific; lives in `templates-specific/ssr/`. Seeds the theme preference
 * from the request cookie into `requestContext` on every request, and optionally
 * renews the cookie server-side with a rolling expiry on responses (skipping
 * static assets via the `reply.hijack()` bypass). No per-project substitutions.
 * One template-literal escape: the domain string
 * (`` `.\${request.domainInfo.rootDomain}` ``).
 */
const SSR_THEME_PLUGIN_SRC = `import type { ServerPlugin } from 'unirend/server';

// Seed theme preference from cookie. Store the raw preference — the server never
// resolves 'auto' since OS preference isn't available server-side.
export function themePlugin(): ServerPlugin {
  return (pluginHost) => {
    // Read the cookie early so requestContext is seeded before SSR rendering.
    pluginHost.addHook('onRequest', (request) => {
      // request.cookies is provided by the cookies plugin (dependsOn: ['cookies']).
      const cookie = request.cookies.themePreference;
      const validPreferences = ['light', 'dark', 'auto'] as const;

      // Validate — reject tampered or missing values, fall back to 'auto'
      const preference =
        cookie &&
        validPreferences.includes(cookie as (typeof validPreferences)[number])
          ? cookie
          : 'auto'; // fallback to OS preference if missing or tampered

      // Seed into request context so components read the correct value during SSR
      request.requestContext.themePreference = preference;
    });

    // Optional: renew the cookie server-side with a rolling expiry.
    // Use onSend rather than onRequest so renewal happens only for normal
    // Fastify-managed responses — Unirend's static asset handler uses
    // reply.hijack(), which bypasses onSend, so assets such as .js/.css/images
    // are skipped automatically.
    pluginHost.addHook('onSend', async (request, reply) => {
      // Defensive guard — onSend is already bypassed for static assets via
      // reply.hijack(), but guard explicitly in case that ever changes.
      if (request.isStaticAsset) {
        return;
      }

      // Only renew when the cookie was already present — avoids writing a cookie
      // on behalf of users who never explicitly chose a preference.
      const existingCookie = request.cookies.themePreference;

      if (existingCookie) {
        // Use the validated preference from requestContext, not the raw cookie.
        // If the original value was tampered (e.g. 'bogus'), onRequest corrected
        // it to 'auto' — writing that here sanitizes the stored cookie.
        const preference = request.requestContext.themePreference as string;

        // Pass undefined for domain when rootDomain is empty — Fastify omits the
        // attribute, giving a host-only cookie (correct for localhost and raw IPs,
        // since domain=.localhost is invalid per RFC 6265). Matches what
        // cycleTheme() writes client-side via useDomainInfo().
        reply.setCookie('themePreference', preference, {
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
          sameSite: 'lax',
          domain: request.domainInfo?.rootDomain
            ? \`.\${request.domainInfo.rootDomain}\`
            : undefined,
        });
      }
    });

    return {
      name: 'theme',
      dependsOn: ['cookies'], // Ensure cookies plugin is loaded first
    };
  };
}
`;

/**
 * Ensure an SSR app's `server/plugins/theme.ts` exists at
 * `${projectPath}/server/plugins/theme.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRThemePlugin(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/server/plugins/theme.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      SSR_THEME_PLUGIN_SRC,
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}
