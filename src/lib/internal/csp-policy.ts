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
 * The kind of content a directive governs, which decides how its source list
 * is read. Scripts and script attributes answer to `'strict-dynamic'`; styles
 * and style attributes do not.
 */
export type CSPInlineKind = 'script' | 'style';

/**
 * Whether `'unsafe-inline'` in this source list actually does anything.
 *
 * Writing the keyword is not the same as having it take effect. A browser
 * ignores `'unsafe-inline'` when the same source list carries a hash or a
 * nonce, which leaves a directive that reads permissive and behaves strictly.
 * Everything that has to reason about inline content needs the second question
 * rather than the first, so it lives here and is asked in one place.
 *
 * `'strict-dynamic'` disables it as well, but **only in a script directive**.
 * The CSP3 algorithm behind this checks the keyword solely when the type being
 * asked about is "script" or "script attribute", so in `style-src` it is inert
 * and `'unsafe-inline'` keeps working. Getting that wrong is not academic: a
 * caller who wrote `style-src 'unsafe-inline' 'strict-dynamic'` has a working
 * policy, and concluding the keyword was already dead would have us contribute
 * hashes that then genuinely kill it, breaking every inline style on the page.
 *
 * Verified in Chrome. An inline script runs under `script-src 'unsafe-inline'`
 * and is blocked the moment a hash, a nonce, or `'strict-dynamic'` joins it,
 * with only a matching hash bringing it back. An inline style still applies
 * under `style-src 'unsafe-inline' 'strict-dynamic'`, and stops the moment a
 * hash is added to it.
 *
 * @param sources The directive's configured source list
 * @param kind What the directive governs, since `'strict-dynamic'` is read only
 *   for scripts
 */
export function isUnsafeInlineEffective(
  sources: readonly string[] | undefined,
  kind: CSPInlineKind,
): boolean {
  if (!sources?.includes("'unsafe-inline'")) {
    return false;
  }

  return !sources.some(
    (source) =>
      (kind === 'script' && source === "'strict-dynamic'") ||
      HASH_SOURCE.test(source) ||
      NONCE_SOURCE.test(source),
  );
}

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

/**
 * The non-directive keys, listed so an unrecognized one can be reported.
 *
 * `satisfies` is what keeps this honest. Adding a field to `CSPConfig` without
 * adding it here is a type error rather than a validator that starts rejecting
 * a field it should accept, which is the failure a hand-maintained key list
 * invites and nobody notices until someone's config is refused.
 */
const CSP_SCALAR_KEYS = {
  preset: true,
  sandbox: true,
  upgradeInsecureRequests: true,
  reportURI: true,
  reportTo: true,
  reportOnly: true,
  allowUnsafeInlineScript: true,
  allowUnsafeEval: true,
} satisfies Record<Exclude<keyof CSPConfig, SourceListDirective>, true>;

/** Every key a CSP config may carry, directives included. */
const CSP_CONFIG_KEYS = new Set<string>([
  ...SOURCE_LIST_DIRECTIVES.map(([key]) => key),
  ...Object.keys(CSP_SCALAR_KEYS),
]);

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
 * One thing wrong with a config, located well enough to point a form field at.
 */
export interface CSPIssue {
  /** Dotted path from the policy object, such as `csp.scriptSrc`. */
  path: string;
  /** The message the throwing validator would have used. */
  message: string;
}

/**
 * Name a value for a message, without putting the value itself in it.
 *
 * Strings are quoted because seeing the exact text is usually the whole hint,
 * and everything else is described by kind: an object or an array printed into
 * a message is noise at best, and at worst it copies a chunk of a stored policy
 * into a log or an HTTP response.
 */
export function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'an array';
  }

  switch (typeof value) {
    case 'string':
      return `the string "${value}"`;
    case 'number':
    case 'boolean':
      return `the ${typeof value} ${String(value)}`;
    case 'object':
      return 'an object';
    default:
      return `a ${typeof value}`;
  }
}

/** Whether a value is usable as a config block: an object, not an array. */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Anything that starts with a scheme, so a relative URI can be told apart. */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Whether a violation-report endpoint is one a browser will actually post to,
 * returning the trailing half of a message or null.
 *
 * Weaker than the source-list check on purpose. A source expression is a host
 * pattern, so `*.cdn.example.com` is meaningful there and goes through the same
 * host validator a CORS origin does. `report-uri` takes a single real URL, and
 * no wildcard belongs in it.
 *
 * What is checked is the part a browser silently drops. A scheme it will not
 * post over, or something that is neither absolute nor rooted at the origin,
 * leaves a policy that looks like it reports and does not, which is the worst
 * way for reporting to be off: violations happen, nothing arrives, and the
 * quiet reads as success.
 */
