/**
 * Parsed domain information derived from a request hostname.
 *
 * Used both on the Fastify request object (`request.domainInfo`) and in the
 * Unirend React context (`useDomainInfo()`).
 */
export interface DomainInfo {
  /** Bare hostname with port stripped (IPv6-safe, e.g. `'app.example.com'` or `'::1'`). */
  hostname: string;
  /**
   * Apex domain without a leading dot (e.g. `'example.com'`).
   * Empty string for localhost and raw IP addresses where no root domain can be resolved.
   *
   * When empty, omit the `domain` attribute entirely — `domain=.localhost` is invalid
   * per RFC 6265 and browsers reject it. A cookie without a `domain` attribute becomes
   * a host-only cookie scoped to the exact hostname, which is correct for localhost and IPs.
   *
   * Prepend `.` when using as a cookie `domain` attribute to span subdomains:
   * ```ts
   * document.cookie = [
   *   'theme=dark',
   *   'path=/',
   *   'max-age=31536000',
   *   domainInfo.rootDomain ? `domain=.${domainInfo.rootDomain}` : null,
   * ].filter(Boolean).join('; ');
   * ```
   */
  rootDomain: string;
}
