/**
 * Publish unirend/php-static-server to its mirror GitHub repo.
 *
 * Source of truth: unirend-php/ in this monorepo (https://github.com/keverw/unirend)
 * Mirror repo:     https://github.com/keverw/unirend-php  (Packagist reads from here)
 *
 * What this script does:
 *   1. Reads the version from unirend-php/version.json
 *   2. Prompts for confirmation
 *   3. Updates the version line in the source unirend-php/README.md
 *   4. Clones the mirror repo to a temp directory
 *   5. Syncs files from unirend-php/ (excludes vendor/, demo/, version.json, etc.) and writes a .gitignore
 *   6. Commits "Release vX.Y.Z", tags vX.Y.Z, pushes branch + tag
 *   7. Cleans up the temp directory
 *
 * Packagist auto-updates on push via webhook — no manual step needed.
 *
 * Usage:
 *   bun run php-publish
 */

import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { $ } from 'bun';
import * as readline from 'readline';
import { createTempDir } from 'lifecycleion/tmp-dir';

const MIRROR_REPO = 'git@github.com:keverw/unirend-php.git';

const projectRoot = join(import.meta.dir, '..');
const phpDir = join(projectRoot, 'unirend-php');
const versionFile = join(phpDir, 'version.json');

interface GitIdentity {
  name: string;
  email: string;
}

async function readGitConfigValue(
  scope: '--local' | '--global',
  key: 'user.name' | 'user.email',
): Promise<string | undefined> {
  const result = await $`git -C ${projectRoot} config ${scope} ${key}`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    return undefined;
  }

  const value = String(result.stdout ?? '').trim();
  return value || undefined;
}

async function resolveGitIdentity(): Promise<GitIdentity> {
  // Prefer the identity configured for this monorepo so publish commits
  // match the author's normal local setup for unirend. Fall back to global
  // git config if local values are not set.
  const localName = await readGitConfigValue('--local', 'user.name');
  const localEmail = await readGitConfigValue('--local', 'user.email');
  const globalName = await readGitConfigValue('--global', 'user.name');
  const globalEmail = await readGitConfigValue('--global', 'user.email');

  const name = localName || globalName;
  const email = localEmail || globalEmail;

  if (!name || !email) {
    console.error('❌ Missing git author identity for publish commit');
    console.error(
      '   Set local config in this repo (preferred): git config user.name "<name>" && git config user.email "<email>"',
    );
    console.error(
      '   Or set global config: git config --global user.name "<name>" && git config --global user.email "<email>"',
    );
    process.exit(1);
  }

  return { name, email };
}

// ── Read version ─────────────────────────────────────────────────────────────

if (!existsSync(versionFile)) {
  console.error('❌ unirend-php/version.json not found');
  process.exit(1);
}

const versionData = JSON.parse(readFileSync(versionFile, 'utf-8')) as {
  version?: string;
};

const version = versionData.version;

if (!version || typeof version !== 'string') {
  console.error('❌ "version" field missing in unirend-php/version.json');
  process.exit(1);
}

const tag = `v${version}`;

// ── Preflight checks ─────────────────────────────────────────────────────────

// 1) Local tooling required by this script.
const gitCheck = await $`which git`.quiet().nothrow();

if (gitCheck.exitCode !== 0) {
  console.error('❌ git is not installed or not in PATH');
  process.exit(1);
}

const rsyncCheck = await $`which rsync`.quiet().nothrow();

if (rsyncCheck.exitCode !== 0) {
  console.error('❌ rsync is not installed or not in PATH');
  process.exit(1);
}

// 2) Mirror connectivity + auth check (same transport used for clone/push).
const mirrorReadCheck = await $`git ls-remote ${MIRROR_REPO}`.quiet().nothrow();

if (mirrorReadCheck.exitCode !== 0) {
  const readError = String(mirrorReadCheck.stderr ?? '').trim();
  console.error(`❌ Cannot access mirror repo: ${MIRROR_REPO}`);

  if (readError) {
    console.error(`   ${readError}`);
  }

  console.error('   Ensure this machine can authenticate to GitHub over SSH.');
  console.error('   Quick setup (one-time):');
  console.error(
    '   1) Check for a key: ls -la ~/.ssh && ls ~/.ssh/id_ed25519.pub',
  );
  console.error(
    '   2) If missing, create one: ssh-keygen -t ed25519 -C "you@example.com"',
  );
  console.error(
    '      (This writes ~/.ssh/id_ed25519 + ~/.ssh/id_ed25519.pub; it does not auto-load the key.)',
  );
  console.error('   3) Start agent in this shell: eval "$(ssh-agent -s)"');
  console.error(
    '      (eval applies SSH_AUTH_SOCK from ssh-agent so ssh-add can talk to it.)',
  );
  console.error(
    '   4) First-time setup (unless your key is auto-loaded): ssh-add ~/.ssh/id_ed25519',
  );
  console.error(
    '   5) Copy public key (macOS): pbcopy < ~/.ssh/id_ed25519.pub',
  );
  console.error(
    '      Linux: cat ~/.ssh/id_ed25519.pub (or xclip/wl-copy if installed)',
  );
  console.error(
    '   6) Add key in GitHub: Settings > SSH and GPG keys > New SSH key',
  );
  console.error('   7) Verify auth: ssh -T git@github.com');
  console.error(
    '      (ssh-add -l is optional diagnostics; it may be empty if your SSH config/keychain provides the key directly.)',
  );
  console.error(
    `   8) Verify repo access directly: git ls-remote ${MIRROR_REPO}`,
  );
  process.exit(1);
}

