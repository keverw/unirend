import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import semver from 'semver';
import {
  parseBunLockfile,
  parseBunLockfileWorkspaces,
} from '../internal/bun-lockfile';
import type { BunLockWorkspace } from '../internal/bun-lockfile';

/**
 * Dependency-override check for scaffolded repos, exported via
 * `unirend/repo-tools`. It catches six ways an `overrides`/`resolutions`
 * entry can look right under bun while being wrong, all of them offline. It
 * also rejects malformed declarations. Bun fails the install for none of
 * these findings: it warns for the nested form and a malformed value, says
 * nothing at all for the rest, and exits 0 either way (all verified against
 * bun 1.3.14).
 *
 * The premise behind the first four: an override is meant to be TEMPORARY. It
 * routes around a specific upstream bug or advisory until the fix arrives
 * through normal resolution. Nothing expires it though, and `package.json` is
 * JSON so it cannot even carry a comment saying why the pin is there, which is
 * how pins outlive their reason by years. These checks are the expiry
 * mechanism the format doesn't give you.
 *
 * 1. STALE: the override names a package that is no longer anywhere in the
 *    dependency tree, so once its target drops out the pin silently does
 *    nothing while still constraining anything that comes back. Bun is silent
 *    here (verified: a flat override naming an uninstalled package produces no
 *    warning at all), so this check is the only guard.
 *
 * 2. INERT: the override uses npm's nested form. Bun does not support nested
 *    overrides — it does NOT scope them like npm and does NOT flatten them, it
 *    ignores the entry outright, so the pin does not exist. Verified against
 *    bun 1.3.14 and stated in bun's docs ("Bun only supports top-level
 *    `overrides`, not nested overrides", same for `resolutions`); support is
 *    still open upstream as oven-sh/bun#6608. A repo that pinned a CVE through
 *    a nested override believes it is patched and has no pin at all. Bun does
 *    print a
 *    `warn: Bun currently does not support nested "overrides"` line during
 *    install, but that scrolls past in install output and fails nothing, which
 *    is why this check turns it into a build failure.
 *
 *    The one exception is npm's `"."` key, which means "the parent package
 *    itself". Bun honors `{ "pkg": { ".": "1.2.3" } }` (verified: it pins pkg
 *    exactly like the flat form, and warns for a non-"." sibling in the same
 *    block), so it is treated as a real, working target.
 *
 * 3. SELECTOR: the key carries npm's version selector (`"pkg@^2": "1.1.16"`),
 *    which bun does not implement — see {@link hasVersionSelector}. It reads
 *    the whole key as a package name, which matches nothing, so the override
 *    applies to nothing and it says so nowhere. Same silence and same danger as
 *    STALE, and the form is easy to reach for because npm does support it.
 *
 * 4. INCOMPATIBLE: the override forces a package below what its dependents
 *    declare they need, or into an unsupported gap in a disjoint range — see
 *    {@link analyzePins}. Bun applies these silently too. A forward override
 *    above the whole range remains allowed, since that is often the pin's job.
 *
 * 5. UNAPPLIED: the lockfile does not hold the version the override asks for,
 *    so the pin is declared but not in effect — see {@link analyzePins}. The
 *    others reason about the DECLARATION and each encodes a belief about
 *    what bun does with it. This one reasons about the RESULT, comparing the
 *    declared spec against what `bun.lock` actually resolved, so it still
 *    holds if one of those beliefs is wrong or bun's behavior changes. In
 *    practice it means `package.json` was edited without installing since,
 *    since bun does apply an added or changed override on a plain install
 *    (verified against bun 1.3.14: adding, changing, and removing an override
 *    each re-resolved the package on a plain `bun install`). A pin that
 *    survives an install cannot be satisfied as written.
 *
 * 6. CONFLICT: the same package is declared in both `overrides` and
 *    `resolutions` with different versions — see {@link addTarget}. That is
 *    the only way to declare one twice, since each field is a single JSON
 *    object. Bun applies the `overrides` entry and ignores the other in
 *    silence, so the losing declaration reads as a pin that is not in effect.
 *
 * A malformed declaration (a non-string or blank value, or `"."` at the top
 * level where there is no parent package) is rejected too, but is not counted
 * among the six: those are syntax errors that read as broken on inspection
 * rather than pins that read as working. Bun warns for these invalid values
 * and ignores them.
 *
 * Presence is probed with `bun why <name>`, which exits non-zero with "No
 * packages matching ..." when the package is absent from the lockfile.
 * `bun.lock` is JSONC (trailing commas), so it cannot be `JSON.parse`d, and
 * `bun why` is the supported way to ask this question. The backward check
 * reads the same lockfile through the shared `bun-lockfile` reader, so the
 * whole check stays offline and belongs in the `check` chain. The resolved
 * `packages` block supplies transitive ranges, while current package.json files
 * supply the repo's own declarations. Child workspace paths come from the
 * lockfile's `workspaces` block. Without the manifests, an override undercutting
 * one of your own direct dependencies could read as fine, especially when the
 * copied lockfile range is stale after a package.json edit.
 *
 * Known limitation: a pin that still satisfies every range declared on it is
 * accepted, even when a newer version exists that would satisfy them too. If
 * every dependent asks for `^2.0.0` and the override pins `2.0.1`, nothing on
 * disk knows whether `2.1.2` was published, so the pin can sit there long
 * after the advisory it was added for is fixed. Every other offline signal
 * agrees it is fine: `bun audit` is quiet because the advisory is resolved,
 * and `bun outdated` lists only direct dependencies so a pinned transitive
 * never appears at all (verified for both).
 *
 * Answering "could this pin go" requires actually resolving without it, which
 * is deliberately not done here: it would mean a network resolve per override
 * on every CI run, and the result is a judgment call rather than a pass/fail,
 * since some pins exist to hold a version steady on purpose. Do it on demand
 * instead — delete the suspect override and run `refreshLockfile()` (`bun run
 * install:fresh`). Its change report names the version the package moves to,
 * which is the answer. Put the override back if the result is worse.
 *
 * The function acts as a main: it prints its own report through the injectable
 * loggers and returns a result instead of exiting, so the scaffolded
 * `scripts/check-overrides.ts` stays a thin wrapper that sets the exit code
 * (and is the place to customize). Keeping the logic here means repos pick up
 * fixes by upgrading unirend instead of re-scaffolding a frozen script.
 */

