import { describe, it, expect } from 'bun:test';
import type { FastifyRequest } from 'fastify';
import { serveSSRBuilt } from '../ssr';
import { defineAppBundles } from './app-bundles';
import type { PageDataHandler } from './data-loader-server-handler-helpers';
import type { NotFoundRequest } from '../types';

const FAKE_BUILD_DIR = '/fake/build';

/**
 * Coverage for `defineAppBundles()`.
 *
 * Two halves. The compile-time block asserts what the helper exists for: a key
 * that was never declared does not type-check, which is what turns a gate that
 * silently stopped working into a build error. The runtime blocks cover the checks the
 * types cannot make — keys arriving from configuration, and a request that has
 * no active bundle at all.
 */

/** A request stub carrying just the field the helper reads. */
function requestWithActiveBundle(activeSSRApp: string): FastifyRequest {
  return { activeSSRApp } as unknown as FastifyRequest;
}

const bundles = defineAppBundles('marketing', 'app-shell');
const otherAppBundles = defineAppBundles('admin', 'docs');

// For the dispatch() generic-preservation checks below. Declared rather than
// built, since what is asserted is the typing and real envelopes add nothing.
interface DashboardData {
  widgets: string[];
  seatCount: number;
}

declare const shellDashboard: PageDataHandler<DashboardData>;
declare const marketingDashboard: PageDataHandler<DashboardData>;
declare const otherDataHandler: PageDataHandler<{ somethingElse: boolean }>;

// --- Type-level -------------------------------------------------------------

// Expressions rather than bindings: what is being asserted is that each line
// does or does not compile, and naming a dozen throwaway booleans adds nothing.
function _typeLevelChecks(request: FastifyRequest): void {
  bundles.is(request, 'marketing');

  // The app the server was created with is selectable, so comparing against it
  // is legal even though it is never declared.
  bundles.is(request, '__default__');

  bundles.is(request, ['marketing', 'app-shell']);

  // The whole point: a typo stops compiling instead of never matching.
  // @ts-expect-error 'app-shelf' is not one of this app's bundles.
  bundles.is(request, 'app-shelf');

  // @ts-expect-error 'app-shelf' is not one of this app's bundles.
  bundles.is(request, ['marketing', 'app-shelf']);

  bundles.key('marketing');

  // @ts-expect-error 'market' is not one of this app's bundles.
  bundles.key('market');

  // Registering the primary app's key throws, so the type refuses it too.
  // @ts-expect-error '__default__' is not a key you register.
  bundles.key('__default__');

  // Two apps in one program keep their own lists — the thing a global type
  // declaration could not do. Neither list leaks into the other.
  otherAppBundles.key('admin');

  // @ts-expect-error 'admin' belongs to the other app's list, not this one.
  bundles.key('admin');

  // @ts-expect-error 'marketing' belongs to this app's list, not the other's.
  otherAppBundles.key('marketing');

  // Keys built from configuration widen TKey to `string`, and then every
  // literal satisfies it — so the reserved key is refused by a conditional
  // type rather than by membership, which survives the widening. `Exclude`
  // would not: Exclude<string, '__default__'> is still `string`.
  const widened = defineAppBundles(...(['marketing'] as string[]));

  widened.key('anything-at-all');

  // @ts-expect-error '__default__' is never registerable, whatever TKey is.
  widened.key('__default__');

  bundles.match(request, { marketing: 'a', 'app-shell': 'b' }, 'c');

  // Cases are optional — list only the bundles that differ.
  bundles.match(request, { marketing: 'a' }, 'c');

  // Legal as a case for the same reason it is legal in is(). Written as a
  // computed key because a naming-convention lint rule of the kind this repo
  // and the starter templates ship rejects `__default__` as a plain property
  // name — worth knowing, though the fallback usually covers this bundle.
  bundles.match(request, { ['__default__']: 'a' }, 'c');

  bundles.match(
    request,
    // @ts-expect-error 'app-shelf' is not one of this app's bundles.
    { 'app-shelf': 'a' },
    'c',
  );

  bundles.match(
    request,
    { marketing: 42 },
    // @ts-expect-error TValue infers from the cases first, so the mismatch is
    // reported against the fallback rather than against the offending case.
    'c',
  );

  // matchFn() takes the same three arguments and enforces the same key rules.
  bundles.matchFn(
    request,
    { marketing: (id: string) => id.length },
    (id: string) => id.length + 1,
  );

  bundles.matchFn(
    request,
    // @ts-expect-error 'app-shelf' is not one of this app's bundles.
    { ['app-shelf']: (id: string) => id.length },
    (_id: string) => 0,
  );

  // The signature comes from the fallback, and the cases are checked against
  // it, so a branch that disagrees is reported against that branch. That is
  // what `NoInfer` on the cases buys, and it is the difference from match():
  // without it the cases infer first, being the earlier parameter, and the
  // mismatch lands on the fallback instead. The match() block above shows it,
  // with its suppression sitting on the fallback for exactly that reason.
  //
  // Do not write the suppression directive's name in prose here — TypeScript
  // reads it out of an ordinary comment and counts it as a real directive.
  bundles.matchFn(
    request,
    // @ts-expect-error a case must accept the parameters the fallback declares.
    { marketing: (id: number) => id },
    (id: string) => id.length,
  );

  bundles.matchFn(
    request,
    // @ts-expect-error a case must return what the fallback returns.
    { marketing: (id: string) => id },
    (id: string) => id.length,
  );

  // dispatch() takes no request — it reads one from the first argument of the
  // call, and is checked the same way.
  bundles.dispatch(
    { marketing: (_req: FastifyRequest, id: string) => id.length },
    (_req: FastifyRequest, _id: string) => 0,
  );

  bundles.dispatch(
    // @ts-expect-error a case must accept the parameters the fallback declares.
    { marketing: (_req: FastifyRequest, id: number) => id },
    (_req: FastifyRequest, id: string) => id.length,
  );

  bundles.dispatch(
    // @ts-expect-error 'app-shelf' is not one of this app's bundles.
    { ['app-shelf']: (_req: FastifyRequest) => 0 },
    (_req: FastifyRequest) => 0,
  );
}

