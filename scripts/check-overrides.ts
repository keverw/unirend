import { join } from 'path';
import { checkOverrides } from '../src/repo-tools';

// Fails on an override (or resolution) that looks applied but isn't (invoked
// via check:overrides, and chained into prepublishOnly).
//
// The cases it covers are deliberately not restated here — the scaffolded
// wrapper spells them out because a generated repo has no source to read, but
// this one sits next to the implementation. See the module docblock in
// src/lib/repo-tools/check-overrides.ts, which is the single place the bun
// behavior behind each case is documented and verified.
//
// Thin wrapper over the same checkOverrides() that scaffolded repos get via
// unirend/repo-tools — this repo runs the library version directly from src/
// so our own check:overrides runs exercise the exported logic. Anchored to the
// repo root (not process.cwd()) so it works no matter where it's invoked from.

// --verbose also prints what each surviving override is doing to the resolved
// tree. Off by default so the prepublishOnly output stays one line. A package
// deliberately downgraded around an upstream regression can be acknowledged
// with allowBackwardPins below.
const isVerbose = process.argv.includes('--verbose');

try {
  const result = await checkOverrides({
    rootDir: join(import.meta.dirname, '..'),
    verbose: isVerbose,
    // allowBackwardPins: ['package-with-an-intentional-downgrade'],
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to run overrides check:', error);
  process.exit(1);
}
