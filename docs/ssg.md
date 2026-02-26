# Static Site Generation (SSG)

<!-- toc -->

- [Creating Generation Script](#creating-generation-script)
  - [Request Context Injection](#request-context-injection)
  - [Template Caching Info](#template-caching-info)
  - [Page Map Output](#page-map-output)
- [Serving Static Files](#serving-static-files)
  - [URL Mismatch Considerations](#url-mismatch-considerations)
  - [404 Pages Suggestion](#404-pages-suggestion)
  - [Using StaticWebServer (Recommended)](#using-staticwebserver-recommended)
    - [Configuration Options](#configuration-options)
      - [Error Pages](#error-pages)
      - [Single Assets](#single-assets)
      - [Asset Folders](#asset-folders)
      - [Development Mode](#development-mode)
      - [HTTPS/SSL Support](#httpsssl-support)
      - [HTTP to HTTPS Redirect Server](#http-to-https-redirect-server)
      - [Cache Control](#cache-control)
      - [Features](#features)
  - [Static Hosting Services](#static-hosting-services)
  - [Apache (.htaccess)](#apache-htaccess)
  - [Nginx](#nginx)
  - [Node.js/Express Static Server](#nodejsexpress-static-server)
  - [PHP Router (for integrating SSG with PHP applications)](#php-router-for-integrating-ssg-with-php-applications)

<!-- tocstop -->

**Static Site Generation (SSG)** allows you to pre-render your React pages at build time, creating static HTML files that can be served by any web server.

## Creating Generation Script

Create a script to generate your static pages using the `generateSSG` function:

> 💡 **Tip:** For a more comprehensive generation example script with detailed error handling and reporting, see [`demos/ssg/generate.ts`](../demos/ssg/generate.ts) in this repository.

```typescript
import { generateSSG } from 'unirend/server';
import path from 'path';

async function main() {
  // Point to the build directory (contains both client/ and server/ subdirectories)
  const buildDir = path.resolve(__dirname, 'build');

  const pages = [
    // Server-rendered (SSG) pages
    { type: 'ssg', path: '/', filename: 'index.html' },
    { type: 'ssg', path: '/about', filename: 'about.html' },
    { type: 'ssg', path: '/contact', filename: 'contact.html' },

    // Client-rendered SPA pages with custom metadata
    {
      type: 'spa',
      filename: 'dashboard.html',
      title: 'Dashboard',
      description: 'SPA Dashboard Page',
    },

    // Client-rendered SPA page with manual request context injection
    {
      type: 'spa',
      filename: 'profile.html',
      title: 'User Profile',
      description: 'User profile page',
      requestContext: {
        // This data will be injected and available on the client
        // See unirend-context.md for how to access this data in your components
        userID: 'default-user',
        theme: 'light',
      },
    },
  ];

  const options = {
    serverEntry: 'entry-ssg', // Default for SSG, customize if needed
    frontendAppConfig: {
      apiUrl: 'https://api.example.com',
    },
    // Optional: Generate page map for StaticWebServer (see "Page Map Output" section)
    // pageMapOutput: 'page-map.json',
    // Optional: containerID used in template processing (defaults to "root")
    // containerID: "root",
    // Optional: custom client/server folder names in buildDir (defaults: "client"/"server")
    // clientFolderName: "client",
    // serverFolderName: "server",
    // Optional: logger (defaults to silent)
    // logger: SSGConsoleLogger,
  };

  const result = await generateSSG(buildDir, pages, options);

  if (result.fatalError) {
    console.error('SSG generation failed:', result.fatalError.message);
    process.exit(1);
  }

  console.log(
    `Generated ${result.pagesReport.successCount} pages successfully!`,
  );
}

main().catch(console.error);
```

### Request Context Injection

Both SSG and SPA pages support injecting request context data that will be available on the client.

**Request Context vs Frontend App Config:**

- **Request Context**: Per-page data that can vary between pages and be mutated on the client (e.g., page-specific state, user preferences, theme)
- **Frontend App Config**: Global, immutable configuration shared across all pages (e.g., API URLs, feature flags, build info)

**SSG Pages (Server-Rendered):**

- Request context can be populated dynamically during the rendering process
- Useful for injecting render-time metadata (e.g., page-specific generation timestamps, debug info, default theme, or other defaults)

**SPA Pages (Client-Rendered):**

- Request context can be manually provided in the page definition via the `requestContext` property
- Useful for injecting static configuration or default values for specific pages

**React Components (Server & Client):**

- Components can read or update the context during the generation process (for SSG pages) and on the client after hydration
- The context acts as a key-value store initially populated during page generation that components can take over on the frontend
- See [Unirend Context documentation](./unirend-context.md) for details on accessing this data in your React components

### Template Caching Info

Unirend automatically caches the processed HTML template in `.unirend-ssg.json` within your client build directory. This serves two important purposes:

1. **Performance**: Avoids re-processing the template on subsequent generation runs
2. **Template preservation**: Keeps a copy of the original `index.html` in case you overwrite it with a generated index page

- **First run**: Processes the HTML template (formatting and preparation) and creates the cache file
- **Subsequent runs**: Uses the cached processed template, preserving your source `index.html`

**Important:** Vite's default behavior is to clean the output directory on each build (`build.emptyOutDir: true`). This means:

- The cache file is cleared on each `vite build` command
- Template processing happens fresh after each build
- This ensures the cache stays in sync with your latest build

If you've disabled `emptyOutDir` in your Vite config, the cache will persist between builds. While this improves performance, make sure to rebuild when you change your HTML template or app configuration.

### Page Map Output

The `pageMapOutput` option generates a JSON file mapping URL paths to their corresponding HTML filenames. This is primarily useful to avoid **React hydration mismatches** — if your server serves `/about` but the pre-rendered file is `about.html`, React will see a different document than expected and warn about hydration errors. The page map lets static servers know exactly which file to serve for each clean URL.

```typescript
const options = {
  // ... other options
  pageMapOutput: 'page-map.json', // Written to buildDir/client/page-map.json
};

const result = await generateSSG(buildDir, pages, options);
```

**Generated file example (`page-map.json`):**

```json
{
  "/": "index.html",
  "/about": "about.html",
  "/contact": "contact.html",
  "/dashboard": "dashboard.html"
}
```

**How paths are determined:**

- **SSG pages**: Uses the `path` property directly (e.g., `{ type: "ssg", path: "/about", filename: "about.html" }`)
- **SPA pages**: Derives path from filename (e.g., `dashboard.html` → `/dashboard`, `index.html` → `/`)

**Usage with static content servers:**

The page map can be loaded by static servers to configure URL-to-file mappings. For example, with unirend's `staticContent` plugin:

```typescript
import pageMap from './build/client/page-map.json';

// Convert to singleAssetMap format (URL → absolute file path)
const singleAssetMap: Record<string, string> = {};

for (const [urlPath, filename] of Object.entries(pageMap)) {
  singleAssetMap[urlPath] = path.join(clientBuildDir, filename);
}

// Use with staticContent plugin
staticContent({
  singleAssetMap,
  // ... other options
});
```

## Serving Static Files

After generating your SSG files, you'll need to configure your web server to serve clean URLs without `.html` extensions. Here are common approaches:

> ⚠️ **Security Note:** All examples below include directory traversal protection to prevent serving files outside the intended directory. This is critical for production deployments.

### URL Mismatch Considerations

- Map clean URLs to their pre-rendered files (e.g., `/about` → `about.html`). If not, you’ll get 404s.
- Serve the document that matches the router route. If you serve a generic fallback document (e.g., a catch‑all `index.html` in SPA setups) or a different page for `/about`, React will warn about hydration mismatches and may re-render. Unknown routes should serve a proper `404.html` (with 404 status), not a mismatched document.
- Normalize trailing slashes (redirect `/about/` → `/about`) to avoid duplicate content and route mismatches.
- Keep generated filenames aligned with routes (e.g., `/blog/my-post` → `build/client/blog/my-post.html`) and ensure internal links use the same clean URLs your rewrites expect.

### 404 Pages Suggestion

- Generate your 404 page like any other SSG page (e.g., `{ type: "ssg", path: "/404", filename: "404.html" }`).
- Configure your server to return status 404 when serving it:
  - Apache: `ErrorDocument 404 /404.html`
  - Nginx: `try_files /404.html =404;`
  - Node/Express: `res.status(404).sendFile(path.join(__dirname, "build/client/404.html"))`

### Using StaticWebServer (Recommended)

Unirend provides a built-in `StaticWebServer` class that automatically consumes the page map and serves your static site with proper status codes, caching, and HTTPS support.

> **Note:** Make sure to generate `page-map.json` using the `pageMapOutput` option in your generation script (see [Page Map Output](#page-map-output)).

See [`demos/ssg/serve.ts`](../demos/ssg/serve.ts) for a complete working example.

**Basic usage:**

```typescript
import { StaticWebServer } from 'unirend/server';
import path from 'path';

const server = new StaticWebServer({
  buildDir: path.resolve(__dirname, 'build/client'),
  pageMapPath: 'page-map.json', // Relative to buildDir
  assetFolders: {
    '/assets': 'assets', // Relative to buildDir
  },
});

await server.listen(3000);
console.log('Static server running at http://localhost:3000');
```

> **Note:** All file paths (`pageMapPath`, `notFoundPage`, `errorPage`, `singleAssets` values, `assetFolders` values) are resolved relative to `buildDir`.

> **💡 Tip:** If you generate `/404` or `/500` pages as SSG pages (e.g., `{ type: 'ssg', path: '/404', filename: '404.html' }`), they'll be automatically detected and served with proper 404/500 status codes. This is the recommended approach for custom error pages.

> **🐳 Container Deployment:** When deploying in containers, bind to `0.0.0.0` to make the server accessible from outside the container: `await server.listen(3000, '0.0.0.0')`. For local development, the default binding is fine.

#### Configuration Options

**Core Options:**

- `buildDir` (required) - Directory containing the built client files
- `pageMapPath` (required) - Path to page-map.json file (relative to buildDir)
- `assetFolders` - Map of URL prefixes to filesystem directories for serving static assets
- `singleAssets` - Map of URL paths to individual files (favicon, robots.txt, etc.)

**Error Handling:**

- `notFoundPage` - Custom 404 page path (relative to buildDir)
- `errorPage` - Custom 500 error page path (relative to buildDir)
- `isDevelopment` - Enable development mode with stack traces in built-in default 500 page only (default: `false`)
- `logErrors` - Automatically log errors to server logger (default: `true`)

**Caching:**

- `cacheControl` - Cache-Control header for HTML pages (default: `"public, max-age=0, must-revalidate"`)
- `immutableCacheControl` - Cache-Control for fingerprinted assets (default: `"public, max-age=31536000, immutable"`)
- `detectImmutableAssets` - Auto-detect fingerprinted files for long caching (default: `true`)

**Server Configuration:**

- `https` - HTTPS/SSL configuration with key, cert, and optional SNI callback
- `logging` - Framework-level logging options (Unirend logger abstraction)
- `fastifyOptions` - Fastify server options (logger, trustProxy, bodyLimit, keepAliveTimeout, etc.)

##### Error Pages

**Recommended approach:** Generate 404 and 500 error pages as SSG pages (e.g., `{ type: 'ssg', path: '/404', filename: '404.html' }`). They'll be automatically detected from the page map and served with proper status codes.

**Advanced configuration:** For custom error page paths (separate from generated pages), use the `notFoundPage` and `errorPage` options:

```typescript
const server = new StaticWebServer({
  buildDir: './build/client',
  pageMapPath: 'page-map.json',
  notFoundPage: 'custom-404.html', // Relative to buildDir
  errorPage: 'custom-error.html', // Relative to buildDir
});
```

**Error page loading priority:**

1. Page map entry (e.g., `/404` from generated SSG pages) - checked first
2. Custom path if specified (`notFoundPage` / `errorPage`)
3. Default file in buildDir (`404.html` / `500.html`)
4. Built-in generic default (fallback if no custom pages found)

**Note:** If error pages are generated as SSG pages (e.g., `{ type: 'ssg', path: '/404', filename: '404.html' }`), they are automatically **removed from normal routes** to prevent serving them with 200 status codes. Error pages are only accessible via error handlers with proper 404/500 status codes.

**Development mode:** The built-in default 500 error page shows stack traces when `isDevelopment: true`. Custom error page files are served as-is (static HTML).

##### Single Assets

Serve standalone files like `favicon.ico` or `robots.txt` from Vite's public folder using the `singleAssets` option:

```typescript
const server = new StaticWebServer({
  buildDir: './build/client',
  pageMapPath: 'page-map.json',
  singleAssets: {
    '/robots.txt': 'robots.txt', // Relative to buildDir
    '/favicon.ico': 'favicon.ico', // Relative to buildDir
    '/sitemap.xml': 'sitemap.xml', // Relative to buildDir
  },
});
```

File paths are resolved relative to `buildDir` and served alongside pages from the page map.

##### Asset Folders

Serve entire directories of static assets using the `assetFolders` option:

```typescript
const server = new StaticWebServer({
  buildDir: './build/client',
  pageMapPath: 'page-map.json',
  assetFolders: {
    '/assets': 'assets', // CSS, JS, images - relative to buildDir
    '/images': 'images', // Additional images folder - relative to buildDir
    '/downloads': 'downloads', // Downloadable files - relative to buildDir
  },
  detectImmutableAssets: true, // Auto-detect fingerprinted files (default: true)
});
```

Files with content hashes (e.g., `app-abc123.js`) automatically get long cache headers (`max-age=31536000, immutable`).

##### Development Mode

Enable development mode to see error stack traces in the built-in default 500 error page:

```typescript
const server = new StaticWebServer({
  buildDir: './build/client',
  pageMapPath: 'page-map.json',
  isDevelopment: true, // Shows stack traces in built-in 500 error page
  logErrors: true, // Automatically log errors (default: true)
});
```

**Error Logging:** By default, all request errors are automatically logged to the server logger with URL, method, and error details. This is especially useful when using custom error pages that can't show dynamic stack traces. Set `logErrors: false` to disable automatic error logging if you prefer to handle logging in custom error handlers.

**Note:** Stack traces only appear in the built-in generic 500 error page (used when no custom error page is found). Custom error page files are served as-is without dynamic content.

##### HTTPS/SSL Support

To enable HTTPS, provide SSL certificate options (same as APIServer and SSRServer):

```typescript
const server = new StaticWebServer({
  buildDir: './build/client',
  pageMapPath: 'page-map.json',
  https: {
    key: privateKey, // string | Buffer - Your SSL private key
    cert: certificate, // string | Buffer - Your SSL certificate
  },
});

await server.listen(443, '0.0.0.0');
console.log('Static server running at https://localhost:443');
```

##### HTTP to HTTPS Redirect Server

For production deployments, run a separate redirect server on port 80 to redirect HTTP traffic to HTTPS:

```typescript
import { StaticWebServer } from 'unirend/server';
import { serveRedirect } from 'unirend/server';

// HTTPS static server (port 443)
const server = new StaticWebServer({
  buildDir: './build/client',
  pageMapPath: 'page-map.json',
  https: {
    key: privateKey,
    cert: certificate,
  },
});

await server.listen(443, '0.0.0.0');
console.log('HTTPS static server running on port 443');

// HTTP → HTTPS redirect server (port 80)
const redirectServer = serveRedirect({
  targetProtocol: 'https',
  statusCode: 301, // Permanent redirect
});

await redirectServer.listen(80, '0.0.0.0');
console.log('HTTP redirect server running on port 80');
```

See [HTTPS Configuration - HTTP to HTTPS Redirect Server](./https.md#http-to-https-redirect-server) for advanced HTTPs configuration options

##### Cache Control

Customize cache headers for pages and immutable assets:

```typescript
const server = new StaticWebServer({
  buildDir: './build/client',
  pageMapPath: 'page-map.json',
  cacheControl: 'public, max-age=3600', // Pages: 1 hour cache
  immutableCacheControl: 'public, max-age=31536000, immutable', // Fingerprinted assets: 1 year
});
```

Default cache behavior:

- **Pages**: `public, max-age=0, must-revalidate` (always revalidate)
- **Immutable assets**: `public, max-age=31536000, immutable` (1 year, never revalidate)
- **Error responses**: `no-store` (never cache)

##### Features

- Automatically maps clean URLs from page-map.json
- Handles 404/500 pages with proper status codes (error pages removed from normal routes)
- Serves static assets with correct MIME types
- Includes ETag caching and range request support
- Supports serving single assets (favicon, robots.txt) and asset folders
- Configurable cache control for pages and immutable assets
- HTTPS/SSL support
- Server-Side JavaScript Runtime-agnostic (works with Node.js, Bun, etc.)
- No React hydration mismatches

### Static Hosting Services

Some static hosting platforms automatically handle clean URLs. Check your provider's documentation for SSG support. Generally, you deploy your `build/client` directory and routes like `/about` should serve `about.html`.

### Apache (.htaccess)

```apache
# Enable URL rewriting
RewriteEngine On

# Remove .html extension from URLs
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^([^.]+)$ $1.html [NC,L]

# Redirect .html URLs to clean URLs
RewriteCond %{THE_REQUEST} /([^.]+)\.html
RewriteRule ^ /%1? [NC,L,R=301]

# Custom 404 page (if you generated one)
ErrorDocument 404 /404.html

# Optional: ensure trailing slashes do not break lookups
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.+)/$ /$1 [R=301,L]
```

### Nginx

```nginx
server {
    # ... other config

    location / {
        # Try exact file, then with .html extension, then directory, finally 404
        try_files $uri $uri.html $uri/ @fallback;
    }

    # Handle 404s with custom page
    location @fallback {
        try_files /404.html =404;
    }

    # Optional: Redirect .html URLs to clean URLs (301 permanent redirect)
    location ~ ^(.+)\.html$ {
        return 301 $1;
    }

    # Optional: Normalize trailing slashes to avoid mismatches
    location ~ ^(.+)/$ {
        return 301 $1;
    }

    # Ensure proper MIME types for assets
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Node.js/Express Static Server

```javascript
app.get('*', (req, res) => {
  // Map clean URLs ("/about") to built files ("/about.html")
  const requestedPath = req.path.endsWith('/')
    ? req.path.slice(0, -1)
    : req.path;
  const filePath = path.join(
    __dirname,
    'build/client',
    requestedPath + '.html',
  );

  // Security check: Prevent directory traversal
  const resolvedPath = path.resolve(filePath);
  const resolvedBuildDir = path.resolve(path.join(__dirname, 'build/client'));

  if (!resolvedPath.startsWith(resolvedBuildDir)) {
    return res.status(403).send('Access denied');
  }

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).sendFile(path.join(__dirname, 'build/client/404.html'));
  }
});
```

### PHP Router (for integrating SSG with PHP applications)

```php
// router.php - Simple router with SSG fallback
$requestPath = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Handle your PHP routes first
if ($requestPath === '/api/submit') {
    require __DIR__ . '/api/submit.php';
    exit();
}

if ($requestPath === '/admin') {
    require __DIR__ . '/admin/index.php';
    exit();
}

// Try to serve SSG page
$ssgPath = __DIR__ . '/build/client' . $requestPath . '.html';

// Security check: Prevent directory traversal
$realSsgPath = realpath($ssgPath);
$realBuildDir = realpath(__DIR__ . '/build/client');

if ($realSsgPath && $realBuildDir && strpos($realSsgPath, $realBuildDir) === 0 && file_exists($ssgPath)) {
    header('Content-Type: text/html');
    readfile($ssgPath);
    exit();
}

// Try to serve static assets
$assetPath = __DIR__ . '/build/client' . $requestPath;

// Security check: Prevent directory traversal
$realAssetPath = realpath($assetPath);

if ($realAssetPath && $realBuildDir && strpos($realAssetPath, $realBuildDir) === 0 && is_file($assetPath)) {
    // Basic MIME type detection
    $extension = strtolower(pathinfo($assetPath, PATHINFO_EXTENSION));
    $mimeTypes = [
        'css' => 'text/css',
        'js' => 'application/javascript',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'gif' => 'image/gif',
        'svg' => 'image/svg+xml',
        'ico' => 'image/x-icon',
    ];

    $mimeType = $mimeTypes[$extension] ?? 'application/octet-stream';
    header('Content-Type: ' . $mimeType);
    readfile($assetPath);
    exit();
}

// 404 - serve SSG 404 page if available
http_response_code(404);
$notFoundPath = __DIR__ . '/build/client/404.html';
if (file_exists($notFoundPath)) {
    readfile($notFoundPath);
} else {
    echo '404 Not Found';
}
exit();
```
