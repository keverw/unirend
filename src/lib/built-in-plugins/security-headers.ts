import type { FastifyRequest, FastifyReply } from 'fastify';
import type {
  ServerPlugin,
  PluginHostInstance,
  UnirendServerMode,
} from '../types';
import {
  matchesOriginList,
  matchesCORSCredentialsList,
  matchesDomainList,
  normalizeDomain,
  validateConfigEntry,
} from 'lifecycleion/domain-utils';
import { LRUCache } from 'lifecycleion/lru-cache';
import { addToVaryHeader } from '../internal/http-header-utils';
import {
  cspHeaderName,
  serializeCSP,
  validateCSPConfig,
  applyCSPPreset,
  isUnsafeInlineEffective,
  describeValue,
  isPlainObject,
  type CSPConfig,
} from '../internal/csp-policy';
import { UNIREND_ERROR_PAGE_STYLE_HASHES } from '../internal/error-page-utils';
import { UNIREND_BOOTSTRAP_SCRIPT_HASH } from '../internal/html-utils/context-data-block';
import type { InlineAttributeFinding } from '../internal/html-utils/format';
import {
  collectFrameOptionsIssues,
  collectFramingIssues,
  collectHSTSIssues,
  collectContentTypeOptionsIssues,
  collectReferrerPolicyIssues,
  collectPermissionsPolicyIssues,
  collectCOOPIssues,
  collectCORPIssues,
  collectCOEPIssues,
  collectCOOPReportOnlyIssues,
  collectCOEPReportOnlyIssues,
  serializeCrossOriginPolicy,
  crossOriginReportGroups,
  collectReportingEndpointsIssues,
  collectReportingIssues,
  isReportingGroupUndefined,
  freezeBaseline,
  serializePermissionsPolicy,
  serializeReportingEndpoints,
  unknownPolicyKeys,
  SECURITY_HEADERS_POLICY_KEYS,
  type HSTSConfig,
  type SecurityHeadersBaseline,
  type SecurityHeadersPolicyInput,
  type SecurityHeadersPolicyIssue,
  type ReferrerPolicyToken,
  type PermissionsPolicyConfig,
  type CrossOriginResourcePolicy,
  type CrossOriginOpenerPolicySetting,
  type CrossOriginEmbedderPolicySetting,
  type ReportingEndpointsConfig,
} from '../internal/security-headers-validation';
import { isHostUnverified } from '../internal/host-verification';
import {
  collectCORSIssues,
  isCORSEnabled,
  HEADER_NAME_TOKEN,
  type CORSConfig,
  type CORSOrigin,
  type ResolvedCORSConfig,
} from '../internal/cors-validation';

export type { CSPConfig } from '../internal/csp-policy';

// The CORS types live next to the rules that judge them, so the collectors can
// be written against them without the plugin and the validator importing each
// other. Re-exported here because this is where they have always been imported
// from.
export type {
  CORSConfig,
  CORSOrigin,
  ResolvedCORSConfig,
} from '../internal/cors-validation';

/**
 * Strict-Transport-Security (HSTS) header parameters.
 *
 * Defined next to the rules that judge it, for the same reason the CORS types
 * are, and re-exported here because this is where it has always been imported
 * from.
 */
export type {
  HSTSConfig,
  SecurityHeadersBaseline,
  ReferrerPolicyToken,
  PermissionsPolicyConfig,
  CrossOriginOpenerPolicy,
  CrossOriginResourcePolicy,
  CrossOriginEmbedderPolicy,
  CrossOriginPolicySetting,
  CrossOriginOpenerPolicySetting,
  CrossOriginEmbedderPolicySetting,
  ReportingEndpointsConfig,
} from '../internal/security-headers-validation';

/**
 * A per-request override of the non-negotiated headers.
 *
 * Each key replaces that block outright rather than merging into it. A partial
 * merge would mean `hsts: { maxAge: 86400 }` silently keeping the baseline's
 * `includeSubDomains`, which is the exact combination a custom-domain override
 * exists to avoid.
 *
 * CORS is deliberately absent. `cors.origin` and `cors.credentials` already
 * take request-aware functions, so it has been per-request since before this
 * existed, and giving it a second mechanism would mean two places to look when
 * an origin decision surprises someone.
 *
 * The same type `validateSecurityHeadersPolicy` checks, under the name that
 * reads better at a `resolve` call site. Deliberately an alias rather than a
 * matching declaration: the runtime key check is tied by `satisfies` to that
 * type, so a look-alike here would let a field be added to the resolver's shape
 * and then rejected per request as an unknown key, with nothing failing to
 * compile.
 */
export type SecurityHeadersOverride = SecurityHeadersPolicyInput;

/**
 * Decides the policy for one request, given the validated defaults.
 *
 * Return `null` to use the defaults unchanged, which is the common path and
 * should be the fast one. `null` specifically, not any falsy value: anything
 * else that is not an override object is treated as a resolver that failed to
 * answer, and fails the request rather than quietly sending the defaults. The
 * defaults include the baseline HSTS, and a store miss returning `undefined`
 * has not established that this domain is one to bind for a year.
 *
 * `baseline` is the configured policy, which is what an omitted block inherits.
 * It is there so "the defaults, with one field different" can be written as
 * what it is:
 *
 * ```ts
 * resolve: async (request, baseline) => {
 *   const tenant = await lookupTenant(request.domainInfo.hostname);
 *   if (!tenant?.isCustomDomain) return null;
 *
 *   return { hsts: { ...baseline.hsts, maxAge: 86400 } };
 * }
 * ```
 *
 * Merging stays the caller's to write, which is the whole point of handing this
 * over rather than merging blocks automatically. A block you return replaces
 * the baseline's outright, so what you kept is visible at the call site instead
 * of being inferred from what you left out. An automatic merge would make
 * `hsts: { maxAge: 86400 }` quietly keep the baseline's `includeSubDomains`,
 * which on a customer's domain is the exact combination `resolve` exists to
 * avoid.
 *
 * It is the policy **as configured**, not as expanded: a `csp.preset` is still
 * a `preset` here rather than the directives it stands for. That is what lets
 * `{ csp: { ...baseline.csp, scriptSrc: [...] } }` work, since the preset rides
 * along and is expanded again on the way back with your directives winning. It
 * also keeps a preset's directives from being baked into a tenant's stored
 * policy, where they would stop tracking the preset.
 *
 * Deeply frozen, so it is safe to hold on to and cannot be edited in place.
 * Build a new object and return that.
 *
 * May be async, since the lookup this exists for is usually a store hit.
 */
export type SecurityHeadersResolver = (
  request: FastifyRequest,
  baseline: SecurityHeadersBaseline,
) => SecurityHeadersOverride | null | Promise<SecurityHeadersOverride | null>;

/**
 * The plugin, plus a way to install its resolver after registration.
 *
 * A plain `ServerPlugin` everywhere it is used as one; the extra method exists
 * for the late-bound case, where the resolver needs a dependency that is not
 * ready at config time.
 */
export type SecurityHeadersPlugin = ServerPlugin<UnirendServerMode> & {
  setResolver: (resolver: SecurityHeadersResolver | undefined) => void;
};

/**
 * Browser security header configuration.
 *
 * Every field is a default. When `resolve` is supplied, its return value is
 * merged over these per request, which is how a multi-tenant deployment varies
 * policy by domain without giving up config-time validation of the defaults.
 */
export interface SecurityHeadersConfig {
  /**
   * Cross-Origin Resource Sharing policy, negotiated per-origin.
   */
  cors?: false | CORSConfig;

  /**
   * Controls the X-Frame-Options response header.
   * - false: do not send the header (default)
   * - "DENY" | "SAMEORIGIN": header value to send
   *
   * @default false
   */
  frameOptions?: false | 'DENY' | 'SAMEORIGIN';

  /**
   * Content-Security-Policy, the header a browser enforces against the page
   * itself rather than against who may read it.
   *
   * Each source-list directive takes sources written as they appear in the
   * header, keywords with their quotes and hosts without:
   *
   * ```ts
   * csp: {
   *   defaultSrc: ["'self'"],
   *   imgSrc: ["'self'", 'data:', 'https://cdn.example.com'],
   *   frameAncestors: ["'none'"],
   *   reportOnly: true,
   * }
   * ```
   *
   * Unirend adds its own hashes for the inline content it emits, so its error
   * pages and injected globals keep working without `'unsafe-inline'`. They go
   * to the directive a browser will actually consult: `scriptSrc` and
   * `styleSrc` (and the `-Elem` forms) when you set them, and `defaultSrc` when
   * you set neither, since that is what the browser reads instead. It never
   * creates a directive you did not write, because one you did not ask for
   * would override `defaultSrc` and block whatever you expected it to cover.
   *
   * Start with `reportOnly: true` on a live site. Violations are reported and
   * nothing is blocked, so you find what breaks without breaking it.
   *
   * @default false
   */
  csp?: false | CSPConfig;

  /**
   * Controls the Strict-Transport-Security (HSTS) response header.
   * - false: do not send the header (default)
   * - { maxAge, includeSubDomains?, preload? }: header parameters
   *
   * The header is only sent when the request arrived over a secure transport,
   * per RFC 6797 section 7.2, which forbids sending it over plain HTTP. Behind
   * a TLS-terminating proxy that means `fastifyOptions.trustProxy` must be set,
   * otherwise Fastify sees plain HTTP and no HSTS header is sent.
   *
   * Take particular care with `includeSubDomains` on a domain you do not
   * control, such as a customer's custom domain. It forces HTTPS across every
   * other subdomain of that domain, and browsers honor it for the full
   * `maxAge`, so shipping a fix later does not revoke it. Use `resolve` to send
   * a narrower policy for those domains.
   *
   * @default false
   */
  hsts?: false | HSTSConfig;

  /**
   * Send `X-Content-Type-Options: nosniff`.
   *
   * Stops a browser second-guessing your `Content-Type`. Without it, a response
   * you serve as `text/plain` can be sniffed as HTML and executed, which turns
   * a file upload endpoint into stored XSS.
   *
   * Off by default like every other header here, which is a deliberate house
   * rule rather than an assessment of the risk: this plugin does not turn
   * protections on behind your back, because a header that appears without
   * anyone asking is a header nobody knows to look at when something breaks.
   * There is no real reason not to set this one.
   *
   * @default false
   */
  contentTypeOptions?: boolean;

  /**
   * Controls the `Referrer-Policy` header.
   *
   * Decides how much of the current URL travels in the `Referer` header on
   * outbound requests and navigations. Without it you are on the browser's
   * default, which is `strict-origin-when-cross-origin` in current browsers but
   * was `no-referrer-when-downgrade` not long ago, so a full URL, including
   * anything you put in a path or query string, could reach a third party.
   *
   * Takes a list as well as a single token, because the header does: a browser
   * uses the last token it understands, which is how a newer policy ships with
   * an older one behind it.
   *
   * @default false
   */
  referrerPolicy?: false | ReferrerPolicyToken | ReferrerPolicyToken[];

  /**
   * Controls the `Permissions-Policy` header.
   *
   * Written as a feature to its allowlist. An empty array disables the feature
   * outright, which is the common case and the reason to reach for this.
   *
   * ```ts
   * permissionsPolicy: {
   *   camera: [],
   *   microphone: [],
   *   geolocation: ['self'],
   * }
   * ```
   *
   * @default false
   */
  permissionsPolicy?: false | PermissionsPolicyConfig;

  /**
   * Controls the `Cross-Origin-Opener-Policy` header.
   *
   * `'same-origin'` severs `window.opener` between your pages and cross-origin
   * ones, which is the main defense against cross-window attacks and a
   * precondition for `crossOriginIsolated`.
   *
   * Check your OAuth and payment flows before enabling. Anything that opens a
   * third-party popup and then talks to it through `window.opener` or
   * `postMessage` on the opener breaks under `'same-origin'`;
   * `'same-origin-allow-popups'` is the setting that keeps those working.
   *
   * @default false
   */
  crossOriginOpenerPolicy?: false | CrossOriginOpenerPolicySetting;

