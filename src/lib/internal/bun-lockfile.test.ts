import { describe, expect, test } from 'bun:test';
import {
  parseBunLockfile,
  parseBunLockfileWorkspaces,
  splitSpec,
} from './bun-lockfile';

// ---------------------------------------------------------------------------
// The shared bun.lock reader, backing checkOverrides() and refreshLockfile().
//
// NOTHING HERE RUNS BUN. Every fixture is literal lockfile text, written with
// the trailing commas bun really emits, since those are the whole reason the
// file cannot simply be JSON.parse-d.
//
// The shapes below were taken from lockfiles bun 1.3.14 actually produced.
// ---------------------------------------------------------------------------

/**
 * A lockfile with both blocks, shaped like the real thing: `workspaces` holds
 * what the repo itself declares, `packages` holds what got resolved.
 */
const LOCKFILE = `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "demo",
      "dependencies": {
        "semver": "^7.8.0",
      },
      "devDependencies": {
        "typescript": "^5.0.0",
      },
    },
  },
  "packages": {
    "minimatch": ["minimatch@10.2.5", "", { "dependencies": { "brace-expansion": "^5.0.5" } }, "sha512-abc"],

    "brace-expansion": ["brace-expansion@5.0.7", "", {}, "sha512-def"],
  }
}
`;

describe('parseBunLockfile', () => {
  test('reads each resolved package and its declared ranges', () => {
    const entries = parseBunLockfile(LOCKFILE);

    expect(entries).toEqual([
      {
        key: 'minimatch',
        spec: 'minimatch@10.2.5',
        name: 'minimatch',
        version: '10.2.5',
        dependencies: { 'brace-expansion': '^5.0.5' },
      },
      {
        key: 'brace-expansion',
        spec: 'brace-expansion@5.0.7',
        name: 'brace-expansion',
        version: '5.0.7',
        dependencies: {},
      },
    ]);
  });

  test('keeps key and name apart for a nested copy', () => {
    // A transitive copy resolved separately is keyed by its path, so the key
    // is not the package name and both have to be carried.
    const entries = parseBunLockfile(`{
  "packages": {
    "a/b/minimatch": ["minimatch@9.0.9", "", {}, "sha512-abc"],
  }
}
`);

    expect(entries[0].key).toBe('a/b/minimatch');
    expect(entries[0].name).toBe('minimatch');
    expect(entries[0].version).toBe('9.0.9');
  });

  test('skips a malformed entry rather than throwing', () => {
    // This backs advisory checks, so an unfamiliar shape must degrade to
    // reporting less, never crash a build.
    const entries = parseBunLockfile(`{
  "packages": {
    "broken": ["not-a-spec-without-version", "", {}, "sha512-abc"],
    "fine": ["left-pad@1.3.0", "", {}, "sha512-abc"],
  }
}
`);

    expect(entries.map((entry) => entry.name)).toEqual(['left-pad']);
  });

  test('excludes peerDependencies but includes optionalDependencies', () => {
    // Peers are routinely and deliberately left unsatisfied, so counting them
    // as declared requirements would produce noise rather than findings.
    const entries = parseBunLockfile(`{
  "packages": {
    "pkg": ["pkg@1.0.0", "", { "dependencies": { "a": "^1.0.0" }, "optionalDependencies": { "b": "^2.0.0" }, "peerDependencies": { "c": "^3.0.0" } }, "sha512-abc"],
  }
}
`);

    expect(entries[0].dependencies).toEqual({ a: '^1.0.0', b: '^2.0.0' });
  });
});

describe('parseBunLockfileWorkspaces', () => {
  test('reads the root package declarations, including devDependencies', () => {
    // The root lives under the "" key. Its dev dependencies ARE installed, so
    // unlike a resolved package's peers they are a real declared requirement.
    expect(parseBunLockfileWorkspaces(LOCKFILE)).toEqual([
      {
        key: '',
        name: 'demo',
        dependencies: { semver: '^7.8.0', typescript: '^5.0.0' },
      },
    ]);
  });

  test('reads a monorepo with several workspaces', () => {
    const workspaces = parseBunLockfileWorkspaces(`{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "root",
      "dependencies": { "semver": "^7.8.0" },
    },
    "packages/app": {
      "name": "@demo/app",
      "dependencies": { "left-pad": "^1.3.0" },
    },
  },
  "packages": {}
}
`);

    expect(workspaces).toEqual([
      { key: '', name: 'root', dependencies: { semver: '^7.8.0' } },
      {
        key: 'packages/app',
        name: '@demo/app',
        dependencies: { 'left-pad': '^1.3.0' },
      },
    ]);
  });

  test('reports an empty name when package.json has none', () => {
    // Verified against bun 1.3.14: a package.json without a `name` produces a
    // workspaces entry with no `name` field at all. The label built from this
    // drops the name rather than rendering a stray leading space.
    expect(
      parseBunLockfileWorkspaces(`{
  "workspaces": {
    "": {
      "dependencies": { "semver": "^7.8.0" },
    },
  }
}
`),
    ).toEqual([{ key: '', name: '', dependencies: { semver: '^7.8.0' } }]);
  });

  test('returns nothing when there is no workspaces block', () => {
    expect(
      parseBunLockfileWorkspaces('{ "lockfileVersion": 1, "packages": {} }'),
    ).toEqual([]);
  });

  test('returns nothing rather than throwing on unparseable text', () => {
    // Same posture as the package reader: degrade to reporting less.
    expect(parseBunLockfileWorkspaces('{ not json at all')).toEqual([]);
  });

  test('does not corrupt a comma that sits inside a string value', () => {
    // The trailing-comma stripper is string-aware on purpose. A blind
    // /,(\\s*[}\\]])/ replace would rewrite the comma inside this range and
    // silently produce data that still parses, which is worse than not
    // parsing at all.
    const workspaces = parseBunLockfileWorkspaces(`{
  "workspaces": {
    "": {
      "name": "demo",
      "dependencies": {
        "weird": ">=1.0.0, <2.0.0",
      },
    },
  }
}
`);

    expect(workspaces[0].dependencies.weird).toBe('>=1.0.0, <2.0.0');
  });
});

describe('splitSpec', () => {
  test('splits a plain and a scoped spec', () => {
    expect(splitSpec('left-pad@1.3.0')).toEqual({
      name: 'left-pad',
      version: '1.3.0',
    });

    // The leading "@" is the scope marker, so only the last one splits.
    expect(splitSpec('@scope/pkg@1.2.3')).toEqual({
      name: '@scope/pkg',
      version: '1.2.3',
    });
  });

  test('reports an empty version when there is no "@" to split on', () => {
    expect(splitSpec('left-pad')).toEqual({ name: 'left-pad', version: '' });
  });
});
