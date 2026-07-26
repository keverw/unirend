import React, { useContext } from 'react';
import type { ReactNode } from 'react';
import { UnirendHeadContext } from './context';
import type { HeadCollector } from './context';
import { HTML_BOOLEAN_ATTRIBUTES } from '../html-utils/escape';
import { getMetaKey, getMetaKeyFromElement } from '../html-utils/meta-key';
import { TEMPLATE_META_MARKER_ATTRIBUTE } from '../consts';
import { serializeStyleObject, toHeadAttributes } from './head-attributes';
import { scanHeadKeys } from './head-keys';
import {
  buildPageMetadataTags,
  resolvePageMetadata,
} from './page-metadata-tags';
import {
  areAllowancesEqual,
  collectDuplicateHeadKeys,
  isDuplicateHeadWarningEnabled,
  warnDuplicateHeadKeys,
} from './duplicate-head-warning';
import type {
  DuplicateHeadAllowance,
  DuplicateHeadKeyReport,
  SeenHeadKeys,
} from './duplicate-head-warning';
import type { PageResponseEnvelope } from '../../api-envelope/api-envelope-types';

/**
 * Props for {@link UnirendHead}.
 *
 * Every one is optional, so passing none of them is the original children-only form.
 */
export interface UnirendHeadProps {
  /**
   * `<title>`, `<meta>`, `<link>`, `<html>`, and `<body>` elements. A child always wins over the
   * envelope field with the same key: the envelope tag is not built at all in that case.
   */
  children?: ReactNode;

  /**
   * A page data loader envelope. Every populated `meta.page` field becomes a head tag.
   *
   * Accepts error and redirect envelopes too, so 404 and error components can pass the envelope
   * they already receive as a prop, `null` included for the case where React Router threw before
   * any loader ran.
   */
  envelope?: PageResponseEnvelope | null;

  /**
   * Suppress the development-only duplicate warning for this instance. `true` covers every key
   * it emits, a string list covers named keys only (`['og:image', 'description']`).
   */
  allowDuplicate?: boolean | string[];
}

/**
 * Framework-native document head manager.
 *
 * Place <title>, <meta>, and <link> tags as direct children, or hand it the page data loader
 * envelope you already have and let it project `meta.page` onto tags for you.
 * Works identically in SSR, SSG, and SPA modes.
 *
 * Server: collects tags via context for injection into the HTML template.
 * Client: renders tags directly; React 19 hoists them to <head>.
 *
 * @example
 * ```tsx
 * import { UnirendHead } from 'unirend/client';
 *
 * function HomePage() {
 *   return (
 *     <>
 *       <UnirendHead>
 *         <title>Home - My App</title>
 *         <meta name="description" content="Welcome to my app" />
 *         <link rel="canonical" href="https://example.com/" />
 *       </UnirendHead>
 *       <main>...</main>
 *     </>
 *   );
 * }
 * ```
 *
 * @example Straight from the loader envelope, with one field overridden locally
 * ```tsx
 * const envelope = useLoaderData<HomeLoaderEnvelope>();
 *
 * // canonical, keywords, and og:* still come from the envelope — only description is replaced.
 * <UnirendHead envelope={envelope}>
 *   <meta name="description" content="Something more specific" />
 * </UnirendHead>
 * ```
 */
