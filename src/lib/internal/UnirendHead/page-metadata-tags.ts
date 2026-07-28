import React from 'react';
import type { ReactElement } from 'react';
import type {
  PageMetadata,
  PageResponseEnvelope,
} from '../../api-envelope/api-envelope-types';
import { getDevMode } from 'lifecycleion/dev-mode';
import { getMetaKeys } from '../html-utils/meta-key';
import { getLinkHeadKey, getLinkHeadKeys, TITLE_HEAD_KEY } from './head-keys';
import { isRepeatableHeadKey } from './repeatable-head-keys';

/**
 * Attributes an envelope-provided tag may never carry, whatever it asks for.
 *
 * `children` and `dangerouslySetInnerHTML` would make React throw on a void element, which would
 * take the page down, the one outcome this file exists to avoid. `style` throws for the same
 * reason: React expects a style object, and every value that reaches it from here is a string,
 * so the one spelling an author would ever write is exactly the one that fails. `key` and `ref`
 * are React's own and are set here. `http-equiv` is excluded on its own merits, see
 * `PageMetadataMetaTag`. Anything starting with `on` is an event handler, which has no business
 * arriving over the wire.
 */
const FORBIDDEN_TAG_ATTRIBUTES = new Set(
  [
    'children',
    'dangerouslySetInnerHTML',
    'style',
    'key',
    'ref',
    'suppressHydrationWarning',
    'http-equiv',
    'httpEquiv',
  ].map((attribute) => attribute.toLowerCase()),
);

/**
 * Whether a `rel` names any relation at all.
 *
 * The relation itself is deliberately not judged. A `UnirendHead` child may declare any `rel`, and
 * the envelope matches it, so a handler that wants to ship a stylesheet or a preload can. The line
 * this file draws is `http-equiv`, which is not a relation and is refused on the meta side: an
 * envelope already has a redirect of its own, so a `refresh` meta could only ever be a broken
 * loader expressing itself the wrong way round.
 *
 * What is left is a shape check. A `rel` of nothing but whitespace passes the populated test above
 * and names nothing, so it would render a link that no head key can identify, invisible to the
 * child-override check and to the duplicate warning both. Read as the space-separated token list
 * HTML defines it to be, which is also how the key is built. See `getLinkHeadKeys()`.
 */
function hasNamedLinkRelation(rel: string): boolean {
  return rel.trim().length > 0;
}

/**
 * The attributes this file reads back off a built tag, to decide what key it occupies and whether
 * it says enough to render.
 *
 * These are canonicalized to lowercase on the way in. HTML matches attribute names
 * case-insensitively, so `REL` is a `rel` to the browser, but it is not one to a property lookup:
 * left as written, a `<link REL="canonical">` would render with no key at all, escaping the
 * child-override check and the duplicate warning both. Every other attribute keeps the casing it
 * arrived with, unless it is one React spells differently, see `HTML_ATTRIBUTE_TO_REACT_PROP`.
 * None of these five is, so lowercasing them costs nothing on that side.
 */
const IDENTITY_TAG_ATTRIBUTES = new Set([
  'name',
  'property',
  'rel',
  'href',
  'content',
]);

/**
 * HTML attribute names whose React prop spelling differs by more than case.
 *
 * An entry is written in HTML, which is the point of `tags`: the envelope is wire data, and
 * whatever produced it (a PHP handler, a CMS, a stored fixture) has no reason to know React's prop
 * names. The docs hold `hreflang` up as an example for exactly that reason. But the client spreads
 * these attributes onto `createElement`, and React matches a lowercased prop name against its own
 * list and says "Invalid DOM property `hreflang`. Did you mean `hrefLang`?".
 *
 * The attribute still renders correctly, so this is console noise rather than a broken tag. What
 * makes it worth fixing anyway is where the noise falls: only on the client, because the server
 * never renders these through React, it serializes the collected record. So an SSR page stayed
 * quiet and the identical envelope started complaining the moment it hydrated, on every render,
 * about a spelling the documentation recommends.
 *
 * Renamed rather than dropped, so the tag keeps the attribute. The server writes the record's name
 * out verbatim and HTML matches attribute names case-insensitively, so a `hrefLang="fr"` in the
 * served markup is the same `hreflang` to a parser that React sets on the client. Reading the
 * lowercased name also means a handler that writes React's spelling already lands here unchanged,
 * which is what the old keep-the-casing rule was protecting.
 *
 * Scoped to the attributes HTML permits on `<meta>` or `<link>`, global attributes included, since
 * those are the only two elements an entry can describe. React's own table is 305 names that
 * disagree with their HTML spelling, nearly all of them SVG presentation attributes and form
 * fields, and copying it wholesale would be reimplementing a part of React that is React's to
 * change. `popovertarget` and `radiogroup` are the shape of what is left out: React knows them,
 * they belong to a `<button>` and a `<menuitem>`, and on a `<link>` React's complaint is a true
 * statement about a meaningless attribute rather than noise to suppress.
 *
 * The risk in scoping it is drift, which is why the boundary is enforced instead of asserted. A
 * test asks React directly, by rendering each name and reading the spelling React suggests, and
 * fails on either side of the contract: a spelling here React no longer agrees with, and an
 * attribute in scope React spells differently that is missing here. So a React upgrade that
 * renames or adds one breaks the build rather than quietly reintroducing the warning. See
 * "the attribute names React spells its own way" in UnirendHeadEnvelope.test.tsx.
 *
 * `http-equiv` is absent because it never reaches here, see `FORBIDDEN_TAG_ATTRIBUTES`.
 */
