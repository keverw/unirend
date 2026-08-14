import { describe, it, expect } from 'bun:test';
import type { FastifyRequest } from 'fastify';
import { serveSSRBuilt } from '../ssr';
import { defineAppBundles } from './app-bundles';

const FAKE_BUILD_DIR = '/fake/build';

/**
 * Coverage for `defineAppBundles()`.
 *
 * Two halves. The compile-time block asserts what the helper exists for: a key
 * that was never declared does not type-check, which is what turns a silently
 * fail-open gate into a build error. The runtime blocks cover the checks the
 * types cannot make — keys arriving from configuration, and a request that has
 * no active bundle at all.
 */

/** A request stub carrying just the field the helper reads. */
function requestWithActiveBundle(activeSSRApp: string): FastifyRequest {
  return { activeSSRApp } as unknown as FastifyRequest;
}

const bundles = defineAppBundles('marketing', 'app-shell');
const otherAppBundles = defineAppBundles('admin', 'docs');

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
}

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

  it('throws when no keys are given', () => {
    expect(() => defineAppBundles()).toThrow(/at least one app bundle key/);
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

  it('throws when the reserved key is declared', () => {
    // Declaring it would suggest it can be registered, and registering it
    // throws — so it is refused where the mistake is cheapest to see.
    expect(() => defineAppBundles('__default__')).toThrow(/__default__/);
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
    ).toThrow(/was used as a case in match\(\)/);
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
    ).toThrow(/was used as a case in match\(\)/);
  });
});