// dispatch() preserves the handler type's own generics. `PageDataHandler<T>` is
// the real shape this exists for, and a helper that quietly widened T would
// hand back something `register()` still accepts while the data type stopped
// being checked — the failure would surface as a wrong payload, not an error.
function _dispatchPreservesHandlerGenerics(): PageDataHandler<DashboardData> {
  return bundles.dispatch({ marketing: marketingDashboard }, shellDashboard);
}

void _dispatchPreservesHandlerGenerics;

function _dispatchRejectsAMismatchedDataType(): void {
  bundles.dispatch(
    // @ts-expect-error a handler typed for other data is not a DashboardData one.
    { marketing: otherDataHandler },
    shellDashboard,
  );
}

void _dispatchRejectsAMismatchedDataType;

// What matchFn() actually buys, pinned as a controlled pair with match() below.
//
// Not "the union cannot be called": for any branch set matchFn() accepts, the
// union match() infers turns out to be callable too, because every case must
// already be assignable to the fallback's signature and TypeScript's parameter
// intersection collapses accordingly. Checked, rather than assumed.
//
// The difference is WHERE a bad branch is reported. matchFn() checks each case
// against the fallback at the case, so the error names the branch that is
// wrong. match() infers from the cases first, so the same mistake is reported
// against the fallback or at the call site, neither of which is the offender.
//
// Here every branch differs from the others but each is assignable to the
// fallback, and the result is one ordinary callable signature.
function _matchFnAcceptsHeterogeneousBranches(
  request: FastifyRequest,
): (id: string) => Promise<number> {
  return bundles.matchFn(
    request,
    {
      marketing: () => Promise.resolve(0),
      ['app-shell']: (id: string, isVerbose?: boolean) =>
        Promise.resolve(isVerbose === true ? id.length * 10 : id.length),
    },
    (id: string) => Promise.resolve(id.length),
  );
}

void _matchFnAcceptsHeterogeneousBranches;

// The controlled pair. A branch whose parameter is NARROWER than the fallback's
// is the one genuinely bad case, since a caller holding the fallback's
// signature could pass a string it cannot accept.
//
// matchFn() reports it on the branch:
function _matchFnReportsABadBranchOnTheBranch(request: FastifyRequest): void {
  bundles.matchFn(
    request,
    // @ts-expect-error the case cannot accept every string the fallback can.
    { marketing: (id: 'a' | 'b') => Promise.resolve(id.length) },
    (id: string) => Promise.resolve(id.length),
  );
}

void _matchFnReportsABadBranchOnTheBranch;

// match() accepts the same branch, and the mistake only surfaces later, at the
// call site, as a parameter intersection that mentions neither the branch nor
// the fallback. That is the ergonomic difference, and pinning it means the
// justification for matchFn() fails the build if it ever stops being true.
function _matchDefersTheSameMistakeToTheCallSite(
  request: FastifyRequest,
): void {
  const load = bundles.match(
    request,
    { marketing: (id: 'a' | 'b') => Promise.resolve(id.length) },
    (id: string) => Promise.resolve(id.length),
  );

  // @ts-expect-error the cases infer as a union, and calling a union
  // intersects its parameter lists, so `id` is string & ('a' | 'b').
  void load('anything');
}

void _matchDefersTheSameMistakeToTheCallSite;

// A notFoundHandler receives NotFoundRequest, which is FastifyRequest minus
// three fields and so is NOT assignable to it. These read only the bundle
// decoration, so they must take it without a cast at the call site.
function _acceptsANotFoundRequest(request: NotFoundRequest): string {
  if (bundles.is(request, 'app-shell')) {
    // is() narrows whichever request type came in, not FastifyRequest.
    return request.activeSSRApp;
  }

  return bundles.match(request, { marketing: 'mk' }, 'fallback');
}