const HTML_ATTRIBUTE_TO_REACT_PROP = new Map<string, string>([
  ['accesskey', 'accessKey'],
  ['autocapitalize', 'autoCapitalize'],
  ['autocorrect', 'autoCorrect'],
  ['autofocus', 'autoFocus'],
  ['charset', 'charSet'],
  ['class', 'className'],
  ['contenteditable', 'contentEditable'],
  ['contextmenu', 'contextMenu'],
  ['crossorigin', 'crossOrigin'],
  ['enterkeyhint', 'enterKeyHint'],
  ['fetchpriority', 'fetchPriority'],
  ['hreflang', 'hrefLang'],
  ['imagesizes', 'imageSizes'],
  ['imagesrcset', 'imageSrcSet'],
  ['inputmode', 'inputMode'],
  ['itemid', 'itemID'],
  ['itemprop', 'itemProp'],
  ['itemref', 'itemRef'],
  ['itemscope', 'itemScope'],
  ['itemtype', 'itemType'],
  ['referrerpolicy', 'referrerPolicy'],
  ['spellcheck', 'spellCheck'],
  ['tabindex', 'tabIndex'],
]);

/**
 * The name an attribute is filed under: lowercased where this file reads it back as an identity,
 * React's spelling where the two differ, and exactly as written otherwise.
 */
function toTagAttributeName(lowered: string, name: string): string {
  if (IDENTITY_TAG_ATTRIBUTES.has(lowered)) {
    return lowered;
  }

  return HTML_ATTRIBUTE_TO_REACT_PROP.get(lowered) ?? name;
}

/**
 * The filed React prop spellings whose DOM attribute is not just the name lowercased, so two
 * arrivals landing on one attribute can be recognized as one.
 *
 * Matched on the exact filed spelling rather than a lowercased one, which is the whole reason this
 * is a map and not a `toLowerCase()` call. `className` sets `class` and a lowercase `classname`
 * sets `classname`, an unknown attribute React passes through as written, so they are two
 * attributes and the pair `class` plus `classname` is no more a repeat than `class` plus `media`
 * is. Lowercasing the filed name first collapses that distinction, and the collapse costs the
 * real attribute: with `classname` written ahead of `class`, the tag shipped the meaningless one
 * and reported the CSS class as a duplicate of it.
 *
 * The reverse of `REACT_PROP_TO_HTML_ATTRIBUTE` in `head-attributes.ts`, which is what the server
 * applies when it serializes this record, restricted to the entries that differ by more than case.
 * `httpEquiv` is that map's only other entry and never reaches here, see
 * `FORBIDDEN_TAG_ATTRIBUTES`.
 */
const FILED_PROP_TO_CLAIMED_ATTRIBUTE = new Map<string, string>([
  ['className', 'class'],
]);

/**
 * The attribute a filed name actually sets, lowercased, since HTML matches attribute names
 * case-insensitively and a repeat is a repeat however either side spelled it.
 */
function getClaimedTagAttribute(attributeName: string): string {
  return (
    FILED_PROP_TO_CLAIMED_ATTRIBUTE.get(attributeName) ??
    attributeName.toLowerCase()
  );
}

/**
 * A name React will pass through to the DOM as written, rather than warning about or mangling.
 */
const VALID_ATTRIBUTE_NAME = /^[a-zA-Z][a-zA-Z0-9:_.-]*$/;

/**
 * The `og` members rendered explicitly, so the sweep over the rest does not emit them twice.
 */
const NAMED_OPEN_GRAPH_MEMBERS = new Set(['title', 'description', 'image']);

/**
 * Pull the page metadata a `UnirendHead` should project onto tags.
 *
 * Everything is optional-chained rather than trusted. `meta` is a required field on the envelope
 * types, but the value arriving here came off the wire (or out of a hand-written local loader),
 * and a page that renders without a title is a far better outcome than one that throws.
 */
export function resolvePageMetadata(
  envelope: PageResponseEnvelope | null | undefined,
): PageMetadata | null {
  return envelope?.meta?.page ?? null;
}

/**
 * A metadata value is only rendered when it is actually a populated string.
 *
 * Absent means no tag. Unirend never substitutes placeholder text for a missing field: a
 * `content="Error loading description"` that ships to production is worse than nothing, and a
 * visibly missing title is the clearer signal that a handler forgot its `pageMetadata`.
 */