function reportEndpointProblem(uri: string): string | null {
  // Origin-relative, the ordinary form for reporting to your own server. Also
  // covers the protocol-relative "//host/path", which is valid here.
  if (uri.startsWith('/')) {
    return null;
  }

  if (!SCHEME_PREFIX.test(uri)) {
    // A bare "csp-report" is a valid relative URL, and that is the problem: it
    // resolves against whatever page was being viewed, so reports arrive at a
    // different endpoint per page and mostly at ones that do not exist.
    return 'is relative to the current page. Write it as an absolute URL, or as a path beginning with "/" to post to this origin.';
  }

  let parsed: URL;

  try {
    parsed = new URL(uri);
  } catch {
    return 'is not a parsable URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `uses the "${parsed.protocol.slice(0, -1)}" scheme, and a browser only posts violation reports over http or https`;
  }

  return null;
}

/**
 * Every problem with a CSP config, rather than the first one.
 *
 * Split out from the throwing validator because the two callers want opposite
 * things. A server starting up wants to stop at the first problem, since there
 * is nobody to show a list to. Anything validating a policy a person is editing
 * wants all of them at once, because fixing one error only to be shown the next
 * is a miserable way to fill in a form.
 *
 * Every value is treated as unknown regardless of what the parameter type says,
 * because a config reaching here may have come from a database row or a form
 * post rather than from the repository. A rule that trusted the declared type
 * and reached into a value would throw on exactly the malformed input a caller
 * asked this function to describe.
 */
export function collectCSPIssues(config: CSPConfig): CSPIssue[] {
  if (!isPlainObject(config)) {
    return [
      {
        path: 'csp',
        message: `Invalid securityHeaders config: csp must be an object of directives, received ${describeValue(config)}`,
      },
    ];
  }

  const issues: CSPIssue[] = [];

  for (const key of Object.keys(config)) {
    if (!CSP_CONFIG_KEYS.has(key)) {
      issues.push({
        path: `csp.${key}`,
        message: `Invalid securityHeaders config: csp.${key} is not a CSP option. A misspelled directive is dropped silently, so it is reported here rather than leaving a policy weaker than it reads.`,
      });
    }
  }

  // Checked here as well as in applyCSPPreset, which throws on an unknown name
  // at serialization time. Without this, an unknown preset is the one mistake
  // that validates cleanly and then fails per request, which defeats the point
  // of checking a stored policy before storing it.
  if (
    config.preset !== undefined &&
    !Object.keys(CSP_PRESETS).includes(config.preset)
  ) {
    issues.push({
      path: 'csp.preset',
      message: `Invalid securityHeaders config: csp.preset "${String(config.preset)}" is not a known preset. Available: ${Object.keys(CSP_PRESETS).join(', ')}.`,
    });
  }

  for (const key of [
    'upgradeInsecureRequests',
    'reportOnly',
    'allowUnsafeInlineScript',
    'allowUnsafeEval',
  ] as const) {
    const value: unknown = config[key];

    if (value !== undefined && typeof value !== 'boolean') {
      issues.push({
        path: `csp.${key}`,
        message: `Invalid securityHeaders config: csp.${key} must be a boolean, received ${describeValue(value)}`,
      });
    }
  }

  // The opt-in flags are compared against `true` rather than read as truthy, so
  // a string "false" out of a form does not switch 'unsafe-inline' on. The
  // check above is what tells the caller that, instead of leaving them with a
  // setting that reads as enabled and is not.
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
      issues.push({
        path: `csp.${key}`,
        message: `Invalid securityHeaders config: csp.${key} must be an array of source expressions`,
      });

      // Nothing below can read a non-array, so move on rather than reporting a
      // pile of consequences of the same mistake.
      continue;
    }

    for (const source of sources) {
      const error = validateSource(source, key, options);

      if (error) {
        issues.push({
          path: `csp.${key}`,
          message: `Invalid securityHeaders config: ${error}`,
        });
      }
    }

    for (const keyword of EXCLUSIVE_KEYWORDS) {
      if (sources.includes(keyword) && sources.length > 1) {
        issues.push({
          path: `csp.${key}`,
          message: `Invalid securityHeaders config: csp.${key} combines ${keyword} with other sources, which cannot be what you meant. ${keyword} means "allow nothing".`,
        });
      }
    }
  }

  if (config.sandbox !== undefined && !Array.isArray(config.sandbox)) {
    issues.push({
      path: 'csp.sandbox',
      message:
        'Invalid securityHeaders config: csp.sandbox must be an array of tokens',
    });
  } else {
    for (const token of config.sandbox ?? []) {
      if (typeof token !== 'string' || !/^allow-[a-z-]+$/.test(token)) {
        issues.push({
          path: 'csp.sandbox',
          message: `Invalid securityHeaders config: csp.sandbox token ${describeValue(token)} is not a valid sandbox token`,
        });
      }
    }
  }

  const hasUsableReportURI =
    config.reportURI === undefined ||
    typeof config.reportURI === 'string' ||
    Array.isArray(config.reportURI);

  if (!hasUsableReportURI) {
    issues.push({
      path: 'csp.reportURI',
      message: `Invalid securityHeaders config: csp.reportURI must be a URI or an array of URIs, received ${describeValue(config.reportURI)}`,
    });
  }

  const reportURIs = !hasUsableReportURI
    ? []
    : typeof config.reportURI === 'string'
      ? [config.reportURI]
      : (config.reportURI ?? []);

  for (const uri of reportURIs) {
    if (typeof uri !== 'string' || uri.trim() === '' || /[\s;,]/.test(uri)) {
      issues.push({
        path: 'csp.reportURI',
        message: `Invalid securityHeaders config: csp.reportURI ${describeValue(uri)} is not a usable URI`,
      });

      continue;
    }

    const problem = reportEndpointProblem(uri);

    if (problem) {
      issues.push({
        path: 'csp.reportURI',
        message: `Invalid securityHeaders config: csp.reportURI "${uri}" ${problem}`,
      });
    }
  }

  // The emptiness check matters as much as the character check. An empty string
  // contains none of the forbidden characters, so it would validate and then
  // serialize as a bare `report-to`, which is not a valid directive. A browser
  // drops it, and reporting is silently off for the one policy whose whole job
  // is telling you what it blocked.
  if (config.reportTo !== undefined && typeof config.reportTo !== 'string') {
    issues.push({
      path: 'csp.reportTo',
      message: `Invalid securityHeaders config: csp.reportTo must be a group name, received ${describeValue(config.reportTo)}`,
    });
  } else if (
    config.reportTo !== undefined &&
    (config.reportTo.trim() === '' || /[\s;,]/.test(config.reportTo))
  ) {
    issues.push({
      path: 'csp.reportTo',
      message: `Invalid securityHeaders config: csp.reportTo "${config.reportTo}" is not a usable group name`,
    });
  }

  return issues;
}

