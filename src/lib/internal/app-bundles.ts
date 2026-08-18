/**
 * `defineAppBundles()` — a checked list of the app bundles one app knows about.
 *
 * A single `SSRServer` can host several app bundles, selected per request with
 * `request.setActiveSSRApp(...)` and read back as `request.activeSSRApp`. That
 * value is a plain `string`, so the gate this exists for silently stops working
 * on a typo. The comparison is simply never true. In the form below that means
 * every bundle 404s, including the one the handler was written for, and
 * spelling it `=== 'app-shelf'` instead means the handler answers everywhere:
 *
 * ```ts
 * // Typo. Compiles, runs, gates nothing.
 * if (request.activeSSRApp !== 'app-shelf') {
 *   return request.trigger404();
 * }
 * ```
 *
 * Declaring the bundles once turns that into a compile error:
 *
 * ```ts
 * export const bundles = defineAppBundles('marketing', 'app-shell');
 *
 * if (!bundles.is(request, 'app-shell')) {
 *   return request.trigger404();
 * }
 * ```
 *
 * **Why a value and not a global type declaration.** Typing `activeSSRApp`
 * itself would mean augmenting Fastify's `FastifyRequest`, which is the only
 * way Fastify types a decorator and is unavoidably global: one list per
 * TypeScript program, shared by every app compiled together. Two apps in one
 * repo could not then have their own lists. This is an ordinary exported const,
 * so it is scoped like any other module export — per app, per package, per
 * whatever boundary you export it at — and two apps interfere with each other
 * exactly as much as two unrelated types do, which is not at all.
 */

import type { FastifyRequest } from 'fastify';

/**
 * The key the app a server was created with is registered under.
 *
 * Selectable like any other bundle, but never registered: `registerBuiltApp()`
 * and `registerHMRApp()` add *additional* bundles and throw on this key.
 *
 * Exported so an app that compares against the primary bundle without going
 * through {@link defineAppBundles} has something checked to compare against.
 * Hardcoding the `'__default__'` string in that comparison is unchecked, and a
 * typo in it is the silently-dead gate this module exists to prevent.
 */
export const DEFAULT_APP_BUNDLE_KEY = '__default__';

/**
 * The part of a request these helpers actually read.
 *
 * Only the bundle decoration, because that is all any of them look at. Typing
 * the parameter as `FastifyRequest` would have been the obvious choice and is
 * the wrong one: a `notFoundHandler` receives `NotFoundRequest`, which is
 * `Omit<FastifyRequest, 'params' | 'routeOptions' | 'is404'>` and therefore not
 * assignable to `FastifyRequest`, so gating one would need a cast at every call
 * — a cast that asserts far more than the helper needs and would go on
 * asserting it if the shapes later diverged for a real reason. Accepting the
 * decoration alone lets both request types through and says what is read.
 */
export type AppBundleRequest = Pick<FastifyRequest, 'activeSSRApp'>;

/**
 * A checked list of app bundle keys, as returned by {@link defineAppBundles}.
 *
 * `TKey` is the union of the keys that were declared, inferred from the
 * arguments, so nothing has to be written twice.
 */
export interface AppBundles<TKey extends string> {
  /**
   * The declared keys, in the order they were given.
   *
   * Handy for registering them in a loop, and for an error message that has to
   * name what was expected.
   */
  readonly keys: readonly TKey[];