function isPopulated(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Copy the attributes of an envelope-provided tag that are safe to render, recording the names of
 * any it had to leave behind.
 *
 * Non-string values are dropped rather than coerced, matching how the named fields are read, and
 * an unusable attribute never invalidates the tag around it.
 */
function sanitizeTagAttributes(
  tag: Record<string, unknown>,
  dropped: string[],
): Record<string, string> {
  const attributes: Record<string, string> = {};
  const claimed = new Set<string>();

  for (const [name, value] of Object.entries(tag)) {
    // Matched against the lowercased name, because the browser does. `HTTP-EQUIV` is an
    // `http-equiv` once the HTML is parsed, so a case-sensitive check here would be a filter the
    // caller opts out of by holding down shift.
    const lowered = name.toLowerCase();

    if (FORBIDDEN_TAG_ATTRIBUTES.has(lowered) || lowered.startsWith('on')) {
      dropped.push(name);
      continue;
    }

    if (!VALID_ATTRIBUTE_NAME.test(name) || typeof value !== 'string') {
      dropped.push(name);
      continue;
    }

    // Two spellings of one attribute are one attribute, so this keeps the first and drops the rest
    // rather than emitting a tag whose rendered value is not the one the checks below read. The
    // extra spelling is reported, since an envelope naming an attribute twice is a handler bug
    // worth hearing about, where a page writing it in TSX is its own author's business.
    //
    // Whichever one survives, the point is that only one does. The two sides resolve a repeat
    // differently, the HTML tokenizer keeping the first and React keeping the last, so a tag
    // carrying both would read as one attribute in the server-rendered HTML and the other after
    // hydration. `toHeadAttributes()` settles the same question for a child by keeping the last,
    // which is the same rule reached from the other end: leave the page with one spelling, so both
    // halves are reading the same tag.
    //
    // Recorded under the attribute the filed name ends up setting, not the name it arrived as,
    // since that is what makes two arrivals one attribute. Keyed on the arriving name, `class` and
    // `className` were two: `class` files as `className`, so the second matched nothing, slipped
    // the check, and overwrote the first value with nothing said. See
    // `getClaimedTagAttribute()` for why the answer is not simply the filed name lowercased.
    const attributeName = toTagAttributeName(lowered, name);
    const claim = getClaimedTagAttribute(attributeName);

    if (claimed.has(claim)) {
      dropped.push(name);
      continue;
    }

    claimed.add(claim);

    attributes[attributeName] = value;
  }

  return attributes;
}

/**
 * Whether an entry's `meta` or `link` member is shaped like a set of attributes at all.
 *
 * An array is excluded along with the primitives, because `Object.entries()` would happily read one
 * and turn `['a', 'b']` into `0="a" 1="b"`, attributes that would then be dropped one at a time and
 * reported as a tag missing its content rather than as the wrong shape entirely.
 *
 * An absent member is the ordinary case, not a malformed one: the public type writes the kind an
 * entry does not use as `never`, which permits the `undefined` a spread or an optional field
 * leaves behind, so this has to answer false for it rather than treat it as a second tag.
 */
function isTagAttributes(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build the element for one `PageMetadata.tags` entry, or null when the entry cannot describe a
 * usable tag.
 *
 * The entry is read as `unknown`, since `tags` arrives with the rest of the envelope and carries
 * the same "the types are a promise, not a guarantee" caveat.
 */
function buildCustomTag(
  entry: unknown,
  index: number,
  messages: string[],
): ReactElement | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    warnTagEntrySkipped(messages, index, 'it is not an object');
    return null;
  }

  const { meta, link } = entry as { meta?: unknown; link?: unknown };
  const dropped: string[] = [];

  // An entry describes one tag. Naming both is a payload the public type rules out, and there is
  // no reading of it that recovers the author's intent, so neither is rendered. Picking one would
  // make which tag ships a function of the order these branches happen to be written in, and would
  // drop the other in silence, which is the outcome every check in this file exists to avoid.
  if (isTagAttributes(meta) && isTagAttributes(link)) {
    warnTagEntrySkipped(
      messages,
      index,
      'it names both meta and link',
      {},
      [],
      '  An entry describes a single tag. Split it into two entries, one naming meta and one naming link.',
    );
    return null;
  }

  if (isTagAttributes(meta)) {
    const attributes = sanitizeTagAttributes(meta, dropped);

    // A meta with no content says nothing, and one with neither `name` nor `property` has no
    // identity, so a child could not override it and the duplicate warning could not see it.
    if (!isPopulated(attributes.content)) {
      warnTagEntrySkipped(
        messages,
        index,
        'its meta has no content',
        attributes,
        dropped,
      );
      return null;
    }

    if (!isPopulated(attributes.name) && !isPopulated(attributes.property)) {
      warnTagEntrySkipped(
        messages,
        index,
        'its meta has neither name nor property',
        attributes,
        dropped,
      );
      return null;
    }

    warnTagAttributesDropped(messages, index, attributes, dropped);

    return React.createElement('meta', {
      key: `unirend-head-tag-${index}`,
      ...attributes,
    });
  }

  if (isTagAttributes(link)) {
    const attributes = sanitizeTagAttributes(link, dropped);

    if (!isPopulated(attributes.rel) || !isPopulated(attributes.href)) {
      warnTagEntrySkipped(
        messages,
        index,
        'its link needs both rel and href',
        attributes,
        dropped,
      );
      return null;
    }

    if (!hasNamedLinkRelation(attributes.rel)) {
      warnTagEntrySkipped(
        messages,
        index,
        'its rel names no relation',
        attributes,
        dropped,
        '  A rel of nothing but whitespace gives the link no identity, so no child could override it\n' +
          '  and the duplicate warning could not see it.',
      );
      return null;
    }

    warnTagAttributesDropped(messages, index, attributes, dropped);

    return React.createElement('link', {
      key: `unirend-head-tag-${index}`,
      ...attributes,
    });
  }

  warnTagEntrySkipped(messages, index, 'it names neither meta nor link');

  return null;
}

