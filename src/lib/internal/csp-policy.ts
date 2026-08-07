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

/**
 * The `sandbox` directive's tokens, which are a closed set defined by HTML's
 * sandbox flags rather than an open `allow-*` namespace.
 *
 * Listed out because a shape test cannot do this job. A browser silently
 * ignores a token it does not recognize, so `allow-form` for `allow-forms`
 * produces a sandbox with forms still disabled and nothing anywhere saying why,
 * which is the same silence this file already refuses to accept for a
 * misspelled directive name or a keyword invented from memory.
 */
const SANDBOX_TOKENS = new Set([
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]);

/**
 * `'sha256-...'`, `'sha384-...'`, `'sha512-...'`, quoted.
 *
 * The alphabet is base64 **and** base64url, matching CSP3's `base64-value`
 * (`1*( ALPHA / DIGIT / "+" / "/" / "-" / "_" )*2( "=" )`), which is the same
 * set `NONCE_SOURCE` below accepts. A tool that emits base64url, or a digest
 * run through a base64url encoder, produces a hash a browser honors, so
 * refusing it here would fail startup on a source expression that works.
 *
 * The `i` flag is there for the algorithm name, which is the only part it
 * changes: the digest's character class already spans both cases, and nothing
 * here rewrites the digest, which would change the bytes it decodes to. CSP3
 * writes the grammar with ABNF string literals, and RFC 5234 defines those as
 * case-insensitive, so `'SHA256-...'` is a hash a browser reads and a tool that
 * upper-cases the name should not fail startup.
 *
 * `isUnsafeInlineEffective` tests with this same pattern, so the two agree
 * about what a hash is. That matters more than the validation does: a hash it
 * failed to recognize would read as "no hash here", and the keyword logic would
 * conclude an `'unsafe-inline'` was live when a browser had already killed it.
 */
const HASH_SOURCE = /^'sha(?:256|384|512)-[A-Za-z0-9+/\-_]+={0,2}'$/i;

/** `'nonce-...'`, quoted. Same case rule as the hash above. */
const NONCE_SOURCE = /^'nonce-[A-Za-z0-9+/\-_]+={0,2}'$/i;

/** A bare scheme source such as `https:`, `data:`, or `blob:`. */
const SCHEME_SOURCE = /^[a-z][a-z0-9+.-]*:$/i;

/**
 * A CSP `host-source`, split into scheme, host, port, and path.
 *
 * Written out here because the grammar is wider than an origin's, and the two
 * places it is wider are exactly the two a shared origin validator gets wrong:
 * the scheme is optional, so `localhost:3000` is a host and a port rather than
 * a scheme and a path, and the port may be `*`.
 *
 * The host half is deliberately loose (`[^:/?#]+`) because it is handed
 * straight to `validateConfigEntry`, which is the thing that actually knows
 * what a valid host looks like, wildcards and public-suffix rules included.
 * This only has to cut the source into the right pieces.
 */
const CSP_HOST_SOURCE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^:/?#]+)(?::(\d+|\*))?(\/[^;,]*)?$/i;

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
 * Schemes refused in a script directive specifically.
 *
 * `data:` there is an `'unsafe-inline'` in everything but name: it makes
 * `<script src="data:text/javascript,...">` load, so an injected attribute
 * carries its own payload and no hash or nonce is involved. Google's CSP
 * Evaluator rates it high severity for that reason, and a policy carrying it
 * has stopped defending against the attack it exists for while still reading
 * as a strict one.
 *
 * `*` is deliberately *not* here, and the difference is worth stating because
 * it looks inconsistent. `*` does not match `data:`, `blob:`, or `filesystem:`
 * and does not permit inline, so `script-src *` is a coarse policy rather than
 * a bypass: it allows any host to serve your scripts, which is bad and visible
 * in the config someone wrote. `data:` is a bypass, which is neither.
 */
const FORBIDDEN_SCRIPT_SCHEMES = new Set(['data:']);

/**
 * Directives that were part of CSP and are not any more.
 *
 * Reported by name rather than as "not a CSP option", because the two are
 * different mistakes. A misspelling means the author meant something else; a
 * removed directive means they meant exactly this and the platform moved. The
 * message should say which.
 */
