import { HTML_BOOLEAN_ATTRIBUTES } from '../html-utils/escape';

/**
 * React prop names whose HTML attribute is not just the prop lowercased, so writing them out
 * verbatim would produce an attribute that doesn't exist.
 *
 * Only the ones that differ by more than case belong here. HTML attribute names are matched
 * case-insensitively, so React spellings like `charSet` or `crossOrigin` already land on the
 * right attribute on their own. `className` and `httpEquiv` do not: `class` is a different word,
 * and `http-equiv` carries a hyphen. An unmapped `httpEquiv` would be serialized as an
 * `httpEquiv=""` attribute, which no parser reads as `http-equiv` — so the tag would not do its
 * job, and it could not be matched against the template's `http-equiv` baseline either.
 *
 * A `Map` rather than an object literal, because the lookup below is keyed by a name this module
 * does not choose. A plain object answers `obj['constructor']` with an inherited function, so a
 * prop named after anything on `Object.prototype` would resolve to a non-string and take the
 * render down a line later. Envelope-provided tags put those names within reach of the wire, see
 * `sanitizeTagAttributes()`. A `Map` carries no such inheritance and misses cleanly.
 */
const REACT_PROP_TO_HTML_ATTRIBUTE = new Map<string, string>([
  ['className', 'class'],
  ['httpEquiv', 'http-equiv'],
]);

/**
 * Converts React element properties into standard HTML attribute key-value records.
 *
 * Two props naming one attribute produce one entry, the last of them, because that is what the
 * page ends up with: React assigns each prop in turn and two casings of a name are one
 * `setAttribute` target. Keeping both would put both spellings in the record, and the record is
 * what the server serializes, so the served HTML carried a repeated attribute name. The tokenizer
 * resolves that the other way, keeping the first, so `<meta NAME="viewport" name="app-x">` was a
 * viewport meta to a crawler and an app-x meta the moment React hydrated it.
 */
export function toHeadAttributes(
  props: Record<string, unknown>,
): Record<string, string> {
  const attrs: Record<string, string> = {};

  // The name each attribute is currently filed under, found by its lowercased form, so a second
  // spelling can replace the first rather than sit beside it. Only ever more than a formality when
  // a child writes one attribute twice, which is why the record is written directly below and only
  // revisited here.
  const filedAs = new Map<string, string>();

  const file = (name: string, value: string): void => {
    const lowered = name.toLowerCase();
    const previous = filedAs.get(lowered);

    if (previous !== undefined && previous !== name) {
      delete attrs[previous];
    }

    filedAs.set(lowered, name);
    attrs[name] = value;
  };

  for (const [key, value] of Object.entries(props)) {
    // Exclude special children props and null/undefined values.
    if (key === 'children' || value === null || value === undefined) {
      continue;
    }

    // Map React prop spellings onto their real HTML attribute names (className -> class,
    // httpEquiv -> http-equiv); everything else is already the attribute name.
    const normKey = REACT_PROP_TO_HTML_ATTRIBUTE.get(key) ?? key;

    // Handle React style objects by serializing them to a standard inline style string.
    if (normKey === 'style' && typeof value === 'object') {
      file(normKey, serializeStyleObject(value as Record<string, unknown>));
    } else {
      const attrValue = toHeadAttributeValue(normKey, value);
      if (attrValue !== null) {
        file(normKey, attrValue);
      }
    }
  }

  return attrs;
}

/**
 * Normalizes React property values (strings, numbers, booleans) into standard
 * HTML attribute string values, returning null for unsupported types or omitted booleans.
 */
function toHeadAttributeValue(key: string, value: unknown): string | null {
  const normKey = key.toLowerCase();
  if (HTML_BOOLEAN_ATTRIBUTES.has(normKey)) {
    if (typeof value === 'boolean' || value === 'true' || value === 'false') {
      // Only an actual boolean false asks for the attribute to be left out. A string never does,
      // however it is spelled, because React reads any string as present: it writes `disabled=""`
      // for `disabled="false"` and warns that the browser will read it as truthy. Treating the
      // string as the removal marker had the server strip an attribute React went on to set, so a
      // `<link rel="stylesheet" disabled="false">` was live in the served HTML and off after
      // hydration. That spelling is the only one an envelope can send, since a `meta.page.tags`
      // value must be a string. See isRemovedBooleanAttribute() for what the marker means.
      return value === false ? 'false' : '';
    }
  }

  if (typeof value === 'string') {
    return value;
  } else if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  } else if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  } else {
    return null;
  }
}

/**
 * Common unitless CSS properties for which numeric values should not be suffixed with 'px'.
 */
const UNITLESS_CSS_PROPERTIES = new Set([
  'animation-iteration-count',
  'border-image-outset',
  'border-image-slice',
  'border-image-width',
  'box-flex',
  'box-flex-group',
  'box-ordinal-group',
  'column-count',
  'columns',
  'flex',
  'flex-grow',
  'flex-positive',
  'flex-shrink',
  'flex-negative',
  'flex-order',
  'grid-row',
  'grid-row-align',
  'grid-row-end',
  'grid-row-span',
  'grid-row-start',
  'grid-column',
  'grid-column-align',
  'grid-column-end',
  'grid-column-span',
  'grid-column-start',
  'font-weight',
  'line-clamp',
  'line-height',
  'opacity',
  'order',
  'orphans',
  'tab-size',
  'widows',
  'z-index',
  'zoom',
  'fill-opacity',
  'flood-opacity',
  'stop-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
]);

/**
 * Serializes a React CSSProperties object into a standard HTML inline style string.
 */
export function serializeStyleObject(
  styleObj: Record<string, unknown>,
): string {
  return Object.entries(styleObj)
    .map(([key, value]) => {
      if (value === null || value === undefined || value === '') {
        return '';
      }

      // Convert camelCase key (e.g. backgroundColor) to kebab-case (e.g. background-color)
      const kebabKey = key.replace(
        /[A-Z]/g,
        (match) => `-${match.toLowerCase()}`,
      );

      // CSSProperties values are strings or numbers; skip anything else rather
      // than emitting a useless '[object Object]' value.
      if (typeof value !== 'string' && typeof value !== 'number') {
        return '';
      }

      let formattedValue = String(value);
      // Append 'px' to numbers unless the CSS property is unitless
      if (typeof value === 'number' && !UNITLESS_CSS_PROPERTIES.has(kebabKey)) {
        formattedValue = `${value}px`;
      }

      return `${kebabKey}:${formattedValue}`;
    })
    .filter(Boolean)
    .join(';');
}