/**
 * The head keys an already-built custom tag occupies, for the claimed-key check.
 *
 * Either kind may occupy more than one. A meta carrying both `name` and `property` is both
 * identities, and a link naming a singular relation among several `rel` tokens is that relation as
 * well as the list. See `getMetaKeys()` and `getLinkHeadKeys()`.
 */
function getCustomTagKeys(tag: ReactElement): string[] {
  const props = tag.props as Record<string, string>;

  if (tag.type === 'link') {
    return getLinkHeadKeys(props.rel);
  }

  return getMetaKeys(props);
}

const KEY_NESTING_SEPARATOR = ':';

/**
 * The metas that are structured objects: a parent whose `:`-suffixed neighbors describe that
 * parent rather than standing on their own.
 *
 * Named rather than inferred from the colon, because the colon does not reliably mean this.
 * `og:locale:alternate` is spelled exactly like a sub-property and is not one: it lists the other
 * locales the page exists in, so it has nothing to say about the `og:locale` a page declares and
 * must not be swept up with it. A blanket rule over every colon would take it. These are the ones
 * where the suffix genuinely cannot stand alone, so they are the ones where a child replacing the
 * parent has to take them along: OpenGraph defines three structured objects, and Twitter cards
 * spell the same idea on `name` rather than `property`.
 */
const STRUCTURED_PARENT_NAMES = [
  'og:image',
  'og:video',
  'og:audio',
  'twitter:image',
  'twitter:player',
];

/**
 * Both spellings of each, because which attribute carries a vocabulary is a matter of habit rather
 * than of rule. OpenGraph documents `property` and Twitter documents `name`, but each parser
 * accepts the other, and plenty of real pages write `property="twitter:image"` or
 * `name="og:image"`. Keying on one spelling would leave the sweep silently not happening for the
 * other, which is the kind of gap nobody would think to look for.
 *
 * Two entries rather than one equivalence, and the difference matters. This says a parent written
 * either way is recognized as a parent, so its own sub-properties go with it. It does not make
 * `name=og:image` and `property=og:image` the same tag: a head tag's identity is the attribute and
 * the value together, which is what lets one `<meta name="twitter:title" property="og:title">` be
 * both tags at once, and what the template merge and the duplicate warning both key on. Collapsing
 * the pair here alone would suppress an envelope tag a child does not match anywhere else in
 * Unirend, so a child on the other attribute is a second tag rather than an override.
 */
const STRUCTURED_PARENT_KEYS = new Set(
  STRUCTURED_PARENT_NAMES.flatMap((parent) => [
    `name=${parent}`,
    `property=${parent}`,
  ]),
);

/**
 * The key a child declared that covers one of this tag's, or null when a child claimed none of
 * them.
 *
 * A key covers itself, which is the whole rule for all but a handful of tags. The exception is a
 * structured object, which also covers the sub-properties describing it: `og:image:width` says
 * nothing without an `og:image`, so a child replacing the image has to take the width with it
 * rather than leave it measuring a different picture. See `STRUCTURED_PARENT_KEYS` for why that
 * set is written out rather than read off the colon.
 */
function findClaimedKey(
  keys: string[],
  claimedKeys: Set<string>,
): string | null {
  for (const key of keys) {
    if (claimedKeys.has(key)) {
      return key;
    }

    // Drop one trailing segment at a time: `property=og:image:width`, then `property=og:image`.
    // The prefix carries no colon, so splitting the whole key leaves it on the leading segment and
    // the ancestors rebuild as real keys. `property=og` is reached and simply is not a structured
    // parent, which is what keeps a bare namespace from claiming anything.
    const segments = key.split(KEY_NESTING_SEPARATOR);

    for (let depth = segments.length - 1; depth > 0; depth--) {
      const ancestor = segments.slice(0, depth).join(KEY_NESTING_SEPARATOR);

      if (STRUCTURED_PARENT_KEYS.has(ancestor) && claimedKeys.has(ancestor)) {
        return ancestor;
      }
    }
  }

  return null;
}

/**
 * What a named `PageMetadata` field put on a key, for the warning below.
 */
interface EmittedField {
  /** The field as an author writes it, e.g. `canonical` or `og.image`. */
  field: string;
  value: string;
}

/**
 * Whether the envelope projection's warnings should be produced at all.
 *
 * Its own dev-mode read rather than the duplicate warning's, so that if the two ever stop
 * answering to one signal, this one going stale is a visible failure rather than a silent one.
 */
