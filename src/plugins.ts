// Import cookie utilities from @fastify/cookie for re-export
import {
  fastifyCookie as fastifyCookieModule,
  sign as signCookieValue,
  unsign as unsignCookieValue,
  Signer as CookieSigner,
  signerFactory as createCookieSigner,
} from '@fastify/cookie';

// Re-export browser security headers plugin (CORS negotiation, HSTS, X-Frame-Options)
export {
  type SecurityHeadersConfig,
  type SecurityHeadersPlugin,
  type CORSConfig,
  type CORSOrigin,
  type CSPConfig,
  type CSPPreset,
  type HSTSConfig,
  type ReferrerPolicyToken,
  type PermissionsPolicyConfig,
  type CrossOriginPolicySetting,
  type CrossOriginOpenerPolicy,
  type CrossOriginOpenerPolicySetting,
  type CrossOriginResourcePolicy,
  type CrossOriginEmbedderPolicy,
  type CrossOriginEmbedderPolicySetting,
  type ReportingEndpointsConfig,
  // The resolver's own types, so a resolver written as a named function rather
  // than inline in the config can be annotated without reaching into internals.
  // `SecurityHeadersBaseline` is what it receives, `SecurityHeadersOverride`
  // what it returns.
  type SecurityHeadersResolver,
  type SecurityHeadersOverride,
  type SecurityHeadersBaseline,
  securityHeaders,
} from './lib/built-in-plugins/security-headers';

// Re-export domain validation plugin for enforcing canonical domains
export {
  type InvalidDomainResponse,
  type DomainValidationConfig,
  type ValidProductionDomains,
  domainValidation,
} from './lib/built-in-plugins/domain-validation';

// Re-export cookies plugin for cookie parsing and signing
export { type CookiesConfig, cookies } from './lib/built-in-plugins/cookies';

// Re-export static content plugin for serving static files
export {
  type StaticContentRouterOptions,
  type FolderConfig,
  staticContent,
} from './lib/built-in-plugins/static-content';

// Re-export manual cookie utilities from @fastify/cookie for convenience
export const cookieUtils = {
  parse: fastifyCookieModule.parse,
  serialize: fastifyCookieModule.serialize,
  signerFactory: createCookieSigner,
  Signer: CookieSigner,
  sign: signCookieValue,
  unsign: unsignCookieValue,
} as const;

// Re-export common types so consumers don't need to depend on @fastify/cookie directly
export type {
  CookieSerializeOptions,
  UnsignResult as CookieUnsignResult,
} from '@fastify/cookie';