  /**
   * Controls `Cross-Origin-Opener-Policy-Report-Only`, which is how you find
   * out whether the real one would break your site.
   *
   * COOP is the header here most likely to break something that works: it
   * severs `window.opener`, and the flows that rely on it, OAuth and payment
   * popups, live in someone else's code. The report-only variant applies
   * nothing and reports what the enforcing header would have done, so you can
   * run it against real traffic first.
   *
   * Name a reporting group to get those reports somewhere other than a
   * developer's DevTools, which is where the interesting failures are least
   * likely to be seen:
   *
   * ```ts
   * securityHeaders({
   *   reportingEndpoints: { coop: 'https://reports.example.com/coop' },
   *   crossOriginOpenerPolicyReportOnly: {
   *     policy: 'same-origin',
   *     reportTo: 'coop',
   *   },
   * });
   * ```
   *
   * Both headers may be sent at once, which is the usual shape mid-migration:
   * enforce the policy you have and report on the stricter one you want.
   *
   * @default false
   */
  crossOriginOpenerPolicyReportOnly?: false | CrossOriginOpenerPolicySetting;

  /**
   * Controls the `Cross-Origin-Resource-Policy` header.
   *
   * Says who may embed this response. `'same-origin'` is the strong setting and
   * the one that will bite: it applies to every response the header goes on,
   * so a site serving its own images or fonts to another origin, or to a CDN,
   * needs `'cross-origin'` for those.
   *
   * @default false
   */
  crossOriginResourcePolicy?: false | CrossOriginResourcePolicy;

  /**
   * Controls the `Cross-Origin-Embedder-Policy` header.
   *
   * Only needed for `crossOriginIsolated`, which is what `SharedArrayBuffer`
   * and high-resolution timers require. `'require-corp'` demands that every
   * cross-origin subresource opt in with its own CORP header or CORS, so
   * enabling it without auditing your third-party assets breaks them. Left off
   * unless you know you need it.
   *
   * @default false
   */
  crossOriginEmbedderPolicy?: false | CrossOriginEmbedderPolicySetting;

  /**
   * Controls `Cross-Origin-Embedder-Policy-Report-Only`.
   *
   * Worth more here than on most headers. `require-corp` demands that every
   * cross-origin subresource opt in, so the things it breaks are third-party
   * images, fonts and frames you may not have an inventory of. This tells you
   * which ones before they stop loading.
   *
   * @default false
   */
  crossOriginEmbedderPolicyReportOnly?:
    false | CrossOriginEmbedderPolicySetting;

  /**
   * Controls the `Reporting-Endpoints` header, which is the other half of
   * `csp.reportTo`.
   *
   * A `report-to` directive names a group, and a group means nothing until a
   * response defines it. Without this, a policy carrying `report-to csp`
   * reports to nowhere: violations happen, no report arrives, and the silence
   * is indistinguishable from having no violations.
   *
   * ```ts
   * securityHeaders({
   *   reportingEndpoints: { csp: 'https://reports.example.com/csp' },
   *   csp: { defaultSrc: ["'self'"], reportTo: 'csp', reportOnly: true },
   * });
   * ```
   *
   * Endpoints must be absolute and `https` (or localhost, which is a
   * potentially trustworthy origin, so a local collector works in
   * development). A browser will not deliver reports over an insecure
   * transport, and a relative URL has no base to resolve against by the time a
   * report is queued.
   *
   * Naming a group here that `csp.reportTo` does not use is fine, since the
   * header is shared with other reporting APIs. The reverse is checked: a
   * `csp.reportTo` naming a group this does not define fails at startup.
   *
   * @default false
   */
  reportingEndpoints?: false | ReportingEndpointsConfig;

  /**
   * Vary the non-negotiated headers per request.
   *
   * The case this exists for: customers mapping their own domains. A single
   * static `hsts` applies to all of them, and `includeSubDomains` on a domain
   * you do not own forces HTTPS across every other subdomain that customer has,
   * honored for the full `maxAge` with no way to revoke it. A domain you do not
   * control needs a shorter `maxAge` and no `includeSubDomains` or `preload`.
   *
   * ```ts
   * securityHeaders({
   *   hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
   *   frameOptions: 'DENY',
   *
   *   resolve: async (request) => {
   *     const tenant = await lookupTenant(request.domainInfo.hostname);
   *     if (!tenant?.isCustomDomain) return null; // defaults unchanged
   *     return { hsts: { maxAge: 86400 }, frameOptions: false };
   *   },
   * });
   * ```
   *
   * Each returned block replaces the default outright rather than merging into
   * it, so `hsts: { maxAge: 86400 }` sends exactly that and nothing else.
   *
   * The second argument is the configured policy, deeply frozen, for the common
   * case of wanting the baseline with one field changed. Keeping a merge
   * explicit is the point: what you kept is visible where you wrote it rather
   * than inferred from what you left out.
   *
   * ```ts
   * resolve: async (request, baseline) => {
   *   const tenant = await lookupTenant(request.domainInfo.hostname);
   *   if (!tenant?.isCustomDomain) return null;
   *
   *   // Same policy, shorter max-age, and no preload on a domain we do not own.
   *   return { hsts: { ...baseline.hsts, maxAge: 86400, preload: false } };
   * },
   * ```
   *
   * The result is validated per request with the same rules as the defaults, so
   * a resolver cannot produce a policy the config would have rejected.
   *
   * **A resolver that throws behaves like any other middleware that throws:**
   * it propagates and becomes a 500. There is no bespoke fallback, because
   * unlike an allow-or-deny callback there is no obviously correct answer to
   * substitute. If you would rather degrade than fail, catch it yourself and
   * return `null`, where you can tell "no override needed" from "the store is
   * down". Either way the error response carries the defaults and **no HSTS**,
   * since a domain whose policy could not be resolved is not one to bind.
   *
   * Called at most once per request; the result is reused for the rest of the
   * lifecycle, including the error path.
   *
   * Not called at all when `domainValidation` has refused the host. There is
   * nothing to decide, since this picks a policy for a tenant and a refused
   * host has none, and the 403 is unirend's own response rather than tenant
   * content. It also stops a `Host` header naming a domain that does not exist
   * from costing a store lookup per request.
   */
  resolve?: SecurityHeadersResolver;

  /**
   * Hosts this deployment owns, for deciding what a failed `resolve` may still
   * send.
   *
   * Without it, a resolver that throws costs the response its HSTS, always.
   * That is never wrong, but it is blunt: a store outage then drops HSTS for
   * first-party traffic too, on domains the operator plainly does own and had
   * every intention of binding.
   *
   * With it, a failed resolve keeps the baseline HSTS when the request's host
   * matches, and still sends nothing when it does not. The distinction is the
   * whole point: binding a domain for a year is safe when you own it and
   * permanent when you do not, and only you can say which is which.
   *
   * Accepts the same patterns as `domainValidation.validProductionDomains`:
   * exact hosts, `*.example.com` for direct subdomains, `**.example.com` for
   * any depth. List only what you genuinely control. A customer's mapped domain
   * does not belong here even though you serve it.
   *
   * @example
   * ownDomains: ['example.com', '**.example.com']
   */
  ownDomains?: string | string[];
}

// Limit how many headers we reflect/allow on preflight to avoid abuse
const MAX_ALLOWED_HEADERS = 100;

// Limit the length of each reflected header name to avoid pathological values
const MAX_HEADER_LEN = 256;

/**
 * The header names a preflight asked for, filtered down to the ones worth
 * echoing back.
 *
 * Only reached when `allowedHeaders` is `['*']`, which is the caller saying
 * "reflect whatever this request wants". That makes the response value client
 * controlled, so every entry is checked rather than trusted: a name longer than
 * {@link MAX_HEADER_LEN} or carrying anything outside the token grammar is
 * dropped, names are deduplicated case-insensitively since field names are
 * case-insensitive, and the list is capped at {@link MAX_ALLOWED_HEADERS} so one
 * request cannot make the server emit an unbounded header.
 *
 * Original casing is preserved on the entries that survive. The header is
 * case-insensitive either way, and echoing back what was asked for is easier to
 * match up in a browser's network panel than a normalized form would be.
 */
function reflectRequestedHeaders(requested: string): string[] {
  const seen = new Set<string>();
  const reflected: string[] = [];

  for (const name of requested.split(',')) {
    const header = name.trim();

    if (
      !header ||
      header.length > MAX_HEADER_LEN ||
      !HEADER_NAME_TOKEN.test(header)
    ) {
      continue;
    }

    const key = header.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    reflected.push(header);

    if (reflected.length >= MAX_ALLOWED_HEADERS) {
      break;
    }
  }

  return reflected;
}

/**
 * A validated policy, the header it belongs in, and the serialized value.
 *
 * `config` is kept rather than discarded because the serialized value is not
 * always final. An SSR request contributes the active template's hashes partway
 * through, and folding those in means serializing this policy again, with more
 * sources. Keeping the config next to the value is what lets that work for a
 * policy a resolver produced, and not just for the one configured at startup.
 */
type CompiledCSP = {
  headerName: string;
  value: string;
  config: CSPConfig;
};

/**
 * The headers whose whole configuration is one value, resolved to the string
 * that goes on the wire.
 *
 * Kept as a list of pairs rather than named fields because nothing downstream
 * has an opinion about any individual one: they are validated, serialized, and
 * then written in a loop. A new one is a line in `resolveSimpleHeaders` and
 * nothing else.
 */
/**
 * The policy fields that become a single-value header.
 *
 * Listed once because three places have to agree about them: the merge, the
 * `null` check that guards the merge, and the serializer. `satisfies` ties it
 * to the policy type, so a field added there without being added here is a
 * type error rather than a header that silently stops being overridable.
 */
const SIMPLE_HEADER_FIELDS = [
  'contentTypeOptions',
  'referrerPolicy',
  'permissionsPolicy',
  'crossOriginOpenerPolicy',
  'crossOriginOpenerPolicyReportOnly',
  'crossOriginResourcePolicy',
  'crossOriginEmbedderPolicy',
  'crossOriginEmbedderPolicyReportOnly',
  'reportingEndpoints',
] as const satisfies ReadonlyArray<keyof SecurityHeadersPolicyInput>;

type ResolvedSimpleHeaders = ReadonlyArray<
  readonly [name: string, value: string]
>;

/**
 * Validate and serialize the single-value headers in one pass.
 *
 * The collectors are the same ones `validateSecurityHeadersPolicy` uses, so a
 * block that function accepts is one the plugin accepts, whether it arrived at
 * startup or from a `resolve` callback.
 *
 * @param policy The block to read, which is the config at startup and the
 *   merged effective policy per request
 * @param onIssue Called with every problem found, so the caller decides whether
 *   to throw the first one or collect them
 */