/** Options for {@link checkOverrides}. */
export interface CheckOverridesOptions {
  /** Repo root containing package.json and bun.lock. Defaults to process.cwd(). */
  rootDir?: string;
  /** Sink for progress notices and warnings. Defaults to console.log. */
  log?: (message: string) => void;
  /** Sink for the aggregated problem report. Defaults to console.error. */
  logError?: (message: string) => void;
  /**
   * Override the presence probe. Receives a package name and resolves true
   * when that package is in the dependency tree. Defaults to `bun why <name>`
   * run in `rootDir`. Exists mainly so tests (and repos on another package
   * manager) can supply their own probe.
   */
  isPackageInstalled?: (name: string) => boolean | Promise<boolean>;
  /**
   * Print what each surviving override is actually doing to the resolved tree
   * (which dependents it forces past, or that it forces nothing right now).
   * Off by default so the every-CI-run output stays a single line. Reads the
   * same lockfile data the check already loads, so it costs no extra work.
   */
  verbose?: boolean;
}

/** One override declaration that names a package. */
export interface OverrideTarget {
  /** The package the override applies to. */
  name: string;
  /** Full declaration path in package.json, e.g. `overrides.minimatch.left-pad`. */
  declaredAt: string;
  /**
   * The version or range the declaration asks for, exactly as written. Carried
   * through so the check can compare it against what the lockfile actually
   * resolved to, rather than only asking whether the package is present.
   */
  spec: string;
}

/** One override whose declared version is not what the lockfile resolved. */
export interface UnappliedPin {
  /** The overridden package. */
  name: string;
  /** Where the override is declared in package.json. */
  declaredAt: string;
  /** The version or range the override asks for. */
  spec: string;
  /** Every version the package actually resolved to in `bun.lock`. */
  resolved: string[];
}

/** Result of {@link checkOverrides}. */
export interface CheckOverridesResult {
  /** True when no problems were found (including the nothing-declared case). */
  success: boolean;
  /** Human-readable problems, one per finding. Empty on success. */
  problems: string[];
  /**
   * Declarations bun ignores outright because they use the nested form, in
   * declaration order. These are also counted in {@link problems}.
   */
  inert: OverrideTarget[];
  /**
   * Every declaration bun actually applies, in declaration order. These are
   * the ones probed against the dependency tree.
   */
  targets: OverrideTarget[];
  /**
   * Overrides forcing a package below what its dependents need or into an
   * unsupported gap, with the ranges they violate. Also counted in
   * {@link problems}.
   * Empty when there is no lockfile to check against.
   */
  backwardPins: BackwardPin[];
  /**
   * Overrides whose declared version is not what the lockfile actually
   * resolved, meaning the pin is not in effect. Also counted in
   * {@link problems}. Empty when there is no lockfile to check against.
   */
  unappliedPins: UnappliedPin[];
}

/** One override forcing a package into an unsupported version. */
export interface BackwardPin {
  /** The overridden package. */
  name: string;
  /** The version the override forced it to. */
  version: string;
  /** Where the override is declared in package.json. */
  declaredAt: string;
  /** Dependents whose declared range the forced version incompatibly violates. */
  violations: Array<{
    /** The dependent, as "name@version". */
    dependent: string;
    /** The range it declares for {@link BackwardPin.name}. */
    range: string;
  }>;
}

interface PackageJSON {
  name?: unknown;
  overrides?: unknown;
  resolutions?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  peerDependenciesMeta?: unknown;
}

/**
 * Find peers that are optional and have no installed declaration on the same
 * package. A dependency/devDependency/optionalDependency wins over optional
 * peer metadata, matching the lockfile parser's treatment of duplicate names.
 */
