import React from 'react';
import type { ReactElement } from 'react';
import type {
  PageMetadata,
  PageResponseEnvelope,
} from '../../api-envelope/api-envelope-types';
import { getDevMode } from 'lifecycleion/dev-mode';
import { getMetaKey } from '../html-utils/meta-key';
import { getLinkHeadKey, getLinkHeadKeys, TITLE_HEAD_KEY } from './head-keys';
import { isRepeatableHeadKey } from './duplicate-head-warning';

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
 * Link relations an envelope-provided tag may not ask for.
 *
 * `http-equiv` is dropped from a meta because it instructs the browser rather than describing the
 * page, and `rel="stylesheet"` is the same argument on a link: it is the one relation whose value
 * the browser fetches and then applies to the document, which is enough to restyle the page over
 * its own content or to read it back out through attribute selectors. Every other relation either
 * describes the page (`canonical`, `alternate`, `icon`) or only warms the cache (`preload`,
 * `modulepreload`, `dns-prefetch`), so those are left alone. Declare a stylesheet as a
 * `UnirendHead` child, or in `index.html`, where the URL is not wire-controlled.
 */
const FORBIDDEN_LINK_RELATIONS = new Set(['stylesheet']);

/**
 * Whether a `rel` names a forbidden relation.
 *
 * Read as the space-separated token list HTML defines it to be, and lowercased, since
 * `rel="alternate STYLESHEET"` is a stylesheet to the browser and would otherwise be a filter the
 * caller opts out of by writing two tokens.
 */
function hasForbiddenLinkRelation(rel: string): boolean {
  return rel
    .toLowerCase()
    .split(/\s+/)
    .some((token) => FORBIDDEN_LINK_RELATIONS.has(token));
}

/**
 * The attributes this file reads back off a built tag, to decide what key it occupies and whether
 * it says enough to render.
 *
 * These are canonicalized to lowercase on the way in. HTML matches attribute names
 * case-insensitively, so `REL` is a `rel` to the browser, but it is not one to a property lookup:
 * left as written, a `<link REL="canonical">` would render with no key at all, escaping the
 * child-override check and the duplicate warning both. Every other attribute keeps the casing it
 * arrived with, since React's own spellings (`crossOrigin`, `referrerPolicy`) warn when lowercased.
 */
const IDENTITY_TAG_ATTRIBUTES = new Set([
  'name',
  'property',
  'rel',
  'href',
  'content',
]);

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

    // Two spellings of one attribute are one attribute. The browser keeps the first and ignores
    // the rest, so this drops the rest rather than emitting a tag whose rendered value is not the
    // one the checks below read.
    if (claimed.has(lowered)) {
      dropped.push(name);
      continue;
    }

    claimed.add(lowered);

    attributes[IDENTITY_TAG_ATTRIBUTES.has(lowered) ? lowered : name] = value;
  }

  return attributes;
}

/**
 * Build the element for one `PageMetadata.tags` entry, or null when the entry cannot describe a
 * usable tag.
 *
 * The entry is read as `unknown`, since `tags` arrives with the rest of the envelope and carries
 * the same "the types are a promise, not a guarantee" caveat.
 */
