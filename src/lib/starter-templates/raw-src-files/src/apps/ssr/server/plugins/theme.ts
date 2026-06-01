import type { ServerPlugin } from 'unirend/server';

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
            ? `.${request.domainInfo.rootDomain}`
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
