import { toASCII } from 'tr46';

// Defense-in-depth: cap label processing to avoid pathological patterns
const MAX_LABELS = 32;
// Extra safety: cap recursive matching steps to avoid exponential blow-ups
const STEP_LIMIT = 10_000;

// Invalid domain characters: ports, paths, fragments, brackets, userinfo, backslashes
export const INVALID_DOMAIN_CHARS = /[/?#:[\]@\\]/;

// Internal / special-use TLDs that we explicitly treat as non-PSL for wildcard-tail checks.
// Keep this list explicit—do not guess.
// Currently we only allow 'localhost'. If you want to allow other IANA special-use
// names (e.g., 'test', 'example', 'invalid', 'local'), add them here deliberately.
export const INTERNAL_PSEUDO_TLDS = Object.freeze(
  new Set<string>(['localhost']),
);

// Helper functions for wildcard pattern validation
export function isAllWildcards(s: string): boolean {
  return s.split('.').every((l) => l === '*' || l === '**');
}

export function hasPartialLabelWildcard(s: string): boolean {
  return s.split('.').some((l) => l.includes('*') && l !== '*' && l !== '**');
}

/**
 * Check DNS length constraints for hostnames (non-throwing):
 * - each label <= 63 octets
 * - total FQDN <= 255 octets
 * - max 127 labels (theoretical DNS limit)
 * Assumes ASCII input (post-TR46 processing).
 */
export function checkDnsLengths(host: string): boolean {
  const labels = host.split('.');

  // Label count cap for domains (127 is theoretical DNS limit)
  if (labels.length === 0 || labels.length > 127) {
    return false;
  }

  let total = 0;
  let i = 0;

  for (const lbl of labels) {
    const isLast = i++ === labels.length - 1;

    if (lbl.length === 0) {
      // Allow only a *trailing* empty label (for FQDN with a dot)
      if (!isLast) {
        return false;
      }
      continue;
    }

    if (lbl.length > 63) {
      return false;
    }

    total += lbl.length + 1; // account for dot
  }

  return total > 0 ? total - 1 <= 255 : false;
}

// IPv6 regex patterns hoisted to module scope for performance
const IPV6_ZONE_ID_PATTERN = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;
const IPV6_BASE_REGEX =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

/**
 * Check if a string is an IPv4 address
 */
export function isIPv4(str: string): boolean {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(str);
}

/**
 * Check if a string is an IPv6 address
 */
export function isIPv6(str: string): boolean {
  // Remove brackets if present and normalize percent-encoding for detection
  const cleaned = str.replace(/^\[|\]$/g, '').replace(/%25/g, '%');

  // Split potential zone identifier (RFC 6874): "<addr>%<ZoneID>"
  let addr = cleaned;
  let zone = '';
  const pct = cleaned.indexOf('%');
  if (pct !== -1) {
    addr = cleaned.slice(0, pct);
    zone = cleaned.slice(pct + 1);
    // Zone must be non-empty and only contain unreserved or pct-encoded bytes
    // RFC 3986 unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
    if (zone.length === 0 || !IPV6_ZONE_ID_PATTERN.test(zone)) {
      return false;
    }
  }

  // Use module-scoped IPv6 regex for better performance
  return IPV6_BASE_REGEX.test(addr);
}

/**
 * Check if a string is an IP address (IPv4 or IPv6)
 */
export function isIPAddress(str: string): boolean {
  return isIPv4(str) || isIPv6(str);
}

/**
 * Canonicalize bracketed IPv6 literal content for deterministic origin comparison.
 * Lowercases the IPv6 address; optionally preserves zone-id casing when shouldPreserveZoneIDCase is true.
 * The zone-id delimiter is expected percent-encoded as "%25" (e.g., fe80::1%25eth0).
 */
export function canonicalizeBracketedIPv6Content(
  content: string,
  shouldPreserveZoneIDCase = false,
): string {
  const i = content.indexOf('%25');

  if (i === -1) {
    return content.toLowerCase();
  }

  const addr = content.slice(0, i).toLowerCase();
  const zone = content.slice(i);
  return shouldPreserveZoneIDCase
    ? `${addr}${zone}`
    : `${addr}${zone.toLowerCase()}`;
}

/**
 * Extract the fixed tail (non-wildcard labels) after the last wildcard in a pattern.
 * Returns the labels that come after the rightmost wildcard in the pattern.
 *
 * @param patternLabels - Array of pattern labels (e.g., ["*", "api", "example", "com"])
 * @returns Object with fixedTailStart index and fixedTail labels array
 */
export function extractFixedTailAfterLastWildcard(patternLabels: string[]): {
  fixedTailStart: number;
  fixedTail: string[];
} {
  // Find the rightmost wildcard
  let lastWildcardIdx = -1;
  for (let i = patternLabels.length - 1; i >= 0; i--) {
    const lbl = patternLabels[i];
    if (lbl === '*' || lbl === '**') {
      lastWildcardIdx = i;
      break;
    }
  }

  const fixedTailStart = lastWildcardIdx + 1;
  const fixedTail = patternLabels.slice(fixedTailStart);

  return { fixedTailStart, fixedTail };
}

/**
 * Internal recursive helper for wildcard label matching
 */
function matchesWildcardLabelsInternal(
  domainLabels: string[],
  patternLabels: string[],
  domainIndex: number,
  patternIndex: number,
  counter: { count: number },
): boolean {
  if (++counter.count > STEP_LIMIT) {
    return false;
  }

  while (patternIndex < patternLabels.length) {
    const patternLabel = patternLabels[patternIndex];

    if (patternLabel === '**') {
      const isLeftmost = patternIndex === 0;

      // ** at index 0 means "1+ labels" while interior ** is "0+"
      // If leftmost, require at least one domain label
      if (isLeftmost) {
        for (let i = domainIndex + 1; i <= domainLabels.length; i++) {
          if (
            matchesWildcardLabelsInternal(
              domainLabels,
              patternLabels,
              i,
              patternIndex + 1,
              counter,
            )
          ) {
            return true;
          }
        }
        return false;
      }

      // Interior **: zero-or-more
      if (
        matchesWildcardLabelsInternal(
          domainLabels,
          patternLabels,
          domainIndex,
          patternIndex + 1,
          counter,
        )
      ) {
        return true;
      }

      // Try matching one or more labels
      for (let i = domainIndex + 1; i <= domainLabels.length; i++) {
        if (
          matchesWildcardLabelsInternal(
            domainLabels,
            patternLabels,
            i,
            patternIndex + 1,
            counter,
          )
        ) {
          return true;
        }
      }
      return false;
    } else if (patternLabel === '*') {
      // * matches exactly one label
      if (domainIndex >= domainLabels.length) {
        return false; // Not enough domain labels
      }
      domainIndex++;
      patternIndex++;
    } else {
      // Exact label match
      if (
        domainIndex >= domainLabels.length ||
        domainLabels[domainIndex] !== patternLabel
      ) {
        return false;
      }
      domainIndex++;
      patternIndex++;
    }
  }

  // All pattern labels matched, check if all domain labels are consumed
  return domainIndex === domainLabels.length;
}

/**
 * Match domain labels against wildcard pattern labels
 */
export function matchesWildcardLabels(
  domainLabels: string[],
  patternLabels: string[],
): boolean {
  const counter = { count: 0 };
  return matchesWildcardLabelsInternal(
    domainLabels,
    patternLabels,
    0,
    0,
    counter,
  );
}

/**
 * Helper function for label-wise wildcard matching
 * Supports patterns like *.example.com, **.example.com, *.*.example.com, etc.
 */
export function matchesMultiLabelPattern(
  domain: string,
  pattern: string,
): boolean {
  const domainLabels = domain.split('.');
  const patternLabels = pattern.split('.');

  // Guard against pathological label counts
  if (domainLabels.length > MAX_LABELS || patternLabels.length > MAX_LABELS) {
    return false;
  }

  // Pattern must have at least one non-wildcard label (the base domain)
  if (
    patternLabels.length === 0 ||
    patternLabels.every((label) => label === '*' || label === '**')
  ) {
    return false;
  }

  // Extract the fixed tail after the last wildcard
  const { fixedTailStart, fixedTail } =
    extractFixedTailAfterLastWildcard(patternLabels);

  // Domain must be at least as long as the fixed tail
  if (domainLabels.length < fixedTail.length) {
    return false;
  }

  // Match fixed tail exactly (right-aligned)
  for (let i = 0; i < fixedTail.length; i++) {
    const domainLabel =
      domainLabels[domainLabels.length - fixedTail.length + i];
    const patternLabel = fixedTail[i];
    if (patternLabel !== domainLabel) {
      return false;
    }
  }

  // Now match the left side (which may include wildcards and fixed labels)
  const remainingDomainLabels = domainLabels.slice(
    0,
    domainLabels.length - fixedTail.length,
  );
  const leftPatternLabels = patternLabels.slice(0, fixedTailStart);

  if (leftPatternLabels.length === 0) {
    // No left pattern, so only the fixed tail is required
    return remainingDomainLabels.length === 0;
  }

  return matchesWildcardLabels(remainingDomainLabels, leftPatternLabels);
}

/**
 * Normalize Unicode dot variants to ASCII dots for consistent IP and domain handling
 * @param s - String that may contain Unicode dot variants
 * @returns String with Unicode dots normalized to ASCII dots
 */
export function toAsciiDots(s: string): string {
  return s.replace(/[．。｡]/g, '.'); // fullwidth/japanese/halfwidth
}

/**
 * Normalize a domain name for consistent comparison
 * Handles trim, lowercase, trailing dots, NFC normalization, and punycode conversion for IDN safety
 * IP addresses are returned as-is after basic normalization
 */
export function normalizeDomain(domain: string): string {
  let trimmed = domain.trim();

  // Remove trailing dot if present (FQDN normalization)
  if (trimmed.endsWith('.')) {
    trimmed = trimmed.slice(0, -1);
  }

  // Normalize Unicode dots BEFORE checking IP for consistent behavior
  trimmed = toAsciiDots(trimmed);

  // Check if it's an IP address - if so, return normalized IP
  // Strip brackets from IPv6 addresses for consistency in domain comparisons
  if (isIPAddress(trimmed)) {
    const normalized = trimmed.toLowerCase();
    // Strip brackets from IPv6 addresses to make [::1] equivalent to ::1
    if (normalized.startsWith('[') && normalized.endsWith(']')) {
      return normalized.slice(1, -1);
    }
    return normalized;
  }

  // Apply NFC normalization for Unicode domains
  const normalized = trimmed.normalize('NFC').toLowerCase();

  try {
    // Use TR46/IDNA processing for robust Unicode domain handling that mirrors browser behavior
    const ascii = toASCII(normalized, {
      useSTD3ASCIIRules: true,
      checkHyphens: true,
      checkBidi: true,
      checkJoiners: true,
      transitionalProcessing: false, // matches modern browser behavior (non-transitional)
      verifyDNSLength: false, // we already do our own length checks
    });
    if (!ascii) {
      throw new Error('TR46 processing failed');
    }
    // Enforce DNS length constraints post-TR46
    return checkDnsLengths(ascii) ? ascii : ''; // return sentinel on invalid DNS lengths
  } catch {
    // On TR46 failure, return sentinel empty-string to signal invalid hostname
    return '';
  }
}

/**
 * Normalize a wildcard domain pattern by preserving wildcard labels
 * and punycode only non-wildcard labels. Also trims and removes
 * a trailing dot if present.
 */
export function normalizeWildcardPattern(pattern: string): string {
  let trimmed = pattern
    .trim()
    .normalize('NFC')
    .replace(/[．。｡]/g, '.'); // normalize Unicode dot variants to ASCII

  // Refuse non-domain characters (ports, paths, fragments, brackets, userinfo, backslashes)
  if (INVALID_DOMAIN_CHARS.test(trimmed)) {
    return ''; // sentinel for invalid pattern
  }

  if (trimmed.endsWith('.')) {
    trimmed = trimmed.slice(0, -1);
  }

  const labels = trimmed.split('.');

  // Reject empty labels post-split early (e.g., *..example.com)
  // This avoids double dots slipping to punycode
  for (const lbl of labels) {
    if (lbl.length === 0) {
      return ''; // sentinel for invalid pattern (no empty labels)
    }
  }

  const normalizedLabels = [];
  for (const lbl of labels) {
    if (lbl === '*' || lbl === '**') {
      normalizedLabels.push(lbl);
      continue;
    }

    // Pre-punycode check for obviously invalid labels
    if (lbl.length > 63) {
      return ''; // sentinel for invalid pattern
    }

    const nd = normalizeDomain(lbl);

    if (nd === '') {
      // Invalid label after normalization
      return ''; // sentinel for invalid pattern
    }

    // Early check: single-label DNS limit (post-punycode)
    if (nd.length > 63) {
      return ''; // sentinel for invalid pattern
    }

    normalizedLabels.push(nd);
  }

  // Extract concrete (non-wildcard) labels and validate final ASCII length
  const concreteLabels = normalizedLabels.filter(
    (lbl) => lbl !== '*' && lbl !== '**',
  );
  if (concreteLabels.length > 0) {
    const concretePattern = concreteLabels.join('.');
    // Validate the ASCII length of the concrete parts to prevent pathological long IDNs
    if (!checkDnsLengths(concretePattern)) {
      return ''; // sentinel for invalid pattern
    }
  }

  return normalizedLabels.join('.');
}
