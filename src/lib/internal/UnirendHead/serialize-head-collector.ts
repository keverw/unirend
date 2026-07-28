import {
  escapeHTML,
  escapeHTMLAttr,
  isRemovedBooleanAttribute,
} from '../html-utils/escape';
import type { HeadCollector } from './context';

/**
 * One tag's attributes, with the boolean attributes an author turned off left out.
 *
 * `toHeadAttributes()` encodes `disabled={false}` as the string `'false'`, which is a marker
 * meaning "do not write this", not a value. Written out it says the opposite of what was asked:
 * a boolean attribute is true by its presence, so `disabled="false"` is a disabled tag. The
 * client renders the same element through React, which omits the attribute entirely, so leaving
 * the marker in place shipped a disabled stylesheet that hydration then quietly enabled.
 */
function serializeTagAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .filter(([name, value]) => !isRemovedBooleanAttribute(name, value))
    .map(([name, value]) => `${name}="${escapeHTMLAttr(value)}"`)
    .join(' ');
}

/**
 * Serialize a collected HeadCollector into three HTML strings
 * suitable for injection into the <!--ss-head--> slot.
 */
export function serializeHeadCollector(collector: HeadCollector): {
  title: string;
  meta: string;
  link: string;
  htmlAttrs: Record<string, string>;
  bodyAttrs: Record<string, string>;
} {
  const title = collector.title
    ? `<title>${escapeHTML(collector.title)}</title>`
    : '';

  const meta = collector.metas
    .map((attrs) => `<meta ${serializeTagAttributes(attrs)} />`)
    .join('\n');

  const link = collector.links
    .map((attrs) => `<link ${serializeTagAttributes(attrs)} />`)
    .join('\n');

  return {
    title,
    meta,
    link,
    htmlAttrs: collector.htmlAttrs,
    bodyAttrs: collector.bodyAttrs,
  };
}