void _acceptsANotFoundRequest;

// The same for the other two, since all four share the parameter type and a
// regression in any one of them would put the cast back at the call site.
function _matchFnAcceptsANotFoundRequest(request: NotFoundRequest): string {
  return bundles.matchFn(
    request,
    { marketing: (id: string) => `mk:${id}` },
    (id: string) => `fb:${id}`,
  )('home');
}

void _matchFnAcceptsANotFoundRequest;

// Shaped like a real notFoundHandler: NotFoundRequest first, then the two
// arguments such a handler receives. This is the call that needed a cast.
function _dispatchAcceptsANotFoundHandler(): (
  request: NotFoundRequest,
  isPageData: boolean | undefined,
  params: { label: string },
) => string {
  return bundles.dispatch(
    {
      ['__default__']: (
        _request: NotFoundRequest,
        isPageData: boolean | undefined,
        params: { label: string },
      ) => `default:${String(isPageData)}:${params.label}`,
    },
    (
      _request: NotFoundRequest,
      isPageData: boolean | undefined,
      params: { label: string },
    ) => `generic:${String(isPageData)}:${params.label}`,
  );
}

void _dispatchAcceptsANotFoundHandler;

// A plain FastifyRequest still works everywhere it did before. The widening is
// to a shape both satisfy, not a swap from one concrete type to another.
function _stillAcceptsAFastifyRequest(request: FastifyRequest): string {
  if (bundles.is(request, 'app-shell')) {
    return request.activeSSRApp;
  }

  return bundles.match(request, { marketing: 'mk' }, 'fallback');
}

void _stillAcceptsAFastifyRequest;

// The `const` type parameter is what keeps the result a literal union instead
// of collapsing to `string`. Without it this annotation would not compile, and
// match() would be useless for the discriminated-config case it exists for.
function _matchInfersLiterals(
  request: FastifyRequest,
): 'Example Co' | 'Example Workspace' | 'Example' {
  return bundles.match(
    request,
    { marketing: 'Example Co', 'app-shell': 'Example Workspace' },
    'Example',
  );
}

void _matchInfersLiterals;

// `is()` is a type predicate, so a passing check narrows the request's active
// bundle to what was checked for — inside the guard, and after an early return.
function _narrowsInsideTheGuard(request: FastifyRequest): 'app-shell' | null {
  if (bundles.is(request, 'app-shell')) {
    return request.activeSSRApp;
  }

  return null;
}

function _narrowsAfterAnEarlyReturn(
  request: FastifyRequest,
): 'marketing' | 'app-shell' | null {
  if (!bundles.is(request, ['marketing', 'app-shell'])) {
    return null;
  }

  return request.activeSSRApp;
}

void [_narrowsInsideTheGuard, _narrowsAfterAnEarlyReturn];

// An empty declaration types the way it has to for a single-app server to be
// able to use it: '__default__' is the only case that compiles, so a
// real-looking key that could never be active stops type-checking.
const _emptyBundles = defineAppBundles();

function _emptyDeclarationAcceptsTheDefaultKey(
  request: FastifyRequest,
): '__default__' | null {
  if (_emptyBundles.is(request, '__default__')) {
    return request.activeSSRApp;
  }

  return null;
}

function _emptyDeclarationRefusesAnUndeclaredKey(request: FastifyRequest) {
  // @ts-expect-error nothing is declared, so '__default__' is the only key
  void _emptyBundles.is(request, 'marketing');

  // @ts-expect-error the same for a case key, which is where a stray key hides
  void _emptyBundles.match(request, { marketing: 'mk' }, 'fallback');
}

void [
  _emptyDeclarationAcceptsTheDefaultKey,
  _emptyDeclarationRefusesAnUndeclaredKey,
];

void _typeLevelChecks;

// --- Runtime ----------------------------------------------------------------

