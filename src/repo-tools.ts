// Repo maintenance tools backing the scripts scaffolded into generated repos.
// The generated `scripts/check-public-assets.ts`, `scripts/clean-cspell.ts`,
// `scripts/check-overrides.ts`, and `scripts/refresh-lockfile.ts` are thin
// wrappers over these functions, so repos pick up fixes by upgrading unirend
// instead of re-scaffolding a frozen script. Each function acts as a main — it
// prints its own report and returns a result — and the wrapper turns that
// result into an exit code.

export {
  checkPublicAssets,
  type CheckPublicAssetsOptions,
  type CheckPublicAssetsResult,
} from './lib/repo-tools/check-public-assets';

export {
  cleanCspell,
  type CleanCspellOptions,
  type CleanCspellResult,
} from './lib/repo-tools/clean-cspell';

export {
  checkOverrides,
  type CheckOverridesOptions,
  type CheckOverridesResult,
  type OverrideTarget,
  type BackwardPin,
  type UnappliedPin,
} from './lib/repo-tools/check-overrides';

export {
  checkNullBytes,
  type CheckNullBytesOptions,
  type CheckNullBytesResult,
} from './lib/repo-tools/check-null-bytes';

export {
  refreshLockfile,
  type RefreshLockfileOptions,
  type RefreshLockfileResult,
  type LockfileChange,
} from './lib/repo-tools/refresh-lockfile';