  /**
   * Whether this request's active bundle is the given key, or any of them.
   *
   * Accepts one key or an array, so a handler shared by several bundles reads
   * the same way as one gated to a single bundle:
   *
   * ```ts
   * if (!bundles.is(request, ['marketing', 'app-shell'])) {
   *   return request.trigger404();
   * }
   * ```
   *
   * A type predicate, so a passing check narrows `request.activeSSRApp` to
   * whatever was checked for — useful when the code after the gate branches on
   * the bundle again rather than just proceeding.
   *
   * `'__default__'` is accepted alongside the declared keys, since the app the
   * server was created with is selectable but is not something you register.
   *
   * Throws a `TypeError` when the request has no active bundle at all, which
   * means it came from an `APIServer` rather than an `SSRServer`. That is a wiring mistake
   * rather than a request that should be refused, and a silent `false` there
   * would turn every gated route into a 404 with nothing to explain it. Gate on
   * the host or a header instead on a standalone API server.
   */
  is<
    TMatch extends BundleKeyOrDefault<TKey>,
    TReq extends AppBundleRequest = AppBundleRequest,
  >(
    request: TReq,
    key: TMatch | readonly TMatch[],
  ): request is TReq & { activeSSRApp: TMatch };

  /**
   * Pick a value for the active bundle, falling back when none is listed.
   *
   * The shape a chain of `is()` calls turns into once more than one bundle
   * needs its own copy, title, or configuration:
   *
   * ```ts
   * const brand = bundles.match(
   *   request,
   *   { marketing: 'Example Co', 'app-shell': 'Example Workspace' },
   *   'Example',
   * );
   * ```
   *
   * Cases are optional, so list only the bundles that differ, and a typo in a
   * case key is a compile error the same way it is in `is()`. `'__default__'`
   * is a legal case, since the app the server was created with is selectable.
   *
   * **The fallback is required, and that is not a convenience.** It cannot be
   * dropped in favor of an exhaustive record: `request.activeSSRApp` is a
   * plain `string`, the reserved key is always reachable, and a list built
   * from configuration widens `TKey` to `string`. Exhaustiveness is never
   * provable here, so there is always a value this has to return.
   *
   * A bundle is "listed" when the key is present, so a case written with an
   * explicit `undefined` value returns `undefined` rather than the fallback.
   * Presence decides, the same way a `switch` case does.
   *
   * Throws a `TypeError` when the request has no active bundle, matching
   * {@link AppBundles.is}, and an `Error` when a case names a bundle that was
   * never declared. The second check is what still holds once `TKey` has
   * widened to `string` and the types have stopped checking anything.
   */
  match<const TValue>(
    request: AppBundleRequest,
    cases: Partial<Record<BundleKeyOrDefault<TKey>, TValue>>,
    fallback: TValue,
  ): TValue;

  /**
   * Pick a *function* for the active bundle, falling back when none is listed.
   *
   * For dispatching behavior rather than data — a loader, a formatter, a
   * fetch strategy that differs per bundle:
   *
   * ```ts
   * const load = bundles.matchFn(
   *   request,
   *   { marketing: loadMarketingPage, 'app-shell': loadShellPage },
   *   loadDefaultPage,
   * );
   *
   * const data = await load(params);
   * ```
   *
   * Same shape and same rules as {@link AppBundles.match} — optional cases, a
   * required fallback, a compile error on an undeclared case key, a `TypeError`
   * on a request with no active bundle. The runtime lookup is literally the
   * same; this exists for what it does to the *types*.
   *
   * **Why not just use `match`.** `match` infers `TValue` from the cases, so a
   * record of functions infers as a *union* of function types. Most branch sets
   * still call fine, since TypeScript intersects the parameter lists and any
   * branch you would want is already assignable to the others. What differs is
   * where a genuinely bad branch is reported. A case whose parameter is
   * narrower than the rest is accepted by `match` and only surfaces later, at
   * the call site, as an intersection that names neither the branch nor the
   * fallback. Constraining the cases to one callable shape here checks each
   * branch where it is written, so the error names the branch that is wrong.
   *
   * `match` can already do this if you write the signature out yourself, as
   * `match<(p: Params) => Promise<Data>>(...)` — an explicit type argument
   * bypasses the union entirely. That works, and it is what this replaces:
   * `TArgs` and `TReturn` infer from the fallback, so the signature is written
   * once instead of at every dispatch site.
   *
   * **Why the cases are wrapped in `NoInfer`.** Inference runs left to right,
   * and the cases come first, so without it they would win and the fallback
   * would be checked against *them* — a branch with the wrong signature would
   * be reported against the fallback, which is the one place that is not
   * wrong. `match` still behaves that way and has a test pinning it. Blocking
   * inference on the cases makes the fallback the single source of the
   * signature and turns every branch into something checked against it, which
   * is the entire ergonomic difference between this and an explicit type
   * argument on `match`.
   *
   * **Annotate an inline fallback, or name it.** The signature is read from the
   * fallback, so an inline arrow with no annotation contributes its own
   * inferred return type rather than the handler type you have in mind, and
   * named cases then fail against it. The error lands on the case, which is
   * confusing, since the fallback is the under-typed one. Passing a named
   * handler, or annotating the arrow, avoids it.
   *
   * **Server-phase only, like the rest of this API.** It needs a
   * `FastifyRequest` with an active bundle, which exists during SSR and not on
   * the client or under SSG, and not on a standalone `APIServer` — that server
   * registers no app bundles, so nothing ever selected one. A loader that
   * dispatches through this renders on the server and throws on client
   * navigation. Gate on the host or a header where there is no active bundle.
   *
   * @throws {TypeError} If the request has no active app bundle
   * @throws {Error} If a case names a bundle that was never declared
   * @throws {TypeError} If the selected case is present but is not a function
   */
  matchFn<TArgs extends unknown[], TReturn>(
    request: AppBundleRequest,
    cases: Partial<
      Record<BundleKeyOrDefault<TKey>, NoInfer<(...args: TArgs) => TReturn>>
    >,
    fallback: (...args: TArgs) => TReturn,
  ): (...args: TArgs) => TReturn;