const REMOVED_DIRECTIVES: Record<string, string> = {
  prefetchSrc:
    'prefetch-src was removed from CSP and no browser shipped it un-flagged. Chrome logs an "Unrecognized Content-Security-Policy directive" warning for it on every page load, which trains people to ignore CSP console output. Prefetches fall under the directive for what is being fetched, so use defaultSrc or the specific one.',
  pluginTypes:
    'plugin-types was removed from CSP along with browser plugin support. Use objectSrc: ["\'none\'"] instead.',
  navigateTo:
    'navigate-to was removed from CSP before any browser shipped it. Use formAction for form submissions, and frameAncestors for who may frame you.',
  blockAllMixedContent:
    'block-all-mixed-content was removed from CSP. Use upgradeInsecureRequests instead.',
  referrer:
    'The CSP referrer directive was removed. Use the securityHeaders referrerPolicy option, which sends the Referrer-Policy header.',
};

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
 *
 * Something that is not a policy at all comes back unchanged too, for the same
 * reason `collectCSPIssues` treats its argument as unknown: a config reaching
 * here may have come from a JSON file or a database row, and expanding a
 * preset is not the step that should have an opinion about that. Handing it
 * back leaves validation to say what is wrong with it, in a sentence a caller
 * can act on, rather than failing here with a TypeError about reading a
 * property of null.
 */