export function isTagWarningEnabled(): boolean {
  return getDevMode();
}

/**
 * Messages one server render has already printed, so a mistake that two instances both hit, or
 * that a replayed subtree produces twice, is said once for the render that produced it.
 *
 * Scoped to the render rather than to the process, which is what it used to be. A message names
 * the values involved, and a handler that builds a `canonical` or an `og:image` out of the request
 * path writes a different string on every request, so a process-wide record never matched one of
 * those against the next request's: it printed on every request anyway, and grew an entry per URL
 * for as long as the server ran. Per render, the values inside a message are fixed, so the record
 * collapses exactly what it means to.
 *
 * It also gives the server the lifecycle the client already has, where a message lives as long as
 * the instance that produced it and is said again when that instance comes back. What that costs
 * is a repeat per request for a handler that is still wrong, which is the same page saying the
 * same thing and stops when the handler is fixed.
 *
 * Weakly keyed, so a finished render's record is collected along with the collector it belongs to,
 * exactly as the duplicate warning's record is. See `getSeenHeadKeys()` in UnirendHead.tsx.
 */
const printedTagMessagesByScope = new WeakMap<object, Set<string>>();

function getPrintedTagMessages(scope: object): Set<string> {
  const existing = printedTagMessagesByScope.get(scope);

  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  printedTagMessagesByScope.set(scope, created);

  return created;
}

/**
 * Print the messages one server render produced, skipping any this render has already said.
 *
 * `scope` is whatever the caller holds that is unique to the render and lives no longer than it,
 * which on the server is the head collector.
 */
export function warnTagMessagesOnce(scope: object, messages: string[]): void {
  // The common case, and the one worth not filing a record for: a render with nothing to say
  // should leave nothing behind in the map.
  if (messages.length === 0) {
    return;
  }

  const printed = getPrintedTagMessages(scope);

  for (const message of messages) {
    if (printed.has(message)) {
      continue;
    }

    printed.add(message);

    // eslint-disable-next-line no-console
    console.warn(message);
  }
}

/**
 * Test-only hook. There is no module state to reset here, since a record lives and dies with the
 * render it belongs to, so this only reads.
 */
export const _test = {
  /** One render's record size, so a test can prove a production render never enters it. */
  getPrintedTagMessageCount: (scope: object): number =>
    printedTagMessagesByScope.get(scope)?.size ?? 0,

  /**
   * The structured-parent set, so a test can hold it against the repeatable-key list and fail if
   * the two are ever merged. See the note on `REPEATABLE_META_KEYS` for why they must not be.
   */
  structuredParentKeys: STRUCTURED_PARENT_KEYS,

  /**
   * The React spelling table, so a test can hold it against React itself rather than against a
   * copy of it. See the note on `HTML_ATTRIBUTE_TO_REACT_PROP`.
   */
  htmlAttributeToReactProp: HTML_ATTRIBUTE_TO_REACT_PROP,
};

/**
 * Record one development-only warning about `tags`, for the caller to print.
 *
 * Collected rather than printed here, because who says it and when depends on which side is
 * rendering. The server prints during the render, once for that render. The client hands the list
 * to its registration, and the DOM sync prints whatever is new across the mounted instances, so an
 * unmounted page's message goes away with it. Everything these report is silent otherwise: the tag
 * simply is not in the head, which is a hard thing to work backwards from when the envelope
 * plainly asked for it.
 */
function warnAboutTags(messages: string[], lines: string[]): void {
  messages.push(
    [...lines, '  This warning only runs in development.'].join('\n'),
  );
}

/**
 * Name an entry for a warning, by identity where it has one and by position otherwise.
 *
 * The index alone would say where to look without saying what to look for, and it is the part of
 * the message that means least: `tags[0]` is a different tag on every page. The identity is also
 * what keeps two instances in one render from reading as one mistake, since the warn-once record
 * keys on the whole message, so a bad `name=app-version` in a layout and a bad
 * `property=twitter:card` in the page are two messages and both are heard.
 */
function describeTagEntry(
  index: number,
  attributes: Record<string, string> = {},
): string {
  const identity =
    attributes.name ?? attributes.property ?? attributes.rel ?? null;

  return identity === null
    ? `meta.page.tags[${index}]`
    : `meta.page.tags[${index}] (${identity})`;
}

/**
 * What an entry skipped for a missing attribute is missing, which is the usual case and so the
 * default closing line.
 */
const TAG_ENTRY_SHAPE_GUIDANCE =
  '  A meta needs content plus name or property, and a link needs rel and href.';

/**
 * Development-only warning for an entry that could not describe a usable tag at all.
 */
function warnTagEntrySkipped(
  messages: string[],
  index: number,
  reason: string,
  attributes: Record<string, string> = {},
  droppedAttributes: string[] = [],
  guidance: string = TAG_ENTRY_SHAPE_GUIDANCE,
): void {
  if (!isTagWarningEnabled()) {
    return;
  }

  const lines = [
    `[unirend] UnirendHead: ${describeTagEntry(index, attributes)} was skipped, because ${reason}.`,
  ];

  if (droppedAttributes.length > 0) {
    lines.push(
      `  Its ${formatAttributeList(droppedAttributes)} ${droppedAttributes.length === 1 ? 'was' : 'were'} dropped first, which may be why.`,
    );
  }

  lines.push(guidance);

  warnAboutTags(messages, lines);
}

