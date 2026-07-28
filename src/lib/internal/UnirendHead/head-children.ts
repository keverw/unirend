import React from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The tags a `UnirendHead` manages.
 *
 * `title`, `meta`, and `link` become head tags. `html` and `body` are read for their attributes and
 * applied to the real document elements, by the template merge on the server and by the stack
 * manager on the client. Nothing else has a meaning here, which is what the warning below says.
 */
export const HEAD_CHILD_TYPES = new Set([
  'title',
  'meta',
  'link',
  'html',
  'body',
]);

/**
 * The subset the client renders into the React root, for React 19 to hoist.
 *
 * `html` and `body` are absent because rendering them inside `#root` would be invalid DOM, a
 * `<body>` nested in a div. Their attributes are applied to the real elements instead.
 */
const RENDERED_HEAD_CHILD_TYPES = new Set(['title', 'meta', 'link']);

/**
 * Walk a `UnirendHead`'s children, visiting every element that could be a head tag.
 *
 * Fragments are transparent: a fragment is not a level of nesting, it is the absence of one, so its
 * children are walked as though they had been written in its place. Without this, wrapping a pair
 * of metas in `<>...</>` collected nothing on the server while the client rendered them anyway,
 * since React hoists whatever renders. That is the same split the `script` filter closes, one level
 * up, and it is invisible until an SSR page is missing tags a SPA build had.
 *
 * A component is deliberately not walked into. `<SharedMetas />` has not rendered when this runs,
 * so there is no output to read: it is an element whose type is a function, and no synchronous walk
 * can turn that into tags. Reuse goes through the component rendering its own `UnirendHead`, which
 * works on both sides, since several instances is the design rather than a special case.
 */
export function forEachHeadChild(
  children: ReactNode,
  visit: (child: ReactElement) => void,
): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      return;
    }

    if (child.type === React.Fragment) {
      forEachHeadChild(
        (child.props as { children?: ReactNode }).children,
        visit,
      );

      return;
    }

    visit(child);
  });
}

/**
 * Whether an element is one of the tags this component manages.
 */
export function isHeadChild(child: ReactElement): boolean {
  return typeof child.type === 'string' && HEAD_CHILD_TYPES.has(child.type);
}

/**
 * The children the client renders, with everything it does not manage removed.
 *
 * Fragments are kept rather than flattened, so React's own key assignment still applies: rebuilding
 * one flat list would mean minting keys for tags that already have perfectly good ones, and two
 * fragments would each start counting from zero.
 */
export function filterRenderableHeadChildren(children: ReactNode): ReactNode[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) {
      return [];
    }

    if (child.type === React.Fragment) {
      return [
        React.cloneElement(
          child,
          undefined,
          filterRenderableHeadChildren(
            (child.props as { children?: ReactNode }).children,
          ),
        ),
      ];
    }

    return typeof child.type === 'string' &&
      RENDERED_HEAD_CHILD_TYPES.has(child.type)
      ? [child]
      : [];
  });
}

/**
 * Name a child for the warning below, the way its author wrote it.
 *
 * A component is named where React knows one, since `<SharedMetas />` is the thing to go looking
 * for and "a component" is not.
 *
 * `memo()`, `forwardRef()`, and `lazy()` are recognized rather than given up on, because a wrapper
 * makes the element's type an object rather than a function: a plain `typeof type === 'function'`
 * test misses all three and falls through to the vaguest answer this has. That is the case where
 * the name matters most, since the warning deduplicates by what it prints, and three differently
 * wrapped components would otherwise collapse into one anonymous entry naming none of them.
 *
 * `displayName` comes first at every level, since that is what a wrapper carries when the function
 * underneath is anonymous. `type` is what memo holds, `render` is what forwardRef holds.
 *
 * A lazy is the one that cannot be unwrapped to a name. It holds `_payload` and `_init` rather
 * than the component, and the component is exactly what has not loaded yet — a child placed here
 * never renders, so nothing will ever resolve it. Naming it takes a `displayName` on the lazy
 * itself. Failing that it still reads as a component rather than as an unrecognizable element,
 * which is the difference between a warning that points somewhere and one that does not.
 */
