import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

// A placeholder LICENSE that matches the generated package.json defaults
// ("private": true, "license": "UNLICENSED"). It reserves all rights for now
// and reminds the maintainer to choose a real license before publishing. It
// deliberately does not grant an open-source license, since that would
// contradict a private workspace.
const fileSrc = `UNLICENSED

Copyright (c) [year] [copyright holder]

All rights reserved.

This workspace was scaffolded with unirend and is private by default: its
package.json is marked "private": true with "license": "UNLICENSED", so no
license to use, copy, modify, or distribute this software is granted.

Before you make this repository public or share it outside your team, choose a real license:

  1. Pick an SPDX license, for example MIT or Apache-2.0: https://spdx.org/licenses/
  2. Replace the text in this file with that license.
  3. Update the "license" field in package.json (and drop "private": true if you publish it to npm).

If this repo stays private, you can leave this file as-is.
`;

/**
 * Ensure a LICENSE file exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites, so a user's own
 * LICENSE is always left intact. `hasLicense` is the caller's single scan of the
 * repo root (true when any license variant is present: `LICENSE`, `LICENSE.md`,
 * `LICENSE.txt`, any case), so we never add a second conflicting LICENSE.
 * @throws {Error} If file creation fails
 */
export async function ensureLicense(
  repoRoot: FileRoot,
  hasLicense: boolean,
  log?: LoggerFunction,
): Promise<void> {
  if (hasLicense) {
    return;
  }

  try {
    const didWrite = await vfsWriteIfNotExists(repoRoot, 'LICENSE', fileSrc);

    if (didWrite && log) {
      log('info', 'Created repo root LICENSE');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure LICENSE: ${errorMessage}`);
  }
}