function optionalOnlyPeers(pkg: PackageJSON): Set<string> {
  const metadata = pkg.peerDependenciesMeta;

  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return new Set();
  }

  const installedNames = new Set<string>();

  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ] as const) {
    const block = pkg[field];

    if (block !== null && typeof block === 'object' && !Array.isArray(block)) {
      for (const name of Object.keys(block)) {
        installedNames.add(name);
      }
    }
  }

  return new Set(
    Object.entries(metadata as Record<string, unknown>)
      .filter(([name, value]) => {
        if (
          installedNames.has(name) ||
          value === null ||
          typeof value !== 'object' ||
          Array.isArray(value)
        ) {
          return false;
        }

        return (value as { optional?: unknown }).optional === true;
      })
      .map(([name]) => name),
  );
}

/** Read the dependency ranges currently declared by one package.json. */
function packageDependencies(pkg: PackageJSON): Record<string, string> {
  const dependencies: Record<string, string> = {};
  const optionalPeers = optionalOnlyPeers(pkg);

  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ] as const) {
    const block = pkg[field];

    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
      continue;
    }

    for (const [name, range] of Object.entries(
      block as Record<string, unknown>,
    )) {
      if (
        typeof range !== 'string' ||
        (field === 'peerDependencies' &&
          (optionalPeers.has(name) || name in dependencies))
      ) {
        continue;
      }

      dependencies[name] = range;
    }
  }

  return dependencies;
}

/**
 * Read the repo's current dependency declarations from its package.json files.
 *
 * The lockfile identifies child workspace paths, but its copied ranges can be
 * stale whenever a manifest was edited without running `bun install`. Using
 * those copies would let an old override pass against an old range even though
 * it undercuts what the current manifest asks for. A missing child manifest
 * falls back to the lockfile entry so a stale workspace does not erase useful
 * advisory data.
 */
async function readWorkspaceDeclarations(
  rootDir: string,
  lockText: string,
  rootPackage: PackageJSON,
): Promise<BunLockWorkspace[]> {
  const declarations: BunLockWorkspace[] = [
    {
      key: '',
      name: typeof rootPackage.name === 'string' ? rootPackage.name : '',
      dependencies: packageDependencies(rootPackage),
    },
  ];
  const resolvedRoot = path.resolve(rootDir);

  for (const workspace of parseBunLockfileWorkspaces(lockText)) {
    if (workspace.key === '') {
      continue;
    }

    const packagePath = path.resolve(rootDir, workspace.key, 'package.json');
    const relativePath = path.relative(resolvedRoot, packagePath);

    // A lockfile is repository input, but do not let a malformed workspace key
    // make this advisory check read outside the repository it was given.
    if (
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      declarations.push(workspace);
      continue;
    }

    let workspaceRaw: string;

    try {
      workspaceRaw = await fs.readFile(packagePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        declarations.push(workspace);
        continue;
      }

      throw new Error(
        `Failed to read workspace manifest ${packagePath}: ${String(error)}`,
      );
    }

    let workspacePackage: PackageJSON;

    try {
      workspacePackage = JSON.parse(workspaceRaw) as PackageJSON;
    } catch (error) {
      throw new Error(
        `Failed to parse workspace manifest ${packagePath}: ${String(error)}`,
      );
    }

    declarations.push({
      key: workspace.key,
      name:
        typeof workspacePackage.name === 'string' ? workspacePackage.name : '',
      dependencies: packageDependencies(workspacePackage),
    });
  }

  return declarations;
}

/**
 * True when an override key carries npm's version selector, as in
 * "brace-expansion@^2" or "@scope/pkg@1.2.3" (meaning "only override this
 * package where the requested range is that one"). A leading "@" is the scope
 * marker, never a selector, so only an "@" past position 0 counts.
 *
 * This is never normalized away by stripping the selector. Bun does not
 * implement the selector: it takes the whole key literally as a package name,
 * which then matches nothing in the tree, so the override applies to nothing
 * (verified against bun 1.3.14 — `{ "brace-expansion@^2": "1.1.16" }` under a
 * minimatch declaring `^5.0.5` left brace-expansion at 5.0.7, byte-identical to
 * declaring no override at all, while the flat key pinned it to 1.1.16).
 *
 * Stripping it would be actively harmful here: it would resolve the key to a
 * package that IS installed and report a dead override as working, which is the
 * exact false negative this check exists to prevent. Bun prints no warning for
 * this form (unlike the nested one), so, as with a stale pin, nothing else in
 * the toolchain reports it.
 */
function hasVersionSelector(key: string): boolean {
  return key.lastIndexOf('@') > 0;
}

interface CollectContext {
  targets: OverrideTarget[];
  /** Nested declarations bun ignores outright. */
  inert: OverrideTarget[];
  /**
   * First declaration seen per package name, so duplicates probe once and a
   * later declaration can be compared against it for a conflicting spec.
   */
  seen: Map<string, { declaredAt: string; spec: string }>;
  problems: string[];
}

