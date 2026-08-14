/**
 * `request.trigger404()` — abandon a request into the not-found path.
 *
 * A handler that calls this makes the server answer exactly as if no handler
 * had ever been registered for that route: the response routes through the
 * same not-found resolution the framework uses for a genuine miss, so an app
 * with a custom `notFoundHandler` or a custom `APIResponseHelpers` class gets
 * its own 404 here too.
 *
 * The sentinel and the per-request flag live together in this module on
 * purpose. The sentinel is the typed return value that carries the control
 * flow, and the flag is the evidence that lets the wrappers fail closed when a
 * handler forgot to `return` it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getDevMode } from 'lifecycleion/dev-mode';
import {
  resolveAPINotFoundResponse,
  type APINotFoundResolutionConfig,
} from './server-utils';
import { getAPIResponseHelpersClass } from './api-response-helpers-utils';

/**
 * Brand carried by the value `request.trigger404()` returns.
 *
 * `Symbol.for` rather than `Symbol()` so the brand is shared across every copy
 * of unirend in a consumer's tree, including a duplicated install and the
 * separate module instances a bundler can produce.
 */
export const TRIGGER_404_BRAND: unique symbol =
  Symbol.for('unirend.trigger404');

/**
 * Opaque value returned by `request.trigger404()`.
 *
 * Return it from an API route handler or a page data handler to abandon the
 * request into the server's not-found path. Never construct one yourself.
 */
export interface Trigger404Signal {
  readonly [TRIGGER_404_BRAND]: true;
}

/** The single sentinel instance every `trigger404()` call returns. */
export const TRIGGER_404_SIGNAL: Trigger404Signal = Object.freeze({
  [TRIGGER_404_BRAND]: true as const,
});

/**
 * Whether a handler return value is the trigger-404 sentinel.
 *
 * Tests the brand *property*, not object identity. Identity would silently
 * stop matching the moment two copies of unirend end up in one process, which
 * would turn the sentinel into an "invalid handler response" error rather than
 * a 404 — a failure the deployment would only discover in production.
 */
export function isTrigger404Signal(value: unknown): value is Trigger404Signal {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[TRIGGER_404_BRAND] === true
  );
}

/**
 * Trigger state for a single handler invocation.
 *
 * Deliberately per invocation rather than per request. During an SSR render,
 * React Router runs its page data loaders in parallel, so several
 * `callHandler()` invocations share one FastifyRequest and interleave freely.
 * One request-wide flag cannot survive that: whichever invocation finished
 * first would close the window while another handler was still awaiting, and
 * a `requested` flag set by one handler could be consumed by another.
 */
export interface Trigger404Scope {
  /** True only while the wrapper is invoking its handler */
  isOpen: boolean;
  /** True once `trigger404()` was called inside this invocation */
  wasRequested: boolean;
}

/**
 * The scope is carried in async context rather than on the request, because
 * that is the only thing that tracks which invocation a `trigger404()` call
 * came from once the invocations interleave. A stack on the request would
 * attribute the call to whichever handler most recently started, not to the
 * handler that actually made it.
 */
const trigger404Storage = new AsyncLocalStorage<Trigger404Scope>();

/** Message shown when `trigger404()` is called where nothing observes it */
const OUT_OF_HANDLER_MESSAGE =
  'request.trigger404() is only available inside an API route handler or a page data handler. In a plugin route, call reply.callNotFound() instead.';

/** Opens a window in which `trigger404()` may be called. */
export function openTrigger404Scope(): Trigger404Scope {
  return { isOpen: true, wasRequested: false };
}

/**
 * Runs a handler invocation inside its scope.
 *
 * The context propagates through the returned promise chain, so a handler that
 * awaits before calling `trigger404()` still resolves to its own scope.
 */
export function runInTrigger404Scope<R>(
  scope: Trigger404Scope,
  run: () => R,
): R {
  return trigger404Storage.run(scope, run);
}

/**
 * Closes the window once the invocation settles.
 *
 * A handler that leaves work running past its own return — a detached promise,
 * or a body still going after a timeout won the race — finds the scope closed
 * and throws, since nothing is left to observe the trigger.
 */
export function closeTrigger404Scope(scope: Trigger404Scope): void {
  scope.isOpen = false;
}

/**
 * Records that the current handler invocation asked to be abandoned and
 * returns the sentinel.
 *
 * Backs the `trigger404` request decoration on both servers. It needs no
 * request argument: the scope comes from async context, which is what makes it
 * correct under concurrent invocations on one request.
 */
