import { join } from 'path';
import { checkNullBytes } from '../src/repo-tools';

// Fails when a file that should be plain text contains a NUL (0x00) byte
// (invoked via check:null-bytes, and chained into prepublishOnly). See the
// module docblock in src/lib/repo-tools/check-null-bytes.ts for why a stray
// NUL is worth failing a build over.
//
// Thin wrapper over the same checkNullBytes() that scaffolded repos get via
// unirend/repo-tools — this repo runs the library version directly from src/
// so our own check:null-bytes runs exercise the exported logic. Anchored to
// the repo root (not process.cwd()) so it works no matter where it's invoked
// from.

try {
  const result = await checkNullBytes({
    rootDir: join(import.meta.dirname, '..'),
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to run null-byte check:', error);
  process.exit(1);
}
