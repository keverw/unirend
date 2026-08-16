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
   * Reply state as it stood before the handler ran, restored if the handler
   * abandons the request.
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
  replySnapshot?: ReplySnapshot;
}

/**
 * Reply state captured before a handler invocation, in the two places a
 * response header can be waiting.
 */
export interface ReplySnapshot {
  /** Headers already on the reply, array values copied */
  headers: Record<string, unknown>;
  /**
   * `@fastify/cookie`'s pending-cookie buffer and its contents at snapshot
   * time. Absent when that plugin is not registered.
   */
  pendingCookies?: {
    /** The live buffer, so the restore writes back to the one in use */
    buffer: Map<unknown, unknown>;
    /** Its entries as they stood before the handler ran */
    entries: [unknown, unknown][];
  };
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
    replySnapshot: reply ? snapshotReplyState(reply) : undefined,
  };
}

/**
 * The description of the symbol `@fastify/cookie` keys its pending-cookie
 * buffer with. Matched by description because the symbol itself is module
 * private — a plain `Symbol()` rather than `Symbol.for()` — so there is no way
 * to name it from here.
 *
 * Reaching into another package's internals is worth being uneasy about, so
 * here is why it is the right call rather than merely the convenient one.
 *
 * **The wrapper is not a way out.** `ControlledReply.setCookie` looks like the
 * obvious interception point, but it is `reply.setCookie.bind(reply)` — we
 * re-expose the plugin's method and it owns the storage, so a handler's call
 * lands in the buffer below either way. Recording the calls at the wrapper and
 * replaying them later does not work either: a handler that sets a cookie and
 * then sends its own response would have the send, and with it the plugin's
 * `onSend` hook, run before the replay, so an ordinary non-triggering handler
 * would silently lose the cookie. That trades a leak on a rare path for data
 * loss on a common one.
 *
 * **A rename cannot reach a release.** `@fastify/cookie` is a direct dependency
 * at a caret range rather than a peer, so the resolved version is one this repo
 * chooses, and `prepublishOnly` runs `bun test`. The three `reply.setCookie()`
 * cases in the "reply state set before the trigger" block compare a triggered
 * 404 against a genuine miss through the real plugin, so they fail if this
 * lookup stops finding the buffer. A bump that moved the symbol would break the
 * build before it could ship. The buffer has carried this same description
 * since it was introduced, and it is internal, so a rename belongs to a major
 * the range excludes until someone bumps it deliberately — which runs those
 * tests.
 *
 * **Startup is the wrong place to check.** There is no reply at boot, so a real
 * check means synthesizing a request, and inspecting the reply prototype
 * instead needs Fastify's own private `kReply` symbol: two private symbols to
 * guard one. Refusing to boot would also turn a hardening regression, one
 * cookie on a triggered 404, into an outage. The warn-once below covers what
 * the tests cannot reach, which is a consumer resolving a different copy of the
 * plugin through an override or their own registration: it fires both when the
 * symbol is gone and when it is still there holding something that is not the
 * `Map` this rollback knows how to rewrite.
 */
const PENDING_COOKIES_SYMBOL_DESCRIPTION = 'fastify.reply.setCookies';

/** Logged at most once per process, since the cause is a dependency change */
let hasWarnedAboutPendingCookies = false;

/** Whether `@fastify/cookie` is registered on the server this reply belongs to */
function hasCookiePlugin(reply: FastifyReply): boolean {
  return (
    typeof (reply as unknown as { setCookie?: unknown }).setCookie ===
    'function'
  );
}

/**
 * Finds the buffer `reply.setCookie()` parks a cookie in until the response is
 * sent.
 *
 * `@fastify/cookie` does not write a `Set-Cookie` header when a handler calls
 * `setCookie()`. It stores the cookie in a `Map` on the reply and only
 * serializes the whole map into the header from its own `onSend` hook, which
 * runs long after this rollback. A rollback that only put the headers back
 * would therefore miss every cookie set the documented way, and that cookie
 * would ship on the 404 — the exact tell the rollback exists to remove.
 *
 * The symbol is declared by `decorateReply`, which for a non-function value
 * assigns it as an own property of every reply, and the `Map` is assigned per
 * request. The prototype chain is walked anyway so a future change of decorator
 * shape cannot quietly turn this into a miss, while the value is always read
 * off the reply itself.
 *
 * The slot and the buffer are reported separately on purpose, because "no
 * buffer" has two very different causes. The `Map` is created lazily — the
 * plugin's request hook normally makes one before the handler runs, but
 * `cookies({ hook: false })` adds no hook, and then nothing creates it until
 * the first `setCookie()` call. So an empty slot is ordinary and says only
 * "not created yet", while a missing slot means the symbol is not where this
 * module expects it. The raw value is carried too, so the restore can tell that
 * apart from a slot holding something this rollback cannot rewrite, which is
 * what an upstream change of container type would look like.
 */
interface PendingCookieSlot {
  /** The symbol the plugin keys its buffer with, as found on this reply */
  key: symbol;
  /** The buffer itself, once the plugin has created it */
  buffer?: Map<unknown, unknown>;
  /**
   * Whatever the slot held, before the `Map` narrowing. Nullish means the
   * plugin simply has not created the buffer yet; anything else that is not a
   * `Map` means the container changed shape upstream.
   */
  value: unknown;
}