export function UnirendHead({
  children,
  envelope,
  allowDuplicate,
}: UnirendHeadProps) {
  const collector = useContext(UnirendHeadContext);

  // Envelope prepass: resolve the merge before anything is collected, then hand the rest of this
  // component one ordinary child list. Children claim their keys first, so a declared tag wins
  // over the envelope field of the same key, and only the child's tag is ever built. Both the
  // server and the client see the identical merged list, so there is no parity to keep in sync.
  const pageMetadata = resolvePageMetadata(envelope);

  const generatedTags =
    pageMetadata === null
      ? EMPTY_TAGS
      : buildPageMetadataTags(pageMetadata, scanHeadKeys(children).claimed);

  // Left strictly alone when there is nothing to generate, so every existing call site keeps the
  // exact child list (and element identities) it had before.
  const effectiveChildren: ReactNode =
    generatedTags.length > 0
      ? [...generatedTags, ...React.Children.toArray(children)]
      : children;

  // Duplicate detection is development-only, so a production build never pays for the scan.
  const shouldWarnOnDuplicates = isDuplicateHeadWarningEnabled();
  const headKeys = shouldWarnOnDuplicates
    ? scanHeadKeys(effectiveChildren).values
    : EMPTY_HEAD_KEYS;

  /* eslint-disable @typescript-eslint/naming-convention */
  const customWindow =
    typeof window !== 'undefined'
      ? (window as typeof window & {
          __UNIREND_TEMPLATE_ATTRS__?: unknown;
        })
      : null;
  /* eslint-enable @typescript-eslint/naming-convention */

  const hasTemplateAttrs =
    customWindow !== null && !!customWindow.__UNIREND_TEMPLATE_ATTRS__;

  const [isMounted, setIsMounted] = React.useState(false);
  React.useEffect(() => {
    // Intentional hydration detection: flip to client-only rendering after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
  }, []);

  const markerRef = React.useRef<HTMLTemplateElement | null>(null);

  // Client-side HTML/Body attribute extraction: parses props from children if running
  // on the client (where the server-side context collector is null).
  const htmlAttrs =
    collector === null
      ? getTagAttributesFromChildren(effectiveChildren, 'html')
      : null;
  const bodyAttrs =
    collector === null
      ? getTagAttributesFromChildren(effectiveChildren, 'body')
      : null;

  // Which template metas this instance overrides. Read off the merged list, so an
  // envelope-derived description overrides the template's exactly as a declared one would.
  const metaKeys =
    collector === null ? getMetaKeysFromChildren(effectiveChildren) : [];

  if (collector === null) {
    // Deliberately in the render phase, not an effect. In pure SPA mode the baseline has to be
    // read from the head before React commits and hoists this component's own metas into it,
    // or those would be mistaken for the template's. It only reads the DOM and builds detached
    // elements, and it runs at most once, so repeating it during a re-render changes nothing.
    captureTemplateMetas();
  }

  // Use useLayoutEffect in client browser environments to avoid flash of layout changes.
  // We fall back to useEffect during server-side/Node render runs to prevent React from
  // printing console warnings about using useLayoutEffect on the server (neither effect actually
  // executes during SSR, but React warns on useLayoutEffect because it cannot affect the server-rendered HTML).
  const useLayoutEffect =
    typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

  const registrationRef = React.useRef<RegisteredAttrs | null>(null);
  const lastMarkerRef = React.useRef<HTMLTemplateElement | null>(null);

  // Effect 1: Handles mounting, attribute updates, and synchronization.
  // Pushes the attributes onto the stack registry on mount, and triggers updateDOM()
  // if attributes change in subsequent layout cycles.
  // The refs are only read inside the effect callback; the lint can't tell because
  // useLayoutEffect here is the isomorphic alias variable, not the React hook directly.
  // eslint-disable-next-line react-hooks/refs
  useLayoutEffect(() => {
    if (collector !== null) {
      return; // Server-side collection is handled in the render phase
    }

    if (!registrationRef.current) {
      registrationRef.current = {
        html: htmlAttrs,
        body: bodyAttrs,
        metaKeys,
        headKeys,
        allowDuplicate,
        markerRef,
      };
      registeredList.push(registrationRef.current);
      lastMarkerRef.current = markerRef.current;

      // Only update DOM if marker is actually mounted (always true for dynamic client-side mount,
      // but null during hydration). This delays DOM update during hydration until the marker is ready.
      if (markerRef.current !== null) {
        updateDOM();
      }
    } else {
      const prev = registrationRef.current;
      const hasMarkerChanged = lastMarkerRef.current !== markerRef.current;
      lastMarkerRef.current = markerRef.current;

      // Kept current unconditionally, outside the gate below. Assigning it costs nothing, and
      // letting it go stale would have the duplicate warning judge this instance by an
      // allowance it no longer declares: an instance that dropped `allowDuplicate` would stay
      // exempt, and one that just added it would keep warning.
      const hasAllowanceChanged = !areAllowancesEqual(
        prev.allowDuplicate,
        allowDuplicate,
      );

      prev.allowDuplicate = allowDuplicate;

      // Optimize updates: only touch the DOM if props or marker actually changed
      if (
        !areRecordsEqual(prev.html, htmlAttrs) ||
        !areRecordsEqual(prev.body, bodyAttrs) ||
        !areKeyListsEqual(prev.metaKeys, metaKeys) ||
        !areHeadKeyMapsEqual(prev.headKeys, headKeys) ||
        hasMarkerChanged ||
        // Storing the new allowance is not enough on its own, since nothing re-reads it until
        // the next sync: dropping an `allowDuplicate` has to surface the warning it was hiding
        // now, not whenever some unrelated attribute happens to change. Only in development,
        // because the allowance has no meaning in a production build and must never be a reason
        // to touch the DOM there.
        (hasAllowanceChanged && shouldWarnOnDuplicates)
      ) {
        prev.html = htmlAttrs;
        prev.body = bodyAttrs;
        prev.metaKeys = metaKeys;
        prev.headKeys = headKeys;
        updateDOM();
      }
    }
  });

  // Effect 2: Handles unmounting/cleanup.
  // Removes this component's active registration from the stack list when the component
  // unmounts, and triggers updateDOM() to restore parent or template baseline state.
  useLayoutEffect(() => {
    if (collector !== null) {
      return;
    }
    return () => {
      if (registrationRef.current) {
        const index = registeredList.indexOf(registrationRef.current);
        if (index !== -1) {
          registeredList.splice(index, 1);
        }
        updateDOM();
        registrationRef.current = null;
      }
    };
  }, [collector]);

  if (collector !== null) {
    // Server-side path: walks children synchronously and collects metadata/attributes
    // into the server-side collector object. Renders null to the client React body
    // because the server injects them directly into the template head.
    if (shouldWarnOnDuplicates) {
      warnDuplicateHeadKeys(
        collectDuplicateHeadKeys(
          getSeenHeadKeys(collector),
          headKeys,
          allowDuplicate,
        ),
      );
    }

    collectServerHead(collector, effectiveChildren);
    return null;
  }

  // Client-side path: filters out <html> and <body> elements from rendering inside the
  // React root (preventing invalid nested DOM structures like <body> inside #root).
  const filteredChildren = React.Children.toArray(effectiveChildren).filter(
    (child) => {
      if (React.isValidElement(child)) {
        return child.type !== 'html' && child.type !== 'body';
      }

      return true;
    },
  );

  // Hoistable elements like <title>, <meta>, <link> are returned and hoisted by React 19.
  // The hidden template gives this UnirendHead instance a committed DOM position.
  // Client effects can run in a different order than server collection, so updateDOM()
  // uses this marker to sort registrations by document order before applying attributes.
  return (
    <>
      {(isMounted || !hasTemplateAttrs || initialHTMLAttrs !== null) && (
        <template ref={markerRef} style={{ display: 'none' }} />
      )}
      {filteredChildren}
    </>
  );
}