/**
 * Sort a declaration block into the entries bun applies and the entries it
 * ignores.
 *
 * A top-level leaf (whose value is a version string) is the only form bun
 * fully supports, and it applies globally across the tree.
 *
 * A nested block (`{ minimatch: { "brace-expansion": "1.1.16" } }`) is npm's
 * scoped form. Bun neither scopes it like npm nor flattens it — it ignores the
 * inner entry entirely, so nothing is pinned (verified against bun 1.3.14,
 * which also prints `warn: Bun currently does not support nested "overrides"`
 * during install). Those entries are collected as `inert` rather than probed:
 * asking whether their target is installed is the wrong question, since the
 * override does not apply either way.
 *
 * The exception is npm's "." key, meaning "the parent package itself", which
 * bun does honor exactly like the equivalent flat entry (verified: it pins the
 * parent, and warns only about a non-"." sibling in the same block). So it is
 * a real target, resolved to the parent's name.
 */
function collectTargets(
  block: unknown,
  field: string,
  context: CollectContext,
  parentName?: string,
): void {
  if (block === undefined || block === null) {
    return;
  }

  if (typeof block !== 'object' || Array.isArray(block)) {
    context.problems.push(
      `  - ${field} must be a JSON object mapping package names to version strings.`,
    );

    return;
  }

  const isNested = parentName !== undefined;

  for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
    const declaredAt = `${field}.${key}`;

    // Checked before anything else, and for every declaration shape, because a
    // key bun reads as a package name that cannot exist is dead no matter what
    // it points at. Rejecting it here also means no name reaching the probe or
    // the range checks below ever carries a selector.
    if (key !== '.' && hasVersionSelector(key)) {
      context.problems.push(
        `  - ${declaredAt} carries a version selector, which bun does not implement. It reads the whole key as a package name, so this override silently applies to nothing. Drop the selector: "${key.slice(0, key.lastIndexOf('@'))}": "<version>".`,
      );

      continue;
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // A block nested inside a block is doubly unsupported. Report it at its
      // own path and stop descending, so one mistake produces one finding
      // rather than one per leaf buried under it.
      if (isNested) {
        // A block, not a version string, so there is no spec to record.
        context.inert.push({ name: key, declaredAt, spec: '' });
        continue;
      }

      // "." names the parent package, so it can't also introduce one.
      if (key === '.') {
        context.problems.push(
          `  - ${declaredAt} uses the "." key at the top level, where there is no parent package for it to refer to.`,
        );

        continue;
      }

      collectTargets(value, declaredAt, context, key);

      continue;
    }

    if (typeof value !== 'string') {
      context.problems.push(
        `  - ${declaredAt} must be a version string or a nested object, got ${
          value === null ? 'null' : typeof value
        }.`,
      );

      continue;
    }

    // semver treats an empty or whitespace-only string as the unconstrained
    // range "*", but bun does not. It warns `Missing override value`, ignores
    // the declaration, and exits successfully. Reject it before the outcome
    // check can mistake every installed version for a match.
    if (value.trim() === '') {
      context.problems.push(
        `  - ${declaredAt} must be a non-empty version string. Bun ignores a blank override value, so this declaration applies to nothing.`,
      );

      continue;
    }

    if (isNested) {
      // Inside a nested block only "." survives, and it targets the parent.
      if (key === '.') {
        addTarget(context, parentName, declaredAt, value);
      } else {
        context.inert.push({ name: key, declaredAt, spec: value });
      }

      continue;
    }

    // A top-level "." has no parent package to refer to, so it names nothing.
    if (key === '.') {
      context.problems.push(
        `  - ${declaredAt} uses the "." key at the top level, where there is no parent package for it to refer to.`,
      );

      continue;
    }

    addTarget(context, key, declaredAt, value);
  }
}

/** How many violating dependents to list per override before summarizing. */
const MAX_LISTED_DEPENDENTS = 5;

/**
 * What one live override is actually doing to the resolved tree, derived from
 * the lockfile alone. Backs both the backward-pin failure and the `verbose`
 * breakdown, so the lockfile is parsed and analyzed once either way.
 */
interface PinStatus {
  name: string;
  declaredAt: string;
  /**
   * The single version the package resolved to, or null when it isn't in the
   * tree or resolved to several versions (both of which make the range
   * comparisons below unanswerable).
   */
  version: string | null;
  /** Ranges the resolved version violates without being a forward override. */
  below: Array<{ dependent: string; range: string }>;
  /**
   * Ranges the resolved version sits ABOVE, meaning the override is actively
   * forcing that dependent past what it asked for. This is the normal reason
   * an override exists, so it is shown, never failed on.
   */
  forcingPast: Array<{ dependent: string; range: string }>;
  /** How many dependents declare a semver-comparable range on this package. */
  declaredRangeCount: number;
}

/**
 * Find overrides that force a package outside a dependent's declared range
 * without being an intentional forward override, reading only local files.
 *
 * Bun applies such an override in complete silence — verified by forcing
 * `brace-expansion` to 1.1.11 under a `minimatch` that declares `^2.0.2`,
 * which installed without a single warning — so nothing else reports it.
 *
 * Forcing a package FORWARD past a declared range is usually the entire point
 * of an override (the advisory fix landed in a major the parent hasn't adopted
 * yet), so that stays allowed. Versions below a range and versions sitting in
 * an unsupported gap between its disjoint branches are both incompatible.
 */