describe('defineAppBundles()', () => {
  it('exposes the declared keys in order', () => {
    expect([...bundles.keys]).toEqual(['marketing', 'app-shell']);
  });

  it('produces a list that registers cleanly in a loop', () => {
    // The workflow the `keys` docblock points at. Every value that would make
    // this throw — untrimmed, path separator, reserved, duplicate — is refused
    // at declaration, so reaching this loop means the list is registerable.
    const server = serveSSRBuilt(FAKE_BUILD_DIR);

    expect(() => {
      for (const key of bundles.keys) {
        server.registerBuiltApp(key, `${FAKE_BUILD_DIR}-${key}`);
      }
    }).not.toThrow();
  });

  it('does not let a caller mutate the declared keys', () => {
    expect(Object.isFrozen(bundles.keys)).toBe(true);
  });

  it('returns the key unchanged', () => {
    expect(bundles.key('marketing')).toBe('marketing');
  });

  it('throws on an empty or whitespace-only key', () => {
    expect(() => defineAppBundles('marketing', '   ')).toThrow(
      /non-empty strings/,
    );
  });

  it('throws on a key with surrounding whitespace', () => {
    // The server trims at registration, so the untrimmed form would be
    // declared here and never seen on a request — every gated route would 404
    // with nothing to explain it. The message names the key to use instead.
    expect(() => defineAppBundles(' marketing ')).toThrow(
      /surrounding whitespace/,
    );
    expect(() => defineAppBundles(' marketing ')).toThrow(/"marketing"/);
  });

  it('throws on a key containing a path separator', () => {
    // Registration refuses these, so declaring one could never match a bundle
    // that exists.
    expect(() => defineAppBundles('my/app')).toThrow(/path separators/);
    expect(() => defineAppBundles('my\\app')).toThrow(/path separators/);
  });

  it('rejects the reserved key at runtime, not only in the types', () => {
    // The types stop being a check when the declaration comes from config, so
    // `key()` verifies rather than trusting its argument.
    const widened = defineAppBundles(...(['marketing'] as string[]));
    // Through a string, which is how the reserved key actually arrives once
    // the declaration came from config — the literal form is a compile error,
    // pinned in the type-level block above.
    const reservedFromConfig: string = '__default__';

    expect(() => widened.key(reservedFromConfig)).toThrow(
      /cannot be registered/,
    );
  });

  it('rejects an undeclared key at runtime', () => {
    // Same widening: `key()` is supposed to be the check that stands between a
    // typo and a runtime throw from registerBuiltApp(), so it has to hold here.
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() => widened.key('typo-nobody-declared')).toThrow(
      /was not declared/,
    );
    expect(() => widened.key('typo-nobody-declared')).toThrow(
      /Declared keys: marketing/,
    );
  });

  it('throws on a duplicate key', () => {
    // `keys` is documented as usable for registering in a loop, and the server
    // refuses a key it already has — so a duplicate would only surface on the
    // second registration. The type system cannot catch it either: the union
    // collapses a repeated literal to one member.
    expect(() => defineAppBundles('marketing', 'marketing')).toThrow(
      /declared more than once/,
    );
  });

  it('throws when __proto__ is declared', () => {
    // As a plain property in a cases object it sets the prototype rather than
    // creating a case, so Object.keys never sees it and hasOwnProperty is
    // false: the case would silently take the fallback forever while is() on
    // the same key returned true. Refused here, the only place it can be.
    expect(() => defineAppBundles('marketing', '__proto__')).toThrow(
      /Do not declare "__proto__"/,
    );
  });

  it('throws when the reserved key is declared', () => {
    // Declaring it would suggest it can be registered, and registering it
    // throws — so it is refused where the mistake is cheapest to see.
    expect(() => defineAppBundles('__default__')).toThrow(/__default__/);
  });
});

describe('defineAppBundles() with no keys', () => {
  // The declaration for an app that has not built its other bundles yet: it
  // registers nothing, so it has no key to pass. The alternative — declaring
  // the default bundle under an invented name — puts a case key that can never
  // fire into the helper whose job is refusing exactly that, so the empty list
  // is accepted and '__default__' carries the app until real keys join it.
  const empty = defineAppBundles();

  const defaultRequest = {
    activeSSRApp: '__default__',
  } as unknown as FastifyRequest;

  it('exposes an empty key list', () => {
    expect([...empty.keys]).toEqual([]);
    expect(Object.isFrozen(empty.keys)).toBe(true);
  });

  it('selects the default bundle with is()', () => {
    expect(empty.is(defaultRequest, '__default__')).toBe(true);
  });

  it('does not select the default bundle for another active bundle', () => {
    const other = { activeSSRApp: 'marketing' } as unknown as FastifyRequest;

    expect(empty.is(other, '__default__')).toBe(false);
  });

  it('selects the default bundle as a case in match()', () => {
    expect(
      empty.match(defaultRequest, { ['__default__']: 'primary' }, 'fallback'),
    ).toBe('primary');
  });

  it('selects the default bundle as a case in dispatch()', () => {
    const handler = empty.dispatch(
      { ['__default__']: () => 'primary' },
      () => 'fallback',
    );

    expect(handler(defaultRequest)).toBe('primary');
  });

  it('selects the default bundle as a case in matchFn()', () => {
    const picked = empty.matchFn(
      defaultRequest,
      { ['__default__']: () => 'primary' },
      () => 'fallback',
    );

    expect(picked()).toBe('primary');
  });

  it('still refuses an undeclared key, naming the empty declaration', () => {
    // The message cannot fall back to "Declared keys: ." here, which would
    // read as a broken message rather than as the reason the key was refused.
    expect(() => empty.is(defaultRequest, 'marketing' as never)).toThrow(
      /Nothing has been declared yet/,
    );
  });

  it('refuses an undeclared case key eagerly from dispatch()', () => {
    // The one check that still happens before a request arrives. It matters
    // more now that the empty declaration is legal, since the zero-key throw
    // that used to fire at module load is gone.
    expect(() =>
      empty.dispatch({ marketing: () => 'x' } as never, () => 'fallback'),
    ).toThrow(/Nothing has been declared yet/);
  });

  it('still throws from key() on every key', () => {
    // Correct when nothing is registered: there is no key to register, so
    // there is no key this can hand back. Reaching the runtime throw needs a
    // cast here, because TKey is `never` and key() cannot be called at all —
    // see the widened case below for where this message is actually reachable.
    expect(() => (empty.key as (key: string) => string)('marketing')).toThrow(
      /Nothing has been declared yet/,
    );

    expect(() => (empty.key as (key: string) => string)('__default__')).toThrow(
      /cannot be registered/,
    );
  });
});