/**
 * Check a CSP config and throw on anything a browser would ignore or that
 * defeats the point of having a policy.
 *
 * Config time rather than request time, matching how the CORS options already
 * behave: a policy typo is a deployment bug, and finding it at startup beats
 * finding it in a violation report.
 *
 * Throws on the first problem, because a server that cannot start has nowhere
 * to put a list. Use `collectCSPIssues` where the policy came from a person
 * rather than from the repository.
 */
export function validateCSPConfig(config: CSPConfig): void {
  const [first] = collectCSPIssues(config);

  if (first) {
    throw new Error(first.message);
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
    // The `-attr` directives are deliberately not here, because of what these
    // particular hashes are rather than what hashes can do. `additions` holds
    // digests of element *content*, the bootstrap script and the error-page
    // styles, and an attribute's value is different content with a different
    // digest. Copying them into `script-src-attr` would list hashes that match
    // no attribute on the page.
    //
    // An attribute can be covered by a hash, just not by one of these: it takes
    // `'unsafe-hashes'` in the directive plus a digest of the attribute's own
    // value. That is the caller's decision to make, so unirend reports those
    // attributes and the hash each would need rather than quietly switching the
    // keyword on. See the inline-attribute warning in security-headers.ts.
    const isScriptDirective =
      key === 'scriptSrc' || key === 'scriptSrcElem' || key === 'scriptSrcAttr';

    let extra =
      key === 'scriptSrc' || key === 'scriptSrcElem'
        ? additions.scriptSrc
        : key === 'styleSrc' || key === 'styleSrcElem'
          ? additions.styleSrc
          : undefined;

    // Adding a hash to a directive where 'unsafe-inline' is doing real work
    // would revoke the opt-in, since a browser ignores the keyword as soon as
    // any hash or nonce joins the list. Contributing here would silently block
    // every inline script or style the caller had just declared they wanted,
    // under a directive that still reads as though it allowed them. Nothing is
    // lost by staying out: 'unsafe-inline' already covers the content those
    // hashes were for.
    //
    // "Doing real work" is the whole condition, not just the keyword's
    // presence. A caller who writes `'unsafe-inline' 'sha256-theirs'`, or pairs
    // it with a nonce, already has an inert keyword and a directive matching on
    // hashes alone. Withholding ours there does not preserve anything, it just
    // leaves unirend's own bootstrap script blocked unless their hash happens
    // to be ours.
    //
    // The directive's kind is passed because 'strict-dynamic' has that effect
    // in a script directive and not in a style one. Assuming otherwise would
    // invert this on `style-src 'unsafe-inline' 'strict-dynamic'`, a policy
    // whose inline styles work: reading the keyword as already dead would have
    // us add hashes that then really do kill it.
    //
    // Checked per directive, since a caller can put 'unsafe-inline' in
    // script-src while script-src-elem stays strict, and it is the element
    // directive that governs an inline <script> when both are set.
    //
    // Guarded on `extra` so the kind below is only decided for the four
    // directives that receive additions. default-src governs both scripts and
    // styles and has no single answer, and it never gets additions anyway.
    if (
      extra &&
      isUnsafeInlineEffective(
        configured,
        isScriptDirective ? 'script' : 'style',
      )
    ) {
      extra = undefined;
    }

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