// 3) Release safety check: do not reuse an existing tag.
const existingTagCheck =
  await $`git ls-remote --tags ${MIRROR_REPO} ${`refs/tags/${tag}`}`
    .quiet()
    .nothrow();

const existingTagRef = String(existingTagCheck.stdout ?? '').trim();

if (existingTagRef) {
  console.error(`❌ Remote tag ${tag} already exists in mirror repo.`);
  console.error(
    `   Bump unirend-php/version.json (current: ${version}) before publishing again.`,
  );

  process.exit(1);
}

// 4) Resolve commit author identity before confirmation.
const publishGitIdentity = await resolveGitIdentity();
const publishCommitAuthor = `${publishGitIdentity.name} <${publishGitIdentity.email}>`;

// ── Confirm ───────────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let answer: string;

try {
  answer = await new Promise<string>((resolve, reject) => {
    rl.once('close', () =>
      reject(new Error('Input stream closed unexpectedly')),
    );

    rl.question(
      `\nPublish ${tag} to ${MIRROR_REPO}?\nCommit author: ${publishCommitAuthor}\nThis will commit, tag, and push. (y/N) `,
      resolve,
    );
  });
} finally {
  rl.close();
}

if (answer.trim().toLowerCase() !== 'y') {
  console.log('Aborted.');
  process.exit(0);
}

// ── Update source README version ─────────────────────────────────────────────

const sourceReadmePath = join(phpDir, 'README.md');
if (existsSync(sourceReadmePath)) {
  const readme = readFileSync(sourceReadmePath, 'utf-8');
  const updated = readme.replace(
    /\*\*Current version:\*\* `[^`]+`/,
    `**Current version:** \`${version}\``,
  );

  if (updated !== readme) {
    writeFileSync(sourceReadmePath, updated, 'utf-8');
    console.log(`Updated source README version to ${version}`);
  }
}

// ── Clone → sync → commit → tag → push ──────────────────────────────────────

const tmpDir = await createTempDir({
  prefix: 'unirend-php-publish-',
  unsafeCleanup: true,
});

try {
  console.log(`\nCloning ${MIRROR_REPO}...`);
  await $`git clone ${MIRROR_REPO} ${tmpDir.path}`;
  // Mirror repo is cloned into a temp dir with its own git config. Explicitly
  // set author identity there so release commits use the same identity resolved
  // from the monorepo context above.
  await $`git -C ${tmpDir.path} config user.name ${publishGitIdentity.name}`;
  await $`git -C ${tmpDir.path} config user.email ${publishGitIdentity.email}`;

  console.log('\nSyncing files...');

  // Sync everything except dev-only files that don't belong in the published package.
  await $`rsync -a --delete \
    --exclude=.git \
    --exclude=vendor \
    --exclude=.phpunit.cache \
    --exclude=.phpunit.result.cache \
    --exclude=composer.lock \
    --exclude=version.json \
    --exclude=demo \
    ${phpDir}/ ${tmpDir.path}/`;

  // Write a .gitignore for the mirror repo (not kept in the monorepo since it would
  // be redundant — the monorepo root .gitignore already covers these paths).
  const mirrorGitignore =
    [
      'vendor/',
      '.phpunit.cache/',
      '.phpunit.result.cache',
      'composer.lock',
    ].join('\n') + '\n';

  writeFileSync(join(tmpDir.path, '.gitignore'), mirrorGitignore, 'utf-8');

  // Stage all changes (new, modified, deleted files).
  await $`git -C ${tmpDir.path} add -A`;

  // --porcelain gives machine-readable output — one line per changed file.
  // If it's empty, nothing changed and there's nothing to publish.
  const status = await $`git -C ${tmpDir.path} status --porcelain`.text();

  if (status.trim() === '') {
    console.log('\nℹ️  No changes to publish — mirror is already up to date.');
    process.exit(0);
  }

  console.log('\nCommitting...');
  await $`git -C ${tmpDir.path} commit -m ${'Release ' + tag}`;
  await $`git -C ${tmpDir.path} tag ${tag}`;

  console.log('\nPushing...');
  await $`git -C ${tmpDir.path} push origin HEAD`;
  await $`git -C ${tmpDir.path} push origin ${tag}`;

  console.log(`\n✅ Published ${tag} successfully!`);
  console.log(
    '   Packagist will update automatically via webhook within a minute.',
  );
  console.log('   https://packagist.org/packages/unirend/php-static-server');
} catch (error) {
  console.error('\n❌ Publish failed:', error);
  process.exit(1);
} finally {
  await tmpDir.cleanup();
}
