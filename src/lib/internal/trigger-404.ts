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
import type { PageDataNotFoundContext } from '../types';
import {
  describeHandlerResult,
  resolveAPINotFoundResponse,
  type APINotFoundResolutionConfig,
} from './server-utils';
import { getDevMode } from 'lifecycleion/dev-mode';

/**
 * Brand carried by the value `request.trigger404()` returns.
 *
 * A namespaced string key rather than a symbol, for one reason: a `unique
 * symbol` is *nominal*, and tsup copies this declaration into every entry that
 * reaches it — `unirend/server`, `unirend/plugins`, `unirend/api-envelope`,
 * `unirend/utils`. Each copy declares its own `unique symbol`, so each copy's
 * `Trigger404Signal` is a distinct type that happens to print the same name.
 * Since `unirend/server` pulls in `unirend/api-envelope`, and both carry a
 * `declare module 'fastify'` block declaring `trigger404`, a consumer writing
 * the documented pattern got `Trigger404Signal is not assignable to
 * Trigger404Signal` from their own file — with `skipLibCheck: true`, which only
 * silences the copies' disagreement inside the declaration files themselves.
 *
 * A string literal key is structural, so every copy of the interface is the
 * same type and the bundles agree.
 *
 * This key is the *type-level* brand only. What the runtime tests is the symbol
 * below, for a reason worth keeping straight: a string key is representable in
 * JSON, so a handler returning upstream data that happened to carry
 * `"unirend.trigger404": true` would have been read as the sentinel and sent
 * down the not-found path. Data must not be able to choose the server's control
 * flow.
 */
export const TRIGGER_404_BRAND = 'unirend.trigger404' as const;

/**
 * The brand the runtime actually checks.
 *
 * A symbol cannot survive `JSON.parse`, so no returned payload can forge it,
 * however it was built and wherever it came from. `Symbol.for` rather than
 * `Symbol()` so the brand is shared across every copy of unirend in a
 * consumer's tree, including a duplicated install and the separate module
 * instances a bundler can produce.
 *
 * Deliberately **not** exported and never referenced by an exported type, which
 * is what keeps the nominal `unique symbol` out of the published declaration
 * files. That is the whole reason the type-level brand above is a string: this
 * one would be a different type in every bundle.
 */
const TRIGGER_404_RUNTIME_BRAND: unique symbol =
  Symbol.for('unirend.trigger404');

/**
 * Opaque value returned by `request.trigger404()`.
 *
 * Return it from an API route handler or a page data handler to abandon the
 * request into the server's not-found path. Never construct one yourself: an
 * object matching this shape is not the sentinel, because the runtime brand is
 * a symbol this interface cannot describe. A hand-built one is rejected as an
 * invalid handler response rather than quietly serving a 404.
 */
export interface Trigger404Signal {
  readonly [TRIGGER_404_BRAND]: true;
}

/** The single sentinel instance every `trigger404()` call returns. */
export const TRIGGER_404_SIGNAL: Trigger404Signal = Object.freeze({
  // Carries both brands: the string one so the value satisfies the public
  // interface, the symbol one so it is recognized.
  [TRIGGER_404_BRAND]: true as const,
  [TRIGGER_404_RUNTIME_BRAND]: true as const,
});

/**
 * Whether a handler return value is the trigger-404 sentinel.
 *
 * Tests the brand *property*, not object identity. Identity would silently
 * stop matching the moment two copies of unirend end up in one process, which
 * would turn the sentinel into an "invalid handler response" error rather than
 * a 404 — a failure the deployment would only discover in production.
 *
 * The property tested is the symbol, never the string. The string brand exists
 * so the published type is structural across unirend's bundles; recognizing it
 * at runtime would let any JSON payload carrying that key take over the
 * request.
 */