function describeChild(type: unknown): string {
  if (typeof type === 'string') {
    return `<${type}>`;
  }

  const name = getComponentName(type);

  if (name !== null) {
    return `<${name} />`;
  }

  return typeof type === 'function' || isWrappedComponent(type)
    ? 'a component'
    : 'an element';
}

/**
 * Whether a type is one of React's wrapper objects, so an unnamed one still reads as a component
 * rather than as something unrecognizable.
 *
 * `_payload` is what makes a lazy one of these. It carries neither `type` nor `render`, so the
 * two fields the unwrapping walks are not enough on their own here, and without this a lazy child
 * is described as "an element" and the warning names nothing to go looking for.
 */
function isWrappedComponent(type: unknown): boolean {
  return (
    typeof type === 'object' &&
    type !== null &&
    ('type' in type || 'render' in type || '_payload' in type)
  );
}

/**
 * The name React knows a component by, unwrapping one wrapper layer at a time, or null.
 *
 * Bounded rather than recursing freely, since `memo(forwardRef(...))` is two layers and nothing in
 * practice is deeper. A cycle is not possible through these fields, but a bound costs nothing and
 * means a malformed type cannot spin here.
 */
function getComponentName(type: unknown): string | null {
  let current = type;

  for (let depth = 0; depth < 4; depth++) {
    if (current === null || current === undefined) {
      return null;
    }

    if (typeof current !== 'function' && typeof current !== 'object') {
      return null;
    }

    const named = current as {
      displayName?: string;
      name?: string;
      type?: unknown;
      render?: unknown;
    };

    if (named.displayName) {
      return named.displayName;
    }

    if (typeof current === 'function' && named.name) {
      return named.name;
    }

    current = named.type ?? named.render;
  }

  return null;
}

/**
 * Development-only warning for children a `UnirendHead` does not manage.
 *
 * Dropped silently before, and only on the server, which is the combination that made it hard to
 * find: an SSR page was missing a tag that the same code produced in a SPA build, with nothing said
 * on either side. Both sides now ignore them, and this is what keeps that from being the new silent
 * failure.
 *
 * Collected rather than printed, matching the envelope projection's messages: the server prints
 * once per render, and the client hands the list to its registration so an unmounted page's warning
 * goes away with it. See `warnTagMessagesOnce()` and `updateDOM()`.
 *
 * Non-element children are passed over rather than reported. A stray string is nearly always
 * incidental whitespace or an interpolation that rendered to nothing, and it cannot be mistaken for
 * a tag the way a `<div>` can.
 */
export function collectUnmanagedChildMessages(
  children: ReactNode,
  messages: string[],
): void {
  const unmanaged: string[] = [];

  forEachHeadChild(children, (child) => {
    if (!isHeadChild(child)) {
      unmanaged.push(describeChild(child.type));
    }
  });

  if (unmanaged.length === 0) {
    return;
  }

  // Counted after deduplicating, since that is what the message lists. Two `<div>` children are one
  // name and have to read as one, or the sentence disagrees with itself.
  const names = [...new Set(unmanaged)];
  const isSingle = names.length === 1;

  messages.push(
    [
      `[unirend] UnirendHead: ${names.join(', ')} ${isSingle ? 'is not a tag' : 'are not tags'} UnirendHead manages, so ${isSingle ? 'it was' : 'they were'} dropped.`,
      '  It collects <title>, <meta>, <link>, <html>, and <body>. A fragment is walked through, so wrapping tags in one is fine.',
      '  A component is not walked into, since it has not rendered yet. Give it its own UnirendHead instead of returning bare tags.',
      '  Scripts and stylesheets belong in your build, in index.html, or in the server templateSlots option.',
      '  This warning only runs in development.',
    ].join('\n'),
  );
}
