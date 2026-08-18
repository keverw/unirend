import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import tsupConfig from '../tsup.config';
import type {
  CSPConfig,
  CSPPreset,
  CrossOriginEmbedderPolicy,
  CrossOriginEmbedderPolicySetting,
  CrossOriginOpenerPolicy,
  CrossOriginOpenerPolicySetting,
  CrossOriginPolicySetting,
  CrossOriginResourcePolicy,
  PermissionsPolicyConfig,
  ReferrerPolicyToken,
  ReportingEndpointsConfig,
  SecurityHeadersConfig,
  SecurityHeadersPlugin,
} from './plugins';
import type {
  FileFoundResult,
  MinimalStatInfo,
  StaticContentRouterOptions,
  StaticContentWarnLoggerObject,
} from './utils';
import type {
  APIClosingHandlerFn,
  APIErrorHandlerFn,
  APIErrorHandlerParams,
  APINotFoundHandlerFn,
  APINotFoundHandlerParams,
  APIRouteHandler,
  AppBundles,
  FastifyServerOptions,
  FastifyTrustProxyFunction,
  FileUploadsConfig,
  HTMLPageType,
  HTTPMethod,
  PageDataHandler,
  PageDataHandlerParams,
  PageDataNotFoundContext,
  PageDataRequestContext,
  PageDataRequestOptions,
  RegisterBuiltAppOptions,
  RegisterHMRAppOptions,
  RenderErrorResult,
  RenderPageResult,
  RenderResponseResult,
  RenderType,
  ResolvePageDataRequestOptions,
  ResponseCompressionOptions,
  ResponseTimeHeaderOptions,
  RouteHandler,
  SafeRouteOptions,
  SPAPageType,
  SSGLogger,
  SSGPageStatus,
  SSGPageType,
  SSGPagesReport,
  UnirendLoggerFunction,
  WebSocketOptions,
  NotFoundRequest,
  SplitClosingHandler,
  SplitErrorHandler,
  SplitNotFoundHandler,
  Trigger404Signal,
  WebClosingHandlerFn,
  WebErrorHandlerFn,
  WebNotFoundHandlerFn,
  WebResponse,
} from './server';
import { defineAppBundles } from './server';

type PublicSecurityHeadersTypeSurface = {
  config: SecurityHeadersConfig;
  plugin: SecurityHeadersPlugin;
  csp: CSPConfig;
  preset: CSPPreset;
  referrerPolicy: ReferrerPolicyToken;
  permissionsPolicy: PermissionsPolicyConfig;
  crossOriginPolicy: CrossOriginPolicySetting<'same-origin'>;
  openerPolicy: CrossOriginOpenerPolicy;
  openerSetting: CrossOriginOpenerPolicySetting;
  resourcePolicy: CrossOriginResourcePolicy;
  embedderPolicy: CrossOriginEmbedderPolicy;
  embedderSetting: CrossOriginEmbedderPolicySetting;
  reportingEndpoints: ReportingEndpointsConfig;
};

const publicSecurityHeadersTypeSurface: PublicSecurityHeadersTypeSurface | null =
  null;

// `request.trigger404()` returns an opaque branded value, so handler code that
// names its own return type needs the name exported alongside the two handler
// types that now accept it.
type PublicTrigger404TypeSurface = {
  signal: Trigger404Signal;
  notFoundRequest: NotFoundRequest;
  apiHandler: APIRouteHandler;
  pageDataHandler: PageDataHandler;
};

const publicTrigger404TypeSurface: PublicTrigger404TypeSurface | null = null;

// The bundle gate `trigger404()` exists for. `defineAppBundles` is a value, not
// a type, so it has to be exported as one — the named type is what lets a
// caller pass the result around without restating its shape.
type PublicAppBundlesTypeSurface = {
  bundles: AppBundles<'marketing' | 'app-shell'>;
};

const publicAppBundlesTypeSurface: PublicAppBundlesTypeSurface = {
  bundles: defineAppBundles('marketing', 'app-shell'),
};

// A handler written as a named function, or in a file of its own, has to name
// what it receives. The request type alone is not enough: the `params`
// argument carries the configured `APIResponseHelpers` class and, for a
// not-found handler, the page data context.
type PublicHandlerTypeSurface = {
  errorParams: APIErrorHandlerParams;
  apiError: APIErrorHandlerFn;
  webError: WebErrorHandlerFn;
  splitError: SplitErrorHandler;
  notFoundParams: APINotFoundHandlerParams;
  pageDataNotFound: PageDataNotFoundContext;
  apiNotFound: APINotFoundHandlerFn;
  webNotFound: WebNotFoundHandlerFn;
  splitNotFound: SplitNotFoundHandler;
  apiClosing: APIClosingHandlerFn;
  webClosing: WebClosingHandlerFn;
  splitClosing: SplitClosingHandler;
  webResponse: WebResponse;
};

