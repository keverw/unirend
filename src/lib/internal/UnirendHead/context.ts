import { createContext } from 'react';

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
export const UnirendHeadContext = createContext<HeadCollector | null>(null);
