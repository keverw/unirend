/**
 * Regression coverage for the `APIResponseHelpersClass` option flowing into
 * handler params as the registered subclass rather than the base class.
 *
 * Most of this file is compile-time only: `bun run type-check` covers
 * `src/**` and fails on the assertions below, while `bun test` confirms the
 * value handlers actually receive at runtime matches what the types promise.
 */

import { describe, it, expect } from 'bun:test';
import getPort from 'get-port';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serveAPI } from '../api';
import { serveSSRBuilt } from '../ssr';
import { APIResponseHelpers } from '../../api-envelope';
import type {
  BaseMeta,
  PageErrorResponse,
} from '../api-envelope/api-envelope-types';
import type {
  APIServerOptions,
  ServeSSRBuiltOptions,
  ServerPlugin,
} from '../types';

/**
 * A subclass that widens one method with an extra optional param. Base and
 * subclass stay mutually assignable structurally, so this only type-checks if
 * the generic is inferred from the `APIResponseHelpersClass` property itself.
 *
 * The `<M>` generic has to be preserved on the override, otherwise the
 * subclass is not assignable to the base at all.
 */
class BrandedHelpers extends APIResponseHelpers {
  public static override createPageErrorResponse<M extends BaseMeta = BaseMeta>(
    params: Parameters<
      typeof APIResponseHelpers.createPageErrorResponse<M>
    >[0] & { shouldBrandTitle?: boolean },
  ): PageErrorResponse<M> {
    const { shouldBrandTitle, ...rest } = params;

    return APIResponseHelpers.createPageErrorResponse<M>({
      ...rest,
      pageMetadata: shouldBrandTitle
        ? { ...rest.pageMetadata, title: `${rest.pageMetadata.title} | Brand` }
        : rest.pageMetadata,
    });
  }
}

const pageMetadata = { title: 'Oops', description: 'Something went wrong' };

/**
 * True only for `any`, which is the one type that distributes into both
 * branches of this conditional.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Fails to compile when the argument's type is `any`.
 *
 * The inline plugin checks below assert what `pluginHost` resolves to, and
 * every softer form of that assertion is useless here: `any` is assignable to
 * everything, so both `satisfies` and a plain annotation accept it silently.
 * A plugin body that only calls methods proves even less, since calls on `any`
 * never error. Without this, a regression in overload ordering that dropped
 * `pluginHost` back to `any` would leave these checks passing.
 */
const assertNotAny = <T>(_value: IsAny<T> extends true ? never : T): void => {};

// --- Compile-time assertions -------------------------------------------------

// Inline plugin on an SSR server: the subclass reaches page data handlers,
// API route handlers, and the plugin host itself, inferred from the option.
const _inlinePluginTypeCheck = () =>
  serveSSRBuilt('./build', {
    APIResponseHelpersClass: BrandedHelpers,
    plugins: [
      (pluginHost) => {
        assertNotAny(pluginHost);
        pluginHost.APIResponseHelpers satisfies typeof BrandedHelpers;

        pluginHost.pageDataHandler.register('home', (request, _reply, params) =>
          params.APIResponseHelpers.createPageErrorResponse({
            request,
            statusCode: 404,
            errorCode: 'not_found',
            errorMessage: 'Not found',
            pageMetadata,
            shouldBrandTitle: true,
          }),
        );

        pluginHost.api.get('widgets', (request, _reply, params) =>
          params.APIResponseHelpers.createAPISuccessResponse({
            request,
            data: { ok: true },
          }),
        );

        pluginHost.APIResponseHelpers.createPageErrorResponse({
          request: {} as FastifyRequest,
          statusCode: 500,
          errorCode: 'boom',
          errorMessage: 'Boom',
          pageMetadata,
          shouldBrandTitle: false,
        });
      },
    ],
    APIHandling: {
      errorHandler: (request, _error, _isDevelopment, _isPageData, params) =>
        params.APIResponseHelpers.createPageErrorResponse({
          request,
          statusCode: 500,
          errorCode: 'boom',
          errorMessage: 'Boom',
          pageMetadata,
          shouldBrandTitle: true,
        }),
    },
  });

