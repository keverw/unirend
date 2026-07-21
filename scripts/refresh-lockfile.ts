import { join } from 'path';
import { refreshLockfile } from '../src/repo-tools';

// Deletes bun.lock, resolves it from scratch, and reports exactly which
// packages changed (invoked via install:fresh). Deliberately not part of
// prepublishOnly — it mutates the lockfile.
//
// Thin wrapper over the same refreshLockfile() that scaffolded repos get via
// unirend/repo-tools — this repo runs the library version directly from src/
// so our own install:fresh runs exercise the exported logic. Anchored to the
// repo root (not process.cwd()) so it works no matter where it's invoked from.

try {
  const result = await refreshLockfile({
    rootDir: join(import.meta.dirname, '..'),
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to refresh the lockfile:', error);
  process.exit(1);
}