/**
 * Development-only warning for a `tags` that is not a list at all.
 *
 * The one malformed shape the entry loop never reports, because it never runs: everything else
 * here is caught per entry. Writing a single entry without the array around it is the obvious way
 * to arrive at this, and left silent it looks exactly like a handler that set no tags.
 */
function warnTagsNotAList(messages: string[]): void {
  if (!isTagWarningEnabled()) {
    return;
  }

  warnAboutTags(messages, [
    '[unirend] UnirendHead: meta.page.tags was ignored, because it is not a list.',
    '  Entries live in an array, a single one included:',
    '  tags: [{ meta: { name: "app-version", content: "1.2.3" } }].',
  ]);
}

/**
 * Development-only warning for attributes stripped from a tag that otherwise rendered.
 */
function warnTagAttributesDropped(
  messages: string[],
  index: number,
  attributes: Record<string, string>,
  dropped: string[],
): void {
  if (!isTagWarningEnabled() || dropped.length === 0) {
    return;
  }

  warnAboutTags(messages, [
    `[unirend] UnirendHead: ${describeTagEntry(index, attributes)} rendered without its ${formatAttributeList(dropped)}.`,
    '  Envelope tags may not carry http-equiv (it instructs the browser rather than describing the page),',
    '  style (React reads it as an object, so the string form throws),',
    "  React's own props (children, dangerouslySetInnerHTML, key, ref), or on* handlers, and every value must be a string.",
    '  Declare those as a UnirendHead child instead, where they are not wire-controlled.',
  ]);
}

/**
 * `a`, `a and b`, `a, b, and c`, since these read as prose in the middle of a sentence.
 */