// Inline plugin on an API server. This relies on serveAPI being overloaded per
// mode: with a single union-typed parameter TypeScript refuses to contextually
// type a function nested in the object literal, and pluginHost would be `any`.
const _inlineAPIPluginTypeCheck = () =>
  serveAPI({
    APIResponseHelpersClass: BrandedHelpers,
    plugins: [
      (pluginHost) => {
        assertNotAny(pluginHost);
        pluginHost.APIResponseHelpers satisfies typeof BrandedHelpers;

        pluginHost.pageDataHandler.register('home', (request, _reply, params) =>
          params.APIResponseHelpers.createPageErrorResponse({
            request,
            statusCode: 404,
            errorCode: 'not_found',
            errorMessage: 'Not found',
            pageMetadata,
            shouldBrandTitle: true,
          }),
        );
      },
    ],
  });

// Plain web mode still contextually types its inline plugins too.
const _inlinePlainPluginTypeCheck = () =>
  serveAPI({
    apiEndpoints: { apiEndpointPrefix: false },
    plugins: [
      (pluginHost) => {
        assertNotAny(pluginHost);

        pluginHost.get('/health', () => 'ok');
      },
    ],
  });

// Callers that hold configuration as the exported `APIServerOptions` union,
// rather than as an inline literal, must still be able to call serveAPI. The
// per-mode overloads hide the implementation signature, so this needs a union
// overload of its own, and `H` has to survive the call.
const _unionOptionsTypeCheck = () => {
  const build = (): APIServerOptions<typeof BrandedHelpers> => ({
    APIResponseHelpersClass: BrandedHelpers,
  });

  const server = serveAPI(build());

  server.APIResponseHelpersClass satisfies typeof BrandedHelpers;
};

// A plugin declared in its own file names the helpers class explicitly; there
// is no options object to infer from at that point.
const _standalonePluginTypeCheck: ServerPlugin<'api', typeof BrandedHelpers> = (
  pluginHost,
) => {
  pluginHost.pageDataHandler.register('about', (request, _reply, params) =>
    params.APIResponseHelpers.createPageErrorResponse({
      request,
      statusCode: 404,
      errorCode: 'not_found',
      errorMessage: 'Not found',
      pageMetadata,
      shouldBrandTitle: true,
    }),
  );
};

// Registering directly on the server instance carries the subclass too.
const _instanceRegistrationTypeCheck = () => {
  const server = serveAPI({ APIResponseHelpersClass: BrandedHelpers });

  server.pageDataHandler.register('contact', (request, _reply, params) =>
    params.APIResponseHelpers.createPageErrorResponse({
      request,
      statusCode: 404,
      errorCode: 'not_found',
      errorMessage: 'Not found',
      pageMetadata,
      shouldBrandTitle: true,
    }),
  );
};

// WebSocket handler params resolve to the subclass as well.
const _webSocketTypeCheck = () => {
  const server = serveAPI({
    APIResponseHelpersClass: BrandedHelpers,
    enableWebSockets: true,
  });

  server.registerWebSocketHandler({
    path: '/ws',
    preValidate: (request, params) => ({
      action: 'reject' as const,
      envelope: params.APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 403,
        errorCode: 'forbidden',
        errorMessage: 'Forbidden',
      }),
    }),
    handler: () => {},
  });
};

// Without the option the params stay on the base class, so subclass-only
// fields must still be rejected.
const _defaultsToBaseClassTypeCheck = () => {
  const server = serveAPI();

  server.pageDataHandler.register('home', (request, _reply, params) =>
    params.APIResponseHelpers.createPageErrorResponse({
      request,
      statusCode: 404,
      errorCode: 'not_found',
      errorMessage: 'Not found',
      pageMetadata,
      // @ts-expect-error shouldBrandTitle only exists on the subclass
      shouldBrandTitle: true,
    }),
  );
};