function analyzePins(
  lockText: string,
  targets: OverrideTarget[],
  workspaceDeclarations: BunLockWorkspace[],
): { statuses: PinStatus[]; unapplied: UnappliedPin[] } {
  const entries = parseBunLockfile(lockText);

  // The repo's own current declarations, read from its package.json files.
  // Without them an override that forces a DIRECT dependency below the range
  // in your own package.json reads as fine, since nothing in `packages`
  // records that range. Reading the manifests rather than the lockfile's copies
  // also keeps this check correct before `bun install` refreshes those copies.
  //
  // Shaped like package entries so the comparison loop below treats both the
  // same way. The label says where the range came from, because "this is your
  // own package.json" is a different (and more actionable) message than some
  // transitive dependency wanting a newer version.
  const declaringSources = [
    ...entries.map((entry) => ({
      label: entry.spec,
      dependencies: entry.dependencies,
    })),
    ...workspaceDeclarations.map((workspace) => ({
      label: workspaceLabel(workspace),
      dependencies: workspace.dependencies,
    })),
  ];

  // Every version each package resolved to. An override normally collapses
  // this to one, and anything else means the pin didn't apply uniformly.
  const versionsByName = new Map<string, Set<string>>();

  for (const entry of entries) {
    const versions = versionsByName.get(entry.name) ?? new Set<string>();
    versions.add(entry.version);
    versionsByName.set(entry.name, versions);
  }

  const statuses: PinStatus[] = [];
  const unapplied: UnappliedPin[] = [];

  for (const { name, declaredAt, spec } of targets) {
    const versions = versionsByName.get(name);

    // The outcome check: does what the lockfile resolved actually match what
    // the override asked for? Every other case here reasons about the
    // declaration; this one reasons about the result, so it stays true even
    // where a belief about bun's behavior turns out to be wrong.
    //
    // Skipped when the spec is not a semver range, which covers the forms an
    // override may legitimately use that have no version to compare (`npm:`
    // aliases, `workspace:`, `catalog:`, git URLs, a file path).
    if (versions !== undefined && semver.validRange(spec) !== null) {
      const resolved = [...versions].sort();
      const missed = resolved.filter(
        (version) =>
          semver.valid(version) === null || !semver.satisfies(version, spec),
      );

      // Reported only when a resolved version falls OUTSIDE the declared
      // range, never merely because the package resolved to several versions.
      // A range override (`"^2.0.0"`) legitimately permits more than one, and
      // an exact pin that did not collapse them is already caught here, since
      // any version other than the pinned one fails to satisfy it.
      if (missed.length > 0) {
        unapplied.push({ name, declaredAt, spec, resolved });
      }
    }

    // Not in the tree at all is the stale-override finding, reported
    // separately. More than one resolved version means attributing which
    // dependent got which copy needs a graph walk this check deliberately
    // doesn't do, so stay quiet rather than guess.
    if (!versions || versions.size !== 1) {
      statuses.push({
        name,
        declaredAt,
        version: null,
        below: [],
        forcingPast: [],
        declaredRangeCount: 0,
      });

      continue;
    }

    const [version] = [...versions];

    if (semver.valid(version) === null) {
      statuses.push({
        name,
        declaredAt,
        version: null,
        below: [],
        forcingPast: [],
        declaredRangeCount: 0,
      });

      continue;
    }

    const violations: Array<{ dependent: string; range: string }> = [];
    const forcingPast: Array<{ dependent: string; range: string }> = [];
    let declaredRangeCount = 0;

    for (const source of declaringSources) {
      const range = source.dependencies[name];

      // Skip ranges semver can't reason about (workspace:, npm: aliases, git
      // URLs). They're legitimate and simply outside what this check answers.
      if (range === undefined || semver.validRange(range) === null) {
        continue;
      }

      declaredRangeCount++;

      // gtr = "above every version the range allows". This is the override
      // actively doing work: forcing a dependent past what it asked for, which
      // is the normal reason an override exists. Recorded for the verbose
      // view, never reported as a problem.
      if (semver.gtr(version, range)) {
        forcingPast.push({ dependent: source.label, range });
      }

      // A non-satisfying version is allowed only when it sits above every
      // version in the range, which is an intentional forward override. `ltr`
      // alone is insufficient here: a version can sit in the unsupported gap
      // of a disjoint range, where satisfies/ltr/gtr are all false.
      if (!semver.satisfies(version, range) && !semver.gtr(version, range)) {
        violations.push({ dependent: source.label, range });
      }
    }

    statuses.push({
      name,
      declaredAt,
      version,
      below: distinctDependents(violations),
      forcingPast: distinctDependents(forcingPast),
      declaredRangeCount,
    });
  }

  return { statuses, unapplied };
}

