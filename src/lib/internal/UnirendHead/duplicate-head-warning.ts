import { getDevMode } from 'lifecycleion/dev-mode';
import { isRepeatableHeadKey } from './repeatable-head-keys';

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
 * A key already claimed by an earlier instance in the same render.
 */
interface SeenHeadKey {
  value: string;
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

  /**
   * The two instances the colliding tags came from, as the caller identified them. Carried so a
   * caller that dedupes across renders can tell one pair from another: replacing the page half of
   * a collision is a new mistake, while the layout half sitting there unchanged is not.
   */
  firstOwner: unknown;
  secondOwner: unknown;
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
  owner: unknown,
): DuplicateHeadKeyReport[] {
  const reports: DuplicateHeadKeyReport[] = [];

  for (const [key, value] of instanceKeys) {
    const previous = seen.get(key);

    if (previous === undefined) {
      seen.set(key, { value, hasWarned: false, owner });
      continue;
    }

    // The instance that claimed this key rendering again is not a second instance. Its latest
    // value replaces the one on record, and `hasWarned` stays as it was so a collision another
    // instance already caused is not reported a second time by the replay.
    if (previous.owner === owner) {
      previous.value = value;
      continue;
    }

    if (previous.hasWarned || isRepeatableHeadKey(key)) {
      continue;
    }

    previous.hasWarned = true;
    reports.push({
      key,
      firstValue: previous.value,
      secondValue: value,
      firstOwner: previous.owner,
      secondOwner: owner,
    });
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
    '  Declare it in one place, or call setRepeatableHeadKeys if this key is meant to repeat.',
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