function resolveSimpleHeaders(
  policy: SecurityHeadersPolicyInput,
  onIssue: (issue: SecurityHeadersPolicyIssue) => void,
): ResolvedSimpleHeaders {
  for (const issue of [
    ...collectContentTypeOptionsIssues(policy.contentTypeOptions),
    ...collectReferrerPolicyIssues(policy.referrerPolicy),
    ...collectPermissionsPolicyIssues(policy.permissionsPolicy),
    ...collectCOOPIssues(policy.crossOriginOpenerPolicy),
    ...collectCORPIssues(policy.crossOriginResourcePolicy),
    ...collectCOEPIssues(policy.crossOriginEmbedderPolicy),
    ...collectCOOPReportOnlyIssues(policy.crossOriginOpenerPolicyReportOnly),
    ...collectCOEPReportOnlyIssues(policy.crossOriginEmbedderPolicyReportOnly),
    ...collectReportingEndpointsIssues(policy.reportingEndpoints),
  ]) {
    onIssue(issue);
  }

  const headers: Array<readonly [string, string]> = [];

  // Compared against `true` rather than read as truthy, the same rule every
  // other opt-in here follows, so a string "false" out of a JSON config does
  // not switch a header on.
  if (policy.contentTypeOptions === true) {
    headers.push(['X-Content-Type-Options', 'nosniff']);
  }

  if (policy.referrerPolicy) {
    const tokens = Array.isArray(policy.referrerPolicy)
      ? policy.referrerPolicy
      : [policy.referrerPolicy];

    if (tokens.length > 0) {
      headers.push(['Referrer-Policy', tokens.join(', ')]);
    }
  }

  if (policy.permissionsPolicy) {
    const value = serializePermissionsPolicy(policy.permissionsPolicy);

    // An empty object is already reported above; this keeps a bare header off
    // the wire regardless, since one with no value says nothing and a browser
    // ignores it.
    if (value) {
      headers.push(['Permissions-Policy', value]);
    }
  }

  if (policy.crossOriginOpenerPolicy) {
    headers.push([
      'Cross-Origin-Opener-Policy',
      serializeCrossOriginPolicy(policy.crossOriginOpenerPolicy),
    ]);
  }

  if (policy.crossOriginOpenerPolicyReportOnly) {
    headers.push([
      'Cross-Origin-Opener-Policy-Report-Only',
      serializeCrossOriginPolicy(policy.crossOriginOpenerPolicyReportOnly),
    ]);
  }

  if (policy.crossOriginResourcePolicy) {
    headers.push([
      'Cross-Origin-Resource-Policy',
      policy.crossOriginResourcePolicy,
    ]);
  }

  if (policy.crossOriginEmbedderPolicy) {
    headers.push([
      'Cross-Origin-Embedder-Policy',
      serializeCrossOriginPolicy(policy.crossOriginEmbedderPolicy),
    ]);
  }

  if (policy.crossOriginEmbedderPolicyReportOnly) {
    headers.push([
      'Cross-Origin-Embedder-Policy-Report-Only',
      serializeCrossOriginPolicy(policy.crossOriginEmbedderPolicyReportOnly),
    ]);
  }

  if (policy.reportingEndpoints) {
    const value = serializeReportingEndpoints(policy.reportingEndpoints);

    if (value) {
      headers.push(['Reporting-Endpoints', value]);
    }
  }

  return headers;
}

type ResolvedSecurityHeadersConfig = {
  cors: ResolvedCORSConfig;
  frameOptions: false | 'DENY' | 'SAMEORIGIN';
  hsts: false | HSTSConfig;
  /**
   * The single-value headers, resolved to the exact string that goes on the
   * wire or `false` for "send nothing".
   *
   * Serialized once here rather than per response, which matters most for
   * `Permissions-Policy`: it is built from an object, so leaving it as config
   * would mean rebuilding the same string on every request for a value that
   * cannot change between them.
   */
  simple: ResolvedSimpleHeaders;
  /**
   * The policy in force, compiled. On the base config this is computed once at
   * startup. On a config a resolver produced it is computed for that request,
   * which is the only time its inputs are known.
   */
  csp: false | CompiledCSP;
  /**
   * Present only on the base config, and only when a `resolve` is configured.
   *
   * Carrying it here rather than threading a resolver argument through every
   * apply path means the config object knows how to become the effective one,
   * and the effective one it returns does not carry it, so there is nothing to
   * recurse into.
   */
  resolveEffective?: (
    request: FastifyRequest,
  ) => Promise<ResolvedSecurityHeadersConfig>;
};

/**
 * The policy in force for this request: the resolver's, if there is one, and
 * the validated defaults otherwise.
 */
async function effectiveConfigFor(
  request: FastifyRequest,
  config: ResolvedSecurityHeadersConfig,
  onResolverError: WritePhase['onResolverError'] = 'throw',
): Promise<ResolvedSecurityHeadersConfig> {
  if (!config.resolveEffective) {
    return config;
  }

  if (onResolverError === 'throw') {
    return config.resolveEffective(request);
  }

  try {
    return await config.resolveEffective(request);
  } catch (error) {
    logCallbackError(
      request,
      error,
      'resolve failed while headers were being applied to a response that was already composed, so the configured defaults are being used without HSTS rather than replacing the response with the error',
    );

    // Whatever the failed resolve left behind, which is the baseline with HSTS
    // dropped, or narrowed to the host when `ownDomains` says it is ours.
    // `resolveEffectiveConfig` stores that before it awaits precisely so this
    // path has something correct to reach for.
    const cache = request as FastifyRequest & {
      securityHeadersEffective?: ResolvedSecurityHeadersConfig;
    };

    return cache.securityHeadersEffective ?? { ...config, hsts: false };
  }
}

/**
 * Check if an origin is allowed based on the origin configuration
 */
async function isOriginAllowed(
  origin: string | undefined,
  originConfig: CORSOrigin | false,
  request: FastifyRequest,
): Promise<boolean> {
  // CORS is off. Nothing is allowed, and nothing above this will send a header
  // either, so this is belt and braces rather than the only guard.
  if (originConfig === false) {
    return false;
  }

  if (typeof originConfig === 'string') {
    // Delegate to list matcher for uniform handling (exact, wildcard, protocol wildcard, and "*")
    return matchesOriginList(origin, [originConfig]);
  }

  if (Array.isArray(originConfig)) {
    return matchesOriginList(origin, originConfig);
  }

  if (typeof originConfig === 'function') {
    return await originConfig(origin, request);
  }

  return false;
}

/**
 * Check if credentials are allowed for an origin
 */
async function areCredentialsAllowed(
  origin: string | undefined,
  credentialsConfig: CORSConfig['credentials'],
  request: FastifyRequest,
  allowWildcardSubdomains: boolean,
): Promise<boolean> {
  if (credentialsConfig === false || credentialsConfig === undefined) {
    return false;
  }

  if (credentialsConfig === true) {
    return true;
  }

  if (Array.isArray(credentialsConfig)) {
    return matchesCORSCredentialsList(origin, credentialsConfig, {
      allowWildcardSubdomains: allowWildcardSubdomains,
    });
  }

  if (typeof credentialsConfig === 'function') {
    return await credentialsConfig(origin, request);
  }

  return false;
}

/**
 * Per-request cache of the two origin-negotiated decisions.
 *
 * Both are computed at most once per request and reused everywhere else in the
 * lifecycle. That is partly to avoid paying for a user callback several times,
 * and partly because a callback that throws must not be given a second chance
 * to throw from the error path that is already handling the first throw.
 */
interface CORSDecisionCache {
  corsOriginAllowed?: boolean;
  corsCredentialsAllowed?: boolean;
}

/**
 * Report a user callback that threw.
 *
 * Read defensively because this runs on paths that predate the request having a
 * logger, and a failure to log must never become the thing that breaks the
 * response we are in the middle of rescuing.
 */
function logCallbackError(
  request: FastifyRequest,
  error: unknown,
  message: string,
): void {
  const log = (request as Partial<FastifyRequest>).log;
  log?.error({ err: error }, `[securityHeaders] ${message}`);
}

/**
 * Decide whether this request's origin is allowed, once per request.
 *
 * A callback that throws denies rather than 500s. The request itself is fine,
 * it is the policy that could not be evaluated, and the safe reading of an
 * unevaluated policy is that the origin is not on it. Denying costs a
 * cross-origin caller its response; 500ing costs everyone theirs, including
 * same-origin traffic that was never subject to the callback in the first
 * place.
 */
async function resolveOriginAllowed(
  request: FastifyRequest,
  cors: ResolvedCORSConfig,
  isOriginAllowedResult?: boolean,
): Promise<boolean> {
  if (isOriginAllowedResult !== undefined) {
    return isOriginAllowedResult;
  }

  const cache = request as FastifyRequest & CORSDecisionCache;

  if (cache.corsOriginAllowed !== undefined) {
    return cache.corsOriginAllowed;
  }

  let isAllowed: boolean;

  try {
    isAllowed = await isOriginAllowed(
      request.headers.origin,
      cors.origin,
      request,
    );
  } catch (error) {
    logCallbackError(
      request,
      error,
      'origin callback threw, denying the origin for this request',
    );
    isAllowed = false;
  }

  // Cached even when the callback threw. Without this the 500 the throw would
  // otherwise produce runs the error path, the error path applies security
  // headers, and the callback is invoked a second time from inside the handler
  // dealing with the first failure.
  cache.corsOriginAllowed = isAllowed;

  return isAllowed;
}

/**
 * Decide whether this request's origin may send credentials, once per request.
 *
 * Same fail-closed rule as the origin decision, and the stakes are higher: the
 * header this gates is what lets a cross-origin caller read a response made
 * with the user's cookies.
 */
async function resolveCredentialsAllowed(
  request: FastifyRequest,
  cors: ResolvedCORSConfig,
): Promise<boolean> {
  const cache = request as FastifyRequest & CORSDecisionCache;

  if (cache.corsCredentialsAllowed !== undefined) {
    return cache.corsCredentialsAllowed;
  }

  let isAllowed: boolean;

  try {
    isAllowed = await areCredentialsAllowed(
      request.headers.origin,
      cors.credentials,
      request,
      cors.credentialsAllowWildcardSubdomains,
    );
  } catch (error) {
    logCallbackError(
      request,
      error,
      'credentials callback threw, withholding Access-Control-Allow-Credentials',
    );
    isAllowed = false;
  }

  cache.corsCredentialsAllowed = isAllowed;

  return isAllowed;
}

/**
 * How a header write should treat a value that is already on the reply.
 *
 * - `'apply'`: set it, which is what the early `onRequest` pass does since
 *   nothing has run yet
 * - `'fill'`: leave an existing value alone, which is what the `onSend`
 *   backstop does so a handler that deliberately set its own value wins
 */
type HeaderWriteMode = 'apply' | 'fill';

function writeSecurityHeader(
  reply: FastifyReply,
  mode: HeaderWriteMode,
  name: string,
  value: string,
): void {
  if (mode === 'fill' && reply.hasHeader(name)) {
    return;
  }

  reply.header(name, value);
}

/**
 * How much an *unset* domain verdict is allowed to mean.
 *
 * - `'rejected-only'`: only an explicit rejection counts. An unset verdict says
 *   nothing, because the gate may simply not have run yet.
 * - `'unverified'`: an unset verdict counts too, because on this path the gate
 *   would already have run if it were ever going to.
 */
type HostCheck = 'rejected-only' | 'unverified';

/**
 * What a header write is allowed to assume, which differs between the
 * `onRequest` pass and anything sending a response.
 *
 * Both fields answer the same underlying question and are carried together so a
 * call site cannot get one right and the other wrong.
 */
interface WritePhase {
  /** How much an unset domain verdict is allowed to mean. */
  hostCheck: HostCheck;
  /**
   * What to do when `resolve` fails.
   *
   * `'throw'` on the `onRequest` pass, which is the documented behavior: the
   * resolver failure becomes a 500 through the ordinary error path, with
   * nothing written to the reply yet.
   *
   * `'degrade'` once a response exists. A throw there does not produce a clean
   * 500, it escapes `onSend` and hands Fastify's error handler a reply that is
   * already composed, which rewrites the body. The observed result was a 403
   * from `domainValidation` whose body had been replaced by the resolver's
   * error message, so a database connection string reached the client under
   * somebody else's status code. Degrading writes the headers the fallback
   * already established, which has HSTS dropped, and logs.
   */
  onResolverError: 'throw' | 'degrade';
}

/** The `onRequest` pass, where nothing has been written and a throw is clean. */
const EARLY_PHASE: WritePhase = {
  hostCheck: 'rejected-only',
  onResolverError: 'throw',
};

/**
 * Whether this request's host is one the server has declined to claim.
 *
 * The two readings ask genuinely different questions, and collapsing them into
 * one gets a real case wrong in each direction.
 *
 * `'rejected-only'` is the conservative reading and the safe default. An unset
 * verdict usually just means this plugin's hook ran before the gate's, so
 * treating it as unverified would withhold HSTS from ordinary responses on a
 * perfectly healthy server.
 *
 * `'unverified'` says something much stronger: `domainValidation` is registered
 * and never got to run, because a hook above it ended the request, which a hook
 * that *throws* also does. Nothing has vouched for the host, and the response
 * still goes out. Sending HSTS there binds whatever host the client asked for,
 * for the full max-age, with no way to revoke it, which is the precise outcome
 * the rejection check already exists to prevent, reached through a plugin that
 * failed rather than a domain that was refused.
 *
 * Which one a response path gets is decided by plugin order, not by how late
 * the write is. See `lateHostCheck` in the plugin body: "the response is being
 * sent" is *not* the same as "every onRequest hook has run", because this
 * plugin answers a preflight from inside its own `onRequest`, and
 * `staticContent` serves a file from inside one too.
 *
 * `isHostUnverified` returns false when `domainValidation` is not registered at
 * all, so a server that does not validate hosts is unaffected by either.
 */