function buildCustomTag(entry: unknown, index: number): ReactElement | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    warnTagEntrySkipped(index, 'it is not an object');
    return null;
  }

  const { meta, link } = entry as { meta?: unknown; link?: unknown };
  const dropped: string[] = [];

  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    const attributes = sanitizeTagAttributes(
      meta as Record<string, unknown>,
      dropped,
    );

    // A meta with no content says nothing, and one with neither `name` nor `property` has no
    // identity, so a child could not override it and the duplicate warning could not see it.
    if (!isPopulated(attributes.content)) {
      warnTagEntrySkipped(
        index,
        'its meta has no content',
        attributes,
        dropped,
      );
      return null;
    }

    if (!isPopulated(attributes.name) && !isPopulated(attributes.property)) {
      warnTagEntrySkipped(
        index,
        'its meta has neither name nor property',
        attributes,
        dropped,
      );
      return null;
    }

    warnTagAttributesDropped(index, attributes, dropped);

    return React.createElement('meta', {
      key: `unirend-head-tag-${index}`,
      ...attributes,
    });
  }

  if (typeof link === 'object' && link !== null && !Array.isArray(link)) {
    const attributes = sanitizeTagAttributes(
      link as Record<string, unknown>,
      dropped,
    );

    if (!isPopulated(attributes.rel) || !isPopulated(attributes.href)) {
      warnTagEntrySkipped(
        index,
        'its link needs both rel and href',
        attributes,
        dropped,
      );
      return null;
    }

    if (hasForbiddenLinkRelation(attributes.rel)) {
      warnTagEntrySkipped(
        index,
        'its rel names a stylesheet, which an envelope may not load',
        attributes,
        dropped,
        '  A stylesheet is applied to the document rather than describing it, and this URL arrives over the wire.\n' +
          '  Declare it as a UnirendHead child, or in index.html, where it is not wire-controlled.',
      );
      return null;
    }

    warnTagAttributesDropped(index, attributes, dropped);

    return React.createElement('link', {
      key: `unirend-head-tag-${index}`,
      ...attributes,
    });
  }

  warnTagEntrySkipped(index, 'it names neither meta nor link');

  return null;
}

/**
 * The head keys an already-built custom tag occupies, for the claimed-key check.
 *
 * A meta occupies one. A link may occupy more, since a `rel` naming a singular relation among
 * several tokens is that relation as well as the list, see `getLinkHeadKeys()`.
 */