/**
 * Name a workspace for the report. The root reads as "this package.json"
 * because a pin undercutting your own declaration is a different and more
 * actionable finding than one undercutting a package deep in the tree.
 *
 * The name is the package's current `name` field, so it is dropped from the
 * label when package.json has none rather than rendered as a stray leading
 * space.
 */
function workspaceLabel(workspace: BunLockWorkspace): string {
  const place =
    workspace.key === '' ? 'this package.json' : `workspace ${workspace.key}`;

  return workspace.name === '' ? place : `${workspace.name} (${place})`;
}

/**
 * Collapse repeated dependent+range pairs and sort them, so a package reached
 * through several paths contributes one line rather than one per path.
 */
function distinctDependents(
  found: Array<{ dependent: string; range: string }>,
): Array<{ dependent: string; range: string }> {
  const seen = new Set<string>();

  return found
    .filter((entry) => {
      const id = `${entry.dependent} ${entry.range}`;

      if (seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    })
    .sort((a, b) => a.dependent.localeCompare(b.dependent));
}

/**
 * Record a package bun actually overrides. The same package can be named by
 * more than one declaration (e.g. once in `overrides` and once in
 * `resolutions`), so probe it once and report it at the first path, keeping
 * the output to one line per package.
 */
function addTarget(
  context: CollectContext,
  name: string,
  declaredAt: string,
  spec: string,
): void {
  const first = context.seen.get(name);

  if (first !== undefined) {
    // Same package, same version, written twice: harmless duplication, and
    // deduping it silently keeps the report to one line per package.
    if (first.spec === spec) {
      return;
    }

    // Reaching here means one entry sits in `overrides` and the other in
    // `resolutions`, which is the only way to declare the same package twice:
    // each field is a single JSON object, so it cannot hold the same key
    // twice, and a literally repeated key is collapsed by JSON.parse (last one
    // wins) before this ever runs. Usually a yarn-era `resolutions` block left
    // behind after a move to bun.
    //
    // Both read as authoritative, but bun applies the `overrides` entry and
    // ignores the `resolutions` one without a word (verified against bun
    // 1.3.14: with overrides at 5.0.6 and resolutions at 5.0.7 the tree
    // resolved to 5.0.6, unchanged when the two fields were swapped in the
    // file, so it is precedence rather than document order, and the install
    // printed nothing and exited 0). So the losing entry reads as a pin that
    // is not in effect, which is the whole class of problem this check exists
    // for.
    //
    // Collection order matches that precedence — `overrides` is walked before
    // `resolutions` — so the retained target is the one bun actually applies
    // and the outcome check below still compares against the right spec.
    context.problems.push(
      `  - ${first.declaredAt} asks for "${first.spec}" but ${declaredAt} asks for "${spec}" for the same package. Bun applies the overrides entry and silently ignores the other, so remove whichever one is wrong.`,
    );

    return;
  }

  context.seen.set(name, { declaredAt, spec });
  context.targets.push({ name, declaredAt, spec });
}

/**
 * The one non-zero `bun why` result that answers "no" rather than "I could not
 * tell you". Bun prints it to stdout as:
 *
 *     error: No packages matching '<name>' found in lockfile
 *
 * Matched loosely (no name interpolation) so a future change to how the name is
 * quoted does not turn a working "no" into a hard failure.
 */
const NO_MATCH = /No packages matching .* found in lockfile/;

/**
 * True when `bun why <name>` finds the package in the lockfile.
 *
 * Exit status alone cannot answer this. Verified against bun 1.3.14, THREE
 * distinct states all exit 1, and only the first means the package is absent:
 *
 *     absent           stdout: error: No packages matching 'x' found in lockfile
 *     corrupt bun.lock stderr: error: Error loading lockfile: ParserError
 *     no bun.lock      stderr: error: Lockfile not found
 *
 * Treating all three as "not installed" would tell you to delete perfectly
 * valid overrides because the lockfile was unreadable, which is the opposite of
 * this tool's job. So a "no" is only returned for bun's explicit no-match
 * output, and every other failure is rethrown with what bun actually said.
 *
 * The absent case is distinguishable by stream alone (it is the only one on
 * stdout), but the message is matched rather than the stream, since which
 * stream an error lands on is the more incidental of the two.
 *
 * A missing `bun` binary is called out separately because it is the one failure
 * with an obvious fix worth naming.
 */
function bunWhy(name: string, rootDir: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(
      'bun',
      ['why', name],
      { cwd: rootDir, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(true);

          return;
        }

        const code = (error as Error & { code?: string | number }).code;

        if (code === 'ENOENT') {
          reject(
            new Error(
              'Could not run "bun why": the bun binary was not found. The overrides check requires Bun.',
            ),
          );

          return;
        }

        if (NO_MATCH.test(stdout)) {
          resolve(false);

          return;
        }

        const said = [stderr, stdout]
          .map((stream) => stream.trim())
          .filter((stream) => stream !== '')
          .join('\n');

        reject(
          new Error(
            `Could not determine whether "${name}" is installed: \`bun why ${name}\` failed` +
              (said === '' ? '.' : ` with:\n${said}`),
          ),
        );
      },
    );
  });
}