export function isTrigger404Signal(value: unknown): value is Trigger404Signal {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[TRIGGER_404_RUNTIME_BRAND] === true
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
  /**
   * Reply headers as they stood before the handler ran, restored if the
   * handler abandons the request.
   *
   * A handler that sets a header or a cookie and *then* triggers would
   * otherwise ship it on the 404, which is exactly the kind of tell this
   * feature exists to remove: a genuine miss never carries a session cookie.
   * The docs say to call `trigger404()` first, and this is what makes that
   * advice rather than a requirement.
   *
   * Undefined on the SSR internal short-circuit, whose `reply` belongs to the
   * page request and is shared with every other loader running in parallel.
   * Restoring there could remove a header a different loader had just set.
   */
  headerSnapshot?: Record<string, unknown>;
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

/**
 * Opens a window in which `trigger404()` may be called.
 *
 * @param reply - Pass the Fastify reply when it belongs to this invocation
 *   alone, so reply state can be rolled back if the handler abandons the
 *   request. Omitted on the SSR internal short-circuit, which shares the page
 *   request's reply with loaders running in parallel.
 */
export function openTrigger404Scope(reply?: FastifyReply): Trigger404Scope {
  return {
    isOpen: true,
    wasRequested: false,
    headerSnapshot: reply ? { ...reply.getHeaders() } : undefined,
  };
}

/**
 * Puts the reply's headers back the way they were before the handler ran.
 *
 * Removes every header currently set and re-applies the snapshot, rather than
 * diffing: a value may be an array (`Set-Cookie`), which no cheap comparison
 * gets right, and the snapshot is the whole truth for this reply anyway.
 */
function restoreReplyHeaders(
  reply: FastifyReply,
  snapshot: Record<string, unknown>,
): void {
  for (const name of Object.keys(reply.getHeaders())) {
    reply.removeHeader(name);
  }

  for (const [name, value] of Object.entries(snapshot)) {
    if (value !== undefined) {
      reply.header(name, value);
    }
  }
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
  /**
   * The frontend's description of this page data request, passed by the SSR
   * short-circuit. That path runs on the page request and builds no HTTP
   * request, so there is no loader body to read it from, and without it a
   * not-found handler would see the page URL where the HTTP fallback shows
   * the page data one.
   */
  pageDataContext?: PageDataNotFoundContext;
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
  pageDataContext,
  pageType,
  version,
}: Trigger404CheckOptions): Promise<Trigger404Outcome> {
  const wasRequested = scope.wasRequested;
  const didReturnSignal = isTrigger404Signal(handlerResult);

  if (!wasRequested && !didReturnSignal) {
    return { triggered: false };
  }

  if (isResponseSent) {
    // Cannot be undone. The sent response stands rather than attempting a
    // second send.
    //
    // Deliberately does not tell this handler to send later or trigger
    // earlier. On the SSR short-circuit the reply belongs to the page request
    // and is shared with every loader running in parallel, so `isResponseSent`
    // cannot say *who* sent: a loader that committed the reply makes this fire
    // for a sibling that did nothing wrong. The message states what is true on
    // both paths, which is that a response was already out, and leaves the
    // cause to the route and pageType fields.
    request.log.error(
      {
        errorCode: 'trigger_404_after_response_sent',
        route,
        pageType,
        version,
      },
      `request.trigger404() was called for ${route} after a response had already been sent. The 404 could not be served and the response that was already sent stands. During an SSR render the reply is shared with every page data loader on that request, so the response may have been sent by a different handler than this one.`,
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
        // The type always, the value itself only in development. The discarded
        // value is arbitrary application data — and on this path specifically
        // it is the data the 404 exists to withhold, which is the last thing
        // that should reach a log sink in production. Same split as
        // invalid_handler_response, via the same helper.
        handlerResponseType: describeHandlerResult(handlerResult),
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

  // Roll back anything the handler put on the reply before abandoning. Must
  // run before the resolver, which sets the 404's own status and
  // `Cache-Control: no-store` and would otherwise be undone by it.
  if (reply && scope.headerSnapshot) {
    restoreReplyHeaders(reply, scope.headerSnapshot);
  }

  const envelope = await resolveAPINotFoundResponse({
    ...resolution,
    // No HelpersClass override here on purpose. It arrives in the spread above,
    // from the resolution the server installed, which is the same config a
    // genuine miss resolves through — so the two cannot disagree about which
    // class builds the envelope. Reading the request's decoration here instead
    // is what made them disagree: that decoration is plumbing for code that
    // holds only a request and never the server, which is not this path.
    classification,
    pageDataContext,
    request,
    reply,
  });

  return { triggered: true, isResponseSent: false, envelope };
}