function isHostDisclaimed(
  request: FastifyRequest,
  hostCheck: HostCheck,
): boolean {
  return hostCheck === 'unverified'
    ? isHostUnverified(request)
    : request.domainValidationRejected === true;
}

/**
 * Check an HSTS block.
 *
 * Extracted so the defaults and a resolver's override are held to the same
 * rules. A resolver returning something the config would have rejected is a
 * bug worth surfacing, not a way around validation.
 */
function validateHSTSConfig(cfg: HSTSConfig): void {
  const [first] = collectHSTSIssues(cfg);

  if (first) {
    throw new Error(first.message);
  }
}

/**
 * Check an X-Frame-Options value.
 *
 * Same arrangement as `validateHSTSConfig`: the rule lives in the collector the
 * public validator uses, and this is the startup-shaped view of it. Worth
 * having as its own check because the value is written to the header verbatim
 * and a browser ignores one it does not recognize, so an unvetted `'ALLOWALL'`
 * disables framing protection without failing anywhere.
 */
function validateFrameOptions(value: unknown): void {
  const [first] = collectFrameOptionsIssues(value);

  if (first) {
    throw new Error(first.message);
  }
}

/**
 * The directive a browser would actually consult for an inline attribute.
 *
 * CSP fallback stops at the first directive that is set, it does not union the
 * chain. `script-src-attr` wins over `script-src`, which wins over
 * `default-src`, and once one of them is present the rest are not consulted at
 * all. An empty array counts as absent because it serializes to nothing, so the
 * browser falls through it too.
 *
 * Returns undefined when nothing in the chain is set, meaning no directive
 * restricts the attribute.
 */
function effectiveAttributeSources(
  policy: CSPConfig,
  kind: 'script' | 'style',
): readonly string[] | undefined {
  const chain =
    kind === 'script'
      ? [policy.scriptSrcAttr, policy.scriptSrc, policy.defaultSrc]
      : [policy.styleSrcAttr, policy.styleSrc, policy.defaultSrc];

  return chain.find((sources) => sources !== undefined && sources.length > 0);
}

/**
 * Whether the policy would actually let this inline attribute run.
 *
 * The check exists because warning unconditionally would be noise: someone who
 * has deliberately set 'unsafe-hashes' or 'unsafe-inline' has already decided,
 * and telling them again on every startup is how a warning gets tuned out. The
 * detection lives in the template pipeline, which cannot see the policy, and
 * the policy lives here, which cannot see the template. Reporting from there
 * and deciding here is what lets the warning be accurate.
 *
 * Accuracy is the whole point, so the decision follows one chain rather than
 * scanning every directive for an opt-in. Asking "did anything anywhere say
 * 'unsafe-inline'" gets it wrong in both directions: a permissive `style-src`
 * would excuse an `onclick=` that has nothing to do with styles, and a
 * `script-src-attr: ["'none'"]` sitting above a permissive `script-src` would
 * excuse a handler that the more specific directive is specifically blocking.
 *
 * The two opt-ins are not equivalent, which is the other thing this gets right.
 * 'unsafe-inline' permits the attribute outright, when it is in effect at all.
 * 'unsafe-hashes' permits nothing by itself: it only makes hash sources
 * eligible to match an attribute, so a directive carrying it still blocks every
 * attribute whose exact value is not also listed as a hash. Verified against
 * Chrome, which runs `onclick` under
 * `script-src-attr 'unsafe-hashes' 'sha256-<value>'` and blocks it under
 * `script-src-attr 'unsafe-hashes'` alone.
 */
function permitsInlineAttribute(
  policy: CSPConfig,
  finding: InlineAttributeFinding,
): boolean {
  const sources = effectiveAttributeSources(policy, finding.kind);

  // Nothing in the chain is set, so nothing blocks the attribute and there is
  // nothing to warn about.
  if (!sources) {
    return true;
  }

  // Effective rather than merely present. A directive reading
  // `'unsafe-inline' 'sha256-something'` has an inert keyword, so the attribute
  // is blocked and the author is the one person who would not guess it from
  // reading their own policy.
  //
  // The finding's kind carries through because 'strict-dynamic' disables the
  // keyword for scripts and script attributes only. A style attribute under
  // `style-src 'unsafe-inline' 'strict-dynamic'` still runs, so warning about
  // it would be a false alarm.
  if (isUnsafeInlineEffective(sources, finding.kind)) {
    return true;
  }

  // 'unsafe-hashes' is a modifier rather than a permission, so it takes the
  // hash of this specific attribute's value alongside it. A policy carrying the
  // keyword and a hash for some *other* attribute still blocks this one, which
  // is exactly the case a keyword-only check would wave through.
  return sources.includes("'unsafe-hashes'") && sources.includes(finding.hash);
}

/**
 * Reject the one framing pair where the fallback is weaker than the policy.
 *
 * The rule and its message live in `collectFramingIssues`, which the public
 * `validateSecurityHeadersPolicy` also uses. This is the startup-shaped view of
 * it: same judgment, thrown rather than returned.
 *
 * @param frameOptions The effective X-Frame-Options value, if any
 * @param csp The effective CSP config, already expanded from its preset
 */
function validateFramingFallback(
  frameOptions: SecurityHeadersConfig['frameOptions'],
  csp: CSPConfig | false | undefined,
): void {
  const [first] = collectFramingIssues(frameOptions, csp);

  if (first) {
    throw new Error(first.message);
  }
}

/**
 * Build the effective policy for a request, running `resolve` at most once.
 *
 * The cached verdict is what keeps a throwing resolver from throwing twice. It
 * propagates the first time and Fastify turns that into a 500; the error path
 * then applies security headers, reaches this, and finds an answer already
 * waiting rather than calling the resolver that just failed. Same double-fault
 * shape the CORS callbacks needed solving, same solution.
 */
async function resolveEffectiveConfig(
  request: FastifyRequest,
  baseConfig: ResolvedSecurityHeadersConfig,
  resolve: SecurityHeadersResolver | undefined,
  serializePolicy: (csp: CSPConfig) => false | CompiledCSP,
  ownDomains: string[] | undefined,
  /**
   * The configured policy, deeply frozen. Handed to the resolver, and read here
   * for the fields an override inherits.
   *
   * One value for both jobs rather than a separate copy for each. The merge
   * needs the single-value headers as the caller *wrote* them rather than as
   * the strings they turned into, since reading them back off
   * `baseConfig.simple` would mean parsing a header to decide what to inherit,
   * and that is exactly what the baseline already holds. Two parameters would
   * be two things that must agree and eventually would not.
   */
  baseline: SecurityHeadersBaseline,
): Promise<ResolvedSecurityHeadersConfig> {
  if (!resolve) {
    return baseConfig;
  }

  const cache = request as FastifyRequest & {
    securityHeadersEffective?: ResolvedSecurityHeadersConfig;
  };

  if (cache.securityHeadersEffective) {
    return cache.securityHeadersEffective;
  }

  // A host `domainValidation` has refused never reaches the resolver at all.
  //
  // There is nothing for it to decide. `resolve` exists to pick a policy for a
  // tenant, and this request has no tenant: the operator has said the host is
  // not one they serve. The response is unirend's own 403 or 400, plain text or
  // a small JSON envelope rather than tenant content, so the configured
  // defaults dress it perfectly well.
  //
  // Skipping is also the cheaper and safer of the two. `resolve` is typically a
  // database or cache lookup, and running it here meant anyone could make the
  // server do one per request just by sending a `Host` header naming a domain
  // that does not exist, on requests that were refused before any of the
  // application's own rate limiting or auth had a chance to see them.
  //
  // HSTS is dropped for the same reason it is dropped everywhere else on this
  // path: a domain the operator has disclaimed is not one to bind. The write
  // side removes the header independently, so this is belt and braces rather
  // than the only guard.
  if (isHostDisclaimed(request, 'rejected-only')) {
    const disclaimed: ResolvedSecurityHeadersConfig = {
      ...baseConfig,
      hsts: false,
    };

    cache.securityHeadersEffective = disclaimed;

    return disclaimed;
  }

  // Stored before awaiting, so the error path has something to use even though
  // the throw below never lets execution reach the assignment at the end.
  //
  // HSTS is dropped from it, and that is not a preference. The baseline is
  // whatever suits the domains the operator owns, typically a long max-age with
  // includeSubDomains, and the whole reason a resolver exists is to send
  // something narrower on a domain they do not own. Falling back to the
  // baseline on a customer domain would bind it for a year with no way to
  // revoke, which is worse than the 500 that prompted it. Everything else is
  // safe to fall back on: too strict at worst, and the effect ends with the
  // response.
  //
  // Unless the operator has said which hosts are theirs, in which case the
  // question has an answer for this request and blanket suppression is just
  // imprecision. Binding a domain for a year is safe when you own it, so a
  // store outage need not cost first-party traffic its HSTS as well.
  const isOwnHost =
    ownDomains !== undefined &&
    ownDomains.length > 0 &&
    matchesDomainList(normalizeDomain(request.hostname ?? ''), ownDomains);

  cache.securityHeadersEffective = isOwnHost
    ? baseConfig
    : { ...baseConfig, hsts: false };

  const override = await resolve(request, baseline);

  // `null` is the documented way to say "the defaults are fine", and it is the
  // only one. Matched exactly rather than read as truthy, the same rule the
  // config path applies to `hsts` and `csp`, and for a sharper version of the
  // same reason.
  //
  // Every other falsy value is a resolver that did not answer: a store miss
  // handing back `undefined` or `''`, a function that fell off the end, a JSON
  // column holding `false`. Reading any of those as consent to the defaults
  // sends the baseline HSTS, and the baseline is whatever suits the domains the
  // operator owns, typically a long max-age with includeSubDomains. On a
  // customer's mapped domain that binds it for a year with no way to revoke,
  // which is the single outcome `resolve` exists to prevent, reached through a
  // value nobody meant to return.
  //
  // So an unrecognized result fails instead, and failing is the safe direction
  // here: the fallback stored just above has already dropped HSTS, so the 500
  // goes out without binding anything.
  if (override === null) {
    cache.securityHeadersEffective = baseConfig;

    return baseConfig;
  }

  // Checked through a separate `unknown` reference rather than on `override`
  // itself. Narrowing the declared type by `Record<string, unknown>` intersects
  // the two, which erases what each block is declared to be and leaves the
  // reads below typed as `{}`.
  const returned: unknown = override;

  if (!isPlainObject(returned)) {
    throw new Error(
      `securityHeaders resolve returned ${describeValue(returned)}. Return null to use the configured defaults, or an object with one or more of: ${SECURITY_HEADERS_POLICY_KEYS.join(', ')}.`,
    );
  }

  // A key that is not a policy field fails the request rather than being
  // ignored, which is the same call the block-level checks below make and for a
  // sharper reason. Every other way of getting a block wrong is caught: a bad
  // value is validated, and `false` and `null` are told apart deliberately. A
  // misspelling is the one mistake that produces a *valid* policy, because
  // dropping the key leaves the block absent and an absent block inherits the
  // baseline, which is exactly what a correct resolver does. So `frameOption:
  // false` on a customer's domain silently sends the baseline's framing policy,
  // and `hst: { maxAge: 86400 }` silently sends the baseline's year-long HSTS
  // on a domain the resolver exists to send something narrower for.
  //
  // TypeScript rules this out for a typed caller, which is why it needs a
  // runtime check: the resolvers that reach here untyped, reading a policy out
  // of a JSON column or an admin form, are the ones that get it wrong.
  const unknownKeys = unknownPolicyKeys(returned);

  if (unknownKeys.length > 0) {
    throw new Error(
      `securityHeaders resolve returned ${unknownKeys.map((key) => `"${key}"`).join(', ')}, which ${unknownKeys.length === 1 ? 'is not a policy field' : 'are not policy fields'}. Expected ${SECURITY_HEADERS_POLICY_KEYS.join(', ')}. A misspelled key is dropped, and a missing block inherits the configured default, so this would send the baseline policy while reading as an override. Use validateSecurityHeadersPolicy() to check a stored policy before it gets here.`,
    );
  }

  // Validated with the same rules as the defaults, so a resolver cannot produce
  // a policy the config would have rejected. A throw here propagates like any
  // other resolver failure, which is right: returning something invalid is a
  // bug in the same place with the same consequences as throwing.
  if (override.hsts !== undefined && override.hsts !== false) {
    validateHSTSConfig(override.hsts);
  }

  // Checked before the merge below, where `??` would otherwise let a `null`
  // through as "inherit" and anything else through as a header value.
  validateFrameOptions(override.frameOptions);

  let csp = baseConfig.csp;

  if (override.csp !== undefined) {
    if (override.csp === false) {
      csp = false;
    } else {
      validateCSPConfig(override.csp);
      csp = serializePolicy(override.csp);
    }
  }

  // Each block replaces rather than merges. A partial merge would let
  // `hsts: { maxAge: 86400 }` silently keep the baseline's includeSubDomains,
  // which is the exact combination the override exists to avoid.
  // The single-value headers follow the same replace-rather-than-merge rule,
  // one field at a time, so a resolver that sets only `referrerPolicy` keeps
  // the baseline's `contentTypeOptions`. Resolved from the merged block rather
  // than from the override alone, which is what makes an inherited field come
  // out serialized rather than missing.
  //
  // A problem here throws like any other resolver failure. The alternative is
  // sending a header the caller wrote and a browser will ignore, which is the
  // silence these checks exist to break.
  //
  // `null` is rejected before the merge, because the merge is what would hide
  // it: `??` reads null as "inherit", so a stored policy meaning "send no
  // header" would have been served the baseline's instead. That is the same
  // call `frameOptions` and `hsts` already make, and the same one
  // `validateSecurityHeadersPolicy` makes, which had drifted: the public
  // validator rejected `{ contentTypeOptions: null }` while the request path
  // quietly accepted it, so a policy checked at save time behaved differently
  // at serve time. `false` is how you say "send no header" and omitting the key
  // is how you say "inherit".
  for (const field of SIMPLE_HEADER_FIELDS) {
    if (override[field] === null) {
      throw new Error(
        `securityHeaders resolve returned ${field}: null. Use false to send no header, or omit the key to inherit the configured default.`,
      );
    }
  }

  const simplePolicy: SecurityHeadersPolicyInput = {
    contentTypeOptions:
      override.contentTypeOptions ?? baseline.contentTypeOptions,
    referrerPolicy: override.referrerPolicy ?? baseline.referrerPolicy,
    permissionsPolicy: override.permissionsPolicy ?? baseline.permissionsPolicy,
    crossOriginOpenerPolicy:
      override.crossOriginOpenerPolicy ?? baseline.crossOriginOpenerPolicy,
    crossOriginResourcePolicy:
      override.crossOriginResourcePolicy ?? baseline.crossOriginResourcePolicy,
    crossOriginOpenerPolicyReportOnly:
      override.crossOriginOpenerPolicyReportOnly ??
      baseline.crossOriginOpenerPolicyReportOnly,
    crossOriginEmbedderPolicy:
      override.crossOriginEmbedderPolicy ?? baseline.crossOriginEmbedderPolicy,
    crossOriginEmbedderPolicyReportOnly:
      override.crossOriginEmbedderPolicyReportOnly ??
      baseline.crossOriginEmbedderPolicyReportOnly,
    reportingEndpoints:
      override.reportingEndpoints ?? baseline.reportingEndpoints,
  };

  const effective: ResolvedSecurityHeadersConfig = {
    cors: baseConfig.cors,
    frameOptions: override.frameOptions ?? baseConfig.frameOptions,
    hsts: override.hsts ?? baseConfig.hsts,
    simple: resolveSimpleHeaders(simplePolicy, (issue) => {
      throw new Error(issue.message);
    }),
    csp,
  };

  // Checked on the merged pair, not on what the resolver returned, because the
  // two halves come from different places. Overriding just the CSP while
  // inheriting `frameOptions: 'SAMEORIGIN'` from the baseline, or the reverse,
  // assembles the rejected combination out of two halves that are each fine on
  // their own. Validating only the override would let a resolver produce a
  // policy the static config would have refused at startup.
  validateFramingFallback(
    effective.frameOptions,
    effective.csp ? effective.csp.config : effective.csp,
  );

  // The reporting pair, checked on the merge for the same reason the framing
  // pair is: either half can come from the override and the other from the
  // baseline, so a resolver replacing only `reportingEndpoints`, or only the
  // CSP, assembles a policy that names a group nothing defines. Startup and
  // `validateSecurityHeadersPolicy` both refuse that, and the request path did
  // not, which made the module's promise, that a policy the validator accepts
  // is one the plugin accepts, false in the direction that matters: the tenant
  // gets a policy reporting to nowhere and nothing says so.
  const [firstMergedReportingIssue] = collectReportingIssues(
    effective.csp ? effective.csp.config : effective.csp,
    simplePolicy.reportingEndpoints,
    crossOriginReportGroups(simplePolicy),
  );

  if (firstMergedReportingIssue) {
    throw new Error(firstMergedReportingIssue.message);
  }

  cache.securityHeadersEffective = effective;

  return effective;
}

function applyUnconditionalSecurityHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  resolvedConfig: ResolvedSecurityHeadersConfig,
  mode: HeaderWriteMode = 'apply',
  phase: WritePhase = EARLY_PHASE,
): void {
  // These headers are not negotiated per-origin. They are safe to apply even
  // on requests that will ultimately receive no Access-Control-Allow-Origin
  // header, so we keep them separate from the origin-dependent CORS logic.

  // Set Vary: Origin so CDN caches don't serve a cached non-CORS response
  // (which lacks Access-Control-Allow-Origin) to a later CORS request for the
  // same URL.
  //
  // Only when CORS is on. With it off no response ever carries an
  // origin-dependent header, so the response does not vary by Origin and saying
  // it does just splits every CDN cache entry by a header the origin server
  // never reads. That matters here because this plugin is registered by people
  // who only want `csp` or `hsts`, and they should not pay a cache penalty for
  // a feature they did not turn on.
  if (isCORSEnabled(resolvedConfig.cors)) {
    addToVaryHeader(reply, 'Origin');
  }

  // Sits here rather than anywhere else so it inherits everything this function
  // already gets: the early onRequest pass, the onSend backstop that covers
  // responses which short-circuited before it, and applySecurityHeaders() for
  // hijacked paths. A 403 from domainValidation and a static file served by
  // reply.hijack() both carry the policy without any of them knowing about CSP.
  if (resolvedConfig.csp) {
    writeSecurityHeader(
      reply,
      mode,
      resolvedConfig.csp.headerName,
      resolvedConfig.csp.value,
    );
  }

  // Security headers (applied for all requests early in lifecycle)
  if (resolvedConfig.frameOptions) {
    writeSecurityHeader(
      reply,
      mode,
      'X-Frame-Options',
      resolvedConfig.frameOptions,
    );
  }

  // The single-value headers, already validated and serialized. Written here
  // rather than anywhere else for the same reason the CSP is: this function is
  // what the early hook, the onSend backstop, and the hijacked-response helper
  // all go through, so a static file and a 403 from domainValidation get them
  // without either path knowing they exist.
  for (const [name, value] of resolvedConfig.simple) {
    writeSecurityHeader(reply, mode, name, value);
  }

  // RFC 6797 section 7.2: a host MUST NOT send Strict-Transport-Security over
  // a non-secure transport, and user agents MUST ignore it when they receive
  // it that way. So the header is only meaningful on an HTTPS response.
  //
  // `request.protocol` is Fastify's resolution, which reads x-forwarded-proto
  // only when `fastifyOptions.trustProxy` says the peer may be believed. That
  // matters for the common TLS-terminating-proxy deployment: without
  // trustProxy the app sees plain HTTP and sends no HSTS at all.
  //
  // Secure transport is necessary but not sufficient. HSTS also has to be a
  // header this host is entitled to send, and a host the server has not claimed
  // is not: setting an HTTPS policy for a domain the operator has not said is
  // theirs binds the browser for the full max-age with no way to revoke it.
  // Keyed on the host verdict rather than on the 403 status, so an ordinary
  // application authorization failure on a domain we do serve keeps its HSTS.
  //
  // Removed rather than merely withheld, because by the late phase the early
  // pass may already have written it. The early pass runs before
  // `domainValidation` on a server that registers this plugin first, and it
  // runs before anything that later throws, so on exactly the requests where
  // the host turns out to be unclaimed the header is already on the reply and
  // not writing it again would leave it there.
  if (isHostDisclaimed(request, phase.hostCheck)) {
    reply.removeHeader('Strict-Transport-Security');
  } else if (resolvedConfig.hsts && request.protocol === 'https') {
    const parts = [`max-age=${Math.floor(resolvedConfig.hsts.maxAge)}`];

    if (resolvedConfig.hsts.includeSubDomains) {
      parts.push('includeSubDomains');
    }

    if (resolvedConfig.hsts.preload) {
      parts.push('preload');
    }

    writeSecurityHeader(
      reply,
      mode,
      'Strict-Transport-Security',
      parts.join('; '),
    );
  }
}

async function applyCORSActualResponseHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  resolvedConfig: ResolvedSecurityHeadersConfig,
  isOriginAllowedResult?: boolean,
  mode: HeaderWriteMode = 'apply',
  phase: WritePhase = EARLY_PHASE,
): Promise<void> {
  const cors = resolvedConfig.cors;
  const origin = request.headers.origin;
  const isCORSOn = isCORSEnabled(cors);

  // Skipped entirely when CORS is off, rather than computed and then unused.
  // `cors.origin` may be a caller's function, and asking it to decide something
  // no header will carry is work nobody asked for on every request.
  const isAllowed = isCORSOn
    ? await resolveOriginAllowed(request, cors, isOriginAllowedResult)
    : false;

  // Apply the unconditional security/Vary headers first, then layer the
  // origin-negotiated CORS headers on top if this request is allowed.
  //
  // The unconditional set is whatever `resolve` decided for this request, which
  // is why it is looked up here rather than closed over: every path that
  // applies headers goes through this function, so resolving here covers the
  // early hook, the onSend backstop, and the hijacked-response helper at once.
  applyUnconditionalSecurityHeaders(
    request,
    reply,
    await effectiveConfigFor(request, resolvedConfig, phase.onResolverError),
    mode,
    phase,
  );

  // CORS off: the unconditional headers above are the whole job.
  if (!isCORSOn) {
    return;
  }

  // For non-preflight requests, let them proceed without CORS headers if the
  // origin is not allowed. Same-origin requests still work; browsers enforce
  // the cross-origin failure client-side.
  if (!isAllowed && origin) {
    return;
  }

  if (origin && isAllowed) {
    // For allowed cross-origin requests we echo the specific origin rather than
    // using '*' so credentials/exposed-headers semantics stay correct.
    writeSecurityHeader(reply, mode, 'Access-Control-Allow-Origin', origin);

    const isCredentialsAllowed = await resolveCredentialsAllowed(request, cors);

    // Never send credentials for the special 'null' origin
    if (isCredentialsAllowed && origin !== 'null') {
      writeSecurityHeader(
        reply,
        mode,
        'Access-Control-Allow-Credentials',
        'true',
      );
    }

    if (cors.exposedHeaders.length > 0) {
      writeSecurityHeader(
        reply,
        mode,
        'Access-Control-Expose-Headers',
        cors.exposedHeaders.join(', '),
      );
    }
  } else if (!origin && cors.origin === '*') {
    // Requests without an Origin header are non-browser/same-origin style
    // traffic. When policy is fully wildcard, keep the public wildcard signal.
    writeSecurityHeader(reply, mode, 'Access-Control-Allow-Origin', '*');
  }
}