export function markTrigger404Requested(): Trigger404Signal {
  const scope = trigger404Storage.getStore();

  if (!scope || !scope.isOpen) {
    throw new Error(OUT_OF_HANDLER_MESSAGE);
  }

  scope.wasRequested = true;

  return TRIGGER_404_SIGNAL;
}

/**
 * Outcome of the shared post-handler check.
 *
 * `triggered: false` means the wrapper continues with its ordinary result
 * checks. `isResponseSent` means the response was out before the trigger could
 * take effect, so there is nothing left to send.
 */
export type Trigger404Outcome =
  | { triggered: false }
  | { triggered: true; isResponseSent: true }
  | { triggered: true; isResponseSent: false; envelope: unknown };

export interface Trigger404CheckOptions {
  request: FastifyRequest;
  /** The scope this handler invocation ran in */
  scope: Trigger404Scope;
  /**
   * The Fastify reply, when the call site has one. Omitted on the SSR internal
   * short-circuit path, which has no HTTP response of its own.
   */
  reply?: FastifyReply;
  /**
   * Whether the response has already gone out. Computed by the call site
   * because the internal short-circuit path only ever holds a ControlledReply.
   */
  isResponseSent: boolean;
  /** Not-found resolution installed by the server on its registries */
  resolution?: APINotFoundResolutionConfig;
  /** Whatever the handler returned */
  handlerResult: unknown;
  /** Human-readable route for logs, e.g. `GET /api/v1/things` */
  route: string;
  /**
   * Forces the API/page-data classification instead of deriving it from
   * `request.url`. The internal short-circuit path runs on the SSR page
   * request, whose URL is the web route rather than the page-data endpoint,
   * so without this it would resolve an API envelope where the HTTP fallback
   * resolves a page one.
   */
  classification?: { isAPI: boolean; isPageData: boolean };
  pageType?: string;
  version?: number;
}

/**
 * The one post-handler check, shared by all three registry wrapper sites.
 *
 * Must run immediately after the handler call and *before* the `=== false` and
 * `isValidEnvelope` checks: the sentinel is not a valid envelope, so a later
 * check would reject it as `invalid_handler_response`.
 */
export async function checkTrigger404({
  request,
  scope,
  reply,
  isResponseSent,
  resolution,
  handlerResult,
  route,
  classification,
  pageType,
  version,
}: Trigger404CheckOptions): Promise<Trigger404Outcome> {
  const wasRequested = scope.wasRequested;
  const didReturnSignal = isTrigger404Signal(handlerResult);

  if (!wasRequested && !didReturnSignal) {
    return { triggered: false };
  }

  if (isResponseSent) {
    // Cannot be undone. The sent response stands and this is logged as a
    // handler bug rather than attempting a second send.
    request.log.error(
      {
        errorCode: 'trigger_404_after_response_sent',
        route,
        pageType,
        version,
      },
      `request.trigger404() was called for ${route} after the response had already been sent. The 404 could not be served and the response that was already sent stands. Call request.trigger404() before sending anything.`,
    );

    return { triggered: true, isResponseSent: true };
  }

  if (!didReturnSignal) {
    // Fail closed: the handler asked for a 404 and then returned an ordinary
    // value, so serve the 404 anyway in every mode. The data the handler meant
    // to withhold never ships, and dev and prod stay byte-identical.
    request.log.error(
      {
        errorCode: 'trigger_404_missing_return',
        route,
        pageType,
        version,
        // Only development sees the offending value, matching how the rest of
        // the codebase gates error detail.
        ...(getDevMode() ? { handlerResponse: handlerResult } : {}),
      },
      `request.trigger404() was called for ${route} but the handler returned a value instead of returning the signal. The 404 was served anyway and the returned value was discarded. Write: return request.trigger404();`,
    );
  }

  if (!resolution) {
    // Framework invariant: both servers install this on both registries before
    // registering routes, so an unset resolution is a unirend bug, not a user
    // path.
    const error = new Error(
      `request.trigger404() was called for ${route} but no not-found resolution was configured on this registry.`,
    );
    (error as unknown as { errorCode: string }).errorCode =
      'trigger_404_unconfigured';
    (error as unknown as { route: string }).route = route;
    throw error;
  }

  const envelope = await resolveAPINotFoundResponse({
    ...resolution,
    // Per-request, so a plugin that swapped the helpers class for this request
    // is honored the same way a genuine miss would honor it.
    HelpersClass: getAPIResponseHelpersClass(request),
    classification,
    request,
    reply,
  });

  return { triggered: true, isResponseSent: false, envelope };
}