/**
 * Check every `overrides`/`resolutions` declaration in the repo's package.json
 * against the installed dependency tree. Prints its report through the
 * injected loggers and returns the outcome instead of exiting — the caller
 * decides the exit code.
 *
 * @throws If package.json cannot be read or parsed, or if the default probe
 * cannot answer whether a package is installed (bun missing, or `bun why`
 * failing for any reason other than the package genuinely being absent).
 */
export async function checkOverrides(
  options?: CheckOverridesOptions,
): Promise<CheckOverridesResult> {
  const rootDir = options?.rootDir ?? process.cwd();
  // eslint-disable-next-line no-console
  const log = options?.log ?? console.log;
  // eslint-disable-next-line no-console
  const logError = options?.logError ?? console.error;
  const isPackageInstalled =
    options?.isPackageInstalled ?? ((name: string) => bunWhy(name, rootDir));

  const pkgPath = path.join(rootDir, 'package.json');
  let pkgRaw: string;

  try {
    pkgRaw = await fs.readFile(pkgPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${pkgPath}: ${String(error)}`);
  }

  let pkg: PackageJSON;

  try {
    pkg = JSON.parse(pkgRaw) as PackageJSON;
  } catch (error) {
    throw new Error(`Failed to parse ${pkgPath}: ${String(error)}`);
  }

  const context: CollectContext = {
    targets: [],
    inert: [],
    seen: new Map(),
    problems: [],
  };

  collectTargets(pkg.overrides, 'overrides', context);
  collectTargets(pkg.resolutions, 'resolutions', context);

  const { targets, inert } = context;

  if (
    targets.length === 0 &&
    inert.length === 0 &&
    context.problems.length === 0
  ) {
    log('overrides check passed (none declared).');
    return {
      success: true,
      problems: [],
      inert,
      targets,
      backwardPins: [],
      unappliedPins: [],
    };
  }

  // Malformed blocks, overrides bun ignores, and overrides whose target left
  // the tree read very differently and have different fixes, so each gets its
  // own section in the report even though all three fail the check.
  const invalid = context.problems;
  const unused: string[] = [];
  let backward: BackwardPin[] = [];
  let unappliedPins: UnappliedPin[] = [];
  let statuses: PinStatus[] = [];

  if (targets.length > 0) {
    let lockText: string | null = null;

    try {
      lockText = await fs.readFile(path.join(rootDir, 'bun.lock'), 'utf8');
    } catch {
      // Absent lockfile handled below; unreadable for any other reason just
      // means the range check is skipped, which is advisory anyway.
    }

    // Without a lockfile every probe fails, which would report every override
    // as dead. Say what actually went wrong instead. Only the default probe
    // depends on the lockfile — an injected one may not.
    const isDefaultProbe = options?.isPackageInstalled === undefined;

    if (isDefaultProbe && lockText === null) {
      logError(
        'overrides check failed:\n\n' +
          '  - No bun.lock found, so there is no dependency tree to check the ' +
          'declared overrides against. Run `bun install` first.\n',
      );

      return {
        success: false,
        problems: [
          'No bun.lock found — run `bun install` before checking overrides.',
        ],
        inert,
        targets,
        backwardPins: [],
        unappliedPins: [],
      };
    }

    for (const { name, declaredAt } of targets) {
      if (!(await isPackageInstalled(name))) {
        unused.push(
          `  - ${declaredAt} → "${name}" is not in the dependency tree`,
        );
      }
    }

    if (lockText !== null) {
      const workspaceDeclarations = await readWorkspaceDeclarations(
        rootDir,
        lockText,
        pkg,
      );
      const analysis = analyzePins(lockText, targets, workspaceDeclarations);
      statuses = analysis.statuses;
      unappliedPins = analysis.unapplied;
      backward = statuses
        .filter((status) => status.below.length > 0)
        .map(({ name, version, declaredAt, below }) => ({
          name,
          // Guarded by below.length: a status with violations always resolved
          // to exactly one comparable version.
          version: version ?? '',
          declaredAt,
          violations: below,
        }));
    }
  }

  // Nested entries are reported whether or not their target is installed —
  // bun ignores them either way, so "is it in the tree" is the wrong question.
  const ignored = inert.map(
    ({ name, declaredAt }) =>
      `  - ${declaredAt} → "${name}" is not pinned at all`,
  );

  // Each backward pin lists the dependents it undercuts, capped so one widely
  // depended-on package can't bury the rest of the report.
  const undercut = backward.map(({ name, version, declaredAt, violations }) => {
    const shown = violations
      .slice(0, MAX_LISTED_DEPENDENTS)
      .map(({ dependent, range }) => `      ${dependent} declares "${range}"`);

    const hidden = violations.length - shown.length;

    if (hidden > 0) {
      shown.push(`      ...and ${hidden} more`);
    }

    return `  - ${declaredAt} pins "${name}" to ${version}\n${shown.join('\n')}`;
  });

  // Each unapplied pin names what it asked for against what the lockfile
  // actually holds, since that gap is the whole finding.
  const drifted = unappliedPins.map(
    ({ name, declaredAt, spec, resolved }) =>
      `  - ${declaredAt} asks for "${spec}" but "${name}" resolved to ${resolved
        .map((version) => `"${version}"`)
        .join(', ')}`,
  );

  if (
    invalid.length > 0 ||
    ignored.length > 0 ||
    unused.length > 0 ||
    undercut.length > 0 ||
    drifted.length > 0
  ) {
    const sections: string[] = [];

    if (invalid.length > 0) {
      sections.push(
        `These declarations are malformed, so bun cannot apply them:\n${invalid.join('\n')}`,
      );
    }

    if (ignored.length > 0) {
      sections.push(
        'Bun does not support nested overrides and ignores these entirely, so they pin nothing:\n' +
          ignored.join('\n') +
          '\n\n  Flatten each one to a top-level entry, which is the only form bun applies:\n' +
          `    "${inert[0].declaredAt.split('.')[0]}": { "${inert[0].name}": "<version>" }\n` +
          '  Note that this applies the pin everywhere in the tree, not just under the parent it was nested\n' +
          '  under. npm scopes the nested form instead, so a repo installed with both resolves it differently.',
      );
    }

    if (unused.length > 0) {
      sections.push(
        'These overrides no longer match anything installed, so they have no effect:\n' +
          unused.join('\n') +
          '\n\n  Remove them from package.json, then run `bun install`.',
      );
    }

    if (undercut.length > 0) {
      sections.push(
        'These overrides force a version outside what a dependent declares it supports, without\n' +
          'being an intentional forward override, which bun\n' +
          'applies without any warning:\n' +
          undercut.join('\n') +
          '\n\n  Raise the pin to a version inside those ranges, or remove it if it has outlived\n' +
          '  its reason. A pin that has fallen behind its dependents usually means the advisory\n' +
          '  it was added for is long fixed upstream.',
      );
    }

    if (drifted.length > 0) {
      sections.push(
        'These overrides are declared but not reflected in bun.lock, so the pin is not in\n' +
          'effect and the version you asked for is not what is installed:\n' +
          drifted.join('\n') +
          '\n\n  Run `bun install` to re-resolve. Bun does apply an added or changed override on a\n' +
          '  plain install, so this normally means package.json was edited without installing\n' +
          '  since. If it survives an install, the pin cannot be satisfied as written (check for\n' +
          '  a conflicting range, or a version that does not exist).',
      );
    }

    logError(`overrides check failed:\n\n${sections.join('\n\n')}\n`);

    return {
      success: false,
      problems: [...invalid, ...ignored, ...unused, ...undercut, ...drifted],
      inert,
      targets,
      backwardPins: backward,
      unappliedPins,
    };
  }

  log(
    `overrides check passed (${targets.length} declared, all still applied).`,
  );

  if (options?.verbose === true && statuses.length > 0) {
    log(`\n${describePins(statuses).join('\n')}`);
  }

  return {
    success: true,
    problems: [],
    inert,
    targets,
    backwardPins: [],
    unappliedPins: [],
  };
}

/**
 * Render the per-override breakdown shown under `verbose`.
 *
 * The distinction worth surfacing is whether a pin is still doing work.
 * "Forcing past" means it is holding a dependent above what that dependent
 * asked for, which is the normal reason an override exists. Sitting inside
 * every declared range means it is not forcing anything right now, which is
 * the strongest hint available offline that the pin may have outlived its
 * reason.
 *
 * That hint is deliberately worded as a candidate rather than a verdict, and
 * never fails the check: a pin can still be load-bearing by capping a future
 * major that nothing in the tree has reached yet, and only a resolve without
 * it (`refreshLockfile()`) actually answers the question.
 */
function describePins(statuses: PinStatus[]): string[] {
  const lines: string[] = [];

  for (const status of statuses) {
    if (status.version === null) {
      // Either absent (already reported as stale) or resolved to several
      // versions, which makes the range comparisons unanswerable.
      lines.push(
        `  ${status.name}\n      resolved to no single version, so its effect can't be determined here`,
      );

      continue;
    }

    lines.push(`  ${status.name} → ${status.version}`);

    if (status.forcingPast.length > 0) {
      const shown = status.forcingPast.slice(0, MAX_LISTED_DEPENDENTS);

      for (const { dependent, range } of shown) {
        lines.push(`      forcing past ${dependent} (declares "${range}")`);
      }

      const hidden = status.forcingPast.length - shown.length;

      if (hidden > 0) {
        lines.push(`      ...and ${hidden} more`);
      }
    } else if (status.declaredRangeCount === 0) {
      // Nothing in the tree declares a comparable range on it, so there is no
      // range for the pin to be forcing past in the first place.
      lines.push(`      no dependent declares a comparable range on it`);
    } else {
      lines.push(`      within every declared range`);
      lines.push(
        `      not currently forcing anything, so it may have outlived its reason —`,
      );
      lines.push(
        `      remove it and run install:fresh to see what actually moves`,
      );
    }
  }

  return lines;
}
