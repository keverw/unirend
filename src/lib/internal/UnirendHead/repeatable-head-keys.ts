import { getHeadKeyValue, SINGULAR_LINK_RELATIONS } from './head-keys';

/**
 * Which head keys may legitimately appear more than once.
 *
 * A module of its own rather than part of the duplicate warning, which is where this began and
 * where it does not belong, because two callers with different lifetimes ask it:
 *
 * - The duplicate warning, in development only, to decide whether two instances emitting one key
 *   is worth saying anything about.
 * - `buildPageMetadataTags()`, in **every** build, to decide whether a `meta.page.tags` entry
 *   renders beside a named `PageMetadata` field that already produced the same key.
 *
 * So this is not a development concern. `setRepeatableHeadKeys()` is an author-facing knob that
 * changes what a production page emits, which is the one place in `UnirendHead` where those two
 * things meet. Living under a filename that says "warning" made that read like a layering mistake
 * every time someone followed the import. It is not one, and the file name should say so.
 *
 * The two sides deliberately share one answer. A key either repeats or it does not, and answering
 * differently would mean the browser keeping a tag the warning calls a mistake.
 */

/**
 * Keys this app expects to repeat, on top of the built-in lists below.
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
 * That is also why the call belongs in code both sides run, not in a browser entry. This writes
 * module state, so it only takes effect where it is actually called, and the `tags` rule above
 * runs during the server render too. Called from the client entry alone, the server drops an entry
 * the browser then keeps, so the HTML a crawler reads is missing a tag the hydrated page has. Put
 * it wherever the app declares its routes, or in any module both entries import.
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
 *
 * Deliberately **not** the same list as `STRUCTURED_PARENT_NAMES` in `page-metadata-tags.ts`, and
 * not derivable from it, however much the shared `og:image`, `og:video`, and `og:audio` entries
 * invite merging the two. They answer different questions and they key differently:
 *
 * - Structured-parent membership is about whether a child replacing a tag takes the `:`-suffixed
 *   tags describing it along, and it is **attribute-agnostic**: `name=og:image` and
 *   `property=og:image` are both recognized, since OpenGraph documents `property`, Twitter
 *   documents `name`, and real pages write it both ways.
 * - Repeatability is about whether two of a tag is normal, and it is **attribute-specific**:
 *   `property=og:image` repeats and `name=og:image` does not, `name=theme-color` repeats and
 *   `property=theme-color` does not.
 *
 * The memberships genuinely disagree in both directions. `twitter:image` and `twitter:player` are
 * structured parents and are not repeatable, because a card carries one image. `og:locale:alternate`
 * is repeatable and is not a structured parent, because it lists the other locales the page exists
 * in rather than describing `og:locale`. Collapsing the lists ships both bugs silently: a second
 * `twitter:image` stops warning, and a child declaring `og:locale` starts eating the alternates.
 * Both directions are pinned by tests, so a merge fails rather than shipping.
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
 *
 * The OpenGraph three only, for the reason above: the Twitter parents are structured without being
 * repeatable, so their sub-properties are not repeatable either.
 */
const REPEATABLE_META_KEY_PREFIXES = [
  'property=og:image:',
  'property=og:video:',
  'property=og:audio:',
];

/**
 * Whether a key repeating across instances is normal rather than a mistake.
 *
 * Asked by the duplicate warning in development and by `buildPageMetadataTags()` in every build,
 * see the note at the top of this file for why one answer serves both. The likely bug report if
 * that ever surprises someone is a `tags` entry that renders in one build and not the other, or on
 * the client and not in the server HTML, which comes from `setRepeatableHeadKeys()` being called
 * somewhere only one side runs.
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
