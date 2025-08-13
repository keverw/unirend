# Static Site Generation (SSG)

<!-- toc -->

- [Creating Generation Script](#creating-generation-script)
  - [Template Caching Info](#template-caching-info)
- [Serving Static Files](#serving-static-files)
  - [URL Mismatch Considerations](#url-mismatch-considerations)
  - [404 Pages Suggestion](#404-pages-suggestion)
  - [Static Hosting Services](#static-hosting-services)
  - [Apache (.htaccess)](#apache-htaccess)
  - [Nginx](#nginx)
  - [Node.js/Express Static Server](#nodejsexpress-static-server)
  - [PHP Router (for integrating SSG with PHP applications)](#php-router-for-integrating-ssg-with-php-applications)
  - [Custom Static Server (like our demo):](#custom-static-server-like-our-demo)

<!-- tocstop -->

**Static Site Generation (SSG)** allows you to pre-render your React pages at build time, creating static HTML files that can be served by any web server.

## Creating Generation Script

Create a script to generate your static pages using the `generateSSG` function:

> 💡 **Tip:** For a more comprehensive generation example script with detailed error handling and reporting, see [`demos/ssg/generate.ts`](../demos/ssg/generate.ts) in this repository.

```typescript
import { generateSSG } from "unirend/server";
import path from "path";

async function main() {
  // Point to the build directory (contains both client/ and server/ subdirectories)
  const buildDir = path.resolve(process.cwd(), "build");

  const pages = [
    // Server-rendered (SSG) pages
    { type: "ssg", path: "/", filename: "index.html" },
    { type: "ssg", path: "/about", filename: "about.html" },
    { type: "ssg", path: "/contact", filename: "contact.html" },

    // Client-rendered SPA pages with custom metadata
    {
      type: "spa",
      filename: "dashboard.html",
      title: "Dashboard",
      description: "SPA Dashboard Page",
    },
  ];

  const options = {
    serverEntry: "entry-ssg", // Default for SSG, customize if needed
    frontendAppConfig: {
      apiUrl: "https://api.example.com",
    },
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
    console.error("SSG generation failed:", result.fatalError.message);
    process.exit(1);
  }

  console.log(
    `Generated ${result.pagesReport.successCount} pages successfully!`,
  );
}

main().catch(console.error);
```

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
app.get("*", (req, res) => {
  // Map clean URLs ("/about") to built files ("/about.html")
  const requestedPath = req.path.endsWith("/")
    ? req.path.slice(0, -1)
    : req.path;
  const filePath = path.join(
    __dirname,
    "build/client",
    requestedPath + ".html",
  );

  // Security check: Prevent directory traversal
  const resolvedPath = path.resolve(filePath);
  const resolvedBuildDir = path.resolve(path.join(__dirname, "build/client"));

  if (!resolvedPath.startsWith(resolvedBuildDir)) {
    return res.status(403).send("Access denied");
  }

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).sendFile(path.join(__dirname, "build/client/404.html"));
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

### Custom Static Server (like our demo):

See [`demos/ssg/serve.ts`](../demos/ssg/serve.ts) for a complete example of a custom static server that handles clean URLs, asset serving, and 404 fallbacks.
