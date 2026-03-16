import { escapeHTML, escapeHTMLAttr } from '../html-utils/escape';
import type { HeadCollector } from './context';

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
