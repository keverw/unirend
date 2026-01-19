# API Envelope Structure Documentation

<!-- toc -->

- [Overview](#overview)
- [Response Envelopes](#response-envelopes)
  - [Common Response Properties](#common-response-properties)
  - [Request ID Handling](#request-id-handling)
  - [1. Page Response Envelope](#1-page-response-envelope)
  - [2. API Response Envelope](#2-api-response-envelope)
  - [Error Response Format](#error-response-format)
  - [Status Codes](#status-codes)
- [API Endpoint Types](#api-endpoint-types)
- [1. Page Data Endpoints](#1-page-data-endpoints)
  - [Request Format](#request-format)
    - [Request Body:](#request-body)
    - [Example Request:](#example-request)
  - [Success Response](#success-response)
  - [Error Response](#error-response)
- [2. Traditional API Endpoints](#2-traditional-api-endpoints)
  - [Request Format](#request-format-1)
    - [Base Routes:](#base-routes)
    - [Examples:](#examples)
  - [Success Response](#success-response-1)
  - [Error Response](#error-response-1)
  - [Authentication Required Errors](#authentication-required-errors)
  - [Error Codes](#error-codes)
    - [Standard Error Codes](#standard-error-codes)
    - [Application-Specific Error Codes](#application-specific-error-codes)
- [Authentication](#authentication)
- [Redirects in API/Page Responses](#redirects-in-apipage-responses)
  - [1. HTTP-Level Redirects (Blocked)](#1-http-level-redirects-blocked)
  - [2. Application-Level Redirects (Recommended)](#2-application-level-redirects-recommended)
    - [Redirect Response Format](#redirect-response-format)
    - [Authentication Required Redirects](#authentication-required-redirects)
    - [Benefits of Application-Level Redirects](#benefits-of-application-level-redirects)
- [Mixing Response Types: API Calls within Data Loaders](#mixing-response-types-api-calls-within-data-loaders)
  - [Key Principles for Response Transformation](#key-principles-for-response-transformation)
  - [Implementation Pattern](#implementation-pattern)
- [Helper utilities](#helper-utilities)
  - [Extending helpers and custom meta](#extending-helpers-and-custom-meta)
    - [Decorate request via plugin](#decorate-request-via-plugin)
    - [Server-wide custom helpers class](#server-wide-custom-helpers-class)
    - [Per-call generics](#per-call-generics)
    - [Subclass to inject defaults from the request](#subclass-to-inject-defaults-from-the-request)

<!-- tocstop -->

## Overview

This document outlines a standardized API envelope structure for SSR applications built with Unirend. The API is divided into two distinct groups of endpoints with different patterns:

1. **Page Data Endpoints** - For Server-Side Rendered (SSR) pages and data loaders (internal use by the SSR Server)
2. **Traditional API Endpoints** - For resource operations via AJAX/fetch (public use). However if a require is required, it is fine to return a API response envelope over a page response envelope, as the pages type are built on-top of your API and Data Loader will handle the redirect.

Both patterns use standardized response envelope structures as defined in the next section.

## Response Envelopes

The application uses two standardized response envelope formats. These formats serve as the source of truth for all API responses in the system.

### Common Response Properties

All response envelopes include these common properties:

| Property      | Type    | Description                                               |
| ------------- | ------- | --------------------------------------------------------- |
| `status`      | string  | Either "success", "error", or "redirect"                  |
| `status_code` | integer | HTTP status code (200, 301, 302, 400, 401, etc.)          |
| `request_id`  | string  | Unique identifier for the request (for tracing/debugging) |
| `type`        | string  | Either "page" or "api" depending on endpoint type         |
| `data`        | object  | Main payload (null if error or redirect)                  |
| `meta`        | object  | User-Definable Metadata about the request and context     |
| `error`       | object  | Error details (null if success or redirect)               |
| `redirect`    | object  | Redirect details (only present for redirect status)       |

### Request ID Handling

The `request_id` field is automatically populated by the unirend response helpers. By default, it will be set to "unknown" unless you configure request ID generation in your SSR or API server plugins.

Note:

- Server-side helpers intentionally default to `"unknown"` instead of generating a random ID when one is not present on the incoming `FastifyRequest`. This makes missing instrumentation obvious and avoids inventing server IDs that cannot be correlated across systems.
- Separately, the page data loader has its own fallback request ID generator used only when transforming responses that are missing a `request_id` or when network/timeout errors occur. See the loader config option `generateFallbackRequestID` and the default described below.

To set proper request IDs, add a plugin to your server that assigns a `requestID` property to the Fastify request object:

```typescript
import type { ServerPlugin } from 'unirend/server';
import { randomUUID } from 'crypto';

// Example plugin for request ID generation
const requestIdPlugin: ServerPlugin = async (pluginHost, options) => {
  pluginHost.addHook('onRequest', async (request, reply) => {
    // Always generate a unique request ID
    (request as { requestID?: string }).requestID = randomUUID();
  });
  pluginHost.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-ID', (request as { requestID?: string }).requestID);
    return payload;
  });
};
```

The response helpers will automatically pick up this `requestID` value when creating envelope responses.

### 1. Page Response Envelope

Used for SSR routes and data loaders. Includes required page metadata for SEO.

```json
{
  "status": "success",
  "status_code": 200,
  "request_id": "req-12345-abcde",
  "type": "page",
  "data": {
    // The main payload - varies by endpoint
    // This is what you use within your page components
  },
  "meta": {
    // This is defined by your own application, below is just an example
    "account": {
      // Account authentication status and information
      "is_authenticated": true,
      "info": {
        "id": "user-id",
        "display_name": "User Name",
        "profile_slug": "user-name-123",
        "role": "user|admin"
      }
    },
    "site_info": {
      "current_year": 2025
    },
    "page": {
      // REQUIRED for page responses if you use helmet within your app layout
      "title": "Page Title - Your App",
      "description": "Page description for SEO"
    }
  },
  "error": null,
  "ssr_request_context": {
    // OPTIONAL: SSR-only infrastructure field (page-type responses only)
    // Automatically populated from request.requestContext when using page response helpers
    // with the server request object
    // Used to forward request context between separated SSR and API servers
    // Not sent from browser, only used in SSR-to-API communication
  }
}
```

### 2. API Response Envelope

Used for AJAX/fetch API endpoints. Does not require page metadata.
This is the suggested standard, the page data loader can pickup on these for authentication required, and try to convert them to frontend errors. However, if you have a form or something submitted by fetch/xmlhttprequest request, you are expected to handle the returned API response envelope yourself, either when successfully or when erroring.

```json
{
  "status": "success",
  "status_code": 200,
  "request_id": "req-12345-abcde",
  "type": "api",
  "data": {
    // The main payload - varies by endpoint
  },
  "meta": {
    "account": {
      // Account authentication status and information
      "is_authenticated": true,
      "info": {
        "id": "user-id",
        "display_name": "User Name",
        "profile_slug": "user-name-123",
        "role": "user|admin"
      }
    },
    "site_info": {
      "current_year": 2025
    }
    // No page metadata - not needed for API calls
  },
  "error": null
}
```

### Error Response Format

When an error occurs, the response will have `status: "error"` and include an `error` object with these properties:

```json
{
  "status": "error",
  "status_code": 400,
  "request_id": "req-12345-abcde",
  "type": "api", // or "page"
  "data": null,
  "meta": {
    /* standard meta fields */
  },
  "error": {
    "code": "invalid_input",
    "message": "The provided input is invalid",
    "details": {
      // Optional additional details about the error
      // For validation errors, this often includes field-specific errors
    }
  }
}
```

### Status Codes

The API uses standard HTTP status codes, but also includes `status` and `status_code` in the response envelope:

| Status Code | Description                            |
| ----------- | -------------------------------------- |
| 200         | Success                                |
| 400         | Bad Request - client-side error        |
| 401         | Unauthorized - authentication required |
| 403         | Forbidden - insufficient permissions   |
| 404         | Not Found - resource doesn't exist     |
| 500         | Server Error                           |

## API Endpoint Types

The API is divided into two distinct groups of endpoints with different patterns:

1. **Page Data Endpoints** - For SSR and data loading used by the SSR data loader
2. **Traditional API Endpoints** - For resource operations

Let's examine each group in detail:

## 1. Page Data Endpoints

These endpoints are specifically designed for retrieving complete page data for Server-Side Rendering (SSR) and React Router data loaders.

### Request Format

To fetch data for SSR pages, the frontend makes an HTTP POST request to a dedicated endpoint:

- **Method:** `POST`
- **Endpoint:** e.g.`/v1/page_data/{page_type}` (e.g., `/v1/page_data/home`, `/v1/page_data/rooms_list`). The `{page_type}` in the URL path identifies the type of page being requested and corresponds to the `pageType` argument used by the frontend page data loader.
- **Content-Type:** `application/json`

#### Request Body:

The JSON body uses `snake_case` and includes the following fields:

```json
{
  "route_params": {
    // An object containing key-value pairs from dynamic route segments.
    // Example: { "property_id": "123", "location_slug": "san-francisco" }
  },
  "query_params": {
    // An object containing key-value pairs from URL query string parameters.
    // Example: { "min_beds": "2", "sort_by": "price" }
  },
  "request_path": "/rooms_list", // The pathname portion of the requested URL (without query string)
  "original_url": "https://example.com/rooms_list?min_beds=2&sort_by=price" // The complete original URL
}
```

- `route_params` (object, required): An object containing the route parameters from the URL. Keys should use `snake_case`.
- `query_params` (object, required): An object representing the query string parameters from the requested URL if any.
- `request_path` (string, required): The pathname portion of the requested URL (without query string).
- `original_url` (string, required): The complete original URL including protocol, host, path, and query string.

#### Example Request:

```
POST /v1/page_data/rooms_list
Content-Type: application/json

{
  "route_params": {
    "country_code": "usa",
    "state_slug": "ca",
    "city_slug": "san-francisco"
  },
  "query_params": {
    "min_beds": "2",
    "features": ["pool", "gym"],
    "sort_order": "price_asc"
  }
}
```

### Success Response

Page data endpoints always use the **Page Response Envelope** format that includes SEO metadata:

```json
{
  "status": "success",
  "status_code": 200,
  "request_id": "req-12345-abcde",
  "type": "page",
  "data": {
    "page": {
      "components": [
        {
          "type": "Hero",
          "props": {
            "title": "Find Your Dream Home",
            "image": "/assets/hero-image.jpg"
          }
        },
        {
          "type": "ListingGrid",
          "props": {
            "listings": [
              // Array of listing objects
            ]
          }
        }
      ]
    }
  },
  "meta": {
    "account": {
      "is_authenticated": true,
      "info": {
        "id": "user-123",
        "display_name": "John Doe",
        "profile_slug": "john-doe-123",
        "role": "user"
      }
    },
    "site_info": {
      "current_year": 2025
    },
    "page": {
      "title": "Your App - Property Listings",
      "description": "Browse available properties"
    }
  },
  "error": null
}
```

### Error Response

When errors occur for page data requests, the response includes an `error` object with details and appropriate page metadata for SEO:

```json
{
  "status": "error",
  "status_code": 404,
  "request_id": "req-12345-abcde",
  "type": "page",
  "data": null,
  "meta": {
    "site_info": {
      "current_year": 2025
    },
    "page": {
      "title": "Page Not Found - Your App",
      "description": "The page you are looking for does not exist."
    }
  },
  "error": {
    "code": "not_found",
    "message": "The requested page could not be found.",
    "details": {
      "requested_path": "/invalid/path"
    }
  }
}
```

## 2. Traditional API Endpoints

These endpoints follow RESTful patterns and are used for standard CRUD operations and data manipulation. They do not need to use the `/page_data` or`/v*/page_data` prefix.

### Request Format

RESTful API endpoints use standard HTTP methods according to the operation:

- **GET**: Read or list resources
- **POST**: Create a new resource
- **PUT/PATCH**: Update an existing resource
- **DELETE**: Remove a resource

#### Base Routes:

- `/v1/auth` - Authentication operations
- `/v1/account` - User operations
- `/v1/rooms` - Property operations
- ... other resource endpoints

#### Examples:

- `POST /v1/auth/login` - User login
- `GET /v1/rooms?min_price=100000` - List rooms with filtering
- `GET /v1/room/{id}` - Get a specific room

### Success Response

Traditional API endpoints use the **API Response Envelope** format, which does not include page metadata:

```json
{
  "status": "success",
  "status_code": 200,
  "request_id": "req-12345-abcde",
  "type": "api",
  "data": {
    // Response payload specific to the endpoint
  },
  "meta": {
    "account": {
      "is_authenticated": true,
      "info": {
        "id": "user-123",
        "display_name": "John Doe",
        "profile_slug": "john-doe-123",
        "role": "user"
      }
    },
    "site_info": {
      "current_year": 2025
    }
  },
  "error": null
}
```

### Error Response

When errors occur for traditional API endpoints:

```json
{
  "status": "error",
  "status_code": 403,
  "request_id": "req-12345-abcde",
  "type": "api",
  "data": null,
  "meta": {
    "site_info": {
      "current_year": 2025
    }
  },
  "error": {
    "code": "permission_denied",
    "message": "You do not have permission to perform this action.",
    "details": {
      "required_role": "admin"
    }
  }
}
```

### Authentication Required Errors

When a user attempts to access a protected resource without being authenticated (whether through page data requests or traditional API calls), your API should return an authentication required error that Unirend's data loader can handle:

```json
{
  "status": "error",
  "status_code": 401,
  "request_id": "req-12345-abcde",
  "type": "api",
  "data": null,
  "meta": {
    "site_info": {
      "current_year": 2025
    }
  },
  "error": {
    "code": "authentication_required",
    "message": "You must be logged in to perform this action.",
    "details": {
      "return_to": "/requested/path"
    }
  }
}
```

### Error Codes

#### Standard Error Codes

Unirend recognizes these standard error codes for special handling by the framework:

| Code                            | Status | Description                                     | Special Behavior                                                          |
| ------------------------------- | ------ | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `authentication_required`       | 401    | User must log in to access this resource        | Page data loader automatically redirects to login with return URL         |
| `invalid_request_body_format`   | 400    | Request body format is invalid (not valid JSON) | Used by `ensureJSONBody` helper for malformed JSON bodies                 |
| `invalid_page_data_body_fields` | 400    | Page data request body has invalid fields       | Framework returns this when page data loader POST body fields are invalid |

**Recommended conventional codes** (no special framework handling, but follow HTTP semantics):

- `not_found` (404) - Requested resource does not exist
- `permission_denied` (403) - User lacks permission to access resource
- `invalid_input` (400) - Validation errors on user input
- `internal_error` (500) - Server encountered an unexpected error

#### Application-Specific Error Codes

You are encouraged to define and document your own error codes for application-specific scenarios. For example:

- `form_submission_error` - Form validation failed
- `resource_conflict` - Resource already exists or conflicts with another
- `payment_required` - Payment or subscription needed
- `rate_limit_exceeded` - Too many requests

The structure and meaning of custom error codes are entirely up to your application's needs. Use descriptive `snake_case` names that clearly indicate the error condition.

## Authentication

Authentication in this API envelope pattern assumes a shared authentication system between your main application and API endpoints. This is typically achieved through:

**Same Domain Deployment**: Running your SPA and API on the same domain (e.g., `yourapp.com`) allows cookies to be automatically shared.

**Subdomain Cookie Sharing**: If using separate subdomains (e.g., `app.yourapp.com` for SPA and `api.yourapp.com` for API), configure cookies with a domain like `.yourapp.com` to share authentication state.

**Cookie Best Practices**:

- Use HttpOnly cookies for security
- Enable Secure flag for HTTPS
- Set SameSite=Strict for CSRF protection
- Configure appropriate Path and Domain for your architecture

If your application uses authentication, consider including the authentication status in the `meta` section of your responses. For example, you might include `meta.account.is_authenticated` to indicate authentication status, and `meta.account.info` for user details when authenticated. The specific structure and field names are entirely up to your application's needs.

## Redirects in API/Page Responses

**Philosophy:** Redirects are rare in traditional APIs but common in SSR/page data loaders. When a page handler needs to redirect (e.g., after form submission, role-based routing, or access control checks), it returns a special redirect envelope instead of using HTTP redirects. This gives you control over the redirect behavior and keeps it within the application layer.

**Note:** For authentication-required scenarios (login required), use the 401 error pattern with `error.code === "authentication_required"` instead - the page data loader automatically handles these by redirecting to the login page. See [Authentication Required Redirects](#authentication-required-redirects) below.

The API application handles redirects in two distinct ways:

### 1. HTTP-Level Redirects (Blocked)

HTTP-level redirects (status codes 301, 302, 303, 307, 308) are generally discouraged for API endpoints. The frontend data loaders are configured to **not automatically follow** HTTP redirects from API endpoints, as they can lead to unexpected behavior and security concerns:

- Point to untrusted external servers that could return malicious page envelopes or `ssr_request_context` data
- Bypass security validation and origin checks
- Lose request context and metadata during the redirect chain

The page data loader uses `redirect: 'manual'` in fetch options to prevent automatic redirect following. If an API endpoint serving page data returns an HTTP redirect, the data loader will intercept it and return an error response with code `redirect_not_followed`.

**Note:** If your API uses HTTP redirects, they should only be in pure API endpoints (not routes serving page data loaders) and should not be added by middleware before page data handler routes.

### 2. Application-Level Redirects (Recommended)

When redirects are part of the application flow, use the dedicated `redirect` status in the **page response envelope**. This is only for page-type responses (not API-type), since redirects are a page/UI concern, not a data API concern.

#### Redirect Response Format

```json
{
  "status": "redirect",
  "status_code": 200,
  "request_id": "req-12345-abcde",
  "type": "page",
  "data": null,
  "meta": {
    "account": {
      "is_authenticated": true,
      "info": {
        "id": "user-123",
        "display_name": "John Doe",
        "profile_slug": "john-doe-123",
        "role": "user"
      }
    },
    "site_info": {
      "current_year": 2025
    },
    "page": {
      "title": "Redirecting...",
      "description": "You are being redirected to a new location."
    }
  },
  "error": null,
  "redirect": {
    "target": "/new/location",
    "permanent": false,
    "preserve_query": true
  }
}
```

Important notes about redirect responses:

- Always use HTTP status code 200 (not 301/302) to avoid confusion with HTTP redirects
- Only available for page-type responses, not API-type responses
- Include appropriate page metadata for SEO during the redirect

The `redirect` object contains:

- `target` (string, required): The URL to redirect to
- `permanent` (boolean, required): Whether the redirect should be considered permanent (for client caching purposes)
- `preserve_query` (boolean, optional): Whether to preserve query parameters when redirecting

The frontend data loader processes this by returning a React Router redirect, preserving query parameters if specified.

#### Authentication Required Redirects

For the specific case of authentication required errors, we use the existing error status pattern:

```json
{
  "status": "error",
  "status_code": 401,
  "request_id": "req-12345-abcde",
  "type": "api",
  "data": null,
  "meta": {
    "site_info": {
      "current_year": 2025
    }
  },
  "error": {
    "code": "authentication_required",
    "message": "You must be logged in to perform this action.",
    "details": {
      "return_to": "/requested/path"
    }
  }
}
```

The frontend data loader handles this by redirecting the user to the login page, including the return_to parameter.

#### Benefits of Application-Level Redirects

This approach:

1. Makes redirects explicit and intentional through a dedicated status
2. Preserves metadata in the response
3. Prevents security issues associated with HTTP redirects
4. Avoids confusion with HTTP status codes
5. Follows the same discriminated union pattern as success and error responses
6. Separates page concerns (redirects) from API concerns

Data loaders handle redirect status responses by converting them to appropriate React Router redirects.

## Mixing Response Types: API Calls within Data Loaders

Since the page response type is an extension of the API response pattern, data loaders will sometimes encounter API-style responses when interacting with backend services. This includes data fetching and error scenarios like authentication failures, access denial, or server errors.

### Key Principles for Response Transformation

1. **Transform API responses to Page responses**: Add required page metadata for SSR/SEO
2. **Preserve metadata**: Keep important data like account information when transforming
3. **Handle specific response types consistently**:
   - Authentication Required (401): Redirect to login with return_to parameter
   - Application-level redirects: Process using the dedicated redirect status
   - System Errors: Use generic user-friendly messages instead of exposing technical details
   - Generic Errors: Convert to appropriate page errors with proper metadata

### Implementation Pattern

Unirend’s `pageDataLoader` implements a consistent, envelope-first pattern across SSR and client:

- Request strategy
  - SSR: If a page data loader handler is registered on the same server instance, the loader short‑circuits and invokes it internally, otherwise it performs an HTTP POST to `{APIBaseURL}{pageDataEndpoint}/{pageType}` with `route_params`, `query_params`, `request_path`, and `original_url`.
  - Client: Performs an HTTP POST with `credentials: "include"` and forwards `Accept-Language`.

- Headers and cookies (SSR HTTP path)
  - Adds `X-SSR-Request`, `X-SSR-Original-IP`, `X-SSR-Forwarded-User-Agent`, `X-Correlation-ID` when sending info to a API backend
  - Applies cookie forwarding policy to inbound `Cookie` and outbound `Set-Cookie` (see SSR docs for policy details).

- Response processing
  - Custom handlers: Runs `statusCodeHandlers` (exact match first, then wildcard `"*"`). If a handler returns a Page envelope, it is used as‑is (redirects supported via `status: "redirect"`, `status_code: 200`).
  - Application redirects: If the response is a Page redirect envelope, it is converted to a React Router redirect (preserving query if requested).
  - HTTP redirects: HTTP 3xx from API responses are not followed and are converted to `redirectNotFollowed` errors, preserving `Location` in details.
  - Page vs API envelopes: Page envelopes are passed through (decorated with SSR‑only data such as cookies on the server). API error envelopes are transformed into Page error envelopes, preserving metadata and optionally extending it via `transformErrorMeta`.
  - Auth flows: 401 with `error.code === "authentication_required"` triggers a redirect to `loginURL` with an optional return parameter (`returnToParam`). 403 maps to access denied, 404 to not found, other codes fall back to generic handling.

- Timeouts and resiliency
  - HTTP requests use `fetchWithTimeout(timeoutMs)`. On timeout or network failures, the loader returns a standardized 500 Page error using configured friendly messages.
  - Local loaders support the same timeout behavior. Local loaders cannot set SSR cookies (no HTTP response path), and SSR‑only cookies are therefore unavailable in the local path.

- Request ID
  - If missing from responses, a fallback `request_id` is generated via `generateFallbackRequestID` (or a default generator). When using helpers on the server, `request_id` is sourced from `request.requestID` if your plugin sets it.

See the README section “Data Loader Error Transformation and Additional Config” for configuration fields that influence this behavior.

## Helper utilities

For convenience, Unirend provides helper functions to construct and validate envelopes in your handlers. These are optional but recommended for consistency.

- Import: `import { APIResponseHelpers } from 'unirend/api-envelope'`
- Create responses:
  - `APIResponseHelpers.createAPISuccessResponse({ request, data, statusCode?, meta? })`
  - `APIResponseHelpers.createAPIErrorResponse({ request, statusCode, errorCode, errorMessage, errorDetails?, meta? })`
  - `APIResponseHelpers.createPageSuccessResponse({ request, data, pageMetadata, statusCode?, meta? })`
  - `APIResponseHelpers.createPageErrorResponse({ request, statusCode, errorCode, errorMessage, pageMetadata, errorDetails?, meta? })`
  - `APIResponseHelpers.createPageRedirectResponse({ request, redirectInfo, pageMetadata, meta? })`
- Validate input: `APIResponseHelpers.ensureJSONBody(request, reply)`
- Type guards: `isSuccessResponse`, `isErrorResponse`, `isRedirectResponse`, `isPageResponse`, `isValidEnvelope`

These helpers assume you set `request.requestID` via a plugin as described above, otherwise `request_id` defaults to `"unknown"`.

### Extending helpers and custom meta

All helper creators are generic over the data payload (T) and meta (M extends BaseMeta), so you can supply your own meta shape per call, or centralize defaults by subclassing the helpers.

> Static by design: `APIResponseHelpers` are intentionally implemented as a static utility. This keeps them side‑effect free, easy to test/re‑export, and lets your request handlers live in separate files without passing instances around. For app‑specific defaults (e.g., build info, account, locale), decorate the Fastify `request` in a plugin and merge those values via the `meta` parameter when calling the static helpers.

#### Decorate request via plugin

Use a server plugin to attach defaults to each request, then merge them in your handlers. See the server plugins guide for request decoration: [Server Plugins](./server-plugins.md).

For a complete example where using build info (load once at startup, decorate requests, auto-merge into response meta), see: [Build Info → Using with Unirend plugins](./build-info.md#using-with-unirend-plugins).

#### Server-wide custom helpers class

You can configure a custom helpers class for the SSR and API servers so all server-produced envelopes (defaults, fallbacks) use your class for creation. This is useful for injecting default metadata (e.g., account/site info) or centralizing conventions.

- Option name: `APIResponseHelpersClass`
- Available on: SSR (`serveSSRDev`/`serveSSRProd` options) and API (`serveAPI` options)
- Validation helpers like `isValidEnvelope` still use the base helpers and are not overridden

Example:

```ts
import { serveSSRDev, serveAPI } from 'unirend/server';
import { APIResponseHelpers } from 'unirend/api-envelope';

// Your custom subclass (optional)
class AppResponseHelpers extends APIResponseHelpers {
  // override/add convenience creators as needed
}

// SSR
const ssr = serveSSRDev(
  {
    serverEntry: './src/entry-server.tsx',
    template: './index.html',
    viteConfig: './vite.config.ts',
  },
  {
    APIResponseHelpersClass: AppResponseHelpers,
    // ...other options
  },
);

// API
const api = serveAPI({
  APIResponseHelpersClass: AppResponseHelpers,
  // ...other options
});
```

#### Per-call generics

```ts
import { APIResponseHelpers } from 'unirend/api-envelope';
import type { BaseMeta } from 'unirend/api-envelope';
interface AppMeta extends BaseMeta {
  account?: { isAuthenticated: boolean; userID?: string; workspaceID?: string };
}

// Create a page success with custom meta type
return APIResponseHelpers.createPageSuccessResponse<MyData, AppMeta>({
  request,
  data,
  pageMetadata: { title: 'Dashboard', description: 'Overview' },
  meta: {
    account: {
      isAuthenticated: Boolean((request as any).user?.id),
      userID: (request as any).user?.id,
      workspaceID: (request as any).workspace?.id,
    },
  },
});
```

#### Subclass to inject defaults from the request

```ts
import { APIResponseHelpers } from 'unirend/api-envelope';
import type { BaseMeta, PageMetadata } from 'unirend/api-envelope';
import type { FastifyRequest } from 'unirend/server';

interface AppMeta extends BaseMeta {
  account?: { isAuthenticated: boolean; userID?: string; workspaceID?: string };
}

export class AppResponseHelpers extends APIResponseHelpers {
  static createPageSuccessWithDefaults<T>(params: {
    request: FastifyRequest;
    data: T;
    pageMetadata: PageMetadata;
    statusCode?: number;
    meta?: Partial<AppMeta>;
  }) {
    const userID = (params.request as any).user?.id as string | undefined;
    const workspaceID = (params.request as any).workspace?.id as
      | string
      | undefined;

    const mergedMeta: AppMeta = {
      ...(params.meta as Partial<AppMeta>),
      account: {
        isAuthenticated: Boolean(userID),
        userID,
        workspaceID,
      },
    } as AppMeta;

    return APIResponseHelpers.createPageSuccessResponse<T, AppMeta>({
      ...params,
      meta: mergedMeta,
    });
  }
}
```

You can re-export your subclass from your app and use it across SSR/API handlers to ensure consistent meta defaults.