interface RegisteredAttrs {
  html: Record<string, string> | null;
  body: Record<string, string> | null;
  metaKeys: string[];
  headKeys: Map<string, string>;
  allowDuplicate: DuplicateHeadAllowance;
  markerRef: React.RefObject<HTMLTemplateElement | null>;
}

// Client-side registry tracking currently active html/body attributes.
// updateDOM() sorts this list by marker document order before merging so client-side
// last-write-wins attributes match server collection order.
const registeredList: RegisteredAttrs[] = [];

// Shared empties, so a render with no envelope and no duplicate scan allocates nothing and the
// change detection in effect 1 keeps comparing the same references.
const EMPTY_TAGS: React.ReactElement[] = [];
const EMPTY_HEAD_KEYS: Map<string, string> = new Map();

// Head keys already claimed during the current server render, one record per collector. Kept
// outside HeadCollector so the collector stays the plain serializable shape the renderers build,
// and weak so a finished render's record is collected along with its collector.
const seenHeadKeysByCollector = new WeakMap<HeadCollector, SeenHeadKeys>();

function getSeenHeadKeys(collector: HeadCollector): SeenHeadKeys {
  const existing = seenHeadKeysByCollector.get(collector);

  if (existing) {
    return existing;
  }

  const created: SeenHeadKeys = new Map();
  seenHeadKeysByCollector.set(collector, created);

  return created;
}

// Duplicate keys the client has already warned about, so a re-render or an unrelated attribute
// change doesn't reprint them. Replaced wholesale on each sync, so a duplicate that goes away on
// navigation and comes back later warns again.
let warnedDuplicateKeys = new Set<string>();

// Clean baseline attributes preserved from index.html (established on first mount).
let initialHTMLAttrs: Record<string, string> | null = null;
let initialBodyAttrs: Record<string, string> | null = null;

// The template's <meta> baseline from index.html, grouped by meta identity. The elements held
// for a key are ones this module owns outright: either the marked nodes the server left in the
// head, or detached nodes built from the baseline for metas the server stripped because the
// landing page overrides them. React's hoisted metas are never in here and are never touched.
//
// A key maps to a list, not a single node, because one identity can legitimately cover several
// template metas — the standard light/dark pair being the obvious case:
//
//   <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fff" />
//   <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000" />
//
// A page declaring theme-color overrides the identity, so it replaces both, exactly as the
// server's merge already does. Collapsing the group to a single node would leave one template
// copy stranded in the head next to the page's override, and restore only one on the way back.
let templateMetaNodes: Map<string, HTMLMetaElement[]> | null = null;

/**
 * Build a detached <meta> for a template baseline entry the server stripped from the served
 * head, so it's ready to put back the moment no page is overriding it any more.
 */
