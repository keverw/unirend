import { join } from 'path';
import { cleanCspell } from '../src/repo-tools';

// Reports custom words in cspell.json that no longer appear anywhere in the
// repo (invoked via cspell:clean, or cspell:clean:fix to remove them).
//
// Thin wrapper over the same cleanCspell() that scaffolded repos get via
// unirend/repo-tools — this repo runs the library version directly from
// src/ so our own cspell:clean runs exercise the exported logic. Anchored to
// the repo root (not process.cwd()) so it works no matter where it's invoked
// from.

const isFix =
  process.argv.includes('--write') || process.argv.includes('--fix');

try {
  const result = await cleanCspell({
    rootDir: join(import.meta.dirname, '..'),
    fix: isFix,
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Script failed with error:', error);
  process.exit(1);
}
