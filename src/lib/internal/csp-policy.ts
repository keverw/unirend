import { validateConfigEntry } from 'lifecycleion/domain-utils';

/**
 * Source-expression keywords a browser understands, written with their quotes.
 *
 * Quoted in config exactly as they appear in the header. It reads the way every
 * CSP example on the internet reads, and it removes a real ambiguity: `self` is
 * also a perfectly valid host name, so an unquoted one has to be an error rather
 * than a guess.
 */
const CSP_KEYWORDS = new Set([
  "'self'",
  "'none'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'unsafe-hashes'",
  "'strict-dynamic'",
  "'report-sample'",
  "'wasm-unsafe-eval'",
  "'inline-speculation-rules'",
]);

/**
 * Keywords that turn a directive off rather than adding to it, so combining one
 * with anything else is always a mistake.
 */
const EXCLUSIVE_KEYWORDS = new Set(["'none'"]);

/** `'sha256-...'`, `'sha384-...'`, `'sha512-...'`, quoted. */
const HASH_SOURCE = /^'sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}'$/;

/** `'nonce-...'`, quoted. */
const NONCE_SOURCE = /^'nonce-[A-Za-z0-9+/\-_]+={0,2}'$/;

/** A bare scheme source such as `https:`, `data:`, or `blob:`. */
const SCHEME_SOURCE = /^[a-z][a-z0-9+.-]*:$/i;

/**
 * Schemes worth refusing outright in a source list.
 *
 * `javascript:` and `vbscript:` in a `script-src` allow exactly the injection a
 * policy exists to stop, and nobody writes either on purpose. Rejecting at
 * config time beats discovering it in a report.
 */
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'vbscript:']);

/**
 * Directives whose value is a source list, in the order they are serialized.
 *
 * Fixed order rather than object-key order so the same config always produces
 * byte-identical output. That keeps the header stable for caches and diffs, and
 * means a test can assert on the whole string.
 */
const SOURCE_LIST_DIRECTIVES = [
  ['defaultSrc', 'default-src'],
  ['scriptSrc', 'script-src'],
  ['scriptSrcElem', 'script-src-elem'],
  ['scriptSrcAttr', 'script-src-attr'],
  ['styleSrc', 'style-src'],
  ['styleSrcElem', 'style-src-elem'],
  ['styleSrcAttr', 'style-src-attr'],
  ['imgSrc', 'img-src'],
  ['fontSrc', 'font-src'],
  ['connectSrc', 'connect-src'],
  ['mediaSrc', 'media-src'],
  ['objectSrc', 'object-src'],
  ['childSrc', 'child-src'],
  ['frameSrc', 'frame-src'],
  ['workerSrc', 'worker-src'],
  ['manifestSrc', 'manifest-src'],
  ['prefetchSrc', 'prefetch-src'],
  ['formAction', 'form-action'],
  ['frameAncestors', 'frame-ancestors'],
  ['baseURI', 'base-uri'],
] as const;

type SourceListDirective = (typeof SOURCE_LIST_DIRECTIVES)[number][0];

/**
 * Named starting points, so a policy can be a few lines instead of twenty.
 *
 * - `strict`: everything same-origin, no plugins, no framing, no base-tag
 *   hijacking. The one to start from, with `reportOnly` on, and widen only
 *   where the reports say you must.
 * - `strict-with-cdn`: the same, plus `data:` images and blob workers, which
 *   is where a `strict` policy usually first hits reality. Still names no
 *   third-party host: add your CDN to `imgSrc` and `scriptSrc` yourself, so it
 *   appears in your config rather than hiding in a preset.
 *
 * Directives you set are merged over the preset per directive, replacing it
 * outright rather than adding to it. Writing `imgSrc` means your `imgSrc` and
 * not the preset's plus yours, so a preset can never silently widen something
 * you narrowed.
 */
export type CSPPreset = 'strict' | 'strict-with-cdn';

