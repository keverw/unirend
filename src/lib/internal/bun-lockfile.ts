/**
 * Minimal reader for `bun.lock`, shared by the repo tools.
 *
 * `bun.lock` is JSONC: bun writes trailing commas, so the file as a whole
 * cannot be `JSON.parse`d. It is line-oriented though, with one package per
 * line in a stable shape:
 *
 *     "eslint": ["eslint@9.39.5", "", { "dependencies": { ... } }, "sha512-..."],
 *
 * so each entry's array is itself valid JSON and can be parsed on its own.
 * That is more robust than pattern-matching the fields out of the text, and it
 * yields the declared dependency ranges as real data rather than strings to
 * re-parse.
 *
 * The map key is not always the package name: a transitive copy resolved
 * separately from the top-level one is keyed by its path ("a/b/minimatch"),
 * which is why {@link BunLockEntry} carries both.
 */

/** One resolved package in the lockfile. */
export interface BunLockEntry {
  /** Lockfile key: the package name, or a path like "a/b/minimatch". */
  key: string;
  /** Resolved "name@version" spec, exactly as written in the lockfile. */
  spec: string;
  /** Package name, split out of {@link spec}. */
  name: string;
  /** Resolved version, split out of {@link spec}. */
  version: string;
  /**
   * Ranges this package declares for its own dependencies, by dependency
   * name. Covers `dependencies`, `optionalDependencies`, and the non-optional
   * half of `peerDependencies`, all of which bun actually installs.
   *
   * Peers count because bun auto-installs them, which makes a peer range a
   * live constraint rather than a wish (verified against bun 1.3.14: a
   * `react-dom@19` declaring peer `react` alongside an override pinning
   * `react` to 18.2.0 installed 18.2.0 without a word). Peers listed in the
   * entry's `optionalPeers` array are excluded, since those are the ones
   * genuinely allowed to go unsatisfied, and bun names them explicitly rather
   * than leaving it to be inferred.
   */
  dependencies: Record<string, string>;
}

/**
 * Match one lockfile entry line, capturing its key and its JSON array. The
 * trailing comma is left outside the capture so the array parses cleanly.
 *
 * Anchored to a line that opens AND closes its array, which excludes the
 * workspace block at the top of the file (`"": {`) and the plain
 * `"name": "range"` lines inside it, none of which are package entries.
 */
const ENTRY_LINE = /^\s+"(.*?)": (\[.*\]),?$/gm;

/**
 * One workspace declared in the lockfile's `workspaces` block: the root
 * package itself, plus any others in a monorepo.
 */
export interface BunLockWorkspace {
  /** Workspace path key. Empty string for the root package. */
  key: string;
  /**
   * The workspace's package name. Empty when package.json has no `name`, which
   * bun reflects by omitting the field from the lockfile entirely (verified).
   */
  name: string;
  /**
   * Ranges this workspace declares, by dependency name. Covers
   * `dependencies`, `devDependencies`, `optionalDependencies`, and
   * `peerDependencies`. Unlike a resolved package, a workspace's dev
   * dependencies ARE installed and are a real declared requirement, so they
   * count here.
   *
   * Peers matter most here, since a library declares what it supports through
   * them: this package itself declares `react: "^19.0.0"`, so an override
   * forcing react below 19 would make the package uninstallable as declared
   * while every other signal stayed quiet. Bun does not write an
   * `optionalPeers` array for workspaces (verified), so there is nothing to
   * exclude on this side.
   */
  dependencies: Record<string, string>;
}

/**
 * Remove JSONC trailing commas so the text can be `JSON.parse`d.
 *
 * Deliberately string-aware rather than a plain `/,(\s*[}\]])/g` replace. A
 * blind regex would also rewrite a comma that happens to sit inside a string
 * value, silently corrupting the data into something that still parses, which
 * is a worse failure than not parsing at all.
 */
function stripTrailingCommas(text: string): string {
  const spans: string[] = [];
  let spanStart = 0;
  let isInString = false;
  let isEscaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (isInString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        isInString = false;
      }

      continue;
    }

    if (char === '"') {
      isInString = true;
      continue;
    }

    // Outside a string: drop a comma whose next non-whitespace character
    // closes the object or array it sits in.
    if (char === ',') {
      let nextIndex = index + 1;
      let nextChar = text[nextIndex];

      while (
        nextChar === ' ' ||
        nextChar === '\t' ||
        nextChar === '\n' ||
        nextChar === '\r'
      ) {
        nextIndex++;
        nextChar = text[nextIndex];
      }

      if (nextChar === '}' || nextChar === ']') {
        spans.push(text.slice(spanStart, index));
        spanStart = index + 1;
        continue;
      }
    }
  }

  if (spans.length === 0) {
    return text;
  }

  spans.push(text.slice(spanStart));
  return spans.join('');
}