function findPendingCookieSlot(
  reply: FastifyReply,
): PendingCookieSlot | undefined {
  // Nothing to find without the plugin, and this runs on every handler
  // invocation, so the symbol walk is skipped entirely for a server that has no
  // cookies at all.
  if (!hasCookiePlugin(reply)) {
    return undefined;
  }

  const replyProperties = reply as unknown as Record<symbol, unknown>;

  // `decorateReply` with a non-function value assigns the symbol as an own
  // property of every reply, so this resolves on the first frame today. The
  // prototype chain is walked anyway so a future change of decorator shape
  // cannot quietly turn this into a miss. The value is always read off the
  // reply itself, since that is where the per-request `Map` lands.
  for (
    let target: object | null = reply;
    target;
    target = Object.getPrototypeOf(target) as object | null
  ) {
    for (const key of Object.getOwnPropertySymbols(target)) {
      if (key.description !== PENDING_COOKIES_SYMBOL_DESCRIPTION) {
        continue;
      }

      const value = replyProperties[key];

      return {
        key,
        buffer: value instanceof Map ? value : undefined,
        value,
      };
    }
  }

  return undefined;
}

/**
 * Copies the reply state a handler could add to before abandoning the request.
 *
 * Headers need more than a shallow spread. Fastify stores a multi-valued
 * `Set-Cookie` as an array and *appends* to that same array on the next
 * `reply.header()` call, so a snapshot holding the array by reference grows
 * along with it: a handler that sets a cookie and then abandons the request
 * would have that cookie restored onto the 404, which is the tell the rollback
 * exists to remove. Only reached when a hook set two or more cookies before the
 * handler ran, since a single one is stored as a string and copies by value.
 *
 * Cookies parked by `reply.setCookie()` are copied out of `@fastify/cookie`'s
 * own buffer for the same reason, one level deep. The entry values are the
 * plugin's own descriptors and are replaced wholesale on each `setCookie()`
 * call rather than mutated, so the entry list is the whole truth here.
 */
function snapshotReplyState(reply: FastifyReply): ReplySnapshot {
  const headers: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(reply.getHeaders())) {
    headers[name] = Array.isArray(value) ? [...value] : value;
  }

  const buffer = findPendingCookieSlot(reply)?.buffer;

  return {
    headers,
    pendingCookies: buffer
      ? { buffer, entries: [...buffer.entries()] }
      : undefined,
  };
}

/**
 * Puts the reply back the way it was before the handler ran.
 *
 * Removes every header currently set and re-applies the snapshot, rather than
 * diffing: a value may be an array (`Set-Cookie`), which no cheap comparison
 * gets right, and the snapshot is the whole truth for this reply anyway. The
 * pending-cookie buffer is rewritten the same way, so a cookie a hook set
 * before the handler — a session renewal, say — survives exactly as it does on
 * a genuine miss, while one the handler set does not.
 */
function restoreReplyState(reply: FastifyReply, snapshot: ReplySnapshot): void {
  for (const name of Object.keys(reply.getHeaders())) {
    reply.removeHeader(name);
  }

  for (const [name, value] of Object.entries(snapshot.headers)) {
    if (value !== undefined) {
      reply.header(name, value);
    }
  }

  // The buffer is looked up again rather than taken from the snapshot alone,
  // because `@fastify/cookie` creates it lazily. Its request hook normally
  // makes one before the handler runs, but `cookies({ hook: false })` adds no
  // hook, and then the first thing to create the buffer is the handler's own
  // `setCookie()` call. The snapshot has none in that case, and trusting it
  // would leave every entry the handler just created in place, shipping exactly
  // the cookie this rollback exists to drop.
  //
  // A buffer that appeared after the snapshot holds nothing but the handler's
  // work, so the empty entry list clears it, which is correct by the same rule
  // that restores a hook's entries when the snapshot did have one.
  const entries = snapshot.pendingCookies?.entries ?? [];
  const slot = snapshot.pendingCookies
    ? undefined
    : findPendingCookieSlot(reply);
  const buffer = snapshot.pendingCookies?.buffer ?? slot?.buffer;

  if (buffer) {
    buffer.clear();

    for (const [key, value] of entries) {
      buffer.set(key, value);
    }
  } else if (
    hasCookiePlugin(reply) &&
    // The symbol is gone, or it is still there holding something this rollback
    // cannot rewrite. Either way the plugin's internals moved.
    (!slot || (slot.value !== null && slot.value !== undefined)) &&
    !hasWarnedAboutPendingCookies
  ) {
    // The plugin is registered but its buffer is not where this module expects
    // it, so an upgrade has moved or reshaped it. Deliberately not keyed on the
    // buffer merely being absent, because that is ordinary: with
    // `cookies({ hook: false })` and a handler that set no cookie, nothing ever
    // created one, and warning there would report a dependency break to an app
    // that has none. An empty slot is that case and stays quiet. A slot holding
    // a non-`Map` is not: the restore above has nothing it can rewrite, so the
    // handler's cookie would ship on the 404 with nothing else to say why.
    hasWarnedAboutPendingCookies = true;

    reply.log.warn(
      { errorCode: 'trigger_404_pending_cookies_unavailable' },
      "request.trigger404() could not find @fastify/cookie's pending-cookie buffer, so a cookie set with reply.setCookie() before the trigger may ship on the 404. Set cookies after the trigger check, or report this against unirend with your @fastify/cookie version.",
    );
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
  if (reply && scope.replySnapshot) {
    restoreReplyState(reply, scope.replySnapshot);
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