export function applyCSPPreset(config: CSPConfig): CSPConfig {
  if (!isPlainObject(config) || !config.preset) {
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

  /**
   * `require-trusted-types-for`, which turns the DOM's injection sinks into
   * type errors rather than XSS.
   *
   * `["'script'"]` is the whole vocabulary today. With it set, assigning a
   * plain string to `innerHTML`, `eval`, and the rest throws unless the value
   * came from a Trusted Types policy, which moves DOM XSS from something you
   * audit for to something the browser refuses.
   *
   * A hash or nonce policy governs the scripts a *page* ships. This governs
   * what the code in those scripts is allowed to do afterwards, which is the
   * half a source list cannot reach.
   */
  requireTrustedTypesFor?: string[];

  /**
   * `trusted-types`, the allowlist of policy names `trustedTypes.createPolicy`
   * may create.
   *
   * Takes policy names plus three specials: `'none'` to forbid creating any,
   * `'allow-duplicates'` to permit a name being created more than once (which
   * bundlers and some libraries need), and `*` for any name.
   *
   * ```ts
   * requireTrustedTypesFor: ["'script'"],
   * trustedTypes: ['default', 'dompurify', "'allow-duplicates'"],
   * ```
   */
  trustedTypes?: string[];
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
  requireTrustedTypesFor: true,
  trustedTypes: true,
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

    if (HASH_SOURCE.test(source)) {
      return null;
    }

    // A nonce in static config is refused, and this is the one rejection here
    // that is about unirend rather than about CSP. A nonce has to be
    // unpredictable and different on every response to mean anything; one
    // written in a config file is the same value forever, so it authorizes an
    // attacker's injected script exactly as readily as your own. Unirend
    // generates no nonces, so there is no path by which this one could be
    // anything else.
    //
    // It also does active harm on the way past: a nonce in a source list makes
    // a browser ignore any 'unsafe-inline' beside it, so a policy that was
    // working stops working, and the hashes unirend contributes are withheld
    // from a directive it judges to have a live nonce.
    if (NONCE_SOURCE.test(source)) {
      return `${directive} contains a nonce. A nonce has to change on every response to mean anything, and one written in config never does, so it would authorize injected script as readily as your own. Unirend hashes its own inline content and the active template's, so use hashes here instead.`;
    }

    // A keyword written in the wrong case is technically valid CSP, since the
    // grammar's string literals are ASCII case-insensitive, and it is still
    // refused here rather than normalized. Normalizing would mean teaching
    // every downstream exact-string comparison the same trick, and there are
    // several: the `'unsafe-inline'` liveness check, the `'none'` exclusivity
    // rule, the `'unsafe-hashes'` attribute check. Missing one of those is not
    // a startup error, it is a policy that reads one way and behaves another,
    // which is the failure this whole file is arranged to avoid. Refusing a
    // spelling nobody writes on purpose costs a clear message at boot.
    if (CSP_KEYWORDS.has(source.toLowerCase())) {
      return `${directive} source ${source} is a keyword written in the wrong case. Write it lowercase, as ${source.toLowerCase()}.`;
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
    const scheme = source.toLowerCase();

    if (FORBIDDEN_SCHEMES.has(scheme)) {
      return `${directive} includes the scheme "${source}", which allows script injection through URLs`;
    }

    // Refused only where it is a bypass. `data:` is ordinary and useful in
    // imgSrc and fontSrc, and is arbitrary code execution in a script
    // directive: `<script src="data:text/javascript,...">` carries its own
    // payload, so an injected tag needs no hash and no nonce.
    if (SCRIPT_DIRECTIVES.has(key) && FORBIDDEN_SCRIPT_SCHEMES.has(scheme)) {
      return `${directive} includes the scheme "${source}", which lets a script carry its own source: <script src="data:text/javascript,..."> needs no hash and no nonce, so this undoes the directive it is written in. Move it to a non-script directive if you meant it there.`;
    }

    return null;
  }

  // Host source. Taken apart here rather than handed over whole, because CSP's
  // host-source grammar is wider than the origin grammar the shared validator
  // implements, and the difference is not academic.
  //
  // CSP3 2.3.1:
  //   host-source = [ scheme-part "://" ] host-part [ ":" port-part ] [ path-part ]
  //   port-part   = 1*DIGIT / "*"
  //
  // Two forms the origin validator refuses and every browser honors. A wildcard
  // port, `https://cdn.example.com:*`, and a scheme-less host with a port,
  // `localhost:3000`. Verified in Chrome: a script loads under both
  // `script-src http://localhost:*` and `script-src localhost:8792`, and is
  // blocked under a control naming a different port, so the grammar is really
  // being read rather than the source being ignored.
  //
  // Refusing them at startup is worse than it looks. `connectSrc:
  // ['ws://localhost:*']` is how a dev server's HMR socket gets allowed, so the
  // failure lands on a policy someone wrote correctly, and the natural way out
  // is to drop the port constraint entirely. A validator whose practical effect
  // is a *wider* policy than the author intended has done the opposite of its
  // job.
  const parts = CSP_HOST_SOURCE.exec(source);

  if (!parts) {
    return `${directive} source "${source}" is not a valid host`;
  }

  const [, scheme, host, port] = parts;

  // A numeric port still has to be a port. `*` is the other legal value and
  // needs no range check.
  if (port !== undefined && port !== '*') {
    const portNumber = Number(port);

    if (portNumber < 1 || portNumber > 65535) {
      return `${directive} source "${source}" has a port outside 1-65535`;
    }
  }

  // The host half, with the scheme kept so a protocol wildcard is still judged
  // as one. The port and path are gone by here, which is the whole point: they
  // are CSP grammar the origin validator does not implement.
  const verdict = validateConfigEntry(
    scheme ? `${scheme}://${host}` : host,
    'origin',
    {
      allowGlobalWildcard: true,
      allowProtocolWildcard: true,
    },
  );

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

/**
 * A base a relative report endpoint is resolved against, so one can be checked
 * at all.
 *
 * `report-uri` takes URI references, so `csp-report` and `../reports` are as
 * valid as an absolute URL and are resolved against the protected resource. At
 * config time there is no protected resource to resolve against, so a stand-in
 * is used. `.invalid` is reserved by RFC 2606 and can never be a real host, and
 * nothing resolved against it is ever emitted: the configured value is what
 * goes in the header, and this is only ever asked whether it parses.
 *
 * Http rather than https, because the scheme of a relative reference comes from
 * its base. An https base would answer a question about the endpoint with a
 * fact about the base, and both are acceptable schemes here anyway.
 */
const REPORT_URI_BASE = 'http://csp-report-validation.invalid/';

/**
 * Whether a violation-report endpoint is one a browser will actually post to,
 * returning the trailing half of a message or null.
 *
 * Weaker than the source-list check on purpose. A source expression is a host
 * pattern, so `*.cdn.example.com` is meaningful there and goes through the same
 * host validator a CORS origin does. `report-uri` takes a URI reference, and no
 * wildcard belongs in one.
 *
 * Resolving against a fixed base is what makes the check both correct and
 * complete, rather than a shape test on the leading characters. It accepts every
 * relative form the grammar allows, and it rejects the ones that look rooted and
 * are not: `//`, `///`, and `//?x` are network-path references with no
 * authority, so they name no endpoint, and a leading-slash test waves all three
 * through while turning away a perfectly valid `csp-report`.
 *
 * What is left to catch is the part a browser silently drops: an unparsable
 * reference, or a scheme it will not post over. Either leaves a policy that
 * looks like it reports and does not, which is the worst way for reporting to be
 * off, since violations happen, nothing arrives, and the quiet reads as success.
 */
function reportEndpointProblem(uri: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(uri, REPORT_URI_BASE);
  } catch {
    return 'is not a usable URL';
  }

  // Read from the resolved URL rather than from the text, so a relative
  // reference is judged by the scheme it would actually be fetched over.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `uses the "${parsed.protocol.slice(0, -1)}" scheme, and a browser only posts violation reports over http or https`;
  }

  return null;
}