const CSP_PRESETS: Record<CSPPreset, CSPConfig> = {
  strict: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    // 'none' rather than 'self': <object> and <embed> are a legacy plugin
    // surface with no modern use, and the recommended value everywhere.
    objectSrc: ["'none'"],
    // Without this, an injected <base href> can redirect every relative URL on
    // the page, which is a quiet way around an otherwise tight script-src.
    baseURI: ["'self'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
  },
  'strict-with-cdn': {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    // data: covers inlined icons and the small images bundlers emit; blob:
    // covers canvas output and object URLs.
    imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    baseURI: ["'self'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    workerSrc: ["'self'", 'blob:'],
  },
};

/**
 * Apply a preset, with the caller's own directives taking precedence.
 *
 * Returns the config unchanged when no preset is named, so the non-preset path
 * costs nothing and behaves exactly as before.
 */
export function applyCSPPreset(config: CSPConfig): CSPConfig {
  if (!config.preset) {
    return config;
  }

  const preset = CSP_PRESETS[config.preset];

  if (!preset) {
    throw new Error(
      `Invalid securityHeaders config: csp.preset "${String(config.preset)}" is not a known preset. Available: ${Object.keys(CSP_PRESETS).join(', ')}.`,
    );
  }

  // Per-directive replacement rather than a deep merge, for the same reason the
  // per-tenant override replaces blocks: a merge would let a preset contribute
  // sources to a directive the caller thought they had written out in full.
  return { ...preset, ...config };
}

/**
 * Content-Security-Policy configuration.
 *
 * Every source-list directive takes an array of source expressions written the
 * way they appear in the header: `["'self'", 'https://cdn.example.com']`.
 * Keywords carry their quotes, hosts do not.
 */
export type CSPConfig = {
  [Directive in SourceListDirective]?: string[];
} & {
  /**
   * A named starting point. Directives you set replace the preset's, one
   * directive at a time. See {@link CSPPreset}.
   */
  preset?: CSPPreset;

  /**
   * `sandbox` directive tokens, for example `['allow-forms', 'allow-scripts']`.
   * An empty array emits the bare directive, which is the most restrictive form.
   */
  sandbox?: string[];

  /** Emits `upgrade-insecure-requests` when true. */
  upgradeInsecureRequests?: boolean;

  /**
   * Where violation reports go. `report-uri` is deprecated but still the only
   * one several browsers implement, so both are supported and either may be set.
   */
  reportURI?: string | string[];
  reportTo?: string;

  /**
   * Send `Content-Security-Policy-Report-Only` instead of enforcing.
   *
   * How a policy gets rolled out on a live site: violations are reported and
   * nothing is blocked, so you find what breaks without breaking it. Worth
   * running in this mode until the reports go quiet.
   */
  reportOnly?: boolean;

  /**
   * Opt in to `'unsafe-inline'` in a script directive.
   *
   * Rejected at config time otherwise. `'unsafe-inline'` in `script-src` is the
   * single setting that makes a policy stop defending against the attack it
   * exists for, and it is usually reached for to fix one inline script rather
   * than deliberately. Unirend hashes its own inline content, so the common
   * reasons to need it do not apply here.
   */
  allowUnsafeInlineScript?: boolean;

  /**
   * Opt in to `'unsafe-eval'` in a script directive. Some older bundlers and
   * template engines still need it; most code does not.
   */
  allowUnsafeEval?: boolean;
};

/** Directives where `'unsafe-inline'` is the dangerous one. */
const SCRIPT_DIRECTIVES = new Set<SourceListDirective>([
  'defaultSrc',
  'scriptSrc',
  'scriptSrcElem',
  'scriptSrcAttr',
]);

function isQuoted(source: string): boolean {
  return source.startsWith("'") && source.endsWith("'") && source.length > 1;
}

/**
 * Validate one source expression, returning an error message or null.
 *
 * Host sources are handed to the same `validateConfigEntry` that CORS origins
 * use, so `*.cdn.example.com` and a PSL tail behave identically in both places
 * rather than each having their own idea of a valid host.
 */
function validateSource(
  source: string,
  key: SourceListDirective,
  options: { allowUnsafeInlineScript: boolean; allowUnsafeEval: boolean },
): string | null {
  // The label used in messages. Kept separate from the key the checks below
  // compare against: an earlier cut used one string for both, so every
  // directive-specific rule silently matched nothing and 'unsafe-inline' walked
  // straight through the guard written to stop it.
  const directive = `csp.${key}`;

  if (typeof source !== 'string' || source.trim() === '') {
    return `${directive} contains an empty source`;
  }

  if (source !== source.trim()) {
    return `${directive} source "${source}" has leading or trailing whitespace`;
  }

  // A source expression is space-separated in the header, so an embedded space
  // would silently split one entry into two.
  if (/\s/.test(source)) {
    return `${directive} source "${source}" contains whitespace. Write each source as its own array entry.`;
  }

  // A semicolon would end the directive and start another one, so a value
  // carrying one can rewrite the rest of the policy.
  if (source.includes(';') || source.includes(',')) {
    return `${directive} source "${source}" contains ";" or ",", which would break out of the directive`;
  }

  if (isQuoted(source)) {
    if (CSP_KEYWORDS.has(source)) {
      if (source === "'unsafe-inline'" && SCRIPT_DIRECTIVES.has(key)) {
        return options.allowUnsafeInlineScript
          ? null
          : `${directive} includes 'unsafe-inline', which allows exactly the inline script injection CSP exists to prevent. Unirend hashes its own inline content, so this is rarely needed. Set csp.allowUnsafeInlineScript: true if you mean it.`;
      }

      if (source === "'unsafe-eval'" && !options.allowUnsafeEval) {
        return `${directive} includes 'unsafe-eval'. Set csp.allowUnsafeEval: true if you mean it.`;
      }

      return null;
    }

    if (HASH_SOURCE.test(source) || NONCE_SOURCE.test(source)) {
      return null;
    }

    // Quoted but unrecognized: almost always a typo or a keyword invented from
    // memory, and it would be silently ignored by the browser.
    return `${directive} source ${source} is quoted but is not a known keyword, hash, or nonce`;
  }

  // Unquoted keyword. Worth its own message: the browser reads it as a host
  // name, matches nothing, and the policy is quietly stricter than intended.
  if (CSP_KEYWORDS.has(`'${source}'`)) {
    return `${directive} source "${source}" must be quoted as '${source}'. Unquoted, a browser reads it as a host name.`;
  }

  if (source === '*') {
    return null;
  }

  if (SCHEME_SOURCE.test(source)) {
    return FORBIDDEN_SCHEMES.has(source.toLowerCase())
      ? `${directive} includes the scheme "${source}", which allows script injection through URLs`
      : null;
  }

  // Host source. Strip a path, which CSP allows and the host validator does not
  // understand, then validate what is left.
  const pathStart = source.indexOf('/', source.indexOf('//') + 2);
  const hostPart = pathStart === -1 ? source : source.slice(0, pathStart);

  const verdict = validateConfigEntry(hostPart, 'origin', {
    allowGlobalWildcard: true,
    allowProtocolWildcard: true,
  });

  if (!verdict.valid) {
    return `${directive} source "${source}" is not a valid host${verdict.info ? `: ${verdict.info}` : ''}`;
  }

  return null;
}

/**
 * Check a CSP config and throw on anything a browser would ignore or that
 * defeats the point of having a policy.
 *
 * Config time rather than request time, matching how the CORS options already
 * behave: a policy typo is a deployment bug, and finding it at startup beats
 * finding it in a violation report.
 */
export function validateCSPConfig(config: CSPConfig): void {
  const options = {
    allowUnsafeInlineScript: config.allowUnsafeInlineScript === true,
    allowUnsafeEval: config.allowUnsafeEval === true,
  };

  for (const [key] of SOURCE_LIST_DIRECTIVES) {
    const sources = config[key];

    if (sources === undefined) {
      continue;
    }

    if (!Array.isArray(sources)) {
      throw new TypeError(
        `Invalid securityHeaders config: csp.${key} must be an array of source expressions`,
      );
    }

    for (const source of sources) {
      const error = validateSource(source, key, options);

      if (error) {
        throw new Error(`Invalid securityHeaders config: ${error}`);
      }
    }

    for (const keyword of EXCLUSIVE_KEYWORDS) {
      if (sources.includes(keyword) && sources.length > 1) {
        throw new Error(
          `Invalid securityHeaders config: csp.${key} combines ${keyword} with other sources, which cannot be what you meant. ${keyword} means "allow nothing".`,
        );
      }
    }
  }

  if (config.sandbox !== undefined && !Array.isArray(config.sandbox)) {
    throw new Error(
      'Invalid securityHeaders config: csp.sandbox must be an array of tokens',
    );
  }

  for (const token of config.sandbox ?? []) {
    if (!/^allow-[a-z-]+$/.test(token)) {
      throw new Error(
        `Invalid securityHeaders config: csp.sandbox token "${token}" is not a valid sandbox token`,
      );
    }
  }

  const reportURIs =
    typeof config.reportURI === 'string'
      ? [config.reportURI]
      : (config.reportURI ?? []);

  for (const uri of reportURIs) {
    if (typeof uri !== 'string' || uri.trim() === '' || /[\s;,]/.test(uri)) {
      throw new Error(
        `Invalid securityHeaders config: csp.reportURI "${String(uri)}" is not a usable URI`,
      );
    }
  }

  if (config.reportTo !== undefined && /[\s;,]/.test(config.reportTo)) {
    throw new Error(
      `Invalid securityHeaders config: csp.reportTo "${config.reportTo}" is not a usable group name`,
    );
  }
}

/**
 * Extra source expressions to merge into a directive when the header is built.
 *
 * This is how unirend's own inline content gets covered without the caller
 * having to know it exists: the framework knows what it emitted and what the
 * hashes are, so it contributes them rather than documenting them and hoping.
 */
export interface CSPAdditions {
  scriptSrc?: readonly string[];
  styleSrc?: readonly string[];
}

/**
 * Serialize a policy to its header value.
 *
 * Returns an empty string when nothing is configured, which the caller reads as
 * "send no header" rather than sending an empty one.
 */
export function serializeCSP(
  config: CSPConfig,
  additions: CSPAdditions = {},
): string {
  const parts: string[] = [];

  for (const [key, directive] of SOURCE_LIST_DIRECTIVES) {
    const configured = config[key];

    // The element-specific directives get the hashes too, because when one is
    // set it is the only thing a browser consults for an inline `<script>` or
    // `<style>`: `script-src-elem` overrides `script-src` for elements rather
    // than adding to it. Hashes sitting in the fallback would be looked at by
    // nothing, and the inline content they cover would be blocked by a policy
    // that appears, on reading it, to allow exactly that content.
    //
    // Both are filled rather than only the more specific one. The element
    // directives are newer than the fallbacks, so a browser that does not
    // implement them reads `script-src`, and a hash in a directive that is not
    // consulted costs nothing.
    //
    // The `-attr` directives are deliberately not here. They govern `onclick=`
    // and `style=""`, which no hash can cover: a hash covers an element's text
    // content, and an attribute has none.
    const extra =
      key === 'scriptSrc' || key === 'scriptSrcElem'
        ? additions.scriptSrc
        : key === 'styleSrc' || key === 'styleSrcElem'
          ? additions.styleSrc
          : undefined;

    if (configured === undefined && (extra === undefined || !extra.length)) {
      continue;
    }

    // Only contribute to a directive the caller actually set. Adding a hash to
    // an unset script-src would create a directive that overrides default-src
    // and blocks everything the caller expected default-src to allow.
    const sources =
      configured === undefined
        ? []
        : [...configured, ...(extra ?? [])].filter(
            (source, index, all) => all.indexOf(source) === index,
          );

    if (!sources.length) {
      continue;
    }

    parts.push(`${directive} ${sources.join(' ')}`);
  }

  if (config.sandbox !== undefined) {
    parts.push(
      config.sandbox.length ? `sandbox ${config.sandbox.join(' ')}` : 'sandbox',
    );
  }

  if (config.upgradeInsecureRequests) {
    parts.push('upgrade-insecure-requests');
  }

  if (config.reportURI !== undefined) {
    const uris =
      typeof config.reportURI === 'string'
        ? [config.reportURI]
        : config.reportURI;

    if (uris.length) {
      parts.push(`report-uri ${uris.join(' ')}`);
    }
  }

  if (config.reportTo !== undefined) {
    parts.push(`report-to ${config.reportTo}`);
  }

  return parts.join('; ');
}

/**
 * Header name for a policy, which is the whole of what `reportOnly` changes.
 */
export function cspHeaderName(config: CSPConfig): string {
  return config.reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
}
