import {
  PageResponseEnvelope,
  RedirectInfo,
} from "../api-envelope/api-envelope-types";
import {
  LocalPageLoaderConfig,
  PageLoaderConfig,
} from "./pageDataLoader-types";
import {
  applyCustomHttpStatusHandler,
  createErrorResponse,
  decorateWithSsrOnlyData,
  isSafeRedirect,
} from "./pageDataLoader-utils";
import {
  DEBUG_PAGE_LOADER,
  DEFAULT_FALLBACK_REQUEST_ID_GENERATOR,
  DEFAULT_RETURN_TO_PARAM,
} from "./pageDataLoader-consts";
import { redirect } from "react-router";

export async function processRedirectResponse(
  config: PageLoaderConfig | LocalPageLoaderConfig,
  responseData: Record<string, unknown>,
  ssrOnlyData: Record<string, unknown>,
): Promise<PageResponseEnvelope> {
  const redirectInfo = responseData.redirect as RedirectInfo;
  const target = redirectInfo.target;

  if (!target) {
    // If no target provided, return an error
    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        400,
        config.errorDefaults.invalidRedirect.code,
        config.errorDefaults.invalidRedirect.message,
        responseData?.request_id as string,
        responseData?.meta as Record<string, unknown>,
      ),
      ssrOnlyData,
    );
  }

  // Validate redirect safety if allowedRedirectOrigins is configured
  if (!isSafeRedirect(target, config.allowedRedirectOrigins)) {
    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        400,
        config.errorDefaults.unsafeRedirect.code,
        config.errorDefaults.unsafeRedirect.message,
        responseData?.request_id as string,
        responseData?.meta as Record<string, unknown>,
      ),
      ssrOnlyData,
    );
  }

  // If preserve_query is true and we have a URL object, preserve query params
  let redirectTarget = target;
  const currentUrl =
    typeof window !== "undefined" ? window.location.href : null;

  if (redirectInfo.preserve_query && currentUrl) {
    try {
      const url = new URL(currentUrl);
      // Only append query if the target doesn't already have query params
      if (!target.includes("?") && url.search) {
        redirectTarget = `${target}${url.search}`;
      }
    } catch (error) {
      if (DEBUG_PAGE_LOADER) {
        // eslint-disable-next-line no-console
        console.warn("Failed to preserve query parameters in redirect", error);
      }
    }
  }

  if (DEBUG_PAGE_LOADER) {
    // eslint-disable-next-line no-console
    console.log(
      `Application redirect to: ${redirectTarget} (${redirectInfo.permanent ? "permanent" : "temporary"})`,
    );
  }

  return redirect(redirectTarget, {
    // Use the appropriate React Router redirect status
    status: redirectInfo.permanent ? 301 : 302,
  }) as unknown as PageResponseEnvelope;
}