function createTemplateMeta(attrs: Record<string, string>): HTMLMetaElement {
  const element = document.createElement('meta');

  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }

  element.setAttribute(TEMPLATE_META_MARKER_ATTRIBUTE, '');

  return element;
}

/**
 * Capture the template's meta baseline once, so template metas can be reconciled against the
 * pages that override them for as long as the app is running.
 *
 * Two sources, mirroring how captureInitialAttrs() handles html/body attributes:
 *
 * - SSR/SSG: the server sends the baseline as index.html authored it, and marks the metas it
 *   left in the head. The DOM alone is not enough here, because a meta the current page
 *   overrides was stripped from the served head and would otherwise be lost for good the
 *   moment the user navigates to a page that doesn't override it.
 * - Pure SPA: nothing was server-injected, so index.html's own metas are still the only ones
 *   in the head and can be read straight from it.
 */
function captureTemplateMetas(): void {
  if (templateMetaNodes !== null || typeof document === 'undefined') {
    return;
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const customWindow = window as typeof window & {
    __UNIREND_TEMPLATE_METAS__?: Array<Record<string, string>>;
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  const baseline = customWindow.__UNIREND_TEMPLATE_METAS__;
  const nodes = new Map<string, HTMLMetaElement[]>();

  const track = (key: string, element: HTMLMetaElement) => {
    const group = nodes.get(key);

    if (group) {
      group.push(element);
    } else {
      nodes.set(key, [element]);
    }
  };

  if (baseline) {
    const marked = new Map<string, HTMLMetaElement[]>();

    for (const element of Array.from(
      document.head.querySelectorAll<HTMLMetaElement>(
        `meta[${TEMPLATE_META_MARKER_ATTRIBUTE}]`,
      ),
    )) {
      const key = getMetaKeyFromElement(element);

      if (key !== null) {
        const group = marked.get(key);

        if (group) {
          group.push(element);
        } else {
          marked.set(key, [element]);
        }
      }
    }

    for (const attrs of baseline) {
      const key = getMetaKey(attrs);

      if (key === null) {
        continue;
      }

      // The server strips a key's template metas all together or not at all, so a key that has
      // any marked node in the head has all of them: adopt that group once and move on.
      const servedGroup = marked.get(key);

      if (servedGroup) {
        if (!nodes.has(key)) {
          nodes.set(key, servedGroup);
        }

        continue;
      }

      // Nothing marked for this key means the server stripped it because the page overrides it.
      // Build the element now and hold it detached until that stops being true.
      track(key, createTemplateMeta(attrs));
    }
  } else {
    for (const element of Array.from(
      document.head.querySelectorAll<HTMLMetaElement>('meta'),
    )) {
      const key = getMetaKeyFromElement(element);

      if (key !== null) {
        track(key, element);
      }
    }
  }

  templateMetaNodes = nodes;
}

/**
 * Bring the template's metas in line with what the mounted pages currently declare: a template
 * meta steps aside while a page overrides it, and comes back once nothing does.
 *
 * This is the half of the override contract that the server can't provide. The server only
 * renders one page, so without this a template meta stripped for the landing page would never
 * return, and one left in the head would sit alongside the meta React hoists on the next
 * navigation (ahead of it in document order, so the stale template value would win).
 *
 * Every template meta sharing an identity moves together, matching the server's merge: a page
 * declaring theme-color replaces the template's whole theme-color set, media variants included.
 */
function reconcileTemplateMetas(declaredKeys: Set<string>): void {
  if (templateMetaNodes === null) {
    return;
  }

  for (const [key, group] of templateMetaNodes) {
    const isOverridden = declaredKeys.has(key);

    for (const node of group) {
      if (isOverridden && node.isConnected) {
        node.remove();
      } else if (!isOverridden && !node.isConnected) {
        document.head.appendChild(node);
      }
    }
  }
}

/**
 * The distinct meta identities a single UnirendHead's children declare, used to decide which
 * template metas are currently overridden. Deduplicated, since a page declaring the same meta
 * twice overrides the template's copy exactly once.
 */
function getMetaKeysFromChildren(children: ReactNode): string[] {
  const keys = new Set<string>();

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== 'meta') {
      return;
    }

    const key = getMetaKey(
      toHeadAttributes(child.props as Record<string, unknown>),
    );

    if (key !== null) {
      keys.add(key);
    }
  });

  return Array.from(keys);
}

/**
 * Capture original document baseline attributes from index.html template on first mount.
 *
 * Checks if the server-rendered script output window.__UNIREND_TEMPLATE_ATTRS__ is defined.
 * If present, it establishes the baseline attributes (safely bypassing any browser-modified classes).
 * If absent (like during SPA dev server runs), it falls back to parsing live DOM attributes but
 * dynamically filters out dynamically-added classes specified in window.__UNIREND_IGNORED_CLASSES__.
 */