/**
 * Parse the `workspaces` block, which {@link parseBunLockfile} does not cover.
 *
 * That block records the ranges the repo itself declares, and they are real
 * requirements: an override forcing a DIRECT dependency below the range in
 * your own `package.json` is invisible without them (verified — with the root
 * declaring `semver: "^7.8.0"` and an override pinning `7.3.0`, bun installs
 * 7.3.0 silently and nothing in the `packages` block records that range).
 *
 * Unlike the package entries this block spans multiple lines, so the
 * line-oriented reader cannot see it. It is parsed by stripping the trailing
 * commas from the whole file and `JSON.parse`-ing that. Any failure yields an
 * empty list rather than throwing, keeping the same posture as the rest of
 * this module: a future lockfile shape should degrade to reporting less, never
 * crash a build.
 */
export function parseBunLockfileWorkspaces(
  lockText: string,
): BunLockWorkspace[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripTrailingCommas(lockText));
  } catch {
    return [];
  }

  const block = (parsed as { workspaces?: unknown } | null)?.workspaces;

  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    return [];
  }

  const workspaces: BunLockWorkspace[] = [];

  for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    const entry = value as Record<string, unknown>;
    const dependencies: Record<string, string> = {};

    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const) {
      const ranges = entry[field];

      if (
        ranges === null ||
        typeof ranges !== 'object' ||
        Array.isArray(ranges)
      ) {
        continue;
      }

      for (const [depName, range] of Object.entries(
        ranges as Record<string, unknown>,
      )) {
        // An installed range wins over a peer range on the same name, matching
        // parseBunLockfile above. Declaring both is normal for a library that
        // develops against what it supports: this package has react as a
        // devDependency at "^19.2.7" and a peer at "^19.0.0". The installed
        // one is stricter and is what actually has to hold, so letting the
        // peer overwrite it would accept an override to 19.1.0 that breaks the
        // build.
        if (field === 'peerDependencies' && depName in dependencies) {
          continue;
        }

        if (typeof range === 'string') {
          dependencies[depName] = range;
        }
      }
    }

    workspaces.push({
      key,
      name: typeof entry.name === 'string' ? entry.name : key,
      dependencies,
    });
  }

  return workspaces;
}

/** Split "name@version" (or "@scope/name@version") into its two halves. */
export function splitSpec(spec: string): { name: string; version: string } {
  const at = spec.lastIndexOf('@');

  return at > 0
    ? { name: spec.slice(0, at), version: spec.slice(at + 1) }
    : { name: spec, version: '' };
}

/**
 * Parse every package entry out of a `bun.lock` file's text.
 *
 * Malformed or unexpected entries are skipped rather than thrown on: this
 * backs advisory checks, and a lockfile shape that changes in a future bun
 * release should degrade to reporting less, never to crashing a build.
 */
export function parseBunLockfile(lockText: string): BunLockEntry[] {
  const entries: BunLockEntry[] = [];

  // exec-based iteration over a /g regex, reset first so a module-level
  // pattern can't carry lastIndex across calls.
  ENTRY_LINE.lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = ENTRY_LINE.exec(lockText)) !== null) {
    const [, key, arrayText] = match;

    let parsed: unknown;

    try {
      parsed = JSON.parse(arrayText);
    } catch {
      continue;
    }

    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') {
      continue;
    }

    const spec = parsed[0];
    const { name, version } = splitSpec(spec);

    if (name === '' || version === '') {
      continue;
    }

    // The metadata object is conventionally at index 2, but take the first
    // object element instead of trusting the position, so a lockfile that
    // grows or reorders fields still yields the dependency ranges.
    const metadata = parsed.find(
      (element): element is Record<string, unknown> =>
        element !== null &&
        typeof element === 'object' &&
        !Array.isArray(element),
    );

    const dependencies: Record<string, string> = {};

    // Peers bun is explicitly told may go unsatisfied. Everything else in
    // `peerDependencies` gets auto-installed and is a real constraint.
    const rawOptionalPeers = metadata?.optionalPeers;
    const optionalPeers = new Set(
      Array.isArray(rawOptionalPeers)
        ? rawOptionalPeers.filter(
            (peer): peer is string => typeof peer === 'string',
          )
        : [],
    );

    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const) {
      const block = metadata?.[field];

      if (block === null || typeof block !== 'object' || Array.isArray(block)) {
        continue;
      }

      for (const [depName, range] of Object.entries(
        block as Record<string, unknown>,
      )) {
        if (field === 'peerDependencies' && optionalPeers.has(depName)) {
          continue;
        }

        // A real dependency wins over a peer range on the same name: bun
        // installs the former, so it is the binding one.
        if (field === 'peerDependencies' && depName in dependencies) {
          continue;
        }

        if (typeof range === 'string') {
          dependencies[depName] = range;
        }
      }
    }

    entries.push({ key, spec, name, version, dependencies });
  }

  return entries;
}
