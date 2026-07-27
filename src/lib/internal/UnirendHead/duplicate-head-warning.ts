import { getDevMode } from 'lifecycleion/dev-mode';
import { getHeadKeyValue } from './head-keys';

/**
 * Development-only detection of the same head tag being emitted by two separate `UnirendHead`
 * instances.
 *
 * Metas and links accumulating across instances is intentional and documented, but a second
 * `description` or `canonical` is almost always a slip rather than an intent, and nothing tells
 * the author today. This is the cheap guard that makes the accumulate rule safe to rely on, in
 * the spirit of what StrictMode does for other easy-to-miss mistakes.
 *
 * What it deliberately does not warn about:
 *
 * - A child overriding an envelope field inside one instance. That is the documented feature,
 *   and it never produces two tags anyway — the envelope tag is not built at all.
 * - A duplicate `<title>`. Last-write-wins across instances is a designed pattern: a layout sets
 *   a default and a page overrides it.
 * - Keys that legitimately repeat, see `isRepeatableHeadKey()`.
 *
 * A warning that fires on correct code is one people learn to ignore, so avoiding false
 * positives matters more here than catching every case.
 */

/**
 * Whether the duplicate warning should run at all.
 *
 * `getDevMode()` reads the same dev-mode global the rest of Unirend uses, and defaults to false
 * when nothing set it, so a production bundle short-circuits before any scanning work happens.
 */
export function isDuplicateHeadWarningEnabled(): boolean {
  return getDevMode();
}

/**
 * Opt-out for the intentional cases the allowlist can't know about.
 *
 * `true` covers every key the instance emits; a string list covers named keys only, written the
 * way an author thinks of them (`'description'`, `'og:image'`, `'canonical'`) rather than in the
 * internal `attribute=value` form.
 */
export type DuplicateHeadAllowance = boolean | string[] | undefined;

/**
 * Meta identities that can legitimately appear more than once.
 *
 * OpenGraph explicitly allows repeating several of these: a page may offer more than one
 * `og:image` for a consumer to choose between, tag an article several times, and so on. The
 * `theme-color` entry is here for the standard light/dark pair, which differ only by `media`.
 */
const REPEATABLE_META_KEYS = new Set([
  'property=og:image',
  'property=og:video',
  'property=og:audio',
  'property=og:locale:alternate',
  'property=og:see_also',
  'property=article:tag',
  'property=article:author',
  'property=book:author',
  'property=book:tag',
  'name=theme-color',
]);

/**
 * The structured sub-properties that follow a repeatable OpenGraph object (`og:image:width`,
 * `og:video:type`, and so on) repeat right along with it.
 */
const REPEATABLE_META_KEY_PREFIXES = [
  'property=og:image:',
  'property=og:video:',
  'property=og:audio:',
];

/**
 * Link relations that must not repeat.
 *
 * Links are handled the other way round from metas on purpose. Most relations are repeatable by
 * nature — a page preloads several assets, ships several icon sizes, lists several `alternate`
 * language variants — so an allowlist of the repeatable ones would be long, incomplete, and a
 * steady source of false positives. Only a handful of relations describe the document once, and
 * those are the ones worth flagging.
 */
const SINGULAR_LINK_RELATIONS = new Set(['canonical', 'manifest', 'amphtml']);

/**
 * Whether a key repeating across instances is normal rather than a mistake.
 */
export function isRepeatableHeadKey(key: string): boolean {
  if (key.startsWith('rel=')) {
    return !SINGULAR_LINK_RELATIONS.has(getHeadKeyValue(key));
  }

  if (REPEATABLE_META_KEYS.has(key)) {
    return true;
  }

  return REPEATABLE_META_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Whether an instance's `allowDuplicate` prop covers a given key.
 */
export function isDuplicateAllowed(
  allowance: DuplicateHeadAllowance,
  key: string,
): boolean {
  if (allowance === true) {
    return true;
  }

  if (!Array.isArray(allowance)) {
    return false;
  }

  const value = getHeadKeyValue(key);

  return allowance.some(
    (entry) =>
      typeof entry === 'string' &&
      (entry.toLowerCase() === value || entry.toLowerCase() === key),
  );
}

/**
 * Whether two `allowDuplicate` values mean the same thing.
 *
 * Compared by value rather than by reference, which is the whole point: the list form is almost
 * always written inline (`allowDuplicate={['description']}`), so it is a brand new array on every
 * render. A reference check would call that a change every time and force a pointless DOM sync
 * per render for a prop that never actually moved.
 *
 * `false` and `undefined` both mean "no allowance", so they compare equal. Order matters within a
 * list, which costs nothing here: a reordered list is still the same allowance, and the only
 * consequence of reporting it changed is one extra idempotent sync.
 */
export function areAllowancesEqual(
  a: DuplicateHeadAllowance,
  b: DuplicateHeadAllowance,
): boolean {
  if (a === b) {
    return true;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((entry, index) => entry === b[index])
    );
  }

  // Neither is a list at this point, so both are booleans or absent.
  return !a === !b;
}