  /**
   * Build one handler that routes to a per-bundle handler when it is called.
   *
   * The same dispatch as {@link AppBundles.matchFn}, minus the `request`
   * argument, because the handlers this is for already take the request first
   * and it would otherwise have to be passed twice:
   *
   * ```ts
   * server.pageDataHandler.register(
   *   'not-found',
   *   bundles.dispatch(
   *     { ['__default__']: unusedSubdomainNotFound },
   *     genericNotFound,
   *   ),
   * );
   * ```
   *
   * What comes back is an ordinary function with the branches' own signature,
   * so it drops straight into `register()` — there is nothing to unwrap and no
   * argument list to forward by hand. The active bundle is read from the first
   * argument at call time, so one registration serves every bundle and each
   * request picks its own branch.
   *
   * Prefer {@link AppBundles.match} when the branches differ only in the data
   * they feed to a shared call. Reach for this when they genuinely do different
   * work — a different fetch, a different status code, a different shape.
   *
   * Undeclared case keys are refused here, when the handler is built, rather
   * than on the first request that happens to reach a bad key. The rest of the
   * checks are per-call and match `matchFn` exactly.
   *
   * **The cases are read once, when the handler is built.** They are copied at
   * that point, so editing the object you passed afterwards changes nothing
   * about the handler you got back. That is what keeps the build-time key check
   * honest: a key added later would otherwise route requests having never been
   * checked, because nothing re-reads the cases per request. Build a second
   * handler if the branches really need to differ, and note that `matchFn`
   * takes its cases per call and so has no such snapshot.
   *
   * @throws {Error} If a case names a bundle that was never declared. Thrown
   *   from this call, not from the returned handler.
   */
  dispatch<TArgs extends [AppBundleRequest, ...unknown[]], TReturn>(
    cases: Partial<
      Record<BundleKeyOrDefault<TKey>, NoInfer<(...args: TArgs) => TReturn>>
    >,
    fallback: (...args: TArgs) => TReturn,
  ): (...args: TArgs) => TReturn;