/**
 * The sink groups `require-trusted-types-for` accepts.
 *
 * One entry, and that is the specification's whole vocabulary rather than an
 * abbreviation. Quoted, because it is a keyword.
 */
const TRUSTED_TYPES_SINK_GROUPS = new Set(["'script'"]);

/**
 * The specials a `trusted-types` list may carry alongside policy names.
 *
 * `'none'` forbids creating any policy, `'allow-duplicates'` permits a name
 * being created more than once, which bundlers and some libraries need, and `*`
 * allows any name.
 */
const TRUSTED_TYPES_KEYWORDS = new Set(["'none'", "'allow-duplicates'", '*']);

/**
 * A Trusted Types policy name, per the spec's `tt-policy-name`.
 */
const TRUSTED_TYPES_POLICY_NAME = /^[A-Za-z0-9\-#=_/@.%]+$/;

/**
 * Every problem with the two Trusted Types directives.
 *
 * Checked like the sandbox tokens and for the same reason: both are closed
 * vocabularies, and a browser drops what it cannot parse. A misspelled sink
 * group leaves the DOM sinks unguarded while the policy reads as though it
 * guards them, which is the failure this file exists to make loud.
 */
function collectTrustedTypesIssues(config: CSPConfig): CSPIssue[] {
  const issues: CSPIssue[] = [];
  const sinkGroups: unknown = config.requireTrustedTypesFor;

  if (sinkGroups !== undefined) {
    if (!Array.isArray(sinkGroups)) {
      issues.push({
        path: 'csp.requireTrustedTypesFor',
        message: `Invalid securityHeaders config: csp.requireTrustedTypesFor must be an array, received ${describeValue(sinkGroups)}`,
      });
    } else if (sinkGroups.length === 0) {
      // The bare directive is not valid CSP: the grammar requires at least one
      // sink group, so a browser drops the whole thing.
      issues.push({
        path: 'csp.requireTrustedTypesFor',
        message:
          'Invalid securityHeaders config: csp.requireTrustedTypesFor is empty, which a browser drops. Use ["\'script\'"], or omit the key.',
      });
    } else {
      for (const group of sinkGroups) {
        if (
          typeof group !== 'string' ||
          !TRUSTED_TYPES_SINK_GROUPS.has(group)
        ) {
          issues.push({
            path: 'csp.requireTrustedTypesFor',
            message: `Invalid securityHeaders config: csp.requireTrustedTypesFor entry ${describeValue(group)} is not a sink group. The only one is "'script'", quoted.`,
          });
        }
      }
    }
  }

  const policies: unknown = config.trustedTypes;

  if (policies === undefined) {
    return issues;
  }

  if (!Array.isArray(policies)) {
    issues.push({
      path: 'csp.trustedTypes',
      message: `Invalid securityHeaders config: csp.trustedTypes must be an array of policy names, received ${describeValue(policies)}`,
    });

    return issues;
  }

  for (const policy of policies) {
    if (typeof policy !== 'string' || policy.trim() === '') {
      issues.push({
        path: 'csp.trustedTypes',
        message: `Invalid securityHeaders config: csp.trustedTypes entry ${describeValue(policy)} is not a policy name`,
      });

      continue;
    }

    if (TRUSTED_TYPES_KEYWORDS.has(policy)) {
      continue;
    }

    // A quoted value that is not one of the keywords is a keyword invented
    // from memory, and a browser reads it as a policy name containing quotes,
    // which matches nothing.
    if (isQuoted(policy)) {
      issues.push({
        path: 'csp.trustedTypes',
        message: `Invalid securityHeaders config: csp.trustedTypes entry ${policy} is quoted but is not one of ${[...TRUSTED_TYPES_KEYWORDS].join(', ')}. A policy name is written unquoted.`,
      });

      continue;
    }

    if (!TRUSTED_TYPES_POLICY_NAME.test(policy)) {
      issues.push({
        path: 'csp.trustedTypes',
        message: `Invalid securityHeaders config: csp.trustedTypes entry "${policy}" is not a valid policy name`,
      });
    }
  }

  return issues;
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
    if (CSP_CONFIG_KEYS.has(key)) {
      continue;
    }

    const removed = REMOVED_DIRECTIVES[key];

    issues.push({
      path: `csp.${key}`,
      message: removed
        ? `Invalid securityHeaders config: csp.${key} is no longer part of CSP. ${removed}`
        : `Invalid securityHeaders config: csp.${key} is not a CSP option. A misspelled directive is dropped silently, so it is reported here rather than leaving a policy weaker than it reads.`,
    });
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
      if (
        typeof token !== 'string' ||
        !SANDBOX_TOKENS.has(token.trim().toLowerCase())
      ) {
        issues.push({
          path: 'csp.sandbox',
          message: `Invalid securityHeaders config: csp.sandbox token ${describeValue(token)} is not a sandbox token. A browser ignores one it does not know, so a typo silently leaves that capability disabled. Valid tokens: ${[...SANDBOX_TOKENS].join(', ')}.`,
        });
      }
    }
  }

  issues.push(...collectTrustedTypesIssues(config));

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

  // Whether a directive more specific than `default-src` already governs inline
  // `<script>` or `<style>` elements.
  //
  // This decides where unirend's own hashes belong. CSP fallback stops at the
  // first directive that is set rather than unioning the chain, so when one of
  // these is present `default-src` is never consulted for that content and the
  // hashes go in the specific directive. When none is, `default-src` is what the
  // browser reads, and the hashes have to go there or they are in no directive
  // the browser will ever look at.
  //
  // An empty array counts as absent, because it serializes to nothing and the
  // browser falls through it, the same reading `effectiveAttributeSources` uses.
  const isDirectiveSet = (sources: unknown): sources is string[] =>
    Array.isArray(sources) && sources.length > 0;

  // Only the plain fallback counts here, deliberately, and the `-elem` form does
  // not. The question this answers is which directive is the *last* one in the
  // chain for every browser, not just for a current one, and a browser that does
  // not implement `script-src-elem` reads straight past it. With no `script-src`
  // in between, what it reads is `default-src`, so withholding the hashes there
  // on the strength of a directive that browser cannot see leaves unirend's
  // bootstrap script blocked, taking every injected global and the router
  // hydration payload with it, silently, under a policy that reads as though it
  // allows exactly that content. `script-src-elem` shipped in Firefox 124, so
  // the browsers this covers are ordinary rather than theoretical.
  //
  // The cost of the other direction is nothing. A modern browser consults
  // `script-src-elem`, which gets the hashes too, and a hash sitting in a
  // `default-src` that is never consulted for scripts matches no URL and widens
  // nothing. The one thing it could disturb, an `'unsafe-inline'` still doing
  // real work in `default-src`, is already checked separately below.
  const isScriptGovernedElsewhere = isDirectiveSet(config.scriptSrc);

  const isStyleGovernedElsewhere = isDirectiveSet(config.styleSrc);

  for (const [key, directive] of SOURCE_LIST_DIRECTIVES) {
    const configured = config[key];

    // Whether this directive is one additions may join, which is the same
    // question `isDirectiveSet` asks everywhere else and has to be, or the two
    // disagree about the same empty array.
    //
    // An empty list is the caller saying nothing: it serializes to nothing and
    // a browser falls through it to the fallback. Contributing to it turned
    // that silence into a real directive holding only unirend's hashes, which
    // then overrode `default-src` and blocked every other script on the page,
    // the precise failure the "never create a directive nobody configured" rule
    // exists to prevent, reached through an empty array instead of an absent
    // key.
    //
    // A directive that says `'none'` is excluded as well, and that one is about
    // meaning rather than mechanics. `'none'` is the caller saying "allow
    // nothing", and `collectCSPIssues` refuses to let them write it alongside
    // anything else, so serializing it next to a hash would emit the very shape
    // this file's own validator calls a mistake. It is not valid CSP either:
    // the grammar admits `'none'` only as a source list's sole member, and a
    // browser meeting it beside a hash drops the `'none'` with a parse warning,
    // quietly turning "allow nothing" into "allow unirend's inline content".
    const canAcceptAdditions =
      isDirectiveSet(configured) &&
      !configured.some((source) => EXCLUSIVE_KEYWORDS.has(source));

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
    // consulted costs nothing. That older browser only lands on `script-src`
    // when the caller wrote one, which is why `default-src` keys on the plain
    // fallback alone and not on the `-elem` form: see `isScriptGovernedElsewhere`
    // above.
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
    //
    // `default-src` does get them, but only for the half of the chain that ends
    // there. A policy that sets `default-src` and nothing else is the shape the
    // documentation recommends starting from, and it is exactly the shape where
    // withholding the hashes blocks unirend's own bootstrap script, taking every
    // injected global and the router hydration payload with it, silently, on a
    // policy that reads as though it allows same-origin content. The hashes are
    // added per kind rather than as a pair, since scripts and styles fall
    // through to `default-src` independently.
    const isScriptDirective =
      key === 'scriptSrc' || key === 'scriptSrcElem' || key === 'scriptSrcAttr';

    let extra = !canAcceptAdditions
      ? undefined
      : key === 'scriptSrc' || key === 'scriptSrcElem'
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
    // directives that receive it directly. default-src is handled separately
    // below, since it governs both kinds and so has no single answer.
    if (
      extra &&
      isUnsafeInlineEffective(
        configured,
        isScriptDirective ? 'script' : 'style',
      )
    ) {
      extra = undefined;
    }

    // default-src, for whichever halves of the chain end here.
    //
    // Which hashes to add is a per-kind question, because the chains fall
    // through independently: a policy can set `script-src` and leave styles to
    // land here.
    //
    // Whether to add any is not, and that distinction is the whole subtlety of
    // this directive. The two kinds share one source list, and CSP3's "does a
    // source list allow all inline behavior for type" returns Does Not Allow on
    // encountering *any* hash or nonce, whatever type it was asked about. Only
    // the 'strict-dynamic' check is type-sensitive. So a single list cannot
    // carry hashes for scripts and still have a live 'unsafe-inline' for
    // styles: the script hashes revoke it for both.
    //
    // `default-src 'self' 'unsafe-inline' 'strict-dynamic'` is where that
    // bites. Its inline scripts are already blocked, by the caller's own
    // 'strict-dynamic', and its inline styles work. Adding the script hashes
    // would fix the scripts and silently break every style on the page, which
    // is not a trade to make on someone's behalf. Staying out preserves what
    // they wrote, and 'unsafe-inline' still covers the styles it was covering.
    if (key === 'defaultSrc' && canAcceptAdditions) {
      const willRevokeUnsafeInline =
        isUnsafeInlineEffective(configured, 'script') ||
        isUnsafeInlineEffective(configured, 'style');

      const fallbackSources = willRevokeUnsafeInline
        ? []
        : [
            ...(isScriptGovernedElsewhere ? [] : (additions.scriptSrc ?? [])),
            ...(isStyleGovernedElsewhere ? [] : (additions.styleSrc ?? [])),
          ];

      extra = fallbackSources.length ? fallbackSources : undefined;
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

  // Trusted Types. Both are plain token lists rather than source lists, so
  // nothing here contributes to them and they serialize exactly as written.
  if (config.requireTrustedTypesFor?.length) {
    parts.push(
      `require-trusted-types-for ${config.requireTrustedTypesFor.join(' ')}`,
    );
  }

  if (config.trustedTypes !== undefined) {
    parts.push(
      config.trustedTypes.length
        ? `trusted-types ${config.trustedTypes.join(' ')}`
        : 'trusted-types',
    );
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
