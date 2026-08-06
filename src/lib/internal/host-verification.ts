import type { FastifyRequest } from 'fastify';

/**
 * Whether this request's host is one the server has not confirmed it serves.
 *
 * Error pages are the reason this exists. They render for requests that failed,
 * and a request can fail before `domainValidation` has run: a plugin registered
 * above it that throws ends the request, and the error handler answers on its
 * behalf. The page that comes back is then being served to a domain nothing has
 * vouched for, which is a poor place to show branding, stack traces, or
 * anything else you would not hand a stranger.
 *
 * The three signals it reads do not mean the same thing, and no one of them
 * answers the question alone:
 *
 * - `server.domainValidationRegistered` says the server validates hosts at all.
 *   Without it, a server that never registered the plugin would look like one
 *   whose check never ran, and every error page would degrade for no reason.
 * - `request.domainValidationChecked` says the host was examined, whatever the
 *   verdict. Unset on a server that does validate means the request died before
 *   the gate.
 * - `request.domainValidationRejected` says the host was refused, or could not
 *   be confirmed because the validator itself failed. Rejections are normally
 *   answered by the plugin, but a failed validator throws, so this is the state
 *   an error page actually meets.
 *
 * Returns `false` when the plugin is not registered, since a server that does
 * not validate hosts has nothing to be unverified against.
 *
 * ```typescript
 * import { isHostUnverified } from 'unirend/server';
 *
 * if (isHostUnverified(request)) {
 *   return plainErrorPage();
 * }
 * ```
 */
export function isHostUnverified(request: FastifyRequest): boolean {
  // Optional-chained because an error page may be handed a request-shaped
  // object in tests, and a helper meant for the failure path should not be the
  // thing that throws on it.
  if (request.server?.domainValidationRegistered !== true) {
    return false;
  }

  if (request.domainValidationChecked !== true) {
    return true;
  }

  return request.domainValidationRejected === true;
}
