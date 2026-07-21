import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { parseBunLockfile, splitSpec } from '../internal/bun-lockfile';

/**
 * Lockfile regenerator for scaffolded repos, exported via
 * `unirend/repo-tools`.
 *
 * Deletes `bun.lock`, resolves it from scratch, and reports exactly which
 * packages changed.
 *
 * Why this exists: a lockfile holds every resolved version steady, including
 * versions that are merely in range. A plain `bun install` will not move them,
 * by design — that is what a lockfile is for. Verified against bun 1.3.14:
 * with `semver: "^7.0.0"` locked at 7.3.0, `bun install` left it at 7.3.0,
 * while deleting the lockfile first resolved it to 7.8.5. So the only way to
 * take the in-range updates the ranges already permit is to resolve from
 * scratch, and nothing reports what that would change until you do it.
 *
 * Note this is NOT needed to make an `overrides` entry take effect. Bun applies
 * an added, changed, or removed override on a plain `bun install` (verified
 * against bun 1.3.14 for all three), and `checkOverrides()` fails the build if
 * the lockfile ever disagrees with a declared pin, so that case is covered
 * without regenerating anything.
 *
 * Where it does help with overrides is the opposite question, the one no
 * offline check can answer: is this pin still needed? Delete the suspect
 * override, run this, and read the change report. It names the version the
 * package moves to, which is the answer. Put the override back if the result
 * is worse.
 *
 * A fresh resolve picks up every in-range update at once, not just the one you
 * were after, and that blast radius is invisible in the diff of a large
 * lockfile. This prints it as a list so regenerating is a deliberate review
 * step rather than a wall of noise. The previous lockfile is restored if the
 * install fails, so a failed resolve does not leave the repo without one
 * (which would make the next install resolve from scratch silently rather than
 * on purpose).
 *
 * This tool mutates the lockfile, so unlike {@link checkOverrides} it is not
 * chained into the generated `check` script — it is run on demand via
 * `bun run install:fresh`.
 *
 * The function acts as a main: it prints its own report through the injectable
 * loggers and returns a result instead of exiting, so the scaffolded
 * `scripts/refresh-lockfile.ts` stays a thin wrapper that sets the exit code
 * (and is the place to customize).
 */

/** Options for {@link refreshLockfile}. */
export interface RefreshLockfileOptions {
  /** Repo root containing bun.lock. Defaults to process.cwd(). */
  rootDir?: string;
  /** Sink for progress and the change report. Defaults to console.log. */
  log?: (message: string) => void;
  /** Sink for failure messages. Defaults to console.error. */
  logError?: (message: string) => void;
  /**
   * Override how the reinstall is run. Resolves true when the install
   * succeeded. Defaults to `bun install` in `rootDir` with inherited stdio, so
   * bun's own progress output reaches the terminal. Exists mainly so tests
   * (and repos wrapping the install in something else) can supply their own.
   */
  install?: () => boolean | Promise<boolean>;
}

/** One package whose resolved version changed. */
export interface LockfileChange {
  /** Package name. */
  name: string;
  /** Resolved version before the refresh. */
  from: string;
  /** Resolved version after the refresh. */
  to: string;
}

/** Result of {@link refreshLockfile}. */
export interface RefreshLockfileResult {
  /** True when the lockfile was regenerated successfully. */
  success: boolean;
  /** Why it failed, when `success` is false. Empty on success. */
  problems: string[];
  /** Packages present before and after at a different version. */
  changed: LockfileChange[];
  /** `name@version` specs that only exist after the refresh. */
  added: string[];
  /** `name@version` specs that only existed before the refresh. */
  removed: string[];
  /** True when a failed install caused the previous lockfile to be restored. */
  restored: boolean;
}

/**
 * Map each lockfile entry to its resolved "name@version".
 *
 * The parsing lives in the shared `bun-lockfile` reader, which also backs the
 * overrides check. All this needs is key → spec: the key (which may be a
 * nested path like "a/b/minimatch" for a transitive copy resolved separately
 * from the top-level one) identifies an entry across the two snapshots, and
 * the spec is what changed.
 */
function readResolved(lockText: string): Map<string, string> {
  return new Map(
    parseBunLockfile(lockText).map((entry) => [entry.key, entry.spec]),
  );
}

/** Run `bun install` in rootDir, letting its output through to the terminal. */
function bunInstall(rootDir: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['install'], {
      cwd: rootDir,
      stdio: 'inherit',
    });

    // A missing bun binary is not a failed resolve — reporting it as one would
    // restore the lockfile and claim the install failed for a dependency
    // reason, so surface it as the environment problem it is.
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new Error(
              'Could not run "bun install": the bun binary was not found. Refreshing the lockfile requires Bun.',
            )
          : error,
      );
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * Delete `bun.lock`, reinstall from scratch, and report which packages
 * changed. Prints its report through the injected loggers and returns the
 * outcome instead of exiting — the caller decides the exit code.
 *
 * @throws If the lockfile cannot be read, deleted, or restored, or if the
 * default installer cannot run `bun`.
 */