describe('defineAppBundles() with a runtime-empty string[]', () => {
  // The case the removed zero-key guard actually protected: a list built from
  // configuration widens TKey to `string`, so every literal type-checks and
  // the runtime checks are the only ones left. Nothing breaks silently, but
  // it now surfaces at first use rather than at module load.
  const names: string[] = [];
  const widened = defineAppBundles(...names);

  const defaultRequest = {
    activeSSRApp: '__default__',
  } as unknown as FastifyRequest;

  it('declares no keys', () => {
    expect([...widened.keys]).toEqual([]);
  });

  it('still selects the default bundle', () => {
    expect(widened.is(defaultRequest, '__default__')).toBe(true);
  });

  it('throws on a key that type-checks but was never declared', () => {
    // 'marketing' compiles here, unlike on the literal empty declaration,
    // because TKey widened to `string`. The runtime check is what is left.
    expect(() => widened.is(defaultRequest, 'marketing')).toThrow(
      /Nothing has been declared yet/,
    );
  });

  it('throws from key() without needing a cast', () => {
    expect(() => widened.key('marketing')).toThrow(
      /Nothing has been declared yet/,
    );
  });
});

describe('AppBundles.is()', () => {
  it('matches the active bundle', () => {
    expect(bundles.is(requestWithActiveBundle('marketing'), 'marketing')).toBe(
      true,
    );
  });

  it('does not match a different bundle', () => {
    expect(bundles.is(requestWithActiveBundle('marketing'), 'app-shell')).toBe(
      false,
    );
  });

  it('matches any key in an array', () => {
    expect(
      bundles.is(requestWithActiveBundle('app-shell'), [
        'marketing',
        'app-shell',
      ]),
    ).toBe(true);
  });

  it('does not match when an array contains none of them', () => {
    expect(
      bundles.is(requestWithActiveBundle('__default__'), [
        'marketing',
        'app-shell',
      ]),
    ).toBe(false);
  });

  it('does not match on an empty array', () => {
    expect(bundles.is(requestWithActiveBundle('marketing'), [])).toBe(false);
  });

  it('matches the primary app', () => {
    expect(
      bundles.is(requestWithActiveBundle('__default__'), '__default__'),
    ).toBe(true);
  });

  it('compares exactly, with no trimming or case folding', () => {
    // The server trims at registration, so a value that reaches here untrimmed
    // is a different key rather than the same one written loosely.
    expect(bundles.is(requestWithActiveBundle(' marketing'), 'marketing')).toBe(
      false,
    );
    expect(bundles.is(requestWithActiveBundle('Marketing'), 'marketing')).toBe(
      false,
    );
  });

  it('rejects a key that was never declared', () => {
    // The types stop checking once the list came from configuration, and this
    // is the method the documented gate calls. A silent false there would 404
    // every request to the route rather than gating it.
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() =>
      widened.is(requestWithActiveBundle('marketing'), 'typo-nobody-declared'),
    ).toThrow(/was passed to is\(\) but was not declared/);
    expect(() =>
      widened.is(requestWithActiveBundle('marketing'), 'typo-nobody-declared'),
    ).toThrow(/Declared keys: marketing/);
  });

  it('rejects an undeclared key inside an array', () => {
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() =>
      widened.is(requestWithActiveBundle('marketing'), [
        'marketing',
        'typo-nobody-declared',
      ]),
    ).toThrow(/was passed to is\(\) but was not declared/);
  });
  it('throws when the request has no active bundle', () => {
    // What an APIServer request looks like: no SSR decoration at all. A silent
    // false would 404 every gated route with nothing to explain it.
    const apiServerRequest = {} as FastifyRequest;

    expect(() => bundles.is(apiServerRequest, 'marketing')).toThrow(
      /only on an SSRServer/,
    );
  });

  it('still checks a key that arrives as a plain string', () => {
    // The types narrow what can be written; a key read from configuration is
    // still just a string, and the comparison has to hold for it.
    const fromConfig = 'marketing' as 'marketing' | 'app-shell';

    expect(bundles.is(requestWithActiveBundle('marketing'), fromConfig)).toBe(
      true,
    );
  });
});

