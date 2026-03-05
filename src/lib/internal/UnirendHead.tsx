import React, { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { escapeHTML, escapeHTMLAttr } from './html-utils/escape';

/**
 * Collected head data built up during server-side renderToString.
 * Last write wins for title, meta and link entries accumulate.
 */
export interface HeadCollector {
  title: string;
  metas: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
}

/**
 * Context value is the collector on the server, null on the client.
 * null signals "render JSX tags so React 19 can hoist them to <head>".
 */
const UnirendHeadContext = createContext<HeadCollector | null>(null);

/**
 * Wraps the app tree to enable UnirendHead on both server and client.
 *
 * Server: pass a collector object — UnirendHead will push entries into it
 * during renderToString, then the caller reads the collected data.
 *
 * Client: pass null — UnirendHead renders the actual <title>/<meta>/<link>
 * tags and React 19 hoists them to <head> automatically.
 */
export function UnirendHeadProvider({
  children,
  collector,
}: {
  children: ReactNode;
  collector: HeadCollector | null;
}) {
  return (
    <UnirendHeadContext.Provider value={collector}>
      {children}
    </UnirendHeadContext.Provider>
  );
}

/**
 * Framework-native document head manager.
 *
 * Place <title>, <meta>, and <link> tags as direct children.
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
 */
export function UnirendHead({ children }: { children?: ReactNode }) {
  const collector = useContext(UnirendHeadContext);

  if (collector !== null) {
    // Server-side: walk children and collect into the ref.
    // renderToString is synchronous so mutations here are safe.
    collectServerHead(collector, children);

    // Render nothing server-side — data is captured in the collector.
    // The server injects it into <head> via the <!--ss-head--> marker.
    return null;
  }

  // Client-side: render the children as real DOM elements.
  // React 19 automatically hoists <title>, <meta>, <link> to <head>.
  return <>{children}</>;
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
    }
  });
}

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

function toHeadAttributes(
  props: Record<string, unknown>,
): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || value === null || value === undefined) {
      continue;
    }

    const attrValue = toHeadAttributeValue(value);
    if (attrValue !== null) {
      attrs[key] = attrValue;
    }
  }

  return attrs;
}

function toHeadAttributeValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return null;
}

/**
 * Serialize a collected HeadCollector into three HTML strings
 * suitable for injection into the <!--ss-head--> slot.
 */
export function serializeHeadCollector(collector: HeadCollector): {
  title: string;
  meta: string;
  link: string;
} {
  const title = collector.title
    ? `<title>${escapeHTML(collector.title)}</title>`
    : '';

  const meta = collector.metas
    .map((attrs) => {
      const attrsStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${escapeHTMLAttr(v)}"`)
        .join(' ');

      return `<meta ${attrsStr} />`;
    })
    .join('\n');

  const link = collector.links
    .map((attrs) => {
      const attrsStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${escapeHTMLAttr(v)}"`)
        .join(' ');

      return `<link ${attrsStr} />`;
    })
    .join('\n');

  return { title, meta, link };
}