  /**
   * The given key, checked against the declared list and returned unchanged.
   *
   * For the registration call, which takes a `string` and would otherwise
   * accept a typo that only surfaces as a runtime throw:
   *
   * ```ts
   * server.registerBuiltApp(bundles.key('marketing'), './build-marketing');
   * ```
   *
   * `'__default__'` is rejected: it is the key of the app the server already
   * has, and passing it to a register method throws.
   *
   * Checked at runtime as well as in the types, because the types can stop
   * being a check. Keys built from configuration — `defineAppBundles(...names)`
   * where `names` is a `string[]` — widen `TKey` to `string`, and then every
   * literal type-checks. The runtime check is what holds in that case, and it
   * is why the reserved key is rejected by a conditional type rather than by
   * membership in `TKey`: the conditional still refuses `'__default__'` once
   * `TKey` is `string`, where `Exclude` would not.
   */
  key<TArg extends TKey>(
    key: TArg extends typeof DEFAULT_APP_BUNDLE_KEY ? never : TArg,
  ): string;
}

/** A declared key, or the reserved key of the app the server was created with. */
type BundleKeyOrDefault<TKey extends string> =
  TKey | typeof DEFAULT_APP_BUNDLE_KEY;

/**
 * The tail of an undeclared-key error, naming what was declared.
 *
 * An empty declaration is legal — an app that has not built its other bundles
 * yet registers none — and "Declared keys: ." would read as a bug in the
 * message rather than as the answer to why the key was refused. Kept neutral
 * about what to do next, because both `key()` and the gates report through
 * here and they are reached at opposite ends: `key()` at the register call,
 * the gates on a request.
 */
function describeDeclared(declaredKeys: readonly string[]): string {
  if (declaredKeys.length === 0) {
    return 'Nothing has been declared yet, so add this key to defineAppBundles() alongside the bundle that registers it.';
  }

  return `Declared keys: ${declaredKeys.join(', ')}.`;
}

/**
 * Refuses a key that was never declared.
 *
 * The types stop being a check once the list came from configuration, since
 * `defineAppBundles(...names)` over a `string[]` widens `TKey` to `string` and
 * every literal then type-checks. Without this, a typo in `is()` would just
 * return false, and in the documented `if (!bundles.is(...)) trigger404()`
 * gate that 404s every request to the route with nothing to explain it.
 * `key()` and `match()` already refuse an undeclared key, so this makes the
 * three agree.
 */
function assertDeclaredKey(
  key: string,
  declared: ReadonlySet<string>,
  declaredKeys: readonly string[],
  method: string,
): void {
  if (key === DEFAULT_APP_BUNDLE_KEY || declared.has(key)) {
    return;
  }

  throw new Error(
    `App bundle key "${key}" was passed to ${method}() but was not declared in defineAppBundles(). ${describeDeclared(declaredKeys)}`,
  );
}

/**
 * The listed function for a bundle, or the fallback, or a throw.
 *
 * Shared by `matchFn()` and `dispatch()` so the two cannot disagree.
 *
 * Presence decides which case wins, the same rule `match()` follows. What
 * differs is the `undefined` value: `match()` returns it, which is right when
 * the cases hold data, but both callers here promise something callable, so
 * returning it would break its own signature and surface as "x is not a
 * function" somewhere else entirely, with nothing naming the bundle. `Partial`
 * admits the explicit `undefined` without `exactOptionalPropertyTypes`, so the
 * types do not catch this one.
 */
function selectFunctionCase<TFn>(
  activeKey: string,
  cases: Record<string, TFn | undefined>,
  fallback: TFn,
  method: string,
): TFn {
  if (!Object.prototype.hasOwnProperty.call(cases, activeKey)) {
    return fallback;
  }

  const selected = cases[activeKey];

  if (typeof selected !== 'function') {
    throw new TypeError(
      `App bundle "${activeKey}" has a case in ${method}() whose value is ${selected === undefined ? 'undefined' : typeof selected}, not a function. Drop the case to take the fallback, or give it a function.`,
    );
  }

  return selected;
}

/**
 * The request's active bundle, or a throw explaining why there isn't one.
 *
 * Shared by all four of `is()`, `match()`, `matchFn()`, and `dispatch()`, so
 * none of them can disagree about what an `APIServer` request means. A request
 * with no SSR decoration at all is a wiring mistake, and answering it silently
 * would turn every gated route into a 404 with nothing to explain it.
 */
