export {
  type CORSConfig,
  type CORSOrigin,
  cors,
} from './lib/built-in-plugins/cors';

export {
  type InvalidDomainResponse,
  type DomainValidationConfig,
  domainValidation,
} from './lib/built-in-plugins/domainValidation';

export {
  type ClientInfoConfig,
  clientInfo,
} from './lib/built-in-plugins/clientInfo';

export { type CookiesConfig, cookies } from './lib/built-in-plugins/cookies';

// Re-export manual cookie utilities from @fastify/cookie for convenience
import {
  fastifyCookie as fastifyCookieModule,
  sign as signCookieValue,
  unsign as unsignCookieValue,
  Signer as CookieSigner,
  signerFactory as createCookieSigner,
} from '@fastify/cookie';

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
