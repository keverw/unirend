import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { checkOverrides } from './check-overrides';

// ---------------------------------------------------------------------------
// checkOverrides — run the exported check against a fake repo. The scaffolded
// scripts/check-overrides.ts is a thin wrapper over this function (asserted in
// starter-templates/templates-shared/check-overrides.test.ts), so its behavior
// is tested here at the function level.
//
// ALL BUT ONE TEST INJECT THE PROBE, so `bun why` is never spawned and no
// install or network access happens — tests describe a dependency tree by name
// instead of installing one. The backward-pin tests additionally write a
// bun.lock fixture, which IS parsed for real by the shared lockfile reader, so
// that path is genuinely exercised.
//
// The exception is the last test, which really does spawn `bun why`, because
// what it checks is the default probe's own handling of a lockfile bun cannot
// read. It stays offline: `bun why` only reads the local lockfile.
//
// Worth stating plainly: this verifies OUR logic, not bun's behavior. The
// claims the tool rests on (a dead override is accepted in total silence, a
// nested override is ignored outright, a backward pin installs without a
// warning) were each verified by hand against real bun and are documented in
// check-overrides.ts. If bun changes any of them, this suite still passes.
// ---------------------------------------------------------------------------

/**
 * Build a bun.lock fixture. Each entry maps a lockfile key to its resolved
 * "name@version" plus the dependency ranges that package declares, which is
 * the shape the backward-pin check reads: the resolved version on one side,
 * the ranges its dependents declare on the other.
 *
 * Keeps the real file's JSONC trailing commas, since those are why the reader
 * parses entries line by line instead of JSON.parse-ing the whole file.
 */
function lockfile(
  entries: Record<string, { spec: string; deps?: Record<string, string> }>,
  rootDeps?: Record<string, string>,
): string {
  const lines = Object.entries(entries).map(([key, { spec, deps }]) => {
    const metadata = deps
      ? `{ "dependencies": ${JSON.stringify(deps)} }`
      : '{}';
    return `    "${key}": ["${spec}", "", ${metadata}, "sha512-abc"],`;
  });

  // The repo's OWN declared ranges live in the workspaces block under the ""
  // key, which bun writes even for a single-package repo with no workspaces
  // configured. Omitted unless a test needs them, so other fixtures stay
  // focused on the resolved packages.
  const workspaces =
    rootDeps === undefined
      ? ''
      : `  "workspaces": {\n    "": {\n      "name": "demo",\n      "dependencies": ${JSON.stringify(rootDeps)},\n    },\n  },\n`;

  return `{\n  "lockfileVersion": 1,\n${workspaces}  "packages": {\n${lines.join('\n')}\n  },\n}\n`;
}