function getCustomTagKeys(tag: ReactElement): string[] {
  const props = tag.props as Record<string, string>;

  if (tag.type === 'link') {
    return getLinkHeadKeys(props.rel);
  }

  const key = getMetaKey(props);

  return key === null ? [] : [key];
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
 * Messages still standing from the last committed pass, and the ones this pass has produced.
 *
 * A render happens on every state change, not just on navigation, so a message that printed every
 * time would bury itself. But the record cannot simply accumulate for the session either: leave
 * a page and come back and you would be told nothing, having possibly never seen the first one.
 *
 * So it tracks what is currently true rather than what has ever been true, the same way the
 * duplicate warning does. `active` suppresses a repeat while the same problem is still there, and
 * `flushTagWarnings()` replaces it with what this pass found, which forgets anything that went
 * away. Navigating back to a page that still has the mistake says so again.
 *
 * Kept per instance rather than as one set apiece, because React re-renders the instance whose
 * state changed and not its neighbors. A single set would be replaced wholesale by whatever that
 * one instance reported, dropping a layout's message while the layout's bad tag is still there,
 * and reprinting it the next time the layout happens to render. Each instance's entry turns over
 * only on a pass it took part in, so the record is the union of what the mounted instances
 * currently say.
 */
const activeTagMessages = new Map<unknown, Set<string>>();
const pendingTagMessages = new Map<unknown, Set<string>>();

/**
 * The instance whose render pass is open, so a message lands in that instance's record.
 *
 * Safe as a single module value because a React render function runs synchronously start to
 * finish: `markTagWarningPass()` and the `buildPageMetadataTags()` call that may warn are in the
 * same uninterrupted stretch of one component's render, with no await between them.
 */
let currentTagWarningOwner: unknown = null;

/**
 * Open a warning pass for one instance, from the render that may fill it.
 *
 * Called for every render rather than only for the ones that warn, because a pass finding nothing
 * is exactly how a message stops being true: that instance's entry turns over to empty and the
 * mistake is reported again if it comes back.
 *
 * Development-only, like everything else these records feed. A production build must not enter the
 * record at all, not merely never read it: the server never flushes, since a render there is
 * one-shot per request, so an entry made there is one nothing ever takes back out. That is a `Set`
 * allocated per instance per render for a message that cannot be printed, and on an app rendering
 * a `UnirendHead` at a data-dependent position, one that keeps finding new `useId` values to key
 * on. Gated here rather than at the call site, so the record cannot be entered from anywhere
 * without the gate coming along.
 */
export function markTagWarningPass(owner: unknown): void {
  if (!getDevMode()) {
    return;
  }

  currentTagWarningOwner = owner;
  pendingTagMessages.set(owner, new Set());
}

/**
 * Close a client sync, promoting what this pass reported to what is currently true.
 *
 * Called from the same commit-time pass that flushes the duplicate warning, so both records turn
 * over together. The server never calls it, which is what it wants: renders there are one-shot per
 * request, and a handler-side mistake should log once for the process rather than once per request.
 *
 * An empty `pendingTagMessages` means no render has happened since the last turnover, so this is
 * not a sync that closes one. That matters because a single commit performs several: every
 * mounting instance's effect calls it, as does an unmounting instance's cleanup. Only the first of
 * those follows the render that filled the record, and the rest have to leave it alone rather than
 * promote an already-drained one and let every message print again on the next render.
 *
 * `liveOwners`, when given, is the set of instances still mounted, and any other instance's entry
 * is dropped. That is what forgets a page you navigated away from. It is left out by the tests
 * that only exercise the turnover, and by nothing else.
 */
export function flushTagWarnings(liveOwners?: ReadonlySet<unknown>): void {
  if (pendingTagMessages.size === 0) {
    return;
  }

  for (const [owner, messages] of pendingTagMessages) {
    activeTagMessages.set(owner, messages);
  }

  pendingTagMessages.clear();

  if (liveOwners === undefined) {
    return;
  }

  for (const owner of activeTagMessages.keys()) {
    if (!liveOwners.has(owner)) {
      activeTagMessages.delete(owner);
    }
  }
}

/**
 * Test-only hooks, since the warning records are module state that would otherwise leak from one
 * test into the next.
 */
export const _test = {
  /** Both record sizes, so a test can prove a production render enters neither. */
  getTagWarningRecordSizes: (): { active: number; pending: number } => ({
    active: activeTagMessages.size,
    pending: pendingTagMessages.size,
  }),
  resetTagEntryWarnings: (): void => {
    activeTagMessages.clear();
    pendingTagMessages.clear();
    currentTagWarningOwner = null;
  },
  markTagWarningPass,
  flushTagWarnings,
};

/**
 * Whether any mounted instance is already standing on this message.
 *
 * Across instances rather than within one, so the same mistake returned by a layout and a page is
 * one message and prints once. It is also what keeps the server quiet: nothing there ever flushes,
 * so an instance's entry is only ever added to, and a handler-side mistake logs once for the
 * process instead of once per request.
 */
function isTagMessageActive(message: string): boolean {
  for (const messages of activeTagMessages.values()) {
    if (messages.has(message)) {
      return true;
    }
  }

  return false;
}

/**
 * Add a message to one of the two records, opening the instance's entry if the pass did not.
 */
function recordTagMessage(
  record: Map<unknown, Set<string>>,
  message: string,
): void {
  const messages = record.get(currentTagWarningOwner);

  if (messages) {
    messages.add(message);
  } else {
    record.set(currentTagWarningOwner, new Set([message]));
  }
}

/**
 * Print one development-only warning about `tags`, unless the same one is already standing.
 *
 * Everything these report is silent otherwise: the tag simply is not in the head, which is a hard
 * thing to work backwards from when the envelope plainly asked for it.
 */
function warnAboutTags(lines: string[]): void {
  const message = [...lines, '  This warning only runs in development.'].join(
    '\n',
  );

  recordTagMessage(pendingTagMessages, message);

  if (isTagMessageActive(message)) {
    return;
  }

  // Recorded as active at print time and not only at the flush, so a re-render that happens before
  // any DOM sync does not print it a second time.
  recordTagMessage(activeTagMessages, message);

  // eslint-disable-next-line no-console
  console.warn(message);
}

/**
 * Name an entry for a warning, by identity where it has one and by position otherwise.
 *
 * The identity matters because the warn-once record keys on the whole message. Two pages hitting
 * the same mistake on the same index would otherwise read as one message, and only the first page
 * visited in a dev session would say anything. With the tag named, `name=app-version` on one page
 * and `property=twitter:card` on another are two messages and both are heard. What still collapses
 * is the same tag with the same problem, which is one mistake however many pages return it.
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
  index: number,
  reason: string,
  attributes: Record<string, string> = {},
  droppedAttributes: string[] = [],
  guidance: string = TAG_ENTRY_SHAPE_GUIDANCE,
): void {
  if (!getDevMode()) {
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

  warnAboutTags(lines);
}

/**
 * Development-only warning for attributes stripped from a tag that otherwise rendered.
 */
function warnTagAttributesDropped(
  index: number,
  attributes: Record<string, string>,
  dropped: string[],
): void {
  if (!getDevMode() || dropped.length === 0) {
    return;
  }

  warnAboutTags([
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
  key: string,
  named: EmittedField,
  dropped: ReactElement,
): void {
  if (!getDevMode()) {
    return;
  }

  const props = dropped.props as Record<string, string>;
  const droppedValue = dropped.type === 'link' ? props.href : props.content;

  warnAboutTags([
    `[unirend] UnirendHead: a meta.page.tags entry for ${key} was dropped, because the ${named.field} field already produced that tag.`,
    `  ${named.field}: ${JSON.stringify(named.value)}`,
    `  dropped:   ${JSON.stringify(droppedValue)}`,
    '  A named PageMetadata field wins over a tags entry with the same key, so only one tag is emitted.',
    '  Set one or the other in your handler, not both.',
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
): ReactElement[] {
  if (metadata === null) {
    return [];
  }

  const tags: ReactElement[] = [];

  // What each named field emitted, keyed the way a `tags` entry would key. A named field beats an
  // entry describing the same thing, so a `rel="canonical"` entry cannot double up with the
  // `canonical` field, and this is what the warning names the losing side against.
  const emittedByField = new Map<string, EmittedField>();

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
    if (claimedKeys.has(key) || emittedByField.has(key)) {
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

  // `tags` comes last, so the named fields keep the order they always had and a page's own
  // children still sit after everything the envelope produced.
  if (Array.isArray(metadata.tags)) {
    for (const [index, entry] of metadata.tags.entries()) {
      const tag = buildCustomTag(entry, index);

      if (tag === null) {
        continue;
      }

      const keys = getCustomTagKeys(tag);

      // A child claiming any key the tag occupies is the documented override and stays quiet, the
      // same as it does for a named field.
      if (keys.some((key) => claimedKeys.has(key))) {
        continue;
      }

      // A key that repeats by nature is not a collision. `og:image` is the case this exists
      // for: an object cannot hold a second `image`, so a page offering several is expected to
      // add the rest here, and dropping them would leave `tags` unable to do the one thing the
      // docs point at it for.
      const collision = keys
        .filter((key) => !isRepeatableHeadKey(key))
        .map((key) => ({ key, named: emittedByField.get(key) }))
        .find((candidate) => candidate.named !== undefined);

      if (collision !== undefined && collision.named !== undefined) {
        warnTagEntryLostToField(collision.key, collision.named, tag);
        continue;
      }

      // Deliberately not recorded as emitted. Keys that repeat legitimately (`og:image`,
      // `rel="alternate"`, a light and dark `theme-color`) are the reason `tags` is a list and
      // not a map, so two entries sharing a key both render.
      tags.push(tag);
    }
  }

  return tags;
}