function readActiveBundle(request: AppBundleRequest): string {
  // Guarded before the property read so `dispatch()` called with nothing, or
  // with a non-object first argument, reports what is wrong rather than
  // "undefined is not an object". The types forbid it, but a handler reached
  // from untyped code still gets a message naming the cause.
  if (request === null || typeof request !== 'object') {
    throw new TypeError(
      `App bundles read the active bundle from a request, but got ${request === null ? 'null' : typeof request}. On an SSRServer this is the request the handler was called with.`,
    );
  }

  const activeKey: unknown = request.activeSSRApp;

  if (typeof activeKey !== 'string') {
    throw new TypeError(
      'request.activeSSRApp is not available on this request, so there is no active app bundle to compare against. App bundles exist only on an SSRServer — on a standalone APIServer, gate on the host or a header instead.',
    );
  }

  return activeKey;
}

/**
 * Declare the app bundles this app knows about.
 *
 * The keys are inferred from the arguments, so the union is written once:
 *
 * ```ts
 * // apps/marketing/bundles.ts
 * export const bundles = defineAppBundles('marketing', 'app-shell');
 * ```
 *
 * See the module docs for why this is a value rather than a type declaration.
 *
 * **An empty declaration is legal, so this can be adopted before there is a
 * second bundle to name.** The app a server is created with is passed to
 * `serveSSRWithHMR()` / `serveSSRBuilt()`, not to `registerBuiltApp()` /
 * `registerHMRApp()`, and registration is what assigns a key — so that app
 * never had one of your choosing, and is selectable as `'__default__'`.
 * Serving only that app, before any others are registered, is a normal state
 * and is where every app starts. A declared key becomes real only when that
 * same key is passed to `registerBuiltApp()` / `registerHMRApp()`, and the
 * serve-time app goes through neither, so inventing a name for it — declaring
 * `defineAppBundles('marketing')` with no matching `registerBuiltApp()` call —
 * type-checks and gates nothing: nothing ever selects `'marketing'`, so
 * `is(request, 'marketing')` is false on every request while that app keeps
 * arriving as `'__default__'`. That is the silently-dead gate this whole
 * module exists to prevent, reintroduced by the declaration itself. Declare nothing instead and gate on `'__default__'`,
 * then add each key once its bundle is actually registered, which leaves the
 * gates already written unchanged. With no keys, `'__default__'` is the only
 * key that type-checks, and `is()` and the three dispatchers all select it.
 * `key()` cannot be called at all, since `TKey` is `never` and there is no key it
 * could hand back, which is right while nothing is registered. It throws at
 * runtime instead on the widened form, where the list came from configuration
 * and `TKey` is `string`.
 *
 * ```ts
 * // Nothing registered yet: the primary app is the only bundle so far.
 * export const bundles = defineAppBundles();
 *
 * if (!bundles.is(request, '__default__')) {
 *   return request.trigger404();
 * }
 *
 * // Later, once the second bundle is built, it joins the declaration and the
 * // gate above keeps working unchanged.
 * export const bundles = defineAppBundles('app-shell');
 * ```
 *
 * Note that `defineAppBundles(...names)` spread from a `string[]` that is
 * empty at runtime is therefore accepted rather than refused here. Nothing
 * breaks silently when it happens: `key()` throws on every key it is given,
 * and `is()`, `match()`, `matchFn()`, and `dispatch()` throw on any key other
 * than `'__default__'`, so the empty list surfaces at the first real use with
 * a message naming the key.
 *
 * @param keys - The bundle keys, excluding `'__default__'`. May be empty.
 * @throws {Error} If a key is empty or whitespace-only, or if `'__default__'`
 *   is passed (it is not a bundle you declare)
 */