export async function refreshLockfile(
  options?: RefreshLockfileOptions,
): Promise<RefreshLockfileResult> {
  const rootDir = options?.rootDir ?? process.cwd();
  // eslint-disable-next-line no-console
  const log = options?.log ?? console.log;
  // eslint-disable-next-line no-console
  const logError = options?.logError ?? console.error;
  const install = options?.install ?? (() => bunInstall(rootDir));

  const lockPath = path.join(rootDir, 'bun.lock');
  let previousText: string;

  try {
    previousText = await fs.readFile(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const problem = `No lockfile found at ${lockPath}. Run \`bun install\` first.`;
      logError(problem);

      return {
        success: false,
        problems: [problem],
        changed: [],
        added: [],
        removed: [],
        restored: false,
      };
    }

    throw error;
  }

  const before = readResolved(previousText);

  log('Removing bun.lock and resolving from scratch...\n');
  await fs.unlink(lockPath);

  let didInstall: boolean;

  try {
    didInstall = await install();
  } catch (error) {
    // Put the old lockfile back before rethrowing, so an installer that blew
    // up (rather than merely failing to resolve) doesn't leave the repo
    // without a lockfile either.
    await fs.writeFile(lockPath, previousText);
    throw error;
  }

  if (!didInstall) {
    await fs.writeFile(lockPath, previousText);

    const problem = 'Install failed — restored the previous bun.lock.';
    logError(`\n${problem}`);

    return {
      success: false,
      problems: [problem],
      changed: [],
      added: [],
      removed: [],
      restored: true,
    };
  }

  // A successful install that wrote no lockfile leaves the repo without one,
  // which is the exact state the restore path exists to prevent — so treat it
  // the same way rather than reporting every package as removed.
  let afterText: string;

  try {
    afterText = await fs.readFile(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.writeFile(lockPath, previousText);

      const problem =
        'The install wrote no bun.lock — restored the previous one.';
      logError(`\n${problem}`);

      return {
        success: false,
        problems: [problem],
        changed: [],
        added: [],
        removed: [],
        restored: true,
      };
    }

    throw error;
  }

  const after = readResolved(afterText);

  const changed: LockfileChange[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  // Diff the two snapshots by lockfile KEY, not by package name. The key is
  // the identity of an entry ("minimatch" for the top-level copy, "a/b/
  // minimatch" for a transitive one resolved separately), so keying on it
  // keeps two copies of the same package as the two independent entries they
  // are. Keying on name would collapse them and report a phantom change
  // whenever their versions differ.
  //
  // Walking `after` finds everything that exists now: a key with no `before`
  // entry is newly added, and one whose spec changed is an upgrade or
  // downgrade. Only `after` is walked here, so removals are invisible to this
  // loop by construction.
  for (const [key, spec] of after) {
    const old = before.get(key);

    if (old === undefined) {
      added.push(spec);
    } else if (old !== spec) {
      // Both specs are "name@version" for the same key, so the name is shared
      // and only the versions differ. Report it as one name with two versions
      // rather than two opaque specs.
      changed.push({
        name: splitSpec(spec).name,
        from: splitSpec(old).version,
        to: splitSpec(spec).version,
      });
    }
  }

  // The mirror pass: anything in `before` with no `after` entry dropped out of
  // the tree entirely. This needs its own loop precisely because the loop
  // above can only see keys that still exist.
  for (const [key, spec] of before) {
    if (!after.has(key)) {
      removed.push(spec);
    }
  }

  log('');

  if (changed.length === 0 && added.length === 0 && removed.length === 0) {
    log('Lockfile regenerated with no resolution changes.');
  } else {
    const sections: Array<[string, string[]]> = [
      [
        'Changed',
        changed.map((entry) => `  ~ ${entry.name} ${entry.from} → ${entry.to}`),
      ],
      ['Added', added.map((spec) => `  + ${spec}`)],
      ['Removed', removed.map((spec) => `  - ${spec}`)],
    ];

    for (const [label, lines] of sections) {
      if (lines.length > 0) {
        log(`${label} (${lines.length}):`);
        log([...lines].sort().join('\n'));
        log('');
      }
    }

    log(
      'Review the diff before committing — a fresh resolve picks up every ' +
        'in-range update, not just the one you were after.',
    );
  }

  return {
    success: true,
    problems: [],
    changed,
    added,
    removed,
    restored: false,
  };
}
