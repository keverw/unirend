/**
 * `defineAppBundles()` — a checked list of the app bundles one app knows about.
 *
 * A single `SSRServer` can host several app bundles, selected per request with
 * `request.setActiveSSRApp(...)` and read back as `request.activeSSRApp`. That
 * value is a plain `string`, so the gate this exists for silently fails open on
 * a typo — the comparison is simply never true, and the handler serves every
 * bundle:
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
 */
const DEFAULT_APP_BUNDLE_KEY = '__default__';

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
  is<TMatch extends BundleKeyOrDefault<TKey>>(
    request: FastifyRequest,
    key: TMatch | readonly TMatch[],
  ): request is FastifyRequest & { activeSSRApp: TMatch };

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
    request: FastifyRequest,
    cases: Partial<Record<BundleKeyOrDefault<TKey>, TValue>>,
    fallback: TValue,
  ): TValue;

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
 * The request's active bundle, or a throw explaining why there isn't one.
 *
 * Shared by `is()` and `match()` so the two cannot disagree about what an
 * `APIServer` request means. Fail-closed is right for a forgotten `return` in
 * a working setup; a request with no SSR decoration at all is a wiring
 * mistake, and answering it silently would turn every gated route into a 404
 * with nothing to explain it.
 */
function readActiveBundle(request: FastifyRequest): string {
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
 * @param keys - The bundle keys, excluding `'__default__'`
 * @throws {Error} If no keys are given, if a key is empty or whitespace-only,
 *   or if `'__default__'` is passed (it is not a bundle you declare)
 */
export function defineAppBundles<TKey extends string>(
  ...keys: TKey[]
): AppBundles<TKey> {
  if (keys.length === 0) {
    throw new Error(
      'defineAppBundles() needs at least one app bundle key. Pass the keys this app registers, e.g. defineAppBundles("marketing", "app-shell").',
    );
  }

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

    is<TMatch extends BundleKeyOrDefault<TKey>>(
      request: FastifyRequest,
      key: TMatch | readonly TMatch[],
    ): request is FastifyRequest & { activeSSRApp: TMatch } {
      const activeKey = readActiveBundle(request);

      return Array.isArray(key)
        ? (key as readonly string[]).includes(activeKey)
        : activeKey === key;
    },

    match<const TValue>(
      request: FastifyRequest,
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
        if (caseKey !== DEFAULT_APP_BUNDLE_KEY && !declared.has(caseKey)) {
          throw new Error(
            `App bundle key "${caseKey}" was used as a case in match() but was not declared in defineAppBundles(). Declared keys: ${declaredKeys.join(', ')}.`,
          );
        }
      }

      // Presence rather than the value, so a case written as `undefined` is
      // still a case. Reading the value and testing it for undefined would
      // make that one spelling silently take the fallback.
      return Object.prototype.hasOwnProperty.call(cases, activeKey)
        ? (cases as Record<string, TValue>)[activeKey]
        : fallback;
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
          `App bundle key "${requestedKey}" was not declared in defineAppBundles(). Declared keys: ${declaredKeys.join(', ')}.`,
        );
      }

      return requestedKey;
    },
  };
}