describe('AppBundles.match()', () => {
  it('returns the case for the active bundle', () => {
    expect(
      bundles.match(
        requestWithActiveBundle('app-shell'),
        { marketing: 'Example Co', 'app-shell': 'Example Workspace' },
        'Example',
      ),
    ).toBe('Example Workspace');
  });

  it('returns the fallback when the active bundle is not listed', () => {
    expect(
      bundles.match(
        requestWithActiveBundle('app-shell'),
        { marketing: 'Example Co' },
        'Example',
      ),
    ).toBe('Example');
  });

  it('returns the fallback when nothing is listed', () => {
    expect(
      bundles.match(requestWithActiveBundle('marketing'), {}, 'Example'),
    ).toBe('Example');
  });

  it('matches the primary app as a case', () => {
    // The reserved key is selectable, so it has to be answerable here even
    // though it is never declared.
    expect(
      bundles.match(
        requestWithActiveBundle('__default__'),
        { ['__default__']: 'base' },
        'other',
      ),
    ).toBe('base');
  });

  it('treats a case present with an undefined value as a case', () => {
    // Presence decides, the way a switch case does. Reading the value and
    // testing it for undefined would make this one spelling silently take the
    // fallback, which is the sort of thing nobody debugs twice.
    expect(
      bundles.match(
        requestWithActiveBundle('marketing'),
        { marketing: undefined },
        'Example',
      ),
    ).toBeUndefined();
  });

  it('compares exactly, with no trimming or case folding', () => {
    // Same rule as is(): a value that reaches here untrimmed is a different
    // key rather than the same one written loosely, so it takes the fallback.
    expect(
      bundles.match(
        requestWithActiveBundle(' marketing'),
        { marketing: 'listed' },
        'fallback',
      ),
    ).toBe('fallback');
  });

  it('throws when the request has no active bundle', () => {
    // Same wiring mistake is() refuses, and refused the same way — a silent
    // fallback would make an APIServer request look like normal operation.
    const apiServerRequest = {} as FastifyRequest;

    expect(() =>
      bundles.match(apiServerRequest, { marketing: 'a' }, 'b'),
    ).toThrow(/only on an SSRServer/);
  });

  it('rejects a case naming an undeclared bundle', () => {
    // The check that still holds once the declaration came from configuration
    // and TKey widened to `string`, which stops the types checking case keys
    // at all. Without it the typo takes the fallback forever, silently.
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() =>
      widened.match(
        requestWithActiveBundle('marketing'),
        { 'typo-nobody-declared': 'a' },
        'b',
      ),
    ).toThrow(/was passed to match\(\) but was not declared/);
    expect(() =>
      widened.match(
        requestWithActiveBundle('marketing'),
        { 'typo-nobody-declared': 'a' },
        'b',
      ),
    ).toThrow(/Declared keys: marketing/);
  });

  it('rejects an undeclared case before looking anything up', () => {
    // Reported as a typo even when the active bundle would have matched a
    // different, valid case — otherwise the mistake only surfaces on whichever
    // bundle happens to hit it.
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() =>
      widened.match(
        requestWithActiveBundle('marketing'),
        { marketing: 'a', 'typo-nobody-declared': 'b' },
        'c',
      ),
    ).toThrow(/was passed to match\(\) but was not declared/);
  });
});

describe('AppBundles.matchFn()', () => {
  const marketingLoader = (id: string) => `marketing:${id}`;
  const shellLoader = (id: string) => `shell:${id}`;
  const defaultLoader = (id: string) => `default:${id}`;

  it('returns the function for the active bundle', () => {
    const load = bundles.matchFn(
      requestWithActiveBundle('app-shell'),
      { marketing: marketingLoader, 'app-shell': shellLoader },
      defaultLoader,
    );

    expect(load).toBe(shellLoader);
    expect(load('home')).toBe('shell:home');
  });

  it('returns the fallback when the active bundle is not listed', () => {
    const load = bundles.matchFn(
      requestWithActiveBundle('app-shell'),
      { marketing: marketingLoader },
      defaultLoader,
    );

    expect(load('home')).toBe('default:home');
  });

  it('returns the fallback when nothing is listed', () => {
    expect(
      bundles.matchFn(
        requestWithActiveBundle('marketing'),
        {},
        defaultLoader,
      )('home'),
    ).toBe('default:home');
  });

  it('matches the primary app as a case', () => {
    expect(
      bundles.matchFn(
        requestWithActiveBundle('__default__'),
        { ['__default__']: marketingLoader },
        defaultLoader,
      )('home'),
    ).toBe('marketing:home');
  });

  it('throws when the request has no active bundle', () => {
    // Same wiring mistake match() refuses. This is the APIServer case: that
    // server registers no app bundles, so nothing ever selected one.
    const apiServerRequest = {} as FastifyRequest;

    expect(() =>
      bundles.matchFn(
        apiServerRequest,
        { marketing: marketingLoader },
        defaultLoader,
      ),
    ).toThrow(/only on an SSRServer/);
  });

  it('rejects a case naming an undeclared bundle', () => {
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() =>
      widened.matchFn(
        requestWithActiveBundle('marketing'),
        { 'typo-nobody-declared': marketingLoader },
        defaultLoader,
      ),
    ).toThrow(/was passed to matchFn\(\) but was not declared/);
  });

  it('compares exactly, with no trimming or case folding', () => {
    // Same rule as is() and match(): a value that reaches here untrimmed is a
    // different key rather than the same one written loosely.
    expect(
      bundles.matchFn(
        requestWithActiveBundle(' marketing'),
        { marketing: marketingLoader },
        defaultLoader,
      )('home'),
    ).toBe('default:home');
  });

  it('rejects an undeclared case before looking anything up', () => {
    // Reported as a typo even when the active bundle would have matched a
    // different, valid case — otherwise the mistake only surfaces on whichever
    // bundle happens to hit it. Mirrors the match() case of the same name.
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() =>
      widened.matchFn(
        requestWithActiveBundle('marketing'),
        { marketing: marketingLoader, 'typo-nobody-declared': shellLoader },
        defaultLoader,
      ),
    ).toThrow(/was passed to matchFn\(\) but was not declared/);
  });

  it('throws when the selected case is present but not a function', () => {
    // Where matchFn() departs from match(). Presence-decides is right when the
    // cases hold data, but here the return type promises something callable, so
    // handing back `undefined` would surface as "load is not a function" at the
    // call site with nothing naming the bundle. `Partial` admits the explicit
    // `undefined` without exactOptionalPropertyTypes, so the types miss it.
    const cases = { marketing: undefined } as unknown as Partial<
      Record<'marketing', (id: string) => string>
    >;

    expect(() =>
      bundles.matchFn(
        requestWithActiveBundle('marketing'),
        cases,
        defaultLoader,
      ),
    ).toThrow(/whose value is undefined, not a function/);
  });
});

