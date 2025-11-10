/**
 * Internal cookie forwarding utilities
 *
 * All functions are pure and accept explicit allow/block sets.
 *
 * Policy behavior:
 * - If both allow and block are empty/undefined, all cookies are allowed
 * - If allow is non-empty, only cookie names in allow are permitted
 * - Block list always takes precedence and denies matching cookie names
 */

/** Determine if a cookie name is permitted by the current allow/block policy */
export function isCookieNameAllowed(
  name: string,
  allowList?: ReadonlySet<string>,
  blockList?: ReadonlySet<string> | true,
): boolean {
  const cookieName = name.trim();

  if (!cookieName) {
    return false;
  }

  // Block all
  if (blockList === true) {
    return false;
  }

  if (blockList && blockList.has(cookieName)) {
    return false;
  }

  if (allowList) {
    return allowList.has(cookieName);
  }

  return true;
}

/**
 * Filter an inbound Cookie header value according to policy
 * Returns the new header string, or undefined if no cookies remain
 */
export function filterIncomingCookieHeader(
  header: string | undefined | null,
  allowList?: ReadonlySet<string>,
  blockList?: ReadonlySet<string> | true,
): string | undefined {
  if (!header) {
    return undefined;
  }

  // Cookie: name=value; name2=value2; ...
  const parts = header
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return undefined;
  }

  const allowedPairs: string[] = [];

  for (const part of parts) {
    const eqIndex = part.indexOf('=');

    if (eqIndex <= 0) {
      continue; // skip invalid segment or empty name
    }

    const name = part.slice(0, eqIndex).trim();
    // Allow empty value (e.g., "x=") to pass through

    if (isCookieNameAllowed(name, allowList, blockList)) {
      allowedPairs.push(part);
    }
  }

  if (allowedPairs.length === 0) {
    return undefined;
  }

  return allowedPairs.join('; ');
}

/**
 * Filter outbound Set-Cookie header values
 * Accepts a single header value or an array of values and returns only allowed ones
 */
export function filterSetCookieHeaderValues(
  values: string | string[],
  allowList?: ReadonlySet<string>,
  blockList?: ReadonlySet<string> | true,
): string[] {
  const arr = Array.isArray(values) ? values : [values];
  const result: string[] = [];

  // Fast path: block all
  if (blockList === true) {
    return result;
  }

  for (const value of arr) {
    // Set-Cookie: name=value; Attr=...; Attr2=...
    const firstSemicolon = value.indexOf(';');
    const firstSegment =
      firstSemicolon === -1 ? value : value.slice(0, firstSemicolon);

    const eqIndex = firstSegment.indexOf('=');

    if (eqIndex <= 0) {
      continue; // invalid
    }

    const name = firstSegment.slice(0, eqIndex).trim();

    if (isCookieNameAllowed(name, allowList, blockList)) {
      result.push(value);
    }
  }

  return result;
}
