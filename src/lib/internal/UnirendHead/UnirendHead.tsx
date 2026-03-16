import React, { useContext } from 'react';
import type { ReactNode } from 'react';
import { UnirendHeadContext } from './context';
import type { HeadCollector } from './context';

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