describe('AppBundles with a NotFoundRequest', () => {
  // A notFoundHandler receives NotFoundRequest, which is FastifyRequest with
  // 'params', 'routeOptions', and 'is404' removed. Nothing here reads any of
  // the three, so the stub carries only the decoration, exactly as the type now
  // says. Before the widening every one of these calls needed a cast.
  function notFoundRequest(activeSSRApp: string): NotFoundRequest {
    return { activeSSRApp } as unknown as NotFoundRequest;
  }

  it('gates with is() and picks with match()', () => {
    expect(bundles.is(notFoundRequest('app-shell'), 'app-shell')).toBe(true);
    expect(
      bundles.match(
        notFoundRequest('__default__'),
        { ['__default__']: 'unused_subdomain' },
        'not_found',
      ),
    ).toBe('unused_subdomain');
  });

  it('picks a function with matchFn()', () => {
    expect(
      bundles.matchFn(
        notFoundRequest('marketing'),
        { marketing: (id: string) => `mk:${id}` },
        (id: string) => `fb:${id}`,
      )('home'),
    ).toBe('mk:home');
  });

  it('routes a handler shaped like a real notFoundHandler', () => {
    // Same argument list a custom notFoundHandler is called with.
    const handler = bundles.dispatch(
      {
        ['__default__']: (
          _request: NotFoundRequest,
          isPageData: boolean | undefined,
        ) => `unused_subdomain:${String(isPageData)}`,
      },
      (_request: NotFoundRequest, isPageData: boolean | undefined) =>
        `not_found:${String(isPageData)}`,
    );

    expect(handler(notFoundRequest('__default__'), true)).toBe(
      'unused_subdomain:true',
    );
    expect(handler(notFoundRequest('marketing'), false)).toBe(
      'not_found:false',
    );
  });

  it('still throws on a request with no active bundle', () => {
    // The widening must not weaken the APIServer guard.
    expect(() => bundles.is({} as NotFoundRequest, 'marketing')).toThrow(
      /only on an SSRServer/,
    );
  });
});