function captureInitialAttrs(): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (initialHTMLAttrs !== null) {
    return; // Already captured
  }

  // To prevent visual flickering, the server-side rendering or an inline anti-flicker script
  // may inject dynamic attributes (such as theme classes) on <html>/<body> before React hydrates.
  // Capturing the live DOM state at mount time would record these dynamic values as the static
  // "baseline template state," making it impossible to remove them (they would be permanently
  // merged back via unioning).
  //
  // NOTE: Because inline anti-flicker scripts in index.html execute synchronously during the browser's
  // initial HTML parsing phase, they are guaranteed to run and populate window.__UNIREND_IGNORED_CLASSES__
  // long before React loads, hydrates, and triggers captureInitialAttrs() on mount.
  /* eslint-disable @typescript-eslint/naming-convention */
  const customWindow = window as typeof window & {
    __UNIREND_TEMPLATE_ATTRS__?: {
      html?: Record<string, string>;
      body?: Record<string, string>;
    };
    __UNIREND_IGNORED_CLASSES__?: Set<string>;
  };

  /* eslint-enable @typescript-eslint/naming-convention */
  const templateAttrs = customWindow.__UNIREND_TEMPLATE_ATTRS__;
  if (templateAttrs && (templateAttrs.html || templateAttrs.body)) {
    // SSR/SSG path: use clean static baseline parsed by server
    initialHTMLAttrs = templateAttrs.html || {};
    initialBodyAttrs = templateAttrs.body || {};
  } else {
    // SPA/Dev path: parse attributes from live DOM, filtering out dynamically added classes
    const ignoredSet =
      customWindow.__UNIREND_IGNORED_CLASSES__ || new Set<string>();

    initialHTMLAttrs = {};
    for (let i = 0; i < document.documentElement.attributes.length; i++) {
      const attr = document.documentElement.attributes[i];
      if (attr.name === 'class') {
        // Parse the live class attribute, split by whitespace to get individual class names,
        // and filter out any dynamic classes (e.g. 'dark') registered in ignoredSet.
        // This ensures they aren't captured as baseline, which would permanently lock them on.
        initialHTMLAttrs['class'] = attr.value
          .split(/\s+/)
          .filter((c) => !ignoredSet.has(c))
          .join(' ');
      } else {
        // For non-class attributes (like lang="en"), record them exactly as defined
        // in the static template index.html.
        initialHTMLAttrs[attr.name] = attr.value;
      }
    }

    initialBodyAttrs = {};
    for (let i = 0; i < document.body.attributes.length; i++) {
      const attr = document.body.attributes[i];
      if (attr.name === 'class') {
        // Apply the same class filtering logic to the <body> tag classes to strip
        // dynamic attributes applied by the inline anti-flicker scripts before hydration.
        initialBodyAttrs['class'] = attr.value
          .split(/\s+/)
          .filter((c) => !ignoredSet.has(c))
          .join(' ');
      } else {
        // Record all other static template body attributes as-is.
        initialBodyAttrs[attr.name] = attr.value;
      }
    }
  }
}

/**
 * Merge baseline template attributes and component stack attributes, then apply to the DOM element.
 *
 * - Non-class/style attributes: Last-write-wins (nested components overwrite parent settings).
 * - Classes: Union/accumulate. Component classes merge as unique space-separated sets on top of template classes.
 * - Styles: Concatenate. Component style directives append to the end.
 * - Unused attributes: Automatically removed from the DOM if not present in the template baseline or the stack.
 */