function formatAttributeList(names: string[]): string {
  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * Development-only warning for a `tags` entry dropped because a named field already produced the
 * same key.
 *
 * Both sides came from the same handler, so unlike a child override there is no way to read this
 * as intent: the envelope asked for one tag twice and got the field's version. Silently keeping
 * one of the two is fine as behavior and bad as feedback, since the entry the author most recently
 * wrote is the one that disappeared.
 */
function warnTagEntryLostToField(
  messages: string[],
  key: string,
  named: EmittedField,
  dropped: ReactElement,
): void {
  if (!isTagWarningEnabled()) {
    return;
  }

  const props = dropped.props as Record<string, string>;
  const droppedValue = dropped.type === 'link' ? props.href : props.content;

  warnAboutTags(messages, [
    `[unirend] UnirendHead: a meta.page.tags entry for ${key} was dropped, because the ${named.field} field already produced that tag.`,
    `  ${named.field}: ${JSON.stringify(named.value)}`,
    `  dropped:   ${JSON.stringify(droppedValue)}`,
    '  A named PageMetadata field wins over a tags entry with the same key, so only one tag is emitted.',
    '  Set one or the other in your handler, not both.',
  ]);
}

/**
 * The value that identifies a built tag in a warning: a link's `href`, a meta's `content`.
 */
function getTagWarningValue(tag: ReactElement): string {
  const props = tag.props as Record<string, string>;

  return JSON.stringify(tag.type === 'link' ? props.href : props.content);
}

/**
 * Development-only warning for the `tags` entries a child's key replaced.
 *
 * A named field a child replaces stays quiet, because that is the documented point of the prop and
 * saying so on every page would be noise. This is the other half and reads nothing like it: the
 * handler wrote a list, and some of it is not in the head. Left silent, the only way to find out is
 * to notice a tag missing and go looking for who took it, and `rel="alternate"` is the case that
 * stings, since a page declaring one language variant of its own is not thinking about the
 * handler's list at all.
 */
function warnTagEntriesLostToChild(
  messages: string[],
  key: string,
  dropped: ReactElement[],
): void {
  if (!isTagWarningEnabled() || dropped.length === 0) {
    return;
  }

  const isSingle = dropped.length === 1;

  warnAboutTags(messages, [
    `[unirend] UnirendHead: ${dropped.length} meta.page.tags ${isSingle ? 'entry' : 'entries'} for ${key} ${isSingle ? 'was' : 'were'} dropped, because a child declares that key.`,
    `  dropped: ${dropped.map(getTagWarningValue).join(', ')}`,
    '  A child replaces everything the envelope contributed for its key, and where that key names a',
    `  structured object (${STRUCTURED_PARENT_NAMES.join(', ')}), the sub-properties describing it.`,
    '  Declare the extra tags as children too, or drop the child, if you meant to keep them.',
  ]);
}

/**
 * Development-only warning for two `tags` entries occupying one key that may not repeat.
 *
 * Both still render, which is where this parts company with the named-field rule above. That one
 * has a winner to name, since a field and an entry are different ways of saying a thing and the
 * field is documented to win. Two entries are the same way of saying it twice, so nothing here
 * knows which the handler meant, and dropping one would make that a coin flip on list order.
 *
 * So this only says it out loud, exactly as the cross-instance duplicate warning does. That warning
 * cannot reach this: it compares one instance against another, and a single instance's keys are
 * collapsed to a map long before it sees them. Without this a handler appending a second
 * `canonical` shipped two of them in silence, which is the one outcome the head keys exist to make
 * visible, and the only `tags` mistake in this file that said nothing at all.
 */
function warnTagEntriesRepeatKey(
  messages: string[],
  key: string,
  first: ReactElement,
  second: ReactElement,
): void {
  if (!isTagWarningEnabled()) {
    return;
  }

  warnAboutTags(messages, [
    `[unirend] UnirendHead: two meta.page.tags entries declare ${key}, so both tags are emitted.`,
    `  first:  ${getTagWarningValue(first)}`,
    `  second: ${getTagWarningValue(second)}`,
    '  That key describes the page once, so declare it in one entry.',
    '  Call setRepeatableHeadKeys if this key is meant to repeat.',
  ]);
}

/**
 * Build the head tags a `PageMetadata` describes, skipping every key the instance's own children
 * already claim.
 *
 * The result is prepended to the declared children, so from here on the rest of `UnirendHead`
 * sees one ordinary child list and behaves exactly as it always has — the same list on the
 * server and on the client, so there is no parity to keep in sync.
 */
export function buildPageMetadataTags(
  metadata: PageMetadata | null,
  claimedKeys: Set<string>,
  messages: string[],
): ReactElement[] {
  if (metadata === null) {
    return [];
  }

  const tags: ReactElement[] = [];

  // What each named field emitted, keyed the way a `tags` entry would key. A named field beats an
  // entry describing the same thing, so a `rel="canonical"` entry cannot double up with the
  // `canonical` field, and this is what the warning names the losing side against.
  const emittedByField = new Map<string, EmittedField>();

  // What each `tags` entry put on a key, for the repeat check in that loop. Kept apart from
  // `emittedByField` because the two drive different rules: a named field beats an entry and only
  // one tag is emitted, while two entries both render and are warned about instead.
  const emittedByEntry = new Map<string, ReactElement>();

  const addMeta = (
    attribute: 'name' | 'property',
    identifier: string,
    field: string,
    content: unknown,
  ): void => {
    if (!isPopulated(content)) {
      return;
    }

    const key = `${attribute}=${identifier.toLowerCase()}`;

    // The named fields cannot collide with each other, but two `og` members can normalize onto
    // one property: `{ type, 'og:type' }` is two object keys describing the same tag, as is a
    // casing difference. First one wins, so the pair renders one meta rather than two.
    //
    // The child test reads ancestors as well as the key itself, because the `og` object is the
    // documented way to write a structured sub-property: `og: { image, 'image:width' }` puts the
    // width on a key of its own, so an exact match would let it outlive the `og:image` a child
    // replaced and leave it measuring the child's picture. Same rule the `tags` loop below applies,
    // and it has to be the same or the primary spelling is the one that gets it wrong.
    if (
      findClaimedKey([key], claimedKeys) !== null ||
      emittedByField.has(key)
    ) {
      return;
    }

    emittedByField.set(key, { field, value: content });

    tags.push(
      React.createElement('meta', {
        key: `unirend-head-${key}`,
        [attribute]: identifier,
        content,
      }),
    );
  };

  if (isPopulated(metadata.title) && !claimedKeys.has(TITLE_HEAD_KEY)) {
    emittedByField.set(TITLE_HEAD_KEY, {
      field: 'title',
      value: metadata.title,
    });

    tags.push(
      React.createElement(
        'title',
        { key: `unirend-head-${TITLE_HEAD_KEY}` },
        metadata.title,
      ),
    );
  }

  addMeta('name', 'description', 'description', metadata.description);
  addMeta('name', 'keywords', 'keywords', metadata.keywords);

  const canonicalKey = getLinkHeadKey('canonical');

  if (isPopulated(metadata.canonical) && !claimedKeys.has(canonicalKey)) {
    emittedByField.set(canonicalKey, {
      field: 'canonical',
      value: metadata.canonical,
    });

    tags.push(
      React.createElement('link', {
        key: `unirend-head-${canonicalKey}`,
        rel: 'canonical',
        href: metadata.canonical,
      }),
    );
  }

  // The named members first, in the order they have always rendered, then the rest of the
  // OpenGraph vocabulary in the order the handler wrote it.
  addMeta('property', 'og:title', 'og.title', metadata.og?.title);
  addMeta(
    'property',
    'og:description',
    'og.description',
    metadata.og?.description,
  );
  addMeta('property', 'og:image', 'og.image', metadata.og?.image);

  if (
    typeof metadata.og === 'object' &&
    metadata.og !== null &&
    !Array.isArray(metadata.og)
  ) {
    for (const [member, value] of Object.entries(metadata.og)) {
      if (NAMED_OPEN_GRAPH_MEMBERS.has(member)) {
        continue;
      }

      if (!VALID_ATTRIBUTE_NAME.test(member)) {
        continue;
      }

      // Written either way round, `type` or `og:type`, it is one property and not two prefixes.
      // Case-insensitively, since that is how the key it lands on is compared.
      const property = member.toLowerCase().startsWith('og:')
        ? member
        : `og:${member}`;

      addMeta('property', property, `og.${member}`, value);
    }
  }

  // Entries a child's key took with it, grouped by the key the child declared, so several losing
  // to one child are one message. Warned after the loop rather than inside it, which is the only
  // way to say how many there were.
  const droppedToChild = new Map<string, ReactElement[]>();

  // `tags` comes last, so the named fields keep the order they always had and a page's own
  // children still sit after everything the envelope produced.
  if (Array.isArray(metadata.tags)) {
    for (const [index, entry] of metadata.tags.entries()) {
      const tag = buildCustomTag(entry, index, messages);

      if (tag === null) {
        continue;
      }

      const keys = getCustomTagKeys(tag);

      // A child declaring one of this tag's keys replaces everything the envelope contributed for
      // it, this entry included, however many tags that is on either side. Repeatability is
      // deliberately not consulted here, unlike the named-field test below: a page writing its own
      // `og:image` is saying which image the page has, and there is no count at which that stops
      // reading as an override. `claimedKeys` is a set, so one child tag and five claim the same
      // thing either way.
      //
      // A structured sub-property goes with the parent it describes, which is the one part of that
      // a key comparison alone gets wrong. `og:image:width` is its own key, so it would otherwise
      // survive the `og:image` it belongs to and end up stating the width of whichever image the
      // child brought rather than the one the handler measured. A wrong claim is worse than a
      // missing one.
      const claimedBy = findClaimedKey(keys, claimedKeys);

      if (claimedBy !== null) {
        // Not silent, unlike a named field a child replaces. That one is the documented point of
        // the prop and needs no commentary, but this is a list the handler wrote that is not in the
        // head, which reads as a bug in the handler until you know a child took it. Collected by
        // key rather than warned here, so several entries losing to one child are one message.
        const existing = droppedToChild.get(claimedBy);

        if (existing) {
          existing.push(tag);
        } else {
          droppedToChild.set(claimedBy, [tag]);
        }

        continue;
      }

      // A key that repeats by nature is not a collision with a named field. `og:image` is the case
      // this exists for: an object cannot hold a second `image`, so a page offering several is
      // expected to add the rest here, and dropping them would leave `tags` unable to do the one
      // thing the docs point at it for. Unlike the child above, both sides here came from the same
      // handler, so there is no override to read into it.
      //
      // `isRepeatableHeadKey()` lives with the duplicate warning, which is development-only, but
      // this call is not: it decides what a production page emits, and an app can add to the list
      // through `setRepeatableHeadKeys()`. So a key named there changes this output, and naming it
      // from a browser entry alone makes the server drop an entry the client keeps. See that
      // function for why the two sides share one list.
      const collision = keys
        .filter((key) => !isRepeatableHeadKey(key))
        .map((key) => ({ key, named: emittedByField.get(key) }))
        .find((candidate) => candidate.named !== undefined);

      if (collision !== undefined && collision.named !== undefined) {
        warnTagEntryLostToField(messages, collision.key, collision.named, tag);
        continue;
      }

      // Two entries on one key that does not repeat is the same mistake as the collision above,
      // made twice in the list rather than across it, and it is the one the field record cannot
      // see: a `tags` entry is deliberately never recorded there. Said rather than resolved, see
      // warnTagEntriesRepeatKey().
      //
      // Every colliding key is said, unlike the field collision above, and the difference is what
      // happens to the entry. That one names the key that cost it the tag and stops, since the tag
      // is gone either way. This one renders, so a `<meta name="a" property="b">` repeating both
      // identities really does ship two of each, and reporting only the first would leave the
      // second duplicate exactly as silent as it was before this check existed.
      const repeats = keys
        .filter((key) => !isRepeatableHeadKey(key))
        .map((key) => ({ key, first: emittedByEntry.get(key) }));

      for (const repeat of repeats) {
        if (repeat.first !== undefined) {
          warnTagEntriesRepeatKey(messages, repeat.key, repeat.first, tag);
        }
      }

      // First one wins the record, so a third entry on the key names the tag that was already
      // there rather than the previous repeat, matching how a scan keeps the first value it meets.
      for (const key of keys) {
        if (!emittedByEntry.has(key)) {
          emittedByEntry.set(key, tag);
        }
      }

      // Deliberately not recorded as emitted by a *field*. Keys that repeat legitimately
      // (`og:image`, `rel="alternate"`, a light and dark `theme-color`) are the reason `tags` is a
      // list and not a map, so two entries sharing a key both render.
      tags.push(tag);
    }
  } else if (metadata.tags !== undefined && metadata.tags !== null) {
    // Absent is the ordinary case and says nothing. Present and not a list is a handler asking
    // for tags and getting none of them, which is worth saying out loud.
    warnTagsNotAList(messages);
  }

  for (const [key, dropped] of droppedToChild) {
    warnTagEntriesLostToChild(messages, key, dropped);
  }

  return tags;
}
