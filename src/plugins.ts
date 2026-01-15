// Import cookie utilities from @fastify/cookie for re-export
import {
  fastifyCookie as fastifyCookieModule,
  sign as signCookieValue,
  unsign as unsignCookieValue,
  Signer as CookieSigner,
  signerFactory as createCookieSigner,
} from '@fastify/cookie';

// Re-export CORS plugin for cross-origin request handling
export {
  type CORSConfig,
  type CORSOrigin,
  cors,
} from './lib/built-in-plugins/cors';

// Re-export domain validation plugin for enforcing canonical domains
export {
  type InvalidDomainResponse,
  type DomainValidationConfig,
  domainValidation,
} from './lib/built-in-plugins/domain-validation';

// Re-export client info plugin for request metadata extraction
export {
  type ClientInfoConfig,
  clientInfo,
} from './lib/built-in-plugins/client-info';

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