/**
 * A key already claimed by an earlier instance in the same render.
 */
interface SeenHeadKey {
  value: string;
  isAllowed: boolean;
  hasWarned: boolean;

  /**
   * Which instance claimed the key, so the record can tell one instance rendering twice from two
   * instances. Compared by identity only, so a caller passes whatever it already has that is
   * unique per instance and stable across a re-render.
   */
  owner: unknown;
}

/**
 * The running record of what earlier instances emitted. One per server render, rebuilt on each
 * client DOM sync.
 */
export type SeenHeadKeys = Map<string, SeenHeadKey>;

export interface DuplicateHeadKeyReport {
  key: string;
  firstValue: string;
  secondValue: string;
}

/**
 * Fold one instance's keys into the running record, returning what it collided with.
 *
 * `seen` is mutated, so instances are fed in one at a time as they render (server) or in
 * document order (client). A key is reported at most once per record even when three instances
 * declare it, since the first warning is the one that gets acted on.
 *
 * `owner` identifies the instance the keys came from. It matters because the record outlives a
 * single render pass on the server, where React may render a subtree more than once for one
 * request (a sibling suspending inside the same boundary replays it). Without it an instance would
 * collide with itself and the author would be told two instances declare a tag only one of them
 * has.
 */
export function collectDuplicateHeadKeys(
  seen: SeenHeadKeys,
  instanceKeys: Map<string, string>,
  allowance: DuplicateHeadAllowance,
  owner: unknown,
): DuplicateHeadKeyReport[] {
  const reports: DuplicateHeadKeyReport[] = [];

  for (const [key, value] of instanceKeys) {
    const isAllowed = isDuplicateAllowed(allowance, key);
    const previous = seen.get(key);

    if (previous === undefined) {
      seen.set(key, { value, isAllowed, hasWarned: false, owner });
      continue;
    }

    // The instance that claimed this key rendering again is not a second instance. Its latest
    // value replaces the one on record, and `hasWarned` stays as it was so a collision another
    // instance already caused is not reported a second time by the replay.
    if (previous.owner === owner) {
      previous.value = value;
      previous.isAllowed = previous.isAllowed || isAllowed;
      continue;
    }

    // Either side of the collision may have declared the repeat intentional, so the opt-out is
    // written once wherever it reads best rather than on every participating instance.
    if (
      previous.hasWarned ||
      previous.isAllowed ||
      isAllowed ||
      isRepeatableHeadKey(key)
    ) {
      previous.isAllowed = previous.isAllowed || isAllowed;
      continue;
    }

    previous.hasWarned = true;
    reports.push({ key, firstValue: previous.value, secondValue: value });
  }

  return reports;
}

/**
 * Render a report as the single console line (plus detail) the author sees.
 */
export function formatDuplicateHeadWarning(
  report: DuplicateHeadKeyReport,
): string {
  return [
    `[unirend] UnirendHead: two separate instances declare ${report.key}, so both tags are emitted.`,
    `  first:  ${JSON.stringify(report.firstValue)}`,
    `  second: ${JSON.stringify(report.secondValue)}`,
    '  Metas and links accumulate across UnirendHead instances (only <title> is last-write-wins).',
    '  Declare it in one place, or pass allowDuplicate to the instance that means it.',
    '  This warning only runs in development.',
  ].join('\n');
}

/**
 * Print the reports. Separate from collection so the client can filter out the ones it has
 * already shown before anything reaches the console.
 */
export function warnDuplicateHeadKeys(reports: DuplicateHeadKeyReport[]): void {
  for (const report of reports) {
    // eslint-disable-next-line no-console
    console.warn(formatDuplicateHeadWarning(report));
  }
}