describe('AppBundles.dispatch()', () => {
  // Shaped like a page-data handler: request first, then the arguments the
  // handler is actually called with. That shape is the whole point.
  const shellHandler = (_request: FastifyRequest, params: string) =>
    `shell:${params}`;
  const defaultHandler = (_request: FastifyRequest, params: string) =>
    `default:${params}`;

  it('routes to the case for the request it is called with', () => {
    const handler = bundles.dispatch(
      { 'app-shell': shellHandler },
      defaultHandler,
    );

    // One handler, built once, answering for both bundles.
    expect(handler(requestWithActiveBundle('app-shell'), 'home')).toBe(
      'shell:home',
    );
    expect(handler(requestWithActiveBundle('marketing'), 'home')).toBe(
      'default:home',
    );
  });

  it('forwards every argument to the selected case', () => {
    const seen: unknown[][] = [];
    const handler = bundles.dispatch(
      {
        marketing: (...args: [FastifyRequest, string, number]) => {
          seen.push(args.slice(1));
          return 'ok';
        },
      },
      (_request: FastifyRequest, _params: string, _version: number) =>
        'fallback',
    );

    expect(handler(requestWithActiveBundle('marketing'), 'home', 42)).toBe(
      'ok',
    );
    expect(seen).toEqual([['home', 42]]);
  });

  it('matches the primary app as a case', () => {
    const handler = bundles.dispatch(
      { ['__default__']: shellHandler },
      defaultHandler,
    );

    expect(handler(requestWithActiveBundle('__default__'), 'home')).toBe(
      'shell:home',
    );
  });

  it('returns the fallback when the active bundle is not listed', () => {
    const handler = bundles.dispatch(
      { marketing: shellHandler },
      defaultHandler,
    );

    expect(handler(requestWithActiveBundle('app-shell'), 'home')).toBe(
      'default:home',
    );
  });

  it('returns the fallback when nothing is listed', () => {
    const handler = bundles.dispatch({}, defaultHandler);

    expect(handler(requestWithActiveBundle('marketing'), 'home')).toBe(
      'default:home',
    );
  });

  it('compares exactly, with no trimming or case folding', () => {
    const handler = bundles.dispatch(
      { marketing: shellHandler },
      defaultHandler,
    );

    expect(handler(requestWithActiveBundle(' marketing'), 'home')).toBe(
      'default:home',
    );
  });

  it('picks per call, so one handler serves every bundle', () => {
    // Built once, asked twice. A helper that resolved at build time would
    // answer both requests with whichever bundle happened to be first.
    const handler = bundles.dispatch(
      { marketing: shellHandler },
      defaultHandler,
    );

    expect(handler(requestWithActiveBundle('marketing'), 'a')).toBe('shell:a');
    expect(handler(requestWithActiveBundle('app-shell'), 'b')).toBe(
      'default:b',
    );
    expect(handler(requestWithActiveBundle('marketing'), 'c')).toBe('shell:c');
  });

  it('throws when the selected case is present but not a function', () => {
    // Matches matchFn(): the return type promises something callable, so a
    // case present with a non-function is named here rather than surfacing as
    // "handler is not a function" from inside the server.
    const cases = { marketing: undefined } as unknown as Partial<
      Record<'marketing', (request: FastifyRequest, params: string) => string>
    >;

    const handler = bundles.dispatch(cases, defaultHandler);

    expect(() => handler(requestWithActiveBundle('marketing'), 'home')).toThrow(
      /whose value is undefined, not a function/,
    );
  });

  it('names the type when a case holds a non-function value', () => {
    // The other guard test covers `undefined`. This one reaches the typeof arm
    // of the same message, which nothing else exercises.
    const cases = { marketing: 'not a handler' } as unknown as Partial<
      Record<'marketing', (request: FastifyRequest, params: string) => string>
    >;

    const handler = bundles.dispatch(cases, defaultHandler);

    expect(() => handler(requestWithActiveBundle('marketing'), 'home')).toThrow(
      /whose value is string, not a function/,
    );
  });

  it('reports a missing request rather than failing on a property read', () => {
    // The types forbid it, but a handler reached from untyped code should say
    // what is wrong instead of "undefined is not an object".
    const handler = bundles.dispatch(
      { marketing: shellHandler },
      defaultHandler,
    );
    const untyped = handler as unknown as (...args: unknown[]) => string;

    expect(() => untyped()).toThrow(/but got undefined/);
    expect(() => untyped(null)).toThrow(/but got null/);
  });

  it('ignores a case added after the handler was built', () => {
    // The cases are snapshotted at build time. Without that, this key would
    // route requests having never passed the undeclared-key check, since that
    // check runs once and nothing re-reads the cases per request.
    const cases: Record<
      string,
      (request: FastifyRequest, params: string) => string
    > = { marketing: shellHandler };

    const handler = bundles.dispatch(cases, defaultHandler);

    cases['typo-nobody-declared'] = shellHandler;
    cases['app-shell'] = shellHandler;

    // The late 'app-shell' case is not used, and the undeclared key cannot
    // route anything either.
    expect(handler(requestWithActiveBundle('app-shell'), 'home')).toBe(
      'default:home',
    );
    expect(handler(requestWithActiveBundle('marketing'), 'home')).toBe(
      'shell:home',
    );
  });

  it('rejects an undeclared case even when a valid case would have matched', () => {
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() =>
      widened.dispatch(
        { marketing: shellHandler, 'typo-nobody-declared': shellHandler },
        defaultHandler,
      ),
    ).toThrow(/was passed to dispatch\(\) but was not declared/);
  });

  it('rejects an undeclared case when the handler is built', () => {
    // Eagerly, unlike matchFn() — the cases are known a phase before any
    // request, so a typo should not wait for traffic to surface.
    const widened = defineAppBundles(...(['marketing'] as string[]));

    expect(() =>
      widened.dispatch(
        { 'typo-nobody-declared': shellHandler },
        defaultHandler,
      ),
    ).toThrow(/was passed to dispatch\(\) but was not declared/);
  });

  it('throws when the handler is called without an active bundle', () => {
    // Building it is fine — there is no request yet to be wrong about.
    const handler = bundles.dispatch(
      { marketing: shellHandler },
      defaultHandler,
    );

    expect(() => handler({} as FastifyRequest, 'home')).toThrow(
      /only on an SSRServer/,
    );
  });
});