function applyAttributes(
  element: HTMLElement,
  initial: Record<string, string>,
  stack: Array<Record<string, string>>,
): void {
  /* eslint-disable @typescript-eslint/naming-convention */
  const ext = element as HTMLElement & {
    __unirendCalculatedClasses__?: Set<string>;
    __unirendCalculatedStyles__?: Set<string>;
    __unirendCalculatedAttrs__?: Set<string>;
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  // 1. Calculate new merged attributes (accumulating stack registrations on top of initial baseline)
  const merged: Record<string, string> = { ...initial };

  for (const attrs of stack) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') {
        // Classes: Union and deduplicate individual class tokens.
        const existingClasses = (merged['class'] || '')
          .split(/\s+/)
          .filter(Boolean);
        const newClasses = value.split(/\s+/).filter(Boolean);
        merged['class'] = Array.from(
          new Set([...existingClasses, ...newClasses]),
        ).join(' ');
      } else if (key === 'style') {
        // Styles: Concatenate the raw strings (separated by a semicolon if needed).
        // Browser CSS precedence handles any overrides.
        const existingStyle = merged['style'] || '';
        const sep = existingStyle && !existingStyle.endsWith(';') ? ';' : '';
        merged['style'] = existingStyle + sep + value;
      } else {
        // All other attributes: Overwrite existing values (last-write-wins).
        merged[key] = value;
      }
    }
  }

  // 2. Class reconciliation (avoid clobbering external classes)
  if (!ext.__unirendCalculatedClasses__) {
    const initClasses = (initial['class'] || '').split(/\s+/).filter(Boolean);
    ext.__unirendCalculatedClasses__ = new Set(initClasses);
  }
  const lastCalculatedClasses = ext.__unirendCalculatedClasses__;
  const currentClasses = new Set(
    (element.getAttribute('class') || '').split(/\s+/).filter(Boolean),
  );

  // Identify external classes = current - lastCalculated
  const externalClasses: string[] = [];
  for (const c of currentClasses) {
    if (!lastCalculatedClasses.has(c)) {
      externalClasses.push(c);
    }
  }

  // New calculated classes
  const newCalculatedClasses = (merged['class'] || '')
    .split(/\s+/)
    .filter(Boolean);
  const newCalculatedClassesSet = new Set(newCalculatedClasses);

  // Final combined classes
  const finalClasses = Array.from(
    new Set([...newCalculatedClasses, ...externalClasses]),
  );

  if (finalClasses.length > 0) {
    element.setAttribute('class', finalClasses.join(' '));
  } else {
    element.removeAttribute('class');
  }
  ext.__unirendCalculatedClasses__ = newCalculatedClassesSet;

  // Remove class from merged attributes so we don't handle it in standard attributes loop
  delete merged['class'];

  // 3. Style reconciliation (avoid clobbering external styles)
  if (!ext.__unirendCalculatedStyles__) {
    const initStyles = parseStyleString(initial['style'] || '');
    ext.__unirendCalculatedStyles__ = new Set(Object.keys(initStyles));
  }
  const lastCalculatedStyles = ext.__unirendCalculatedStyles__;
  const newStylesMap = parseStyleString(merged['style'] || '');

  // Remove style properties that were set by UnirendHead in the previous run
  // but are no longer in the new calculated style map.
  for (const styleProp of lastCalculatedStyles) {
    if (!(styleProp in newStylesMap)) {
      element.style.removeProperty(styleProp);
    }
  }

  // Set the new calculated styles
  const nextCalculatedStyles = new Set<string>();
  for (const [prop, val] of Object.entries(newStylesMap)) {
    element.style.setProperty(prop, val);
    nextCalculatedStyles.add(prop);
  }
  ext.__unirendCalculatedStyles__ = nextCalculatedStyles;

  // Remove style from merged attributes so we don't handle it in standard attributes loop
  delete merged['style'];

  // 4. Standard attributes reconciliation (avoid clobbering external attributes)
  if (!ext.__unirendCalculatedAttrs__) {
    const initAttrs = new Set(Object.keys(initial));
    initAttrs.delete('class');
    initAttrs.delete('style');
    ext.__unirendCalculatedAttrs__ = initAttrs;
  }
  const lastCalculatedAttrs = ext.__unirendCalculatedAttrs__;

  // Remove attributes that were set by UnirendHead in the previous run
  // but are no longer in the new calculated attributes map.
  for (const attrName of lastCalculatedAttrs) {
    if (!(attrName in merged)) {
      element.removeAttribute(attrName);
    }
  }

  // Set the new calculated attributes
  const nextCalculatedAttrs = new Set<string>();
  for (const [key, value] of Object.entries(merged)) {
    if (HTML_BOOLEAN_ATTRIBUTES.has(key.toLowerCase()) && value === 'false') {
      element.removeAttribute(key);
      continue;
    }
    element.setAttribute(key, value);
    nextCalculatedAttrs.add(key);
  }
  ext.__unirendCalculatedAttrs__ = nextCalculatedAttrs;
}

/**
 * Synchronize current cumulative configuration states of html/body elements to the active DOM.
 */