// Naming a custom helpers class in a type requires supplying the class value
// that backs it, whether that happens through an explicit type argument or
// through an annotation on a pre-built config. Without this the type promises
// handlers a subclass the server never installs, and the first call to anything
// the subclass added throws.
const _explicitTypeArgumentTypeCheck = () => {
  // @ts-expect-error explicit H with no APIResponseHelpersClass to back it
  serveAPI<typeof BrandedHelpers>();

  // @ts-expect-error same, with an empty options literal
  serveAPI<typeof BrandedHelpers>({});

  // @ts-expect-error same on the SSR side
  serveSSRBuilt<typeof BrandedHelpers>('./build');

  // @ts-expect-error caught where the config is declared, not at the call
  const bad: APIServerOptions<typeof BrandedHelpers> = {};
  void bad;

  // @ts-expect-error same for the SSR option types
  const badSSR: ServeSSRBuiltOptions<typeof BrandedHelpers> = {};
  void badSSR;
};

// The requirement must not cost the legitimate cases. A pre-built config that
// does carry the class stays callable, and `H` survives to the return type.
// Requiring the class at the call site instead of on the type would reject
// these, since the property is optional on the declared type of the variable.
const _prebuiltConfigTypeCheck = () => {
  const apiConfig: APIServerOptions<typeof BrandedHelpers> = {
    APIResponseHelpersClass: BrandedHelpers,
  };
  serveAPI(apiConfig).APIResponseHelpersClass satisfies typeof BrandedHelpers;

  const ssrConfig: ServeSSRBuiltOptions<typeof BrandedHelpers> = {
    APIResponseHelpersClass: BrandedHelpers,
  };
  serveSSRBuilt('./build', ssrConfig)
    .APIResponseHelpersClass satisfies typeof BrandedHelpers;

  // Leaving H at the base keeps the option optional, as before.
  const plain: APIServerOptions = { serverLabel: 'x' };
  void serveAPI(plain);
  void serveSSRBuilt('./build', {});
  void serveAPI();
};

// Reference the checks so lint does not flag them as unused.
void _inlinePluginTypeCheck;
void _inlineAPIPluginTypeCheck;
void _inlinePlainPluginTypeCheck;
void _unionOptionsTypeCheck;
void _explicitTypeArgumentTypeCheck;
void _prebuiltConfigTypeCheck;
void _standalonePluginTypeCheck;
void _instanceRegistrationTypeCheck;
void _webSocketTypeCheck;
void _defaultsToBaseClassTypeCheck;

// --- Runtime assertions ------------------------------------------------------

describe('APIResponseHelpersClass in handler params', () => {
  it('hands the configured subclass to page data and API route handlers', async () => {
    const port = await getPort();
    const seen: Array<unknown> = [];

    const plugin: ServerPlugin<'api', typeof BrandedHelpers> = (pluginHost) => {
      pluginHost.pageDataHandler.register('home', (request, _reply, params) => {
        seen.push(params.APIResponseHelpers);

        return params.APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { ok: true },
          pageMetadata,
        });
      });

      pluginHost.api.get('widgets', (request, _reply, params) => {
        seen.push(params.APIResponseHelpers);

        return params.APIResponseHelpers.createAPISuccessResponse({
          request,
          data: { ok: true },
        });
      });

      seen.push(pluginHost.APIResponseHelpers);
    };

    const server = serveAPI({
      APIResponseHelpersClass: BrandedHelpers,
      plugins: [plugin],
    });

    await server.listen(port, 'localhost');

    try {
      const fastify = (
        server as unknown as { fastifyInstance: FastifyInstance }
      ).fastifyInstance;

      await fastify.inject({
        method: 'POST',
        url: '/api/v1/page_data/home',
        payload: {
          route_params: {},
          query_params: {},
          request_path: '/home',
          original_url: '/home',
        },
      });

      await fastify.inject({ method: 'GET', url: '/api/v1/widgets' });
    } finally {
      await server.stop();
    }

    expect(seen).toHaveLength(3);
    expect(seen.every((value) => value === BrandedHelpers)).toBe(true);
  });
});
