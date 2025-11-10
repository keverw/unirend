import { getDomain, getSubdomain, getPublicSuffix } from 'tldts';
import {
  isAllWildcards,
  hasPartialLabelWildcard,
  checkDnsLengths,
  normalizeDomain,
  isIPv6,
  toAsciiDots,
  canonicalizeBracketedIPv6Content,
  matchesMultiLabelPattern,
  extractFixedTailAfterLastWildcard,
  isIPAddress,
  normalizeWildcardPattern,
  INTERNAL_PSEUDO_TLDS,
  INVALID_DOMAIN_CHARS,
} from './helpers';

/**
 * Normalize origin URL for consistent comparison
 * Handles protocol, hostname, port normalization with punycode support
 * Removes default ports: 80 for http, 443 for https
 */
export function normalizeOrigin(origin: string): string {
  // Preserve literal "null" origin exactly; treat all other invalids as empty sentinel
  if (origin === 'null') {
    return 'null';
  }

  try {
    // Normalize Unicode dots before URL parsing for browser compatibility
    // Chrome allows URLs like https://127。0。0。1
    const normalizedOrigin = toAsciiDots(origin);
    const url = new URL(normalizedOrigin);
    // Normalize hostname with punycode
    const normalizedHostname = normalizeDomain(url.hostname);

    // If hostname normalization fails (pathological IDN), return original origin
    // to avoid emitting values like "https://" with an empty host.
    if (normalizedHostname === '') {
      return '';
    }

    // Preserve brackets for IPv6 hosts; avoid double-bracketing if already present
    let host: string;
    // Extract the raw bracketed host (if present) from the authority portion only
    // to prevent matching brackets in path/query/fragment portions of full URLs.
    const schemeSep = normalizedOrigin.indexOf('://');
    const afterScheme = normalizedOrigin.slice(schemeSep + 3);
    const cut = Math.min(
      ...[
        afterScheme.indexOf('/'),
        afterScheme.indexOf('?'),
        afterScheme.indexOf('#'),
      ].filter((i) => i !== -1),
    );
    const authority =
      cut === Infinity ? afterScheme : afterScheme.slice(0, cut);
    const bracketMatch = authority.match(/\[([^\]]+)\]/);
    const rawBracketContent = bracketMatch ? bracketMatch[1] : null;

    // Decode only for IPv6 detection, not for output
    const hostnameForIpv6Check = (
      rawBracketContent ? rawBracketContent : normalizedHostname
    )
      .replace(/%25/g, '%')
      .toLowerCase();

    if (isIPv6(hostnameForIpv6Check)) {
      // Canonicalize bracket content using shared helper (do not decode %25)
      const raw = rawBracketContent
        ? rawBracketContent
        : normalizedHostname.replace(/^\[|\]$/g, '');

      const canon = canonicalizeBracketedIPv6Content(
        raw /* shouldPreserveZoneIDCase: false */,
      );

      host = `[${canon}]`;
    } else {
      host = normalizedHostname;
    }

    // Normalize default ports for http/https
    let port = '';
    const protocolLower = url.protocol.toLowerCase();
    const defaultPort =
      protocolLower === 'https:'
        ? '443'
        : protocolLower === 'http:'
          ? '80'
          : '';

    if (url.port) {
      // Remove default ports for known protocols
      port = url.port === defaultPort ? '' : `:${url.port}`;
    } else {
      // Fallback: some URL implementations with exotic hosts might not populate url.port
      // even if an explicit port exists in the original string. Detect and normalize manually.
      // Handle potential userinfo (user:pass@) prefix for future compatibility

      // Try IPv6 bracketed format first
      let portMatch = authority.match(/^(?:[^@]*@)?\[[^\]]+\]:(\d+)$/);

      if (portMatch) {
        const explicit = portMatch[1];
        port = explicit === defaultPort ? '' : `:${explicit}`;
      } else {
        // Fallback for non-IPv6 authorities: detect :port after host
        portMatch = authority.match(/^(?:[^@]*@)?([^:]+):(\d+)$/);
        if (portMatch) {
          const explicit = portMatch[2];
          port = explicit === defaultPort ? '' : `:${explicit}`;
        }
      }
    }

    // Explicitly use lowercase protocol for consistency
    return `${protocolLower}//${host}${port}`;
  } catch {
    // Fallback: handle bracketed IPv6 literals with optional ports manually.
    // This avoids relying on URL parsing for inputs like scope identifiers which
    // may not be universally accepted by URL implementations.
    const m = origin.match(/^(https?):\/\/(\[([^\]]+)\])(?::(\d+))?$/i);
    if (m) {
      const schemeLower = m[1].toLowerCase();
      const bracketContent = m[3];
      const portStr = m[4] || '';
      const defaultPort =
        schemeLower === 'https' ? '443' : schemeLower === 'http' ? '80' : '';

      // Canonicalize bracket content using shared helper
      const canon = canonicalizeBracketedIPv6Content(
        bracketContent /* shouldPreserveZoneIDCase: false */,
      );

      const host = `[${canon}]`;
      const port = portStr && portStr !== defaultPort ? `:${portStr}` : '';
      return `${schemeLower}://${host}${port}`;
    }

    // If URL parsing fails and pattern doesn't match bracketed IPv6, return empty sentinel
    // (handles invalid URLs). Literal "null" is handled above.
    return '';
  }
}