export async function processApiResponse(
  response: Response,
  config: PageLoaderConfig,
): Promise<PageResponseEnvelope> {
  const isServer = typeof window === "undefined"; // detecting here again instead of passing to promote tree-shaking
  const statusCode = response.status;

  // Extract cookies from response when on server
  const cookies = isServer ? response.headers.getSetCookie() : [];
  const ssrOnlyData = {
    ...(isServer ? { cookies } : {}),
  };

  // Handle HTTP redirects explicitly before attempting to parse JSON
  if (
    response.type === "opaqueredirect" ||
    [301, 302, 303, 307, 308].includes(statusCode)
  ) {
    if (DEBUG_PAGE_LOADER) {
      // eslint-disable-next-line no-console
      console.warn(
        `API returned a HTTP redirect to: ${response.headers.get("Location")}`,
      );
    }

    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        statusCode,
        config.errorDefaults.redirectNotFollowed.code,
        config.errorDefaults.redirectNotFollowed.message,
        config.generateFallbackRequestID
          ? config.generateFallbackRequestID("redirect")
          : DEFAULT_FALLBACK_REQUEST_ID_GENERATOR("redirect"),
        undefined,
        {
          originalStatus: statusCode,
          location: response.headers.get("Location"),
        },
      ),
      ssrOnlyData,
    );
  }

  // extract the response data and check if it is valid json
  let responseData;
  let isValidJson = false;

  try {
    responseData = await response.json();
    isValidJson = true;
  } catch {
    responseData = null;
  }

  if (DEBUG_PAGE_LOADER) {
    // eslint-disable-next-line no-console
    console.log("response Info", {
      isValidJson,
      statusCode,
      responseData,
    });
  }

  if (isValidJson) {
    // Check for custom status code handlers first
    const customHandlerResult = applyCustomHttpStatusHandler(
      statusCode,
      responseData,
      config,
      ssrOnlyData,
    );

    if (customHandlerResult) {
      // If the custom handler returned a redirect, process it.
      if (
        customHandlerResult.status === "redirect" &&
        customHandlerResult.type === "page" &&
        customHandlerResult.redirect
      ) {
        return processRedirectResponse(
          config,
          customHandlerResult as unknown as Record<string, unknown>,
          ssrOnlyData,
        );
      }

      // Otherwise, the custom handler's response is final.
      return customHandlerResult;
    }

    // Check for redirect status - only for page-type responses with status 200
    // Our convention is that redirect responses always use status_code 200
    if (
      responseData?.status === "redirect" &&
      responseData?.type === "page" &&
      responseData?.redirect
    ) {
      return processRedirectResponse(config, responseData, ssrOnlyData);
    }

    // Continue with existing checks for page responses and auth redirects
    if (statusCode === 200 && responseData?.type === "page") {
      // successful page response as is
      return decorateWithSsrOnlyData(responseData, ssrOnlyData);
    } else {
      // if it already is a page / error response, return it as is
      if (responseData?.type === "page") {
        return decorateWithSsrOnlyData(responseData, ssrOnlyData);
      } else if (
        statusCode === 401 &&
        responseData?.status === "error" &&
        responseData?.error?.code === "authentication_required"
      ) {
        // redirect to login - check for return_to in the error details
        const returnTo = responseData?.error?.details?.return_to;
        const returnToParam = config.returnToParam || DEFAULT_RETURN_TO_PARAM;

        // Only include return_to in the URL if it has a value, and ensure it's properly encoded
        if (returnTo) {
          const encodedReturnTo = encodeURIComponent(returnTo);
          return redirect(
            `${config.loginUrl}?${returnToParam}=${encodedReturnTo}`,
          ) as unknown as PageResponseEnvelope;
        }

        return redirect(config.loginUrl) as unknown as PageResponseEnvelope;
      } else {
        // Convert API responses to page responses
        // This happens when the API returns an "api" type response but we need a "page" type
        // for React Router data loaders. We preserve metadata from the original API response.
        if (responseData?.type === "api") {
          if (responseData?.status === "error") {
            const requestID =
              responseData?.request_id ||
              (config.generateFallbackRequestID
                ? config.generateFallbackRequestID("error")
                : DEFAULT_FALLBACK_REQUEST_ID_GENERATOR("error"));

            if (statusCode === 404) {
              return decorateWithSsrOnlyData(
                createErrorResponse(
                  config,
                  404,
                  config.errorDefaults.notFound.code,
                  responseData?.error?.message ||
                    config.errorDefaults.notFound.message,
                  requestID,
                  responseData?.meta,
                ),
                ssrOnlyData,
              );
            } else if (statusCode === 500) {
              return decorateWithSsrOnlyData(
                createErrorResponse(
                  config,
                  500,
                  config.errorDefaults.internalError.code,
                  responseData?.error?.message ||
                    config.errorDefaults.internalError.message,
                  requestID,
                  responseData?.meta,
                  // If in development mode, include error details
                  (config.isDevelopment ??
                    process.env.NODE_ENV === "development")
                    ? responseData?.error?.details
                    : undefined,
                ),
                ssrOnlyData,
              );
            } else if (statusCode === 403) {
              // access denied is different from the auth required error, meaning logged out
              return decorateWithSsrOnlyData(
                createErrorResponse(
                  config,
                  403,
                  config.errorDefaults.accessDenied.code,
                  responseData?.error?.message ||
                    config.errorDefaults.accessDenied.message,
                  requestID,
                  responseData?.meta,
                  responseData?.error?.details,
                ),
                ssrOnlyData,
              );
            } else {
              // Generic error response
              return decorateWithSsrOnlyData(
                createErrorResponse(
                  config,
                  statusCode,
                  responseData?.error?.code ||
                    config.errorDefaults.genericError.code,
                  responseData?.error?.message ||
                    config.errorDefaults.genericError.message,
                  requestID,
                  responseData?.meta,
                  responseData?.error?.details,
                ),
                ssrOnlyData,
              );
            }
          } else {
            // Success API response that should be a page response
            return decorateWithSsrOnlyData(
              createErrorResponse(
                config,
                500,
                config.errorDefaults.invalidResponse.code,
                config.errorDefaults.invalidResponse.message,
                responseData?.request_id,
                responseData?.meta,
              ),
              ssrOnlyData,
            );
          }
        } else {
          // Not an API response, create appropriate page error
          if (statusCode === 404) {
            return decorateWithSsrOnlyData(
              createErrorResponse(
                config,
                404,
                config.errorDefaults.notFound.code,
                config.errorDefaults.notFound.message,
              ),
              ssrOnlyData,
            );
          } else if (statusCode === 500) {
            return decorateWithSsrOnlyData(
              createErrorResponse(
                config,
                500,
                config.errorDefaults.internalError.code,
                config.errorDefaults.internalError.message,
              ),
              ssrOnlyData,
            );
          } else {
            // Generic error for any other status code
            return decorateWithSsrOnlyData(
              createErrorResponse(
                config,
                statusCode,
                "http_error",
                `HTTP Error: ${statusCode}`,
              ),
              ssrOnlyData,
            );
          }
        }
      }
    }
  } else {
    // Check for custom status code handlers for non-JSON responses
    const customHandlerResult = applyCustomHttpStatusHandler(
      statusCode,
      null,
      config,
      ssrOnlyData,
    );

    if (customHandlerResult) {
      // If the custom handler returned a redirect, process it.
      if (
        customHandlerResult.status === "redirect" &&
        customHandlerResult.type === "page" &&
        customHandlerResult.redirect
      ) {
        return processRedirectResponse(
          config,
          customHandlerResult as unknown as Record<string, unknown>,
          ssrOnlyData,
        );
      }

      // Otherwise, the custom handler's response is final.
      return customHandlerResult;
    }

    // Not valid JSON response
    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        statusCode || 500,
        config.errorDefaults.invalidResponse.code,
        config.errorDefaults.invalidResponse.message,
      ),
      ssrOnlyData,
    );
  }
}