export function defineAppBundles<TKey extends string = never>(
  // The `= never` default is what makes the empty declaration type correctly.
  // Inference has no candidates when there are no arguments, so without it
  // `TKey` would fall back to its `string` constraint and every key would
  // type-check against a list that declares nothing — the opposite of the
  // point. `never` makes `BundleKeyOrDefault<TKey>` exactly `'__default__'`,
  // so that is the only case that compiles. A call with arguments infers from
  // them as before and never reaches the default.
  ...keys: TKey[]
): AppBundles<TKey> {
  // These mirror what the server itself does with a key at registration. A
  // declaration the server would refuse or rewrite is worse than useless here:
  // it type-checks, so it reads as protection, while the comparison it produces
  // can never match. See the surrounding-whitespace case below.
  const declared = new Set<string>();

  for (const key of keys) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error(
        'App bundle keys must be non-empty strings. Check the arguments to defineAppBundles().',
      );
    }

    if (key !== key.trim()) {
      // The server trims at registration, so ` marketing ` is registered — and
      // reported by `request.activeSSRApp` — as `marketing`. Declaring the
      // untrimmed form would make every `is()` call against it false, so every
      // gated request would 404 with nothing to explain it. Refused rather than
      // trimmed silently: trimming would leave the declared literal type
      // disagreeing with the key the server actually uses, so `is(request, '
      // marketing ')` would still never match.
      throw new Error(
        `App bundle key "${key}" has surrounding whitespace. The server trims keys when they are registered, so declare it as "${key.trim()}" — otherwise nothing would ever match it.`,
      );
    }

    if (key === '__proto__') {
      // Written as a plain property in a cases object, `__proto__` sets the
      // prototype instead of creating an own property. `Object.keys` then does
      // not see it, so the undeclared-key check cannot report it, and
      // `hasOwnProperty` is false, so the case silently takes the fallback
      // forever while `is()` on the same key returns true. That is precisely
      // the silently-broken gate this helper exists to prevent, and it cannot
      // be fixed at the case site, so the key is refused here.
      throw new Error(
        'Do not declare "__proto__" as an app bundle key. Written as a case in match(), matchFn(), or dispatch() it sets the object prototype rather than a case, so it would never match and nothing would report it. Rename the bundle.',
      );
    }

    if (key === DEFAULT_APP_BUNDLE_KEY) {
      throw new Error(
        `Do not declare "${DEFAULT_APP_BUNDLE_KEY}" in defineAppBundles(). It is the key of the app the server was created with, so it is always selectable and is never registered.`,
      );
    }

    if (key.includes('/') || key.includes('\\')) {
      // Registration refuses these outright, so a declaration containing one
      // could never describe a bundle that exists. Caught here, where the
      // mistake is visible, rather than at the register call.
      throw new Error(
        `App bundle key "${key}" cannot contain path separators. Use alphanumeric names like "marketing" or "admin".`,
      );
    }

    if (declared.has(key)) {
      // `keys` is meant to be usable for registering in a loop, and the server
      // refuses a key it already has. A duplicate is invisible to the type
      // system too — the union collapses `'marketing' | 'marketing'` to one
      // member — so this is the only place the copy-paste can be caught.
      // Refused rather than deduplicated, since a repeated key means the
      // declaration does not say what its author thought it said.
      throw new Error(
        `App bundle key "${key}" is declared more than once in defineAppBundles(). Each bundle is registered once, so a repeated key is a mistake rather than a second bundle.`,
      );
    }

    declared.add(key);
  }

  const declaredKeys: readonly TKey[] = Object.freeze([...keys]);

  return {
    keys: declaredKeys,

    is<
      TMatch extends BundleKeyOrDefault<TKey>,
      TReq extends AppBundleRequest = AppBundleRequest,
    >(
      request: TReq,
      key: TMatch | readonly TMatch[],
    ): request is TReq & { activeSSRApp: TMatch } {
      const activeKey = readActiveBundle(request);
      const wanted: readonly string[] = Array.isArray(key)
        ? (key as readonly string[])
        : [key as string];

      for (const candidate of wanted) {
        assertDeclaredKey(candidate, declared, declaredKeys, 'is');
      }

      return wanted.includes(activeKey);
    },

    match<const TValue>(
      request: AppBundleRequest,
      cases: Partial<Record<BundleKeyOrDefault<TKey>, TValue>>,
      fallback: TValue,
    ): TValue {
      const activeKey = readActiveBundle(request);

      // Checked before the lookup, so a typo is reported as a typo rather than
      // silently taking the fallback forever. `is()` gets this from the type
      // system alone because it takes the key positionally; here the keys are
      // object properties, and a declaration built from configuration has
      // widened TKey to `string`, which stops the types checking them at all.
      for (const caseKey of Object.keys(cases)) {
        assertDeclaredKey(caseKey, declared, declaredKeys, 'match');
      }

      // Presence rather than the value, so a case written as `undefined` is
      // still a case. Reading the value and testing it for undefined would
      // make that one spelling silently take the fallback.
      return Object.prototype.hasOwnProperty.call(cases, activeKey)
        ? (cases as Record<string, TValue>)[activeKey]
        : fallback;
    },

    matchFn<TArgs extends unknown[], TReturn>(
      request: AppBundleRequest,
      cases: Partial<
        Record<BundleKeyOrDefault<TKey>, NoInfer<(...args: TArgs) => TReturn>>
      >,
      fallback: (...args: TArgs) => TReturn,
    ): (...args: TArgs) => TReturn {
      const activeKey = readActiveBundle(request);

      for (const caseKey of Object.keys(cases)) {
        assertDeclaredKey(caseKey, declared, declaredKeys, 'matchFn');
      }

      return selectFunctionCase(
        activeKey,
        cases as Record<string, ((...args: TArgs) => TReturn) | undefined>,
        fallback,
        'matchFn',
      );
    },

    dispatch<TArgs extends [AppBundleRequest, ...unknown[]], TReturn>(
      cases: Partial<
        Record<BundleKeyOrDefault<TKey>, NoInfer<(...args: TArgs) => TReturn>>
      >,
      fallback: (...args: TArgs) => TReturn,
    ): (...args: TArgs) => TReturn {
      // Eagerly, so an undeclared key is reported where the handler is wired up
      // rather than on whichever request first reaches the bad case. The other
      // two cannot do this — they are handed the request and the cases at the
      // same moment — but here the cases are known a whole phase earlier.
      for (const caseKey of Object.keys(cases)) {
        assertDeclaredKey(caseKey, declared, declaredKeys, 'dispatch');
      }

      // Snapshot, so what was validated above is what gets used. Holding the
      // caller's object by reference would let a key added after this call
      // route requests without ever passing the check, since the check has
      // already run and nothing re-runs it per request. Copying once here
      // closes that for good and costs nothing per request; re-validating on
      // every call would cost something on every call, forever.
      const snapshotCases: Record<
        string,
        ((...args: TArgs) => TReturn) | undefined
      > = { ...cases };

      return (...args: TArgs): TReturn => {
        // The request is the first argument by construction, which is what
        // lets this drop into `register()` without a forwarding wrapper.
        const activeKey = readActiveBundle(args[0]);

        return selectFunctionCase(
          activeKey,
          snapshotCases,
          fallback,
          'dispatch',
        )(...args);
      };
    },

    key(key) {
      // `key` is typed but not trusted: when the declaration came from
      // configuration, TKey is `string` and every literal satisfies it.
      const requestedKey: string = key;

      if (requestedKey === DEFAULT_APP_BUNDLE_KEY) {
        throw new Error(
          `"${DEFAULT_APP_BUNDLE_KEY}" is the key of the app the server was created with, so it cannot be registered. Pass it to is() if you meant to compare against the primary app.`,
        );
      }

      if (!declared.has(requestedKey)) {
        throw new Error(
          `App bundle key "${requestedKey}" was not declared in defineAppBundles(). ${describeDeclared(declaredKeys)}`,
        );
      }

      return requestedKey;
    },
  };
}