/**
 * Smart wildcard matching for domains (apex must be explicit)
 *
 * Special case: a single "*" matches any host (domains and IPs).
 * For non-global patterns, apex domains must be listed explicitly.
 *
 * Pattern matching rules:
 * - "*.example.com" matches DIRECT subdomains only:
 *   - "api.example.com" ✅ (direct subdomain)
 *   - "app.api.example.com" ❌ (nested subdomain - use ** for this)
 * - "**.example.com" matches ALL subdomains (including nested):
 *   - "api.example.com" ✅ (direct subdomain)
 *   - "app.api.example.com" ✅ (nested subdomain)
 *   - "v2.app.api.example.com" ✅ (deep nesting)
 * - "*.*.example.com" matches exactly TWO subdomain levels:
 *   - "a.b.example.com" ✅ (two levels)
 *   - "api.example.com" ❌ (one level)
 *   - "x.y.z.example.com" ❌ (three levels)
 */
export function matchesWildcardDomain(
  domain: string,
  pattern: string,
): boolean {
  const normalizedDomain = normalizeDomain(domain);

  if (normalizedDomain === '') {
    return false; // invalid domain cannot match
  }

  // Normalize pattern preserving wildcard labels and trailing dot handling
  const normalizedPattern = normalizeWildcardPattern(pattern);
  if (!normalizedPattern) {
    return false; // invalid pattern
  }

  // Check if pattern contains wildcards
  if (!normalizedPattern.includes('*')) {
    return false;
  }

  // Allow single "*" as global wildcard - matches both domains and IP addresses
  if (normalizedPattern === '*') {
    return true;
  }

  // Do not wildcard-match IP addresses with non-global patterns; only exact IP matches are supported elsewhere
  if (isIPAddress(normalizedDomain)) {
    return false;
  }

  // Reject other all-wildcards patterns (e.g., "*.*", "**.*")
  if (isAllWildcards(normalizedPattern)) {
    return false;
  }

  // PSL/IP tail guard: ensure the fixed tail is neither a PSL nor an IP (except explicit localhost)
  // This prevents patterns like "*.com" or "**.co.uk" from matching

  const labels = normalizedPattern.split('.');
  const { fixedTail: fixedTailLabels } =
    extractFixedTailAfterLastWildcard(labels);
  if (fixedTailLabels.length === 0) {
    return false; // require a concrete tail
  }

  const tail = fixedTailLabels.join('.');

  if (!INTERNAL_PSEUDO_TLDS.has(tail)) {
    if (isIPAddress(tail)) {
      return false; // no wildcarding around IPs
    }

    const ps = getPublicSuffix(tail);

    if (ps && ps === tail) {
      return false; // no wildcarding around public suffixes
    }
  }

  // Special case: prevent "**.<registrable>" from matching the apex registrable domain itself
  // e.g., "**.example.com" should NOT match "example.com"
  if (normalizedPattern.startsWith('**.')) {
    const remainder = normalizedPattern.slice(3);
    const remainderNormalized = normalizeDomain(remainder);

    // Deterministic guard: "**." requires at least one label before remainder
    // Therefore, it should never match the apex remainder itself regardless of TLD recognition
    // Fast path: if domain exactly equals the remainder, reject immediately
    if (normalizedDomain === remainderNormalized) {
      return false;
    }

    // Determine the registrable domain and subdomain of the remainder once
    const registrable = getDomain(remainderNormalized);
    const sub = getSubdomain(remainderNormalized);

    // Case 1: "**.<registrable>" should never match the registrable apex itself
    if (
      normalizedDomain === remainderNormalized &&
      registrable &&
      registrable === remainderNormalized
    ) {
      return false;
    }

    // Case 2: Remainder has at least one subdomain before the registrable
    // Double asterisk patterns should NOT match the subdomain itself since ** expects
    // something to be present before the remainder part
    // "**.api.example.com" -> should NOT match "api.example.com" (nothing before "api")
    // "**.blogs.foo.com" -> should NOT match "blogs.foo.com" (nothing before "blogs")
    // This makes logical sense: ** means "one or more labels before"
    if (normalizedDomain === remainderNormalized && sub && sub.length > 0) {
      return false;
    }
  }

  return matchesMultiLabelPattern(normalizedDomain, normalizedPattern);
}

