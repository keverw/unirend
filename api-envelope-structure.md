# API Envelope Structure Documentation

## Overview

This document outlines a standardized API envelope structure for SSR applications built with Unirend. The API is divided into two distinct groups of endpoints with different patterns:

1. **Page Data Endpoints** - For Server-Side Rendered (SSR) pages and data loaders (internal use by the SSR Server)
2. **Traditional API Endpoints** - For resource operations via AJAX/fetch (public use). However if a require is required, it is fine to return a API response envelope over a page response envelope, as the pages type are built on-top of your API and Data Loader will handle the redirect.

Both patterns use standardized response envelope structures as defined in the next section.

## Response Envelopes

The application uses two standardized response envelope formats. These formats serve as the source of truth for all API responses in the system.

### Common Response Properties

All response envelopes include these common properties:

| Property      | Type    | Description                                           |
| ------------- | ------- | --------------------------------------------------------- |
| `status`      | string  | Either "success", "error", or "redirect"              |
| `status_code` | integer | HTTP status code (200, 301, 302, 400, 401, etc.)      |
| `request_id`  | string  | Unique identifier for the request (for tracing/debugging) |
| `type`        | string  | Either "page" or "api" depending on endpoint type     |
| `data`        | object  | Main payload (null if error or redirect)              |
| `meta`        | object  | User-Definable Metadata about the request and context |
| `error`       | object  | Error details (null if success or redirect)           |
| `redirect`    | object  | Redirect details (only present for redirect status)   |

### Request ID Handling

The `request_id` field is automatically populated by the unirend response helpers. By default, it will be set to "unknown" unless you configure request ID generation in your SSR or API server plugins.

To set proper request IDs, add a plugin to your server that assigns a `requestID` property to the Fastify request object:

```typescript
import { type SSRPlugin } from "unirend/server";
import { randomUUID } from "crypto";

// Example plugin for request ID generation
const requestIdPlugin: SSRPlugin = async (fastify, options) => {
  fastify.addHook("onRequest", async (request, reply) => {
    // Always generate a unique request ID
    (request as { requestID?: string }).requestID = randomUUID();
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
      // REQUIRED for page responses
      "title": "Page Title - Your App",
      "description": "Page description for SEO"
    }
  },
  "error": null
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
- **Endpoint:** e.g.`/v1/page_data/{page_type}` (e.g., `/v1/page_data/home`, `/v1/page_data/rooms_list`). The `{page_type}` in the URL path identifies the type of page being requested and corresponds to the `pageType` argument used by the frontend page loader.
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

These endpoints follow RESTful patterns and are used for standard CRUD operations and data manipulation. They do not use the `/page_data` or`/v*/page_data` prefix.

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

### Application-Specific Error Codes

You are encouraged to define and document your own error codes for application-specific error scenarios. For example, you might use codes like `form_submission_error`, or `resource_conflict` to represent different types of errors in your API responses. The structure and meaning of these codes are entirely up to your application's needs.

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

## Redirects in API Responses

The API application handles redirects in two distinct ways:

### 1. HTTP-Level Redirects

HTTP-level redirects (status codes 301, 302, 303, 307, 308) are generally discouraged for API endpoints. The frontend data loaders are configured to not automatically follow HTTP redirects from API endpoints, as they can lead to unexpected behavior and security concerns.

When an API endpoint returns an HTTP redirect:

1. The data loader intercepts the redirect
2. Returns an error response with code `api_redirect_not_followed`
3. Includes the original redirect information in the error details

This approach prevents potential security issues and ensures consistent behavior.

### 2. Application-Level Redirects

For scenarios where redirects are a legitimate part of the application flow, we use a dedicated `redirect` status in the page response envelope. This is specifically for page-type responses and is not available for API-type responses, as redirects are primarily a UI/page concern.

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

## Mixing Response Types: API Calls within Dataloaders

Since the page response type is an extension of the API response pattern, dataloaders will sometimes encounter API-style responses when interacting with backend services. This includes data fetching and error scenarios like authentication failures, access denial, or server errors.

### Key Principles for Response Transformation

1. **Transform API responses to Page responses**: Add required page metadata for SSR/SEO
2. **Preserve metadata**: Keep important data like account information when transforming
3. **Handle specific response types consistently**:
   - Authentication Required (401): Redirect to login with return_to parameter
   - Application-level redirects: Process using the dedicated redirect status
   - System Errors: Use generic user-friendly messages instead of exposing technical details
   - Generic Errors: Convert to appropriate page errors with proper metadata

### Implementation Pattern

For a complete implementation pattern, refer to `src/apps/main-website/frontend/loaders/pageLoader.ts`, which provides a comprehensive example of:

- Handling HTTP-level redirects (rejecting with clear error messages)
- Processing application-level redirects (using the dedicated redirect status)
- Converting API responses to page responses
- Processing authentication required errors
- Preserving account metadata
- Sanitizing system-level errors for production

The pageLoader provides a reusable pattern that can be applied across all routes requiring data loading. This consistent transformation pattern ensures all responses returned from dataloaders include the required page metadata and proper redirect handling, regardless of the source.