describe('checkOverrides', () => {
  let tmpDir: TmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'unirend-check-overrides-',
      unsafeCleanup: true,
    });
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  /**
   * Write a package.json and run the check with `installed` standing in for
   * the dependency tree. Probed names are recorded so tests can assert which
   * packages the check considered targets.
   */
  async function run(pkg: unknown, installed: string[] = [], lock?: string) {
    await fs.promises.writeFile(
      path.join(tmpDir.path, 'package.json'),
      typeof pkg === 'string' ? pkg : JSON.stringify(pkg, null, 2),
    );

    // Only the backward-pin tests need a lockfile. Without one that check is
    // skipped, which keeps every other test focused on a single behavior.
    if (lock !== undefined) {
      await fs.promises.writeFile(path.join(tmpDir.path, 'bun.lock'), lock);
    }

    const lines: string[] = [];
    const probed: string[] = [];

    const result = await checkOverrides({
      rootDir: tmpDir.path,
      log: (message) => lines.push(message),
      logError: (message) => lines.push(message),
      isPackageInstalled: (name) => {
        probed.push(name);
        return installed.includes(name);
      },
    });

    return { result, probed, output: lines.join('\n') };
  }

  test('passes when no overrides are declared', async () => {
    const { result, probed, output } = await run({ name: 'demo' });

    expect(result.success).toBe(true);
    expect(result.targets).toEqual([]);
    expect(probed).toEqual([]);
    expect(output).toContain('none declared');
  });

  test('passes when every declared override is still installed', async () => {
    const { result, output } = await run(
      { overrides: { 'left-pad': '1.3.0' } },
      ['left-pad'],
    );

    expect(result.success).toBe(true);
    expect(result.problems).toEqual([]);
    expect(output).toContain('1 declared, all still applied');
  });

  test('fails on a dead top-level override in overrides', async () => {
    const { result, output } = await run({
      overrides: { 'left-pad': '1.3.0' },
    });

    expect(result.success).toBe(false);
    expect(result.problems).toHaveLength(1);
    // The full declaration path makes the offending line findable in a large
    // package.json.
    expect(result.problems[0]).toContain('overrides.left-pad');
    expect(result.problems[0]).toContain('not in the dependency tree');
    expect(output).toContain('overrides check failed');
  });

  test('fails on a dead override in resolutions (the yarn-style field)', async () => {
    const { result } = await run({ resolutions: { 'left-pad': '1.3.0' } });

    expect(result.success).toBe(false);
    expect(result.problems[0]).toContain('resolutions.left-pad');
  });

  test('parses scoped package names', async () => {
    const { result, probed } = await run(
      { overrides: { '@scope/pkg': '1.0.0' } },
      ['@scope/pkg'],
    );

    // The leading "@" is the scope marker, not a version selector.
    expect(probed).toEqual(['@scope/pkg']);
    expect(result.success).toBe(true);
  });

  test('fails a nested override, which bun ignores outright', async () => {
    // Verified against bun 1.3.14: a nested block is neither scoped like npm
    // nor flattened, it is dropped, so brace-expansion is not pinned at all
    // even though it is installed. That is the dangerous case — the repo
    // believes it has a pin it does not have.
    const { result, probed, output } = await run(
      { overrides: { minimatch: { 'brace-expansion': '1.1.12' } } },
      ['minimatch', 'brace-expansion'],
    );

    expect(result.success).toBe(false);
    expect(result.inert).toEqual([
      {
        name: 'brace-expansion',
        declaredAt: 'overrides.minimatch.brace-expansion',
        spec: '1.1.12',
      },
    ]);
    // Never probed: whether it's installed is irrelevant to a pin bun drops.
    expect(probed).toEqual([]);
    expect(result.targets).toEqual([]);
    expect(output).toContain('does not support nested overrides');
    expect(output).toContain('Flatten each one to a top-level entry');
  });

  test('fails a version-qualified key rather than stripping the selector', async () => {
    // Regression test for a false negative that defeated the whole check for
    // security pins. The key used to be normalized by stripping "@^2", which
    // resolved it to brace-expansion — a package that IS installed — so a dead
    // override was reported as applied and working.
    //
    // Verified against bun 1.3.14: `{ "brace-expansion@^2": "1.1.16" }` under a
    // minimatch declaring "^5.0.5" left brace-expansion at 5.0.7, identical to
    // declaring no override at all, while the flat key pinned it to 1.1.16. Bun
    // records the entry in bun.lock's overrides block and prints no warning of
    // any kind, so as with a stale pin this check is the only guard.
    const { result, probed, output } = await run(
      { overrides: { 'brace-expansion@^2': '1.1.16' } },
      ['minimatch', 'brace-expansion'],
    );

    expect(result.success).toBe(false);
    // The key must never become a probed target: that is exactly the bug.
    expect(result.targets).toEqual([]);
    expect(probed).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(output).toContain('carries a version selector');
    // The remedy names the flat key to use instead.
    expect(output).toContain('"brace-expansion": "<version>"');
  });

  test('fails a version-qualified scoped key', async () => {
    const { result, output } = await run(
      { overrides: { '@scope/pkg@^1': '1.2.3' } },
      ['@scope/pkg'],
    );

    expect(result.success).toBe(false);
    expect(result.targets).toEqual([]);
    // The selector is stripped back to the scoped name for the suggestion,
    // not to the bare scope.
    expect(output).toContain('"@scope/pkg": "<version>"');
  });

  test('fails a nested override whose parent is not installed either', async () => {
    const { result, probed } = await run({
      overrides: { 'totally-not-installed': { 'brace-expansion': '1.1.12' } },
    });

    // The parent key is only a selector, so it is never reported as a dead
    // package in its own right — the finding is the inert inner entry.
    expect(result.success).toBe(false);
    expect(probed).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain(
      'overrides.totally-not-installed.brace-expansion',
    );
  });

  test('reports a doubly-nested block once, at its own path', async () => {
    const { result } = await run({
      overrides: { minimatch: { 'brace-expansion': { '.': '1.1.12' } } },
    });

    // One mistake, one finding — not one per leaf buried underneath it.
    // The value is a block rather than a version string, so there is no spec.
    expect(result.inert).toEqual([
      {
        name: 'brace-expansion',
        declaredAt: 'overrides.minimatch.brace-expansion',
        spec: '',
      },
    ]);
  });

  test('resolves the "." key to the parent package', async () => {
    // Bun honors "." inside a nested block (verified: it pins the parent
    // exactly like the flat form), so unlike its siblings it is a real target.
    const { result, probed } = await run(
      { overrides: { minimatch: { '.': '9.0.0' } } },
      ['minimatch'],
    );

    expect(probed).toEqual(['minimatch']);
    expect(result.targets[0].declaredAt).toBe('overrides.minimatch..');
    expect(result.inert).toEqual([]);
    expect(result.success).toBe(true);
  });

  test('fails a "." sibling that bun drops, while keeping the "." itself', async () => {
    const { result, probed } = await run(
      { overrides: { minimatch: { '.': '9.0.0', 'left-pad': '1.3.0' } } },
      ['minimatch'],
    );

    // Only the "." entry is applied, so only it is probed; the sibling is inert.
    expect(probed).toEqual(['minimatch']);
    expect(result.targets).toHaveLength(1);
    expect(result.inert).toHaveLength(1);
    expect(result.inert[0].declaredAt).toBe('overrides.minimatch.left-pad');
    expect(result.success).toBe(false);
  });

  test('fails a "." key at the top level, where it has no parent', async () => {
    const { result } = await run({ overrides: { '.': '1.0.0' } });

    expect(result.success).toBe(false);
    expect(result.problems[0]).toContain('no parent package');
  });

  test('probes a package named by two identical declarations only once', async () => {
    // Same package, same version, written twice is harmless duplication, so it
    // dedupes quietly rather than adding a second line to the report.
    const { result, probed } = await run(
      {
        overrides: { 'left-pad': '1.3.0' },
        resolutions: { 'left-pad': '1.3.0' },
      },
      ['left-pad'],
    );

    expect(probed).toEqual(['left-pad']);
    expect(result.targets).toHaveLength(1);
    expect(result.success).toBe(true);
  });

  test('fails when two declarations ask for different versions', async () => {
    // Verified against bun 1.3.14: with overrides at 5.0.6 and resolutions at
    // 5.0.7 the tree resolved to 5.0.6, and swapping the two fields in the file
    // did not change that, so `overrides` wins on precedence rather than on
    // document order. The install printed nothing and exited 0, so the losing
    // entry reads as a pin that is simply not in effect.
    const { result, probed, output } = await run(
      {
        overrides: { 'left-pad': '1.3.0' },
        resolutions: { 'left-pad': '1.2.0' },
      },
      ['left-pad'],
    );

    expect(result.success).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(output).toContain('overrides.left-pad asks for "1.3.0"');
    expect(output).toContain('resolutions.left-pad asks for "1.2.0"');

    // The retained target is the one bun actually applies, so the outcome
    // check still compares against the winning spec.
    expect(result.targets).toEqual([
      { name: 'left-pad', declaredAt: 'overrides.left-pad', spec: '1.3.0' },
    ]);
    expect(probed).toEqual(['left-pad']);
  });

  test('fails on a malformed declaration value', async () => {
    const { result, output } = await run({ overrides: { 'left-pad': 3 } });

    expect(result.success).toBe(false);
    expect(result.problems[0]).toContain('must be a version string');
    expect(output).toContain('malformed');
  });

  test('fails on empty and whitespace-only override values', async () => {
    // Verified against bun 1.3.14: both forms print `Missing override value`,
    // leave the package at its normal resolution, and still exit successfully.
    // semver.validRange() reads them as "*", so they must be rejected before
    // the resolved-version comparison can mistake them for applied ranges.
    const { result, probed, output } = await run(
      {
        overrides: {
          'left-pad': '',
          minimatch: { '.': ' \t ' },
        },
      },
      ['left-pad', 'minimatch'],
    );

    expect(result.success).toBe(false);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toContain('overrides.left-pad');
    expect(result.problems[1]).toContain('overrides.minimatch..');
    expect(
      result.problems.every((problem) => problem.includes('non-empty')),
    ).toBe(true);
    expect(result.targets).toEqual([]);
    expect(probed).toEqual([]);
    expect(output).toContain('malformed');
  });

  test('fails when the overrides field is not an object', async () => {
    const { result } = await run({ overrides: ['left-pad'] });

    expect(result.success).toBe(false);
    expect(result.problems[0]).toContain(
      'overrides must be a JSON object mapping package names',
    );
  });

  // -------------------------------------------------------------------------
  // Backward pins: an override forcing a package BELOW what a dependent
  // declares it needs. Bun applies these silently (verified by hand), and the
  // whole check is offline — it reads the ranges already recorded in bun.lock.
  // -------------------------------------------------------------------------

  test('fails an override pinning below what a dependent declares', async () => {
    const { result, output } = await run(
      { overrides: { 'brace-expansion': '1.1.11' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': '^2.0.2' },
        },
        'brace-expansion': { spec: 'brace-expansion@1.1.11' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.backwardPins).toHaveLength(1);
    expect(result.backwardPins[0]).toMatchObject({
      name: 'brace-expansion',
      version: '1.1.11',
      declaredAt: 'overrides.brace-expansion',
      violations: [{ dependent: 'minimatch@9.0.9', range: '^2.0.2' }],
    });
    expect(output).toContain('outside what a dependent declares it supports');
    expect(output).toContain('minimatch@9.0.9 declares "^2.0.2"');
  });

  test('allows an override pinning FORWARD past a declared range', async () => {
    // Forcing a package ahead of what a parent allows is usually the entire
    // point of an override (the fix landed in a major the parent hasn't
    // adopted), so it must not fail the build.
    const { result } = await run(
      { overrides: { 'brace-expansion': '2.0.2' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@3.1.2',
          deps: { 'brace-expansion': '^1.1.7' },
        },
        'brace-expansion': { spec: 'brace-expansion@2.0.2' },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.backwardPins).toEqual([]);
  });

  test('fails a pin in the unsupported gap of a disjoint range', async () => {
    const { result, output } = await run(
      { overrides: { 'brace-expansion': '2.0.0' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': '^1.0.0 || ^3.0.0' },
        },
        'brace-expansion': { spec: 'brace-expansion@2.0.0' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.backwardPins[0].violations).toEqual([
      { dependent: 'minimatch@9.0.9', range: '^1.0.0 || ^3.0.0' },
    ]);
    expect(output).toContain('outside what a dependent declares it supports');
  });

  test('allows a pin that satisfies every declared range', async () => {
    const { result } = await run(
      { overrides: { 'brace-expansion': '2.1.2' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': '^2.0.2' },
        },
        'brace-expansion': { spec: 'brace-expansion@2.1.2' },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.backwardPins).toEqual([]);
  });

  test('ignores ranges semver cannot evaluate', async () => {
    // workspace:, npm: aliases and git URLs are legitimate and simply outside
    // what this check can answer, so they must not throw or false-positive.
    const { result } = await run(
      { overrides: { 'brace-expansion': '1.1.11' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': 'workspace:*' },
        },
        'brace-expansion': { spec: 'brace-expansion@1.1.11' },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.backwardPins).toEqual([]);
  });

  test('makes no backward claim when a package resolved to more than one version', async () => {
    // The BACKWARD check stays quiet here: attributing which dependent got
    // which copy needs a graph walk it deliberately doesn't do. The outcome
    // check still fails the run, though, and rightly so — an exact pin that
    // left a second version standing did not apply.
    const { result } = await run(
      { overrides: { 'brace-expansion': '1.1.11' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': '^2.0.2' },
        },
        'brace-expansion': { spec: 'brace-expansion@1.1.11' },
        'a/b/brace-expansion': { spec: 'brace-expansion@2.0.2' },
      }),
    );

    expect(result.backwardPins).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.unappliedPins).toEqual([
      {
        name: 'brace-expansion',
        declaredAt: 'overrides.brace-expansion',
        spec: '1.1.11',
        resolved: ['1.1.11', '2.0.2'],
      },
    ]);
  });

  test('fails when the lockfile does not hold the version the override asks for', async () => {
    // The drift case: the override is declared and the package is installed,
    // so presence and range checks both pass, but the pin never took. Bun does
    // apply an added override on a plain install (verified against 1.3.14), so
    // in practice this means package.json was edited without installing since.
    const { result, output } = await run(
      { overrides: { 'brace-expansion': '1.1.16' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@10.2.5',
          deps: { 'brace-expansion': '^5.0.5' },
        },
        'brace-expansion': { spec: 'brace-expansion@5.0.7' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.unappliedPins).toEqual([
      {
        name: 'brace-expansion',
        declaredAt: 'overrides.brace-expansion',
        spec: '1.1.16',
        resolved: ['5.0.7'],
      },
    ]);
    expect(output).toContain('not reflected in bun.lock');
    expect(output).toContain('Run `bun install` to re-resolve');
  });

  test('fails a pin below a range the repo itself declares', async () => {
    // Regression test. The repo's own ranges do not appear among the resolved
    // packages, so an override forcing a DIRECT dependency below the range in
    // your own package.json used to pass: nothing in `packages` records that
    // range, and the resolved version satisfies the override, so the outcome
    // check is happy too.
    //
    // Verified against bun 1.3.14: with the root declaring `semver: "^7.8.0"`
    // and an override pinning `7.3.0`, bun installed 7.3.0 without a word.
    // Bun also copies the declaration into the lockfile's workspaces block,
    // even for a single package, but the current manifest is authoritative.
    const { result, output } = await run(
      {
        name: 'demo',
        dependencies: { semver: '^7.8.0' },
        overrides: { semver: '7.3.0' },
      },
      ['semver'],
      lockfile({ semver: { spec: 'semver@7.3.0' } }, { semver: '^7.8.0' }),
    );

    expect(result.success).toBe(false);
    expect(result.backwardPins).toEqual([
      {
        name: 'semver',
        version: '7.3.0',
        declaredAt: 'overrides.semver',
        violations: [
          { dependent: 'demo (this package.json)', range: '^7.8.0' },
        ],
      },
    ]);
    // The label says where the range came from, since "your own package.json"
    // is a more actionable message than some transitive dependency. The name
    // is package.json's own `name` field, "demo" in this fixture.
    expect(output).toContain('demo (this package.json) declares "^7.8.0"');
  });

  test('uses the current root manifest when the lockfile workspace range is stale', async () => {
    const { result, output } = await run(
      {
        name: 'demo',
        dependencies: { semver: '^8.0.0' },
        overrides: { semver: '7.8.0' },
      },
      ['semver'],
      lockfile({ semver: { spec: 'semver@7.8.0' } }, { semver: '^7.8.0' }),
    );

    expect(result.success).toBe(false);
    expect(result.backwardPins[0].violations).toEqual([
      { dependent: 'demo (this package.json)', range: '^8.0.0' },
    ]);
    expect(output).not.toContain('declares "^7.8.0"');
  });

  test('ignores an optional-only peer declared by the root workspace', async () => {
    const { result } = await run(
      {
        overrides: { react: '18.2.0' },
        peerDependencies: { react: '^19.0.0' },
        peerDependenciesMeta: { react: { optional: true } },
      },
      ['react'],
      lockfile({ react: { spec: 'react@18.2.0' } }, { react: '^19.0.0' }),
    );

    expect(result.success).toBe(true);
    expect(result.backwardPins).toEqual([]);
  });

  test('keeps an installed root dependency binding when its peer is optional', async () => {
    const { result } = await run(
      {
        name: 'demo',
        overrides: { react: '18.2.0' },
        devDependencies: { react: '^19.2.0' },
        peerDependencies: { react: '^19.0.0' },
        peerDependenciesMeta: { react: { optional: true } },
      },
      ['react'],
      lockfile({ react: { spec: 'react@18.2.0' } }, { react: '^19.2.0' }),
    );

    expect(result.success).toBe(false);
    expect(result.backwardPins[0].violations).toEqual([
      { dependent: 'demo (this package.json)', range: '^19.2.0' },
    ]);
  });

  test('ignores an optional-only peer declared by a child workspace', async () => {
    const workspaceDir = path.join(tmpDir.path, 'packages', 'app');
    await fs.promises.mkdir(workspaceDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(workspaceDir, 'package.json'),
      JSON.stringify({
        peerDependencies: { react: '^19.0.0' },
        peerDependenciesMeta: { react: { optional: true } },
      }),
    );

    const lock = lockfile({ react: { spec: 'react@18.2.0' } }).replace(
      '  "packages": {',
      '  "workspaces": {\n    "packages/app": {\n      "name": "app",\n      "peerDependencies": { "react": "^19.0.0" },\n    },\n  },\n  "packages": {',
    );
    const { result } = await run(
      { overrides: { react: '18.2.0' } },
      ['react'],
      lock,
    );

    expect(result.success).toBe(true);
    expect(result.backwardPins).toEqual([]);
  });

  test('uses a child workspace manifest when its lockfile range is stale', async () => {
    const workspaceDir = path.join(tmpDir.path, 'packages', 'app');
    await fs.promises.mkdir(workspaceDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(workspaceDir, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0' } }),
    );

    const lock = lockfile({ react: { spec: 'react@18.2.0' } }).replace(
      '  "packages": {',
      '  "workspaces": {\n    "packages/app": {\n      "name": "app",\n      "dependencies": { "react": "^18.0.0" },\n    },\n  },\n  "packages": {',
    );
    const { result } = await run(
      { overrides: { react: '18.2.0' } },
      ['react'],
      lock,
    );

    expect(result.success).toBe(false);
    expect(result.backwardPins[0].violations).toEqual([
      { dependent: 'app (workspace packages/app)', range: '^19.0.0' },
    ]);
  });

  test('rejects a malformed current workspace manifest instead of using stale lockfile ranges', async () => {
    const workspaceDir = path.join(tmpDir.path, 'packages', 'app');
    await fs.promises.mkdir(workspaceDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(workspaceDir, 'package.json'),
      '{ invalid json',
    );

    const lock = lockfile({ react: { spec: 'react@18.2.0' } }).replace(
      '  "packages": {',
      '  "workspaces": {\n    "packages/app": {\n      "name": "app",\n      "dependencies": { "react": "^18.0.0" },\n    },\n  },\n  "packages": {',
    );

    expect(
      run({ overrides: { react: '18.2.0' } }, ['react'], lock),
    ).rejects.toThrow(
      /Failed to parse workspace manifest .*packages[/\\]app[/\\]package\.json/,
    );
  });

  test('omits the name from the label when package.json has none', async () => {
    // Verified against bun 1.3.14: a package.json with no `name` produces a
    // workspaces entry with no name field, which would otherwise render as a
    // dangling " (this package.json)".
    const lock = lockfile(
      { semver: { spec: 'semver@7.3.0' } },
      { semver: '^7.8.0' },
    ).replace('      "name": "demo",\n', '');

    const { result, output } = await run(
      {
        dependencies: { semver: '^7.8.0' },
        overrides: { semver: '7.3.0' },
      },
      ['semver'],
      lock,
    );

    expect(result.success).toBe(false);
    expect(output).toContain('this package.json declares "^7.8.0"');
    expect(output).not.toContain(' (this package.json)');
  });

  test('accepts a range override that permits several resolved versions', async () => {
    // Only a version OUTSIDE the declared range is a finding. A range pin
    // legitimately allows more than one, so multiple versions alone must not
    // fail, otherwise every `^`-style override in a large tree would.
    const { result } = await run(
      { overrides: { 'brace-expansion': '^2.0.0' } },
      ['brace-expansion'],
      lockfile({
        'brace-expansion': { spec: 'brace-expansion@2.0.2' },
        'a/b/brace-expansion': { spec: 'brace-expansion@2.1.0' },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.unappliedPins).toEqual([]);
  });

  test('skips the outcome check for a spec semver cannot evaluate', async () => {
    // `npm:` aliases, `workspace:`, `catalog:`, git URLs and file paths are
    // legitimate override values with no version to compare against, so they
    // must not be reported as unapplied.
    const { result } = await run(
      { overrides: { 'brace-expansion': 'npm:@scope/fork@1.0.0' } },
      ['brace-expansion'],
      lockfile({
        'brace-expansion': { spec: 'brace-expansion@5.0.7' },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.unappliedPins).toEqual([]);
  });

  test('reports one line per distinct dependent and range', async () => {
    const { result } = await run(
      { overrides: { 'brace-expansion': '1.1.11' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': '^2.0.2' },
        },
        // Same dependent at the same version and range, reached by a second
        // path — one finding, not two.
        'a/b/minimatch': {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': '^2.0.2' },
        },
        glob: { spec: 'glob@10.0.0', deps: { 'brace-expansion': '^2.1.0' } },
        'brace-expansion': { spec: 'brace-expansion@1.1.11' },
      }),
    );

    expect(result.backwardPins[0].violations).toEqual([
      { dependent: 'glob@10.0.0', range: '^2.1.0' },
      { dependent: 'minimatch@9.0.9', range: '^2.0.2' },
    ]);
  });

  test('skips the range check entirely when there is no lockfile', async () => {
    // An injected probe means the lockfile is optional, and the range check
    // simply has nothing to read.
    const { result } = await run({ overrides: { 'left-pad': '1.3.0' } }, [
      'left-pad',
    ]);

    expect(result.success).toBe(true);
    expect(result.backwardPins).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // verbose: what each surviving override is doing. Off by default so the
  // every-CI-run output stays one line.
  // -------------------------------------------------------------------------

  test('says nothing extra unless verbose is set', async () => {
    const { output } = await run(
      { overrides: { 'brace-expansion': '2.1.2' } },
      ['brace-expansion'],
      lockfile({
        minimatch: {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': '^2.0.2' },
        },
        'brace-expansion': { spec: 'brace-expansion@2.1.2' },
      }),
    );

    expect(output).toBe(
      'overrides check passed (1 declared, all still applied).',
    );
  });

  test('verbose reports a pin that is actively forcing a dependent past its range', async () => {
    const lines: string[] = [];

    await fs.promises.writeFile(
      path.join(tmpDir.path, 'package.json'),
      JSON.stringify({ overrides: { 'brace-expansion': '2.0.2' } }),
    );
    await fs.promises.writeFile(
      path.join(tmpDir.path, 'bun.lock'),
      lockfile({
        minimatch: {
          spec: 'minimatch@3.1.2',
          deps: { 'brace-expansion': '^1.1.7' },
        },
        'brace-expansion': { spec: 'brace-expansion@2.0.2' },
      }),
    );

    const result = await checkOverrides({
      rootDir: tmpDir.path,
      log: (message) => lines.push(message),
      logError: (message) => lines.push(message),
      isPackageInstalled: () => true,
      verbose: true,
    });

    expect(result.success).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('brace-expansion → 2.0.2');
    expect(output).toContain(
      'forcing past minimatch@3.1.2 (declares "^1.1.7")',
    );
    // A pin doing work must not be labeled a removal candidate.
    expect(output).not.toContain('outlived its reason');
  });

  test('verbose flags a pin that is not forcing anything as a candidate', async () => {
    const lines: string[] = [];

    await fs.promises.writeFile(
      path.join(tmpDir.path, 'package.json'),
      JSON.stringify({ overrides: { 'brace-expansion': '2.1.2' } }),
    );
    await fs.promises.writeFile(
      path.join(tmpDir.path, 'bun.lock'),
      lockfile({
        minimatch: {
          spec: 'minimatch@9.0.9',
          deps: { 'brace-expansion': '^2.0.2' },
        },
        'brace-expansion': { spec: 'brace-expansion@2.1.2' },
      }),
    );

    const result = await checkOverrides({
      rootDir: tmpDir.path,
      log: (message) => lines.push(message),
      logError: (message) => lines.push(message),
      isPackageInstalled: () => true,
      verbose: true,
    });

    const output = lines.join('\n');
    expect(output).toContain('within every declared range');
    expect(output).toContain('outlived its reason');
    // It stays a hint, never a failure: the pin may still cap a future major.
    expect(result.success).toBe(true);
  });

  test('throws on an unparsable package.json', () => {
    expect(run('{ not json')).rejects.toThrow('Failed to parse');
  });

  test('reports the missing lockfile instead of every override, with the default probe', async () => {
    // Without a lockfile `bun why` fails for everything, which would report
    // every declared override as dead. The check has to say what actually
    // went wrong. (No isPackageInstalled here, so the default path runs.)
    await fs.promises.writeFile(
      path.join(tmpDir.path, 'package.json'),
      JSON.stringify({ overrides: { 'left-pad': '1.3.0' } }),
    );

    const lines: string[] = [];
    const result = await checkOverrides({
      rootDir: tmpDir.path,
      log: (message) => lines.push(message),
      logError: (message) => lines.push(message),
    });

    expect(result.success).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('No bun.lock found');
    expect(lines.join('\n')).toContain('bun install');
  });

  test('refuses to guess when the lockfile is unreadable by bun', async () => {
    // The one test that really spawns `bun why` (see the banner). It has to:
    // the behavior under test IS the default probe's, and injecting a probe
    // would replace the very code being checked.
    //
    // A lockfile that exists but does not parse is the gap the missing-file
    // guard above does not cover. Our own reader degrades to empty, so every
    // probe fails, and reading that as "absent" would tell you to delete a
    // perfectly valid override because bun could not read the lockfile.
    await fs.promises.writeFile(
      path.join(tmpDir.path, 'package.json'),
      JSON.stringify({ name: 'demo', overrides: { 'left-pad': '1.3.0' } }),
    );

    await fs.promises.writeFile(
      path.join(tmpDir.path, 'bun.lock'),
      'GARBAGE {{{ not a lockfile\n',
    );

    // Reported as a thrown failure, not a check result: the check could not be
    // performed at all, which is different from it finding a problem.
    expect(
      checkOverrides({
        rootDir: tmpDir.path,
        log: () => {},
        logError: () => {},
      }),
    ).rejects.toThrow(/Could not determine whether "left-pad" is installed/);
  });
});