function updateDOM(): void {
  if (typeof document === 'undefined') {
    return;
  }

  captureInitialAttrs();

  // Sort registrations by committed DOM document order. React layout effects run
  // child-before-parent, which can invert registration push order compared to SSR collection.
  // Earlier markers are processed first and later markers override them for last-write-wins attrs.
  const sortedRegistrations = [...registeredList].sort((a, b) => {
    const elA = a.markerRef.current;
    const elB = b.markerRef.current;
    if (!elA || !elB || !elA.isConnected || !elB.isConnected) {
      return 0; // Fallback: keep current order
    }
    const position = elA.compareDocumentPosition(elB);
    if (position & 4) {
      // DOCUMENT_POSITION_FOLLOWING
      // elB follows elA, so A is earlier in document order.
      return -1;
    }
    if (position & 2) {
      // DOCUMENT_POSITION_PRECEDING
      // elB precedes elA, so A is later in document order.
      return 1;
    }
    return 0;
  });

  const htmlStack: Array<Record<string, string>> = [];
  const bodyStack: Array<Record<string, string>> = [];
  const declaredMetaKeys = new Set<string>();

  // Development-only: detect the same key coming from two separate instances. Done here rather
  // than during render so it reads the committed, document-ordered set of mounted instances once,
  // instead of firing twice under StrictMode's double render.
  const shouldWarnOnDuplicates = isDuplicateHeadWarningEnabled();
  const seenHeadKeys: SeenHeadKeys = new Map();
  const duplicateReports: DuplicateHeadKeyReport[] = [];

  for (const item of sortedRegistrations) {
    if (item.html) {
      htmlStack.push(item.html);
    }

    if (item.body) {
      bodyStack.push(item.body);
    }

    for (const key of item.metaKeys) {
      declaredMetaKeys.add(key);
    }

    if (shouldWarnOnDuplicates) {
      duplicateReports.push(
        ...collectDuplicateHeadKeys(
          seenHeadKeys,
          item.headKeys,
          item.allowDuplicate,
        ),
      );
    }
  }

  if (shouldWarnOnDuplicates) {
    const fresh = duplicateReports.filter(
      (report) => !warnedDuplicateKeys.has(report.key),
    );

    warnedDuplicateKeys = new Set(duplicateReports.map((report) => report.key));
    warnDuplicateHeadKeys(fresh);
  }

  applyAttributes(document.documentElement, initialHTMLAttrs || {}, htmlStack);
  applyAttributes(document.body, initialBodyAttrs || {}, bodyStack);
  reconcileTemplateMetas(declaredMetaKeys);
}

/**
 * Compares two head key maps for equality, so effect 1 only touches the DOM when the set of tags
 * an instance emits actually changed.
 */
function areHeadKeyMapsEqual(
  a: Map<string, string>,
  b: Map<string, string>,
): boolean {
  if (a === b) {
    return true;
  }

  if (a.size !== b.size) {
    return false;
  }

  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false;
    }
  }

  return true;
}

/**
 * Compares two meta key lists as sets. Overriding is a set membership question, so reordering
 * a page's metas doesn't change which template metas step aside.
 *
 * Compared as sets rather than by length and membership, which would call
 * ['viewport', 'theme-color'] equal to ['viewport', 'viewport'] — same length, and every key of
 * the second is in the first. Skipping the update on that would leave the theme-color baseline
 * detached even though the page had stopped overriding it. The lists are already deduplicated
 * at collection, so this is belt and braces.
 */
function areKeyListsEqual(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);

  if (setA.size !== setB.size) {
    return false;
  }

  for (const key of setA) {
    if (!setB.has(key)) {
      return false;
    }
  }

  return true;
}

/**
 * Compares two attribute records for shallow equality.
 *
 * This optimization avoids triggering expensive DOM re-renders in useLayoutEffect
 * if the requested html/body attributes haven't actually changed.
 */
function areRecordsEqual(
  a: Record<string, string> | null,
  b: Record<string, string> | null,
): boolean {
  // 1. If both refer to the same object (or both are null), they are equal.
  if (a === b) {
    return true;
  }

  // 2. If one is null/undefined but the other is a valid record, they are not equal.
  if (!a || !b) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  // 3. Different number of attributes means they cannot be equal.
  if (keysA.length !== keysB.length) {
    return false;
  }

  // 4. Verify all keys and their corresponding values match.
  for (const key of keysA) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
}

/**
 * Scans component children to extract properties from a specific tag name (e.g. <html> or <body>).
 * Returns the normalized attributes record if the target element is found, otherwise null.
 */
function getTagAttributesFromChildren(
  children: ReactNode,
  tagName: 'html' | 'body',
): Record<string, string> | null {
  let attrs: Record<string, string> | null = null;

  // Walk all children nodes looking for the target react element.
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === tagName) {
      if (attrs === null) {
        attrs = {};
      }
      // Map JSX/React props (e.g. className, lang) to standard HTML attribute strings
      // and merge them if multiple elements of the same tag exist in the same UnirendHead block.
      mergeAttributeRecords(
        attrs,
        toHeadAttributes(child.props as Record<string, unknown>),
      );
    }
  });

  return attrs;
}

