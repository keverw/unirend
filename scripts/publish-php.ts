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
 *   bun run publish-php
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
      `\nPublish ${tag} to ${MIRROR_REPO}?\nThis will commit, tag, and push. (y/N) `,
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