const publicHandlerTypeSurface: PublicHandlerTypeSurface | null = null;

// The option and result types that were reachable from an exported one, as a
// union member, an options field, or a callback the caller writes, but had no
// exported name of their own.
type PublicServerTypeSurface = {
  pageDataHandlerParams: PageDataHandlerParams;
  routeHandler: RouteHandler;
  safeRouteOptions: SafeRouteOptions;
  httpMethod: HTTPMethod;
  renderType: RenderType;
  renderPage: RenderPageResult;
  renderResponse: RenderResponseResult;
  renderError: RenderErrorResult;
  ssgPage: SSGPageType;
  spaPage: SPAPageType;
  htmlPage: HTMLPageType;
  ssgPageStatus: SSGPageStatus;
  ssgPagesReport: SSGPagesReport;
  ssgLogger: SSGLogger;
  registerHMRApp: RegisterHMRAppOptions;
  registerBuiltApp: RegisterBuiltAppOptions;
  pageDataRequestContext: PageDataRequestContext;
  pageDataRequestOptions: PageDataRequestOptions;
  resolvePageDataRequestOptions: ResolvePageDataRequestOptions;
  webSocketOptions: WebSocketOptions;
  fileUploads: FileUploadsConfig;
  responseCompression: ResponseCompressionOptions;
  responseTimeHeader: ResponseTimeHeaderOptions;
  fastifyServerOptions: FastifyServerOptions;
  trustProxy: FastifyTrustProxyFunction;
  loggerFunction: UnirendLoggerFunction;
};

const publicServerTypeSurface: PublicServerTypeSurface | null = null;

// `unirend/utils`: the stat shape a found file carries, plus the two arguments
// the `StaticContentCache` constructor takes.
type PublicUtilsTypeSurface = {
  stat: MinimalStatInfo;
  foundFile: FileFoundResult;
  routerOptions: StaticContentRouterOptions;
  warnLogger: StaticContentWarnLoggerObject;
};

const publicUtilsTypeSurface: PublicUtilsTypeSurface | null = null;

type PackageExport = {
  types: string;
  import: string;
};

type PackageJSON = {
  exports: Record<string, PackageExport>;
};

type TsupEntry = {
  entry?: string[] | Record<string, string>;
  outDir?: string;
  dts?: unknown;
};

type PublicLibraryEntry = TsupEntry & {
  entry: [string];
  outDir: string;
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJSON = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
) as PackageJSON;

// Normalize tsup's config shape so the test can handle either a single config
// object or the array of entrypoint configs this project currently uses.
const configs = (
  Array.isArray(tsupConfig) ? [...tsupConfig] : [tsupConfig]
) as TsupEntry[];

// Public library entrypoints are the tsup entries that emit declarations.
// The CLI is intentionally excluded because it is registered through `bin`,
// not through package `exports`.
const publicLibraryEntries = configs.filter(
  (config): config is PublicLibraryEntry =>
    config.dts !== false &&
    Array.isArray(config.entry) &&
    config.entry.length === 1 &&
    typeof config.outDir === 'string',
);

// Each public tsup entrypoint builds into dist/<subpath>/<entry-name>.*.
// Package exports must mirror that layout so documented imports like
// `unirend/build-info` resolve for ESM and TypeScript consumers. unirend is
// ESM-only (see tsup.config.ts), so there is no CJS `require` condition.
const expectedExports = Object.fromEntries(
  publicLibraryEntries.map((config) => {
    const outDir = config.outDir;
    const exportPath = `./${basename(outDir)}`;
    const fileName = basename(config.entry[0], '.ts');

    return [
      exportPath,
      {
        types: `./${outDir}/${fileName}.d.ts`,
        import: `./${outDir}/${fileName}.js`,
      },
    ];
  }),
);

describe('package exports', () => {
  it('registers every public tsup library entrypoint', () => {
    expect(packageJSON.exports).toEqual(expectedExports);
  });

  it('exports the named types needed to build reusable security policies', () => {
    expect(publicSecurityHeadersTypeSurface).toBeNull();
  });

  it('exports the trigger-404 signal type alongside the handler types', () => {
    expect(publicTrigger404TypeSurface).toBeNull();
  });

  it('exports the error, not found, and closing handler types', () => {
    expect(publicHandlerTypeSurface).toBeNull();
  });

  it('exports the option and result types reachable from the public API', () => {
    expect(publicServerTypeSurface).toBeNull();
    expect(publicUtilsTypeSurface).toBeNull();
  });

  it('exports defineAppBundles as a value, with its type', () => {
    expect([...publicAppBundlesTypeSurface.bundles.keys]).toEqual([
      'marketing',
      'app-shell',
    ]);
  });
});