function collectServerHead(
  collector: HeadCollector,
  children: ReactNode,
): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      return;
    }

    const type = child.type as string;
    const props = child.props as Record<string, unknown>;

    if (type === 'title') {
      // Last write wins — child route titles override parent layout titles
      collector.title = toTitleText(props.children as ReactNode);
    } else if (type === 'meta') {
      // Accumulate — parent layout and child page metas coexist
      collector.metas.push(toHeadAttributes(props));
    } else if (type === 'link') {
      collector.links.push(toHeadAttributes(props));
    } else if (type === 'html') {
      mergeAttributeRecords(collector.htmlAttrs, toHeadAttributes(props));
    } else if (type === 'body') {
      mergeAttributeRecords(collector.bodyAttrs, toHeadAttributes(props));
    }
  });
}

function mergeAttributeRecords(
  existing: Record<string, string>,
  newAttrs: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(newAttrs)) {
    if (key === 'class') {
      // Classes: Union and deduplicate individual class tokens.
      const existingValue = existing['class'] || '';
      const newClasses = value.split(/\s+/).filter(Boolean);
      const existingClasses = existingValue.split(/\s+/).filter(Boolean);
      existing['class'] = Array.from(
        new Set([...existingClasses, ...newClasses]),
      ).join(' ');
    } else if (key === 'style') {
      // Styles: Concatenate the raw strings (separated by a semicolon if needed).
      // We append instead of parsing property-by-property to prevent breaking complex
      // values like inline SVGs or data URLs. Browser CSS precedence handles any overrides.
      const existingValue = existing['style'] || '';
      const sep = existingValue && !existingValue.endsWith(';') ? ';' : '';
      existing['style'] = existingValue + sep + value;
    } else {
      // All other attributes: Overwrite existing values (last-write-wins).
      existing[key] = value;
    }
  }
}

/**
 * Resolves child nodes of a <title> tag into a flat string.
 * Supports strings, numbers, and bigints, ignoring React elements or other node types.
 */
function toTitleText(children: ReactNode): string {
  return React.Children.toArray(children)
    .map((node) => {
      if (
        typeof node === 'string' ||
        typeof node === 'number' ||
        typeof node === 'bigint'
      ) {
        return String(node);
      }

      return '';
    })
    .join('');
}

// Exported for testing purposes only
// eslint-disable-next-line react-refresh/only-export-components
export const _test = {
  areRecordsEqual,
  areHeadKeyMapsEqual,
  applyAttributes,
  captureInitialAttrs,
  toHeadAttributes,
  serializeStyleObject,
  parseStyleString,
  getInitialHTMLAttrs: () => initialHTMLAttrs,
  getInitialBodyAttrs: () => initialBodyAttrs,
  resetInitialAttrs: () => {
    initialHTMLAttrs = null;
    initialBodyAttrs = null;
  },
  getRegisteredList: () => registeredList,
  updateDOM,
  captureTemplateMetas,
  reconcileTemplateMetas,
  areKeyListsEqual,
  getMetaKeysFromChildren,
  getTemplateMetaNodes: () => templateMetaNodes,
  resetTemplateMetas: () => {
    templateMetaNodes = null;
  },
  resetDuplicateWarnings: () => {
    warnedDuplicateKeys = new Set();
  },
};

/**
 * Parses a standard CSS style string into a key-value record.
 * Correctly handles semicolons inside quotes or parentheses (e.g. data URIs or colors).
 */
function parseStyleString(styleStr: string): Record<string, string> {
  const styles: Record<string, string> = {};
  if (!styleStr) {
    return styles;
  }

  let start = 0;
  let isInDoubleQuote = false;
  let isInSingleQuote = false;
  let inParen = 0;

  for (let i = 0; i < styleStr.length; i++) {
    const char = styleStr[i];
    if (char === '"' && !isInSingleQuote) {
      isInDoubleQuote = !isInDoubleQuote;
    } else if (char === "'" && !isInDoubleQuote) {
      isInSingleQuote = !isInSingleQuote;
    } else if (char === '(') {
      inParen++;
    } else if (char === ')') {
      inParen--;
    } else if (
      char === ';' &&
      !isInDoubleQuote &&
      !isInSingleQuote &&
      inParen === 0
    ) {
      const decl = styleStr.slice(start, i).trim();
      addStyleDeclaration(styles, decl);
      start = i + 1;
    }
  }

  if (start < styleStr.length) {
    const decl = styleStr.slice(start).trim();
    addStyleDeclaration(styles, decl);
  }

  return styles;
}

function addStyleDeclaration(
  styles: Record<string, string>,
  decl: string,
): void {
  if (!decl) {
    return;
  }
  const colonIdx = decl.indexOf(':');
  if (colonIdx !== -1) {
    const key = decl.slice(0, colonIdx).trim().toLowerCase();
    const val = decl.slice(colonIdx + 1).trim();
    styles[key] = val;
  }
}
