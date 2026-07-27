import { getDevMode } from 'lifecycleion/dev-mode';
import { getHeadKeyValue, SINGULAR_LINK_RELATIONS } from './head-keys';

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
 * Keys this app expects to repeat, on top of the built-in list below.
 *
 * Written once by `setRepeatableHeadKeys()` rather than declared on the instances that repeat a
 * key, because which key repeats is a fact about the key and not about any one component. An
 * opt-out attached to a component has to answer "which of the instances carries it", and past two
 * instances there is no answer that reads well: the allowance would have to go on all but one of
 * them, or one instance would be silencing a collision between two others it has nothing to do
 * with.
 */
let appRepeatableHeadKeys = new Set<string>();

/**
 * Declare the head keys this app expects to see more than once, so the duplicate warning treats
 * them the way it treats `og:image`.
 *
 * Replaces any previous list rather than adding to it, so calling it twice cannot leave an
 * allowance nobody can find. Keys are written the way an author thinks of them (`'description'`,
 * `'og:image'`, `'canonical'`), and the internal `attribute=value` form is accepted too.
 *
 * Not development-only, so name a key here because it really does repeat and not to quiet
 * something. The duplicate warning is the visible half and never runs in a production build, but
 * `isRepeatableHeadKey()` also decides which `meta.page.tags` entries survive a named
 * `PageMetadata` field producing the same key, and that runs in every build. So a key declared
 * here can change which tags a production page emits: a `tags` entry for it renders alongside the
 * field rather than losing to it, exactly as a built-in repeatable key does.
 *
 * It has no say over a child. A tag declared as a `UnirendHead` child replaces everything the
 * envelope contributed for its key whatever the key is, so this list cannot rescue an entry from
 * one. See `buildPageMetadataTags()`.
 *
 * If a key repeats for everyone rather than only for you, it belongs in the built-in list instead,
 * so that everyone gets it.
 */
export function setRepeatableHeadKeys(keys: string[]): void {
  appRepeatableHeadKeys = new Set(
    keys
      .filter((key) => typeof key === 'string')
      .map((key) => key.toLowerCase()),
  );
}

/**
 * Whether this app declared the key repeatable.
 */
function isAppRepeatableHeadKey(key: string): boolean {
  if (appRepeatableHeadKeys.size === 0) {
    return false;
  }

  return (
    appRepeatableHeadKeys.has(key) ||
    appRepeatableHeadKeys.has(getHeadKeyValue(key))
  );
}

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
 * Whether a key repeating across instances is normal rather than a mistake.
 */
export function isRepeatableHeadKey(key: string): boolean {
  // The app's own list first, so it can name a key the built-in rules would otherwise flag.
  if (isAppRepeatableHeadKey(key)) {
    return true;
  }

  if (key.startsWith('rel=')) {
    return !SINGULAR_LINK_RELATIONS.has(getHeadKeyValue(key));
  }

  if (REPEATABLE_META_KEYS.has(key)) {
    return true;
  }

  return REPEATABLE_META_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
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