/**
 * Smart origin wildcard matching for CORS with URL parsing
 * Supports protocol-specific wildcards and domain wildcards:
 * - * - matches any valid HTTP(S) origin (global wildcard)
 * - https://* or http://* - matches any domain with specific protocol
 * - *.example.com - matches direct subdomains with any protocol (ignores port)
 * - **.example.com - matches all subdomains including nested with any protocol
 * - https://*.example.com or http://*.example.com - matches direct subdomains with specific protocol
 * - https://**.example.com or http://**.example.com - matches all subdomains including nested with specific protocol
 *
 * Protocol support:
 * - For CORS, only http/https are supported; non-HTTP(S) origins never match
 * - Invalid or non-HTTP(S) schemes are rejected early for security
 *
 * Special cases:
 * - "null" origins: Cannot be matched by wildcard patterns, only by exact string inclusion in arrays
 *   (Security note: sandboxed/file/data contexts can emit literal "null". Treat as lower trust; do not
 *   allow via "*" or host wildcards. Include the literal "null" explicitly if you want to allow it.)
 * - Apex domains (example.com) must be listed explicitly, wildcards ignore port numbers
 * - Invalid URLs that fail parsing are treated as literal strings (no wildcard matching)
 */
export function matchesWildcardOrigin(
  origin: string,
  pattern: string,
): boolean {
  // Normalize Unicode dots before URL parsing for consistency
  const normalizedOrigin = toAsciiDots(origin);
  const normalizedPattern = toAsciiDots(pattern);

  // Parse once and reuse
  let originUrl: URL | null = null;
  try {
    originUrl = new URL(normalizedOrigin);
  } catch {
    originUrl = null;
  }

  // For CORS, only http/https are relevant; reject other schemes early when parsed.
  if (originUrl) {
    const scheme = originUrl.protocol.toLowerCase();
    if (scheme !== 'http:' && scheme !== 'https:') {
      return false;
    }
  }

  // Global wildcard: single "*" matches any valid HTTP(S) origin
  if (normalizedPattern === '*') {
    return originUrl !== null; // Must be a valid URL with HTTP(S) scheme
  }

  // Protocol-only wildcards: require valid URL parsing for security
  const patternLower = normalizedPattern.toLowerCase();

  if (patternLower === 'https://*' || patternLower === 'http://*') {
    if (!originUrl) {
      return false; // must be a valid URL
    }

    const want = patternLower === 'https://*' ? 'https:' : 'http:';
    return originUrl.protocol.toLowerCase() === want;
  }

  // Remaining logic requires a parsed URL
  if (!originUrl) {
    return false;
  }

  try {
    const normalizedHostname = normalizeDomain(originUrl.hostname);

    if (normalizedHostname === '') {
      return false;
    }

    const originProtocol = originUrl.protocol.slice(0, -1).toLowerCase(); // Remove trailing ":" and lowercase

    // Handle protocol-specific domain wildcards: https://*.example.com
    if (normalizedPattern.includes('://')) {
      const [patternProtocol, ...rest] = normalizedPattern.split('://');
      const domainPattern = rest.join('://');

      // Reject non-domain characters in the domain pattern portion
      if (INVALID_DOMAIN_CHARS.test(domainPattern)) {
        return false;
      }

      // Protocol must match exactly
      if (originProtocol !== patternProtocol.toLowerCase()) {
        return false;
      }

      // Fast reject: domain pattern must contain at least one wildcard and not be all-wildcards
      if (!domainPattern.includes('*') || isAllWildcards(domainPattern)) {
        return false;
      }

      // Check domain pattern using direct domain matching
      return matchesWildcardDomain(normalizedHostname, domainPattern);
    }

    // Handle domain wildcard patterns (including multi-label patterns)
    if (normalizedPattern.includes('*')) {
      // Fast reject for invalid all-wildcards patterns (e.g., "*.*", "**.*")
      // Note: single "*" is handled above as global wildcard
      if (normalizedPattern !== '*' && isAllWildcards(normalizedPattern)) {
        return false;
      }

      return matchesWildcardDomain(normalizedHostname, normalizedPattern);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a domain matches any pattern in a list
 * Supports exact matches, wildcards, and normalization
 *
 * Validation:
 * - Origin-style patterns (e.g., "https://*.example.com") are NOT allowed in domain lists.
 *   If any entry contains "://", an error will be thrown to surface misconfiguration early.
 * - Empty or whitespace-only entries are ignored.
 * Use `matchesOriginList` for origin-style patterns.
 */
export function matchesDomainList(
  domain: string,
  allowedDomains: string[],
): boolean {
  const normalizedDomain = normalizeDomain(domain);

  // Early exit: invalid input cannot match any allowed domain
  if (normalizedDomain === '') {
    return false;
  }

  // Trim and filter out empty entries first
  const cleaned = allowedDomains
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Validate: throw if any origin-style patterns are present
  const ORIGIN_LIKE = /^[a-z][a-z0-9+\-.]*:\/\//i;
  const originLike = cleaned.filter((s) => ORIGIN_LIKE.test(s));

  if (originLike.length > 0) {
    throw new Error(
      `matchesDomainList: origin-style patterns are not allowed in domain lists: ${originLike.join(', ')}`,
    );
  }

  for (const allowed of cleaned) {
    if (allowed.includes('*')) {
      if (matchesWildcardDomain(domain, allowed)) {
        return true;
      }
      continue;
    }

    if (normalizedDomain === normalizeDomain(allowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a configuration entry for either domain or origin contexts.
 * Non-throwing: returns { valid, info? } where info can carry non-fatal hints.
 *
 * - Domain context: accepts exact domains and domain wildcard patterns.
 * - Origin context: accepts
 *   - exact origins (any scheme),
 *   - protocol-only wildcards like "https://*" (any scheme allowed; info provided if non-http(s)),
 *   - protocol + domain wildcard like "https://*.example.com",
 *   - bare domains (treated like domain context).
 *
 * Common rules:
 * - Only full-label wildcards are allowed ("*" or "**"); partial label wildcards are invalid.
 * - All-wildcards domain patterns (e.g., "*.*") are invalid. The global "*" may be allowed
 *   in origin context when explicitly enabled via options.
 * - Wildcards cannot target IP tails.
 * - PSL tail guard (with allowlist for internal pseudo-TLDs like localhost).
 */
export type WildcardKind = 'none' | 'global' | 'protocol' | 'subdomain';

export function validateConfigEntry(
  entry: string,
  context: 'domain' | 'origin',
  options?: { allowGlobalWildcard?: boolean; allowProtocolWildcard?: boolean },
): { valid: boolean; info?: string; wildcardKind: WildcardKind } {
  const raw = (entry ?? '').trim();
  if (!raw) {
    return { valid: false, info: 'empty entry', wildcardKind: 'none' };
  }

  // Normalize options with secure defaults
  const opts = {
    allowGlobalWildcard: false,
    allowProtocolWildcard: true,
    ...(options ?? {}),
  } as Required<NonNullable<typeof options>> & {
    allowGlobalWildcard: boolean;
    allowProtocolWildcard: boolean;
  };

  // Helper: validate non-wildcard labels (punycode + DNS limits)
  function validateConcreteLabels(pattern: string): boolean {
    const labels = pattern.split('.');
    const concrete: string[] = [];
    for (const lbl of labels) {
      if (lbl === '*' || lbl === '**') {
        continue;
      }

      if (lbl.length > 63) {
        return false;
      }

      const nd = normalizeDomain(lbl);

      if (nd === '') {
        return false;
      }

      if (nd.length > 63) {
        return false;
      }

      concrete.push(nd);
    }

    if (concrete.length > 0) {
      if (!checkDnsLengths(concrete.join('.'))) {
        return false;
      }
    }

    return true;
  }

  // Helper: PSL tail guard and IP-tail rejection for wildcard patterns
  function wildcardTailIsInvalid(pattern: string): boolean {
    const normalized = normalizeWildcardPattern(pattern);

    if (!normalized) {
      return true; // invalid pattern
    }

    const labels = normalized.split('.');

    // Extract the fixed tail after the last wildcard
    const { fixedTail: fixedTailLabels } =
      extractFixedTailAfterLastWildcard(labels);
    if (fixedTailLabels.length === 0) {
      return true; // require a concrete tail
    }

    const tail = fixedTailLabels.join('.');
    if (INTERNAL_PSEUDO_TLDS.has(tail)) {
      return false; // allow *.localhost etc.
    }
    if (isIPAddress(tail)) {
      return true; // no wildcarding around IPs
    }
    const ps = getPublicSuffix(tail);
    if (ps && ps === tail) {
      return true;
    }
    return false;
  }

  // Helper: domain-wildcard structural checks (no URL chars, full labels, etc.)
  function validateDomainWildcard(pattern: string): {
    valid: boolean;
    info?: string;
    wildcardKind: WildcardKind;
  } {
    // Normalize Unicode dots and trim
    const trimmed = pattern
      .trim()
      .normalize('NFC')
      .replace(/[．。｡]/g, '.'); // normalize Unicode dot variants to ASCII

    if (!trimmed.includes('*')) {
      return { valid: false, wildcardKind: 'none' };
    }

    if (isAllWildcards(trimmed)) {
      return {
        valid: false,
        info: 'all-wildcards pattern is not allowed',
        wildcardKind: 'none',
      };
    }

    // Disallow URL-ish characters inside domain patterns
    if (INVALID_DOMAIN_CHARS.test(trimmed)) {
      return {
        valid: false,
        info: 'invalid characters in domain pattern',
        wildcardKind: 'none',
      };
    }

    if (hasPartialLabelWildcard(trimmed)) {
      return {
        valid: false,
        info: 'partial-label wildcards are not allowed',
        wildcardKind: 'none',
      };
    }

    if (!validateConcreteLabels(trimmed)) {
      return {
        valid: false,
        info: 'invalid domain labels',
        wildcardKind: 'none',
      };
    }

    if (wildcardTailIsInvalid(trimmed)) {
      return {
        valid: false,
        info: 'wildcard tail targets public suffix or IP (disallowed)',
        wildcardKind: 'none',
      };
    }

    return { valid: true, wildcardKind: 'subdomain' };
  }

  // Helper: exact domain check (no protocols). Reject apex public suffixes.
  function validateExactDomain(s: string): {
    valid: boolean;
    info?: string;
    wildcardKind: WildcardKind;
  } {
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(s)) {
      return {
        valid: false,
        info: 'protocols are not allowed in domain context',
        wildcardKind: 'none',
      };
    }

    // Check if it's an IP address first - if so, allow it (consistent with matchesDomainList)
    // Note: bracketed IPv6 is validated before this colon check, so order is preserved
    // Normalize Unicode dots for consistent IP detection
    const sDots = toAsciiDots(s);
    if (isIPAddress(sDots)) {
      const nd = normalizeDomain(sDots);
      if (nd === '') {
        return {
          valid: false,
          info: 'invalid IP address',
          wildcardKind: 'none',
        };
      }

      return { valid: true, wildcardKind: 'none' };
    }

    // For non-IP addresses, reject URL-like characters
    if (INVALID_DOMAIN_CHARS.test(s)) {
      return {
        valid: false,
        info: 'invalid characters in domain',
        wildcardKind: 'none',
      };
    }

    const nd = normalizeDomain(s);

    if (nd === '') {
      return { valid: false, info: 'invalid domain', wildcardKind: 'none' };
    }

    const ps = getPublicSuffix(nd);

    if (ps && ps === nd && !INTERNAL_PSEUDO_TLDS.has(nd)) {
      return {
        valid: false,
        info: 'entry equals a public suffix (not registrable)',
        wildcardKind: 'none',
      };
    }
    return { valid: true, wildcardKind: 'none' };
  }

  // Domain context path
  if (context === 'domain') {
    // Reject any origin-style entries (with protocols) upfront
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(raw)) {
      return {
        valid: false,
        info: 'protocols are not allowed in domain context',
        wildcardKind: 'none',
      };
    }

    // Special-case: global wildcard in domain context (config-time validation)
    if (raw === '*') {
      return opts.allowGlobalWildcard
        ? { valid: true, wildcardKind: 'global' }
        : {
            valid: false,
            info: "global wildcard '*' not allowed in this context",
            wildcardKind: 'none',
          };
    }

    if (raw.includes('*')) {
      return validateDomainWildcard(raw);
    }
    return validateExactDomain(raw);
  }

  // Origin context
  // Special-case: literal "null" origin is allowed by exact inclusion
  if (raw.toLowerCase() === 'null') {
    return { valid: true, wildcardKind: 'none' };
  }

  // Special-case: global wildcard in origin context (config-time validation)
  if (raw === '*') {
    return opts.allowGlobalWildcard
      ? { valid: true, wildcardKind: 'global' }
      : {
          valid: false,
          info: "global wildcard '*' not allowed in this context",
          wildcardKind: 'none',
        };
  }

  const schemeIdx = raw.indexOf('://');
  if (schemeIdx === -1) {
    // Bare domain/or domain pattern allowed in origin lists; reuse domain rules
    if (raw.includes('*')) {
      return validateDomainWildcard(raw);
    }
    return validateExactDomain(raw);
  }

  const scheme = raw.slice(0, schemeIdx).toLowerCase();
  const rest = raw.slice(schemeIdx + 3);
  if (!rest) {
    return {
      valid: false,
      info: 'missing host in origin',
      wildcardKind: 'none',
    };
  }

  // Disallow path/query/fragment in origin entries
  if (rest.includes('/') || rest.includes('#') || rest.includes('?')) {
    return {
      valid: false,
      info: 'origin must not contain path, query, or fragment',
      wildcardKind: 'none',
    };
  }

  // Reject userinfo in origin entries for security and clarity
  if (rest.includes('@')) {
    return {
      valid: false,
      info: 'origin must not include userinfo',
      wildcardKind: 'none',
    };
  }

  // Protocol-only wildcard: scheme://*
  if (rest === '*') {
    if (!opts.allowProtocolWildcard) {
      return {
        valid: false,
        info: 'protocol wildcard not allowed',
        wildcardKind: 'none',
      };
    }

    const info =
      scheme === 'http' || scheme === 'https'
        ? undefined
        : 'non-http(s) scheme; CORS may not match';
    return { valid: true, info, wildcardKind: 'protocol' };
  }

  // Extract host (and optional port) while respecting IPv6 brackets
  let host = rest;
  let hasPort = false;

  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end === -1) {
      return {
        valid: false,
        info: 'unclosed IPv6 bracket',
        wildcardKind: 'none',
      };
    }
    host = rest.slice(0, end + 1);
    const after = rest.slice(end + 1);
    if (after.startsWith(':')) {
      // port present -> allowed for exact origins, but reject with wildcard hosts below
      // leave host as bracketed literal
      hasPort = true;
    } else if (after.length > 0) {
      return {
        valid: false,
        info: 'unexpected characters after IPv6 host',
        wildcardKind: 'none',
      };
    }
  } else {
    // strip port if present
    const colon = rest.indexOf(':');
    if (colon !== -1) {
      host = rest.slice(0, colon);
      // optional port part is fine for exact origins
      hasPort = true;
    }
  }

  // If wildcard present in origin authority, treat as protocol+domain wildcard
  if (host.includes('*')) {
    // Forbid ports/brackets with wildcard hosts
    if (host.includes('[') || host.includes(']')) {
      return {
        valid: false,
        info: 'wildcard host cannot be an IP literal',
        wildcardKind: 'none',
      };
    }

    if (hasPort) {
      return {
        valid: false,
        info: 'ports are not allowed in wildcard origins',
        wildcardKind: 'none',
      };
    }

    // Validate as domain wildcard
    const verdict = validateDomainWildcard(host);
    if (!verdict.valid) {
      return verdict;
    }

    const info =
      scheme === 'http' || scheme === 'https'
        ? undefined
        : 'non-http(s) scheme; CORS may not match';
    return { valid: true, info, wildcardKind: 'subdomain' };
  }

  // Exact origin: allow any scheme; validate host as domain or IP
  if (host.startsWith('[')) {
    // Bracketed IPv6 literal
    // basic bracket shape already checked; accept as valid exact host
    const info =
      scheme === 'http' || scheme === 'https'
        ? undefined
        : 'non-http(s) scheme; CORS may not match';
    return { valid: true, info, wildcardKind: 'none' };
  }

  const hostDots = toAsciiDots(host);
  if (isIPAddress(hostDots)) {
    const info =
      scheme === 'http' || scheme === 'https'
        ? undefined
        : 'non-http(s) scheme; CORS may not match';
    return { valid: true, info, wildcardKind: 'none' };
  }

  // Domain host
  const nd = normalizeDomain(host);

  if (nd === '') {
    return {
      valid: false,
      info: 'invalid domain in origin',
      wildcardKind: 'none',
    };
  }
  const ps = getPublicSuffix(nd);
  if (ps && ps === nd && !INTERNAL_PSEUDO_TLDS.has(nd)) {
    return {
      valid: false,
      info: 'origin host equals a public suffix (not registrable)',
      wildcardKind: 'none',
    };
  }
  const info =
    scheme === 'http' || scheme === 'https'
      ? undefined
      : 'non-http(s) scheme; CORS may not match';
  return { valid: true, info, wildcardKind: 'none' };
}

/**
 * Helper function to check origin list with wildcard support
 * Supports exact matches, wildcards, and normalization
 * Special case: single "*" matches any origin (global wildcard)
 *
 * @param origin - The origin to check (undefined for requests without Origin header)
 * @param allowedOrigins - Array of allowed origin patterns
 * @param opts - Options for handling edge cases
 * @param opts.treatNoOriginAsAllowed - If true, allows requests without Origin header when "*" is in the allowed list
 */
export function matchesOriginList(
  origin: string | undefined,
  allowedOrigins: string[],
  opts: { treatNoOriginAsAllowed?: boolean } = {},
): boolean {
  const cleaned = allowedOrigins.map((s) => s.trim()).filter(Boolean);

  if (!origin) {
    // Only allow requests without Origin header if explicitly opted in AND "*" is in the list
    return !!opts.treatNoOriginAsAllowed && cleaned.includes('*');
  }

  const normalizedOrigin = normalizeOrigin(origin);

  return cleaned.some((allowed) => {
    // Global wildcard: single "*" matches any origin - delegate to matchesWildcardOrigin for proper validation
    if (allowed === '*') {
      return matchesWildcardOrigin(origin, '*');
    }

    if (allowed.includes('*')) {
      // Avoid double-normalizing/parsing; wildcard matcher handles parsing + normalization itself
      // We pass the raw origin/pattern here (vs normalized in the non-wildcard path) because
      // the wildcard matcher needs to parse the origin as a URL for protocol/host extraction
      return matchesWildcardOrigin(origin, allowed);
    }

    return normalizedOrigin === normalizeOrigin(allowed);
  });
}

/**
 * Helper function to check if origin matches any pattern in a list (credentials-safe)
 * Only supports exact matches and normalization - NO wildcards for security
 */
export function matchesCORSCredentialsList(
  origin: string | undefined,
  allowedOrigins: string[],
  options: { allowWildcardSubdomains?: boolean } = {},
): boolean {
  if (!origin) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const cleaned = allowedOrigins.map((s) => s.trim()).filter(Boolean);

  const allowWildcard = !!options.allowWildcardSubdomains;

  for (const allowed of cleaned) {
    // Optional wildcard support for credentials lists (subdomain patterns only)
    if (allowWildcard && allowed.includes('*')) {
      if (matchesWildcardOrigin(origin, allowed)) {
        return true;
      }
      continue;
    }

    if (normalizedOrigin === normalizeOrigin(allowed)) {
      return true;
    }
  }

  return false;
}

export { normalizeDomain, isIPAddress };