/**
 * Browser security headers plugin for Unirend
 *
 * Owns the response headers a browser enforces policy from: CORS negotiation
 * plus the non-negotiated headers such as X-Frame-Options and HSTS.
 *
 * Provides more flexible CORS handling than @fastify/cors, specifically:
 * - Dynamic credentials based on origin
 * - Function-based origin validation
 * - Separate credential and origin policies
 *
 * CORS options live under `cors`, and CORS is off until `cors.origin` is set.
 * The examples below all set it, because there is no default that turns it on:
 * a plugin registered for `csp` or `hsts` alone sends no CORS headers at all.
 *
 * @example
 * ```typescript
 * // Allow public API access but only credentials for trusted origins.
 * // The two lists are independent: '*' decides who may read a response,
 * // the credentials list decides who may do it with cookies attached.
 * securityHeaders({
 *   cors: {
 *     origin: "*", // Written out, never inherited: this is every origin
 *     credentials: ["https://myapp.com", "https://admin.myapp.com"], // Only these can send cookies
 *     methods: ["GET", "POST"],
 *   },
 * })
 *
 * // Handle "null" origins from sandboxed documents or file:// URLs
 * securityHeaders({
 *   cors: {
 *     origin: ["https://app.com", "null"], // Explicitly allow null origins
 *     credentials: ["https://app.com"], // Credentials not allowed for null origins
 *   },
 * })
 *
 * // Dynamic validation based on request
 * securityHeaders({
 *   cors: {
 *     origin: (origin, request) => {
 *       // Allow any origin for public endpoints
 *       if (request.url?.startsWith('/api/public/')) return true;
 *       // Restrict private endpoints
 *       return origin === 'https://myapp.com';
 *     },
 *     credentials: (origin, request) => {
 *       // Only allow credentials for authenticated endpoints from trusted origins
 *       return request.url?.startsWith('/api/auth/') && origin === 'https://myapp.com';
 *     },
 *   },
 * })
 *
 * // No CORS, which is the default and can also be said out loud
 * securityHeaders({ cors: false, csp: { preset: 'strict' } })
 * ```
 */
export function securityHeaders(
  config: SecurityHeadersConfig = {},
): SecurityHeadersPlugin {
  // Validated and normalized in one pass, by the same collectors the public
  // `validateCORSPolicy` uses, so a block that function accepts is one the
  // plugin accepts. Startup wants the first problem rather than the list, since
  // there is nobody to show a list to and the config came from the repository.
  //
  // The error class carries through because two of these rules have raised a
  // TypeError since long before they moved, and which class a startup failure
  // throws is something a caller may well be catching on.
  const cors = collectCORSIssues(config.cors);
  const [firstCORSIssue] = cors.issues;

  if (firstCORSIssue) {
    throw firstCORSIssue.typeError
      ? new TypeError(firstCORSIssue.message)
      : new Error(firstCORSIssue.message);
  }

  const corsConfig: ResolvedCORSConfig = cors.normalized;

  // Validate security header options at config-time.
  //
  // Matched against the two values that mean "no HSTS" rather than tested for
  // truthiness, so the falsy ones that mean nothing of the kind still get
  // checked. A JSON config carrying `hsts: 0` or `hsts: null` would otherwise
  // skip validation here and then be read as "off" downstream, which is the
  // header quietly not being sent rather than the startup failure a bad value
  // deserves. Same rule the resolver path already applies to an override.
  if (config.hsts !== undefined && config.hsts !== false) {
    validateHSTSConfig(config.hsts);
  }

  // Unconditional, unlike the framing cross-check below, which only has a pair
  // to judge when there is a CSP. A bad value is a bad value either way, and
  // JavaScript callers get no help from the type.
  validateFrameOptions(config.frameOptions);

  // The single-value headers, validated and serialized once. Startup throws the
  // first problem rather than collecting them, the same as everything else
  // here: there is nobody to show a list to and the config came from the
  // repository.
  const baseSimplePolicy: SecurityHeadersPolicyInput = {
    contentTypeOptions: config.contentTypeOptions,
    referrerPolicy: config.referrerPolicy,
    permissionsPolicy: config.permissionsPolicy,
    crossOriginOpenerPolicy: config.crossOriginOpenerPolicy,
    crossOriginOpenerPolicyReportOnly: config.crossOriginOpenerPolicyReportOnly,
    crossOriginResourcePolicy: config.crossOriginResourcePolicy,
    crossOriginEmbedderPolicy: config.crossOriginEmbedderPolicy,
    crossOriginEmbedderPolicyReportOnly:
      config.crossOriginEmbedderPolicyReportOnly,
    reportingEndpoints: config.reportingEndpoints,
  };

  const baseSimpleHeaders = resolveSimpleHeaders(baseSimplePolicy, (issue) => {
    throw new Error(issue.message);
  });

  // Assemble the validated blocks into the shape the request-time helpers read.
  // Keeping CORS in its own block means a future per-request override can
  // replace one block without touching the others.
  // Validate and serialize the startup policy once. A resolver can replace it
  // per request, but for everyone not using one the value is fixed for the life
  // of the process.
  let resolvedCSP: false | CompiledCSP = false;

  // Rebuilt policies, keyed by the policy they came from and the extra sources
  // folded into it.
  //
  // One cache per `securityHeaders()` call, which in practice means per server:
  // the plugin instance is registered once and shared by every app on it, so a
  // multi-app SSR server has one of these covering all of its apps.
  //
  // What the key space actually is, since it is wider than it first looks. The
  // policy half is the serialized base policy, so a per-tenant resolver adds
  // one entry per distinct policy rather than one per request, and tenants
  // sharing a policy share an entry. The sources half is every hash contributed
  // during the request, and that is two different things with two different
  // shapes:
  //
  // - the template's hashes, fixed per app for the life of the process, so they
  //   contribute one entry per app
  // - the rendered page's own inline content, which is decided per render, so
  //   it contributes roughly one entry per distinct page shape
  //
  // That second one is the wide one, and it is worth being honest that this is
  // no longer "one entry per app". A site whose pages each render different
  // inline content has a key space the size of its route table, and one that
  // renders request-varying inline content misses every time.
  //
  // Which is fine, and measured rather than assumed: a miss costs about 3µs
  // (build the key, then serialize ~20 directives), against an SSR render
  // measured in milliseconds. Even a 100% miss rate is noise here. The cache is
  // a small win on a warm path, not a load-bearing optimization, so thrashing
  // it degrades nothing that matters. It is sized for the common case and left
  // there deliberately rather than grown to chase a cost this small.
  //
  // LRU rather than a plain Map because that is the difference between
  // degrading and leaking. Development recomputes hashes per request, since
  // Vite may add inline content after unirend is done with the template, and a
  // Vite plugin injecting something request-varying mints a new key every time.
  // An eviction policy degrades gracefully there, where a hard cap that stopped
  // storing would leave the steady-state apps permanently uncached behind
  // whatever churned in first. Same LRUCache the static content cache uses.
  // Unirend contributes hashes for the inline content it emits itself: the
  // bootstrap that assigns the injected globals, and the styles on its error
  // pages. The framework is the only thing that knows what it emitted, so
  // asking the caller to list these would be asking them to track bytes they
  // never see.
  // Quoted here. hashInlineContentForCSP returns the bare expression, since a
  // source list has unquoted members too and quoting is the assembler's job.
  // Getting this wrong is quiet: an unquoted sha256-... is read as a host
  // name, matches nothing, and the inline content it was meant to allow is
  // blocked with no clue as to why.
  const quote = (hash: string) => `'${hash}'`;

  const ownScriptSources = [quote(UNIREND_BOOTSTRAP_SCRIPT_HASH)];
  const ownStyleSources = UNIREND_ERROR_PAGE_STYLE_HASHES.map(quote);

  const policyBySources = new LRUCache<string, string>(64);

  /**
   * Validate a policy and serialize it with unirend's own inline hashes folded
   * in, producing the value that goes on the wire.
   *
   * Used for the configured policy at startup and for whatever a resolver
   * returns per request, so both arrive downstream in the same shape and both
   * can have request sources folded in later. Returns `false` for a policy that
   * serializes to nothing, which is how "no CSP" is expressed.
   */
  function compileCSP(policy: CSPConfig): false | CompiledCSP {
    const value = serializeCSP(policy, {
      scriptSrc: ownScriptSources,
      styleSrc: ownStyleSources,
    });

    if (!value) {
      return false;
    }

    return { headerName: cspHeaderName(policy), value, config: policy };
  }

  /**
   * The policy with a request's own sources folded in, which for SSR is the
   * active template's inline hashes.
   *
   * Takes the compiled policy rather than closing over the configured one. That
   * is the whole point: a resolver can hand a tenant a different policy, and
   * the hashes for the template that tenant is about to be served have to end
   * up in *that* policy, not in the one the server started with.
   */
  function buildPolicyWithSources(
    compiled: CompiledCSP,
    extra: { scriptSrc?: readonly string[]; styleSrc?: readonly string[] },
  ): string {
    const scriptSrc = [...ownScriptSources, ...(extra.scriptSrc ?? [])];
    const styleSrc = [...ownStyleSources, ...(extra.styleSrc ?? [])];
    const key = `${compiled.value}|${scriptSrc.join(' ')}|${styleSrc.join(' ')}`;

    let policy = policyBySources.get(key);

    if (policy === undefined) {
      policy = serializeCSP(compiled.config, { scriptSrc, styleSrc });
      policyBySources.set(key, policy);
    }

    return policy;
  }

  // Matched against the two values that mean "no CSP" rather than tested for
  // truthiness, so a falsy value that means nothing of the kind is still held
  // to the rules. `csp: null` or `csp: ''` out of a JSON config would otherwise
  // skip the expansion and both checks below and start a server with the header
  // quietly absent, which is the failure nobody notices until it matters. The
  // resolver path already rejects the same values per request.
  //
  // Expanded once, here, so everything downstream (validation, serialization,
  // the frameAncestors check below) sees the finished policy rather than each
  // having to remember to expand it. Expansion hands back anything that is not
  // a policy untouched, leaving validation to describe it.
  if (config.csp !== undefined && config.csp !== false) {
    const cspConfig = applyCSPPreset(config.csp);

    validateCSPConfig(cspConfig);

    validateFramingFallback(config.frameOptions, cspConfig);

    resolvedCSP = compileCSP(cspConfig);
  }

  // A reporting group nothing defines is a policy that reports to nowhere,
  // which is the one mistake here whose only symptom is an absence.
  //
  // Outside the CSP block deliberately. A group can be named by a cross-origin
  // policy's `report-to` parameter as well as by `csp.reportTo`, and a config
  // that sets `crossOriginOpenerPolicyReportOnly` with no CSP at all is exactly
  // the shape someone reaches for first, since report-only COOP is the thing
  // you run *before* committing to a policy.
  const [firstReportingIssue] = collectReportingIssues(
    config.csp === undefined || config.csp === false
      ? config.csp
      : applyCSPPreset(config.csp),
    config.reportingEndpoints,
    crossOriginReportGroups(baseSimplePolicy),
  );

  if (firstReportingIssue) {
    throw new Error(firstReportingIssue.message);
  }

  // What a resolver is handed, and what an omitted block inherits.
  //
  // Built here, after every block above has been validated, so a resolver can
  // never be given a policy the config itself would have refused. Built once,
  // because it cannot change between requests, and a resolver runs on every one.
  //
  // The CSP goes in as configured rather than as expanded, which is the one
  // choice worth stating. `{ csp: { ...baseline.csp, scriptSrc: [...] } }` is
  // the reason: the preset rides along and is expanded again on the way back,
  // with the caller's directives winning, exactly as the configured policy is
  // treated. Handing over the expanded form instead would bake a preset's
  // directives into whatever the resolver returns and, for a resolver that
  // stores what it built, into a tenant's saved policy, where they would quietly
  // stop tracking the preset they came from.
  const baselinePolicy = freezeBaseline({
    csp: config.csp,
    hsts: config.hsts,
    frameOptions: config.frameOptions,
    ...baseSimplePolicy,
  });

  // One message per distinct finding, rather than per request. In production
  // these come from a template hashed once at startup, so the set of them is
  // fixed for the life of the app and repeating per request would say nothing
  // new. Deduping across requests is the whole point: without it a single
  // inline attribute warns on every response, which is how a warning stops
  // being read.
  //
  // Keyed by description and hash together, matching how the scanner dedupes.
  // Two <button onclick> with different handlers are two findings that need two
  // different hashes to fix, so collapsing them on the description would report
  // the first and silently swallow the second.
  //
  // LRU rather than a Set for the same reason `policyBySources` above is one,
  // and the case is the same case. Development re-scans the template per
  // request, after Vite has transformed it, so a Vite plugin emitting a
  // request-varying `style=` or `on*=` value mints a new key every time and a
  // Set would grow without limit for as long as the dev server runs. An
  // eviction policy degrades instead: the worst that happens is a warning
  // repeating after its entry falls out, which is the right way round, since
  // the alternative to a repeated warning here is unbounded memory.
  //
  // Larger than the policy cache because the two hold different things. That
  // one caches a serialized header per distinct page shape, where a miss costs
  // microseconds. This one is the only thing standing between a real finding
  // and a log nobody reads, so it is sized to hold every attribute a realistic
  // template carries several times over.
  const reportedInlineAttributes = new LRUCache<string, true>(512);

  const findingKey = (finding: InlineAttributeFinding) =>
    `${finding.description}|${finding.hash}`;

  const reportInlineAttributes = (
    request: FastifyRequest,
    findings: readonly InlineAttributeFinding[] | undefined,
  ): void => {
    if (!findings?.length) {
      return;
    }

    const fresh = findings.filter(
      (finding) => !reportedInlineAttributes.has(findingKey(finding)),
    );

    if (!fresh.length) {
      return;
    }

    for (const finding of fresh) {
      reportedInlineAttributes.set(findingKey(finding), true);
    }

    const log = (request as Partial<FastifyRequest>).log;

    // The hash goes in the log because it is the one piece of this that cannot
    // be worked out by hand later: it covers the attribute value exactly as
    // parsed, and the value is only in hand while the template is being
    // scanned. Someone who decides to take the 'unsafe-hashes' route can paste
    // it rather than reverse-engineer it.
    log?.warn(
      {
        inlineAttributes: fresh.map((finding) => ({
          attribute: finding.description,
          directive:
            finding.kind === 'script' ? 'script-src-attr' : 'style-src-attr',
          hash: finding.hash,
        })),
      },
      "[securityHeaders] Template content carries inline attributes that this policy blocks. A hash source alone never matches an attribute: it takes 'unsafe-hashes' plus the hash of that attribute's exact value, listed above. Better fixes first: move an on* handler to an addEventListener in a script unirend already hashes, and a style=\"\" attribute into a <style> block or a class.",
    );
  };

  // Mutable so a resolver can be installed after registration. A resolver that
  // needs a database cannot run at config time, but the plugin has to register
  // early so its onRequest beats anything that might short-circuit. Keeping the
  // two separate is what lets both be true: register with a validated static
  // baseline that does no I/O, and install the real resolver once whatever it
  // depends on is ready. Requests served in between get the defaults rather
  // than an error.
  let activeResolver: SecurityHeadersResolver | undefined = config.resolve;

  // Kept exactly as written, not normalized. normalizeDomain answers "what host
  // is this", and a pattern is not a host: it turns `**.example.com` into an
  // empty string, which then matches nothing. Normalizing here cost the
  // documented `['example.com', '**.example.com']` its entire subdomain half,
  // silently, so a failed resolve on api.example.com dropped HSTS for a domain
  // the operator had just said they own. matchesDomainList takes patterns and
  // is case-insensitive on both sides, so there is nothing to do to them first.
  //
  // The request's hostname is still normalized before matching, which is the
  // side of the comparison that genuinely is a host.
  const ownDomains =
    config.ownDomains === undefined
      ? undefined
      : Array.isArray(config.ownDomains)
        ? config.ownDomains
        : [config.ownDomains];

  // Validated at startup rather than left to fail quietly at match time. An
  // entry that matches nothing is invisible in exactly the situation this
  // option exists for: the resolver is already failing, and the only symptom is
  // an HSTS header missing from a response nobody is looking at.
  if (ownDomains) {
    for (const entry of ownDomains) {
      const verdict = validateConfigEntry(entry, 'domain');

      if (!verdict.valid) {
        throw new Error(
          `Invalid securityHeaders ownDomains entry "${entry}"${verdict.info ? ': ' + verdict.info : ''}`,
        );
      }
    }
  }

  const resolvedConfig: ResolvedSecurityHeadersConfig = {
    cors: corsConfig,
    frameOptions: config.frameOptions ?? false,
    hsts: config.hsts ?? false,
    simple: baseSimpleHeaders,
    csp: resolvedCSP,
    resolveEffective: (request) =>
      resolveEffectiveConfig(
        request,
        resolvedConfig,
        activeResolver,
        // A preset is expanded first, so a resolver can return one, and then the
        // same compile step the configured policy went through runs on it. That
        // shared step is what puts unirend's own inline hashes in a resolver's
        // policy as well, and what lets a request's template hashes be folded
        // into it later.
        (csp) => compileCSP(applyCSPPreset(csp)),
        ownDomains,
        baselinePolicy,
      ),
  };

  // Whether `domainValidation` was registered *above* this plugin, captured at
  // registration because it is a fact about plugin order and order is fixed
  // once the server is built.
  //
  // This is what makes an unset domain verdict readable. The tempting rule,
  // "once a response is being sent, every onRequest hook has run", is simply
  // false in this codebase: this plugin answers a CORS preflight from inside
  // its own onRequest, and `staticContent` serves a file from inside one too.
  // On both paths the gate below us legitimately never runs, and reading that
  // as "unverified" stripped HSTS from every preflight and every static asset
  // on a server whose plugin order the documentation explicitly allows.
  //
  // With the gate above us, the inference is sound: anything we can answer has
  // already been through it, so an unset verdict means the request died before
  // the gate rather than merely bypassing it. That is exactly the case worth
  // catching, since a hook that throws above the gate is how an unchecked host
  // reaches an error page.
  //
  // With the gate below us, an unset verdict is ambiguous and stays ambiguous,
  // so only an explicit rejection counts. That is the pre-existing behavior
  // rather than a new hole, and it is the concrete reason `domainValidation`
  // belongs first.
  //
  // Held per *registration* rather than on the factory, which is the whole
  // reason it is declared inside `plugin` below. A `securityHeaders()` value is
  // a long-lived object the caller keeps hold of, because `setResolver` hands
  // it to them for exactly that, so registering one on two servers is an
  // ordinary thing to do. On the factory this variable was global to all of
  // them and the last registration won: register a gate-less second server and
  // the first server, correctly ordered, silently started sending HSTS for
  // unverified hosts again. Declared here, each registration closes over its
  // own, and every hook registered in the same call sees that one.
  const plugin = async (fastify: PluginHostInstance<UnirendServerMode>) => {
    let isGateRegisteredAbove = false;

    /**
     * The phase for anything writing headers onto a response that exists.
     *
     * Both halves are late-specific: an unset domain verdict may be read as
     * "unverified" only when the gate is above us, and a resolver failure must
     * degrade rather than throw, because there is already a composed reply that
     * a throw would replace.
     */
    const latePhase = (): WritePhase => ({
      hostCheck: isGateRegisteredAbove ? 'unverified' : 'rejected-only',
      onResolverError: 'degrade',
    });

    // `domainValidation` decorates the instance when it registers, so the
    // decoration being present *here*, while this plugin is registering, is
    // exactly the question "did the gate go first".
    //
    // Read two ways because this runs against two shapes. A server passes the
    // `PluginHostInstance` wrapper, which exposes decorations through
    // `getDecoration`. A test, and anything else calling the plugin function
    // directly, passes a raw Fastify instance, where `decorate` has set a plain
    // own property. Neither read mutates anything.
    const host = fastify as unknown as {
      getDecoration?: (property: string) => unknown;
      domainValidationRegistered?: unknown;
    };

    isGateRegisteredAbove =
      host.getDecoration?.('domainValidationRegistered') === true ||
      host.domainValidationRegistered === true;

    // A warning rather than a startup failure, because this is the one shape of
    // the problem this code cannot settle. `Reporting-Endpoints` may be coming
    // from a reverse proxy or a hook of the caller's own, and refusing to start
    // would break a working deployment over a file that is not visible from
    // here. When the option *is* configured and simply omits the group, that is
    // a contradiction rather than an unknown, and it throws at config time.
    if (
      isReportingGroupUndefined(
        config.csp === undefined || config.csp === false
          ? config.csp
          : applyCSPPreset(config.csp),
        config.reportingEndpoints,
        // The cross-origin policies name groups through a `report-to`
        // parameter, and a config that sets only a report-only COOP with no CSP
        // at all is the shape someone reaches for first. Leaving them out meant
        // exactly that config got no warning, on the header whose entire job is
        // telling you what the enforcing one would have done.
        crossOriginReportGroups(baseSimplePolicy),
      )
    ) {
      fastify.log?.warn(
        `[securityHeaders] A policy names a reporting group (csp.reportTo, or a cross-origin policy's reportTo) but securityHeaders.reportingEndpoints is not configured. A browser resolves the group through the Reporting-Endpoints header, so unless something else on this server sends one, this policy reports to nowhere and the absence of reports will look like an absence of violations.`,
      );
    }

    // `sandbox` is the one directive a report-only policy cannot rehearse. It
    // is not merely unenforced there, it is ignored outright, so the rollout
    // this documentation recommends for everything else, run it in report-only
    // until the violations go quiet, produces silence for this directive
    // whether or not it would have broken the page.
    //
    // Verified rather than assumed: under an enforcing `sandbox allow-scripts`
    // the document reports `window.origin` as "null", an opaque origin, and
    // under the identical report-only policy it reports the real origin. The
    // sandbox simply did not apply, and Chrome logs nothing about it.
    //
    // A warning rather than a rejection because the pairing is not wrong, it is
    // just incomplete: the rest of the policy is being rehearsed correctly and
    // this one directive is along for the ride.
    if (
      config.csp !== undefined &&
      config.csp !== false &&
      config.csp.reportOnly &&
      config.csp.sandbox !== undefined
    ) {
      fastify.log?.warn(
        '[securityHeaders] csp.sandbox is set on a report-only policy, where browsers ignore it entirely rather than reporting what it would have done. The rest of the policy still reports normally. Move sandbox to an enforcing policy when you are ready to test it, since report-only will never tell you whether it breaks the page.',
      );
    }

    fastify.decorateRequest(
      'applySecurityHeaders',
      async function applySecurityHeaders(
        this: FastifyRequest,
        reply: FastifyReply,
      ) {
        // Pass nothing for the origin verdict: applyCORSActualResponseHeaders
        // reads the per-request cache itself, and computes it fail-closed if
        // this raw path is the first thing to ask.
        //
        // Late, because this is only ever called from a handler about to write
        // a response, which is past every onRequest hook. It is also the only
        // chance to get the host verdict right for a hijacked reply, since
        // those bypass the onSend backstop entirely.
        await applyCORSActualResponseHeaders(
          this,
          reply,
          resolvedConfig,
          undefined,
          'apply',
          latePhase(),
        );
      },
    );

    // Declared unconditionally, assigned per request, and left undefined when
    // the request's policy has nothing to add to.
    //
    // Its absence is a signal rather than a missing convenience: it tells the
    // SSR renderer there is no reason to hash a template's inline content,
    // which in development is real work on every request. That signal has to be
    // per request, not per server. A resolver can introduce a CSP on a server
    // configured without one, and deciding this at registration would leave
    // exactly those tenants' templates without hashes, under a policy strict enough
    // to block the very content the hashes were for.
    fastify.decorateRequest('addCSPSources', undefined);

    // Handle preflight OPTIONS requests
    fastify.addHook(
      'onRequest',
      async (request: FastifyRequest, reply: FastifyReply) => {
        // origin is undefined for same-origin and non-browser requests; all
        // branches below guard with `origin &&` or `!origin` checks accordingly.
        const origin = request.headers.origin;
        const method = request.method;

        // Resolved before anything is written, so a resolver that throws does
        // so with no headers on the reply yet, and the 500 that follows is the
        // ordinary error path rather than a half-headed response.
        const effective = await effectiveConfigFor(request, resolvedConfig);

        applyUnconditionalSecurityHeaders(request, reply, effective);

        // Installed only when this request has a policy, and bound to that
        // policy. A per-request closure rather than a shared one because the
        // policy it has to reason about is this request's, which a resolver may
        // have replaced.
        if (effective.csp) {
          const policy = effective.csp.config;

          (
            request as FastifyRequest & {
              addCSPSources?: (sources: {
                scriptSrc?: readonly string[];
                styleSrc?: readonly string[];
                inlineAttributes?: readonly InlineAttributeFinding[];
              }) => void;
              cspExtraSources?: { scriptSrc: string[]; styleSrc: string[] };
            }
          ).addCSPSources = function addCSPSources(sources) {
            const target = request as FastifyRequest & {
              cspExtraSources?: { scriptSrc: string[]; styleSrc: string[] };
            };

            target.cspExtraSources ??= { scriptSrc: [], styleSrc: [] };
            target.cspExtraSources.scriptSrc.push(...(sources.scriptSrc ?? []));
            target.cspExtraSources.styleSrc.push(...(sources.styleSrc ?? []));

            // Checked against this request's policy, not the configured one, so
            // a resolver that relaxed or tightened inline handling for a tenant
            // is what decides whether the warning is useful for them.
            //
            // Filtered per finding rather than gated as a group, because a
            // single template can report both an `onclick=` and a `style=`, and
            // a policy can easily permit one while blocking the other. Judging
            // the group by any one of them would either hide a real finding or
            // invent one.
            reportInlineAttributes(
              request,
              sources.inlineAttributes?.filter(
                (finding) => !permitsInlineAttribute(policy, finding),
              ),
            );
          };
        }

        const isCORSOn = isCORSEnabled(resolvedConfig.cors);

        // Decide the origin once. resolveOriginAllowed caches it on the request
        // for the onSend backstop, the hijacked-response helper, and the error
        // path, and denies rather than throwing if the callback throws.
        //
        // Not asked at all when CORS is off, since the answer is fixed and a
        // caller's origin function should not be run to produce it.
        const isOriginAllowedResult = isCORSOn
          ? await resolveOriginAllowed(request, resolvedConfig.cors)
          : false;

        // Record that this hook reached the negotiation, so the onSend backstop
        // below knows it has nothing left to do. Anything that short-circuited
        // before this point leaves the marker unset.
        (
          request as FastifyRequest & { securityHeadersApplied?: boolean }
        ).securityHeadersApplied = true;

        // Handle preflight OPTIONS requests.
        //
        // Guarded on CORS being on, so "off" means the plugin does not touch
        // OPTIONS at all and the request reaches the route table exactly as it
        // would on a server without this plugin. Answering a preflight is a CORS
        // behavior, and a server that does no CORS answering them, whether with
        // a 403 or a bare 204, both shadows an application's own OPTIONS route
        // and implies a negotiation that is not happening.
        if (method === 'OPTIONS' && isCORSOn) {
          // Add Vary headers for preflight caching
          addToVaryHeader(
            reply,
            'Access-Control-Request-Headers',
            'Access-Control-Request-Method',
            'Access-Control-Request-Private-Network',
          );

          // Return 403 for disallowed origins on preflight
          if (!isOriginAllowedResult && origin) {
            reply.code(403).header('Cache-Control', 'no-store');
            return reply.send({ error: 'Origin not allowed by CORS policy' });
          }

          // Get requested headers from preflight
          const requestedHeaders = request.headers[
            'access-control-request-headers'
          ] as string;

          // Build allowed methods using Set for deduplication and normalize to uppercase
          const methodSet = new Set(
            resolvedConfig.cors.methods.map((m) => m.toUpperCase()),
          );

          const allowedMethods = Array.from(methodSet);

          // Build the allowed-headers list. Two modes, and which one applies is
          // decided by what the caller configured rather than by the request.
          //
          // `['*']` is the caller saying "reflect whatever this request asked
          // for", so the value is client controlled and every entry is filtered
          // before it goes back out. See `reflectRequestedHeaders`.
          //
          // A concrete list is a fact about the server, not about the request:
          // these are the headers it accepts, so it advertises all of them and
          // the request's own list has no say. That is deliberately *not* an
          // intersection. Sending only the overlap would let the value change
          // per request for no gain, since a browser is asking whether the
          // headers it named are permitted and gets its answer either way, and
          // a shared preflight cache entry would then be narrower than the
          // policy it stands for.
          //
          // The requested names need no validation on this path precisely
          // because none of them reach the response. Filtering them here read
          // as a security control and was not one: the code that did it could
          // never add a header, since the list it was appending to already held
          // every configured name. What keeps an unwanted name off the response
          // is that it was never configured.
          let allowedHeaders: string[] =
            resolvedConfig.cors.allowedHeaders.includes('*')
              ? requestedHeaders
                ? reflectRequestedHeaders(requestedHeaders)
                : // Nothing was asked for, so there is nothing to reflect, and
                  // nothing else to fall back to: validation refuses `*`
                  // alongside named headers, so a list containing it contains
                  // only it. An empty list means the header is not sent, which
                  // is the right answer to a preflight that asked about no
                  // headers.
                  []
              : [...resolvedConfig.cors.allowedHeaders];

          // Cap to avoid sending excessive header lists
          if (allowedHeaders.length > MAX_ALLOWED_HEADERS) {
            allowedHeaders = allowedHeaders.slice(0, MAX_ALLOWED_HEADERS);
          }

          // Set preflight response headers.
          //
          // Guarded on having something to say, the same as the two header
          // lists below and beside it. `methods: []` used to fall through and
          // emit a bare `Access-Control-Allow-Methods:` with an empty value,
          // which is not the way to say "no methods": it is a header carrying
          // nothing, on a response whose other two lists had known for a while
          // to stay off the wire when they were empty. An empty list now means
          // the same thing in all three places, which is that the header is not
          // sent, and a browser then permits only what it permits without one.
          if (allowedMethods.length > 0) {
            reply.header(
              'Access-Control-Allow-Methods',
              allowedMethods.join(', '),
            );
          }

          // Only set Access-Control-Allow-Headers if we have headers to send
          if (allowedHeaders.length > 0) {
            reply.header(
              'Access-Control-Allow-Headers',
              allowedHeaders.join(', '),
            );
          }

          reply.header(
            'Access-Control-Max-Age',
            resolvedConfig.cors.maxAge.toString(),
          );

          // Handle private network requests (Chrome feature)
          const requestPrivateNetwork =
            request.headers['access-control-request-private-network'];

          if (
            requestPrivateNetwork === 'true' &&
            resolvedConfig.cors.allowPrivateNetwork
          ) {
            reply.header('Access-Control-Allow-Private-Network', 'true');
          }

          if (resolvedConfig.cors.preflightContinue) {
            // Continue to route handler but set CORS headers first
            await applyCORSActualResponseHeaders(
              request,
              reply,
              resolvedConfig,
              isOriginAllowedResult,
            );

            return;
          } else {
            // Handle preflight completely here
            await applyCORSActualResponseHeaders(
              request,
              reply,
              resolvedConfig,
              isOriginAllowedResult,
            );

            reply.code(resolvedConfig.cors.optionsSuccessStatus);
            return reply.send();
          }
        }

        await applyCORSActualResponseHeaders(
          request,
          reply,
          resolvedConfig,
          isOriginAllowedResult,
        );
      },
    );

    // Backstop for responses that never reached the hook above.
    //
    // An `onRequest` hook only covers what runs after it, so a plugin listed
    // earlier in the array that ends the request produced a response with no
    // security headers at all. That covers `domainValidation`'s 403, its 400
    // for an unparseable Host, its canonical/www redirects, and any gate an
    // application registers of its own. Which responses were covered therefore
    // depended silently on the order of the plugins array.
    //
    // `onSend` runs for every reply Fastify sends, whoever sent it and whenever
    // they registered, so it makes the header set order-independent. Writes are
    // fill-if-absent, so a route that deliberately set its own value keeps it.
    // Hijacked responses bypass `onSend` entirely and are covered instead by
    // `request.applySecurityHeaders()`.
    fastify.addHook(
      'onSend',
      async (request: FastifyRequest, reply: FastifyReply, ...args) => {
        const payload = args[0];

        // The hook above may have run before the host verdict was in, in which
        // case HSTS is already on the reply and has to come off.
        //
        // Two ways that happens, and the late reading covers both. The host was
        // examined and rejected, or `domainValidation` never got to run at all
        // because something registered above it ended the request, which
        // includes a hook that threw. The second one is the quieter of the two:
        // the response is an error page, nothing has vouched for the host, and
        // the header would still bind whatever the client asked for.
        if (isHostDisclaimed(request, latePhase().hostCheck)) {
          reply.removeHeader('Strict-Transport-Security');
        }

        // Fold in any sources contributed during the request, which for SSR is
        // the active app's template hashes. The app is chosen per request, so
        // this cannot be known at config time the way the rest of the policy is.
        const extra = (
          request as FastifyRequest & {
            cspExtraSources?: { scriptSrc: string[]; styleSrc: string[] };
          }
        ).cspExtraSources;

        if (extra) {
          // The policy in force for *this* request, which is not necessarily
          // the one configured at startup. Comparing against the startup policy
          // was the bug here: a resolver that returned its own CSP left the
          // header holding a value this check did not recognize, so the fold-in
          // was skipped and the tenant's page went out under a policy missing
          // the hashes for the very template it was about to render.
          //
          // Degrading rather than throwing, because this runs in onSend with a
          // reply already composed: a throw here would hand Fastify's error
          // handler a finished response to rewrite.
          const effective = await effectiveConfigFor(
            request,
            resolvedConfig,
            'degrade',
          );

          if (effective.csp) {
            // Overwrite rather than fill-if-absent, since the header is already
            // there from the early pass and the whole point is to replace it.
            // But only when it still holds the value this plugin put there: a
            // route that deliberately set its own policy keeps it, same rule as
            // everywhere else.
            if (
              reply.getHeader(effective.csp.headerName) === effective.csp.value
            ) {
              reply.header(
                effective.csp.headerName,
                buildPolicyWithSources(effective.csp, extra),
              );
            }
          }
        }

        const hasRunEarly = (
          request as FastifyRequest & { securityHeadersApplied?: boolean }
        ).securityHeadersApplied;

        if (!hasRunEarly) {
          // No verdict argument: the per-request cache is consulted inside, so
          // a decision the early hook did reach is reused rather than recomputed
          // and a callback is never invoked twice for one request.
          await applyCORSActualResponseHeaders(
            request,
            reply,
            resolvedConfig,
            undefined,
            'fill',
            latePhase(),
          );
        }

        return payload;
      },
    );

    return Promise.resolve();
  };

  /**
   * Install or replace the resolver after registration.
   *
   * The handle is the plugin value itself, which the caller already holds from
   * passing it to `plugins`, so there is nothing extra to keep track of:
   *
   * ```ts
   * const headers = securityHeaders({ hsts: { maxAge: 31536000 } });
   * const server = serveSSRBuilt(buildDir, { plugins: [headers] });
   *
   * await db.connect();
   * headers.setResolver(async (request) => lookupTenantPolicy(request));
   * ```
   */
  plugin.setResolver = (resolver: SecurityHeadersResolver | undefined) => {
    activeResolver = resolver;
  };

  return plugin;
}
