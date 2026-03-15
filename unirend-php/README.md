# unirend/php-static-server

[![Packagist Version](https://img.shields.io/packagist/v/unirend/php-static-server)](https://packagist.org/packages/unirend/php-static-server)
[![Packagist Downloads](https://img.shields.io/packagist/dt/unirend/php-static-server)](https://packagist.org/packages/unirend/php-static-server)

**Current version:** `0.0.2`

Serve [Unirend](https://github.com/keverw/unirend) SSG output on shared hosting (cPanel, Apache). Mirrors `StaticWebServer` from the Node.js package — reads the same `page-map.json` format, serves clean URLs, handles 404/500 error pages with correct status codes, range requests, and custom API routes.

<!-- toc -->

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Options](#options)
  - [`singleAssets`](#singleassets)
  - [`assetFolders`](#assetfolders)
- [Error Pages](#error-pages)
- [Error Logging](#error-logging)
  - [Default Behavior (logErrors: true)](#default-behavior-logerrors-true)
  - [Custom Error Hook (onError)](#custom-error-hook-onerror)
  - [Disabling Error Logging](#disabling-error-logging)
  - [PHP Error Log Location](#php-error-log-location)
- [Custom Routes](#custom-routes)
  - [Route Path Normalization](#route-path-normalization)
  - [Request body parsing](#request-body-parsing)
- [Range Requests](#range-requests)
- [`.htaccess`](#htaccess)
- [Local Development](#local-development)
- [Versioning](#versioning)
- [Contributing to unirend-php](#contributing-to-unirend-php)
  - [Running tests](#running-tests)
  - [Running the demo locally](#running-the-demo-locally)
  - [Publishing a new version](#publishing-a-new-version)
- [License](#license)

<!-- tocstop -->

## Requirements

- PHP 8.1+
- Apache with `mod_rewrite` (standard on cPanel/shared hosting)

## Installation

```bash
composer require unirend/php-static-server
```

## Quick Start

1. Build your Unirend SSG project — this produces a `build/client/` directory with `page-map.json` inside.

2. Copy the templates into your hosting document root:

```bash
cp vendor/unirend/php-static-server/templates/index.php .
cp vendor/unirend/php-static-server/templates/.htaccess .
```

3. Edit `index.php` to point at your build directory:

```php
<?php
require_once __DIR__ . '/vendor/autoload.php';

use Unirend\StaticServer\StaticServer;

$server = new StaticServer([
  'buildDir' => __DIR__ . '/build/client',
]);

$server->serve();
```

4. Deploy `index.php`, `.htaccess`, `vendor/`, and `build/client/` to your host.

## Options

| Option                  | Type             | Default                                 | Description                                                                                                                                                                       |
| ----------------------- | ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildDir`              | `string`         | required                                | Absolute path to your SSG build directory                                                                                                                                         |
| `pageMapPath`           | `string`         | `'page-map.json'`                       | Path to page map, relative to `buildDir`                                                                                                                                          |
| `singleAssets`          | `array`          | `[]`                                    | Map individual files (favicon, robots.txt, etc.) — merged with page map, takes precedence on conflicts with page map and asset folders                                            |
| `assetFolders`          | `array`          | `[]`                                    | URL prefix → directory mappings for asset folders                                                                                                                                 |
| `notFoundPage`          | `string\|null`   | `null`                                  | Custom 404 page path, relative to `buildDir`                                                                                                                                      |
| `errorPage`             | `string\|null`   | `null`                                  | Custom 500 page path, relative to `buildDir`                                                                                                                                      |
| `cacheControl`          | `string`         | `'public, max-age=0, must-revalidate'`  | Cache-Control for HTML pages                                                                                                                                                      |
| `immutableCacheControl` | `string`         | `'public, max-age=31536000, immutable'` | Cache-Control for hashed assets                                                                                                                                                   |
| `detectImmutableAssets` | `bool`           | `true`                                  | Auto-detect content-hashed filenames                                                                                                                                              |
| `isDevelopment`         | `bool`           | `false`                                 | Show stack traces in default 500 error page HTML                                                                                                                                  |
| `logErrors`             | `bool`           | `true`                                  | Enable `error_log()` as the fallback when no `onError` hook is set (or when the hook throws)                                                                                      |
| `onError`               | `callable\|null` | `null`                                  | Custom error hook called with `(\Throwable $e, string $context)`. Fires regardless of `logErrors`. If the hook throws, falls back to `error_log()` only if `logErrors` is `true`. |

### `singleAssets`

Map individual URLs to files, useful for `robots.txt`, `favicon.ico`, etc.

```php
'singleAssets' => [
    '/robots.txt'  => 'robots.txt',
    '/favicon.ico' => 'favicon.ico',
    '/sitemap.xml' => 'sitemap.xml',
],
```

### `assetFolders`

Map URL prefixes to asset directories. Files with content hashes in their names (e.g. `app.abc123ef.js`) automatically get immutable `Cache-Control` headers.

```php
'assetFolders' => [
    '/assets' => 'assets',
],
```

## Error Pages

Error pages are loaded at startup using the same priority chain as the Node.js `StaticWebServer`:

1. `/404` or `/500` entry in `page-map.json` (your SSG-generated error page)
2. `notFoundPage` / `errorPage` option
3. `404.html` / `500.html` in `buildDir`
4. Built-in generic HTML fallback

If your SSG generates `/404` or `/500` pages, they are automatically removed from the normal route map so they can only be served via error handlers with the correct status codes.

## Error Logging

### Default Behavior (`logErrors: true`)

By default, exceptions are written to PHP's error log via `error_log()` before displaying error pages:

```php
$server = new StaticServer([
  'buildDir' => __DIR__ . '/build/client',
]);
// Exceptions are logged to PHP's error log automatically
```

### Custom Error Hook (`onError`)

Use `onError` to route errors to your own logging system instead of `error_log()`. The hook receives the exception and a context string describing where the error occurred (e.g. `'Custom route handler error'`):

```php
$server = new StaticServer([
  'buildDir' => __DIR__ . '/build/client',
  'onError' => function (\Throwable $e, string $context): void {
    // Send to your logging service, write to a custom log file, etc.
    myLogger()->error($context . ': ' . $e->getMessage(), [
      'exception' => $e,
    ]);
  },
]);
```

If the hook itself throws, the error is silently caught and `error_log()` is used as a fallback (unless `logErrors: false`) — the 500 response is still sent correctly.

### Disabling `error_log()` Fallback

Set `logErrors: false` to disable the built-in `error_log()` fallback. A custom `onError` hook will still fire if one is provided — `logErrors` only controls whether `error_log()` is used:

```php
$server = new StaticServer([
  'buildDir' => __DIR__ . '/build/client',
  'logErrors' => false, // Disables error_log() — onError hook still fires if set
]);
```

To suppress all error logging entirely, set `logErrors: false` and omit `onError`.

Error pages are always displayed normally regardless of logging configuration.

### PHP Error Log Location

Where `error_log()` writes depends on your PHP and server configuration:

- **cPanel/shared hosting**: Usually `~/logs/error_log` or the domain's error log in the control panel
- **Apache**: Typically `/var/log/apache2/error.log` or `/var/log/httpd/error_log`
- **PHP-FPM**: Configured via `error_log` in `php-fpm.conf`
- **Local dev** (`php -S`): Printed to the terminal

## Custom Routes

Add API endpoints or other server-side logic before calling `serve()`. Custom routes are checked before static file lookup, so they can also override static pages if needed.

**Note:** Custom route handlers are responsible for setting their own headers (Content-Type, Cache-Control, etc.). Only static files served from the page map or asset folders get automatic cache headers.

### Route Path Normalization

Routes are automatically normalized for convenience:

- **Empty paths** (`''`) are treated as root (`'/'`)
- **Missing leading slashes** are added automatically (`'api/users'` → `'/api/users'`)
- **Trailing slashes** are removed for flexible matching (`'/users/'` → `'/users'`)
  - Both `/users` and `/users/` will match the same route
- **HTTP methods** are case-insensitive (`'get'` and `'GET'` both work)
- **Paths** are case-sensitive (`'/api/Users'` ≠ `'/api/users'`)

**Design Note:** This is more forgiving than the default TypeScript/Fastify implementation. Since PHP executes per-request rather than as a long-running server, we normalize paths instead of throwing errors to avoid production outages from configuration mistakes.

```php
$server = new StaticServer([
  'buildDir' => __DIR__ . '/build/client',
  'assetFolders' => ['/assets' => 'assets'],
]);

// Simple endpoint
$server->addRoute('POST', '/api/contact', function (
  array $params,
  array $body,
): void {
  // $body is parsed from JSON body or $_POST
  $name = $body['name'] ?? 'stranger';

  // send email, save to DB, etc.

  header('Content-Type: application/json');
  echo json_encode(['ok' => true]);
});

// Dynamic route with named :param segments
$server->addRoute('GET', '/api/posts/:id', function (
  array $params,
  array $body,
): void {
  $id = (int) $params['id'];
  header('Content-Type: application/json');
  echo json_encode(['id' => $id]);
});

// Start serving requests — handles routing, static files, and error pages
// (Your web server with PHP handles the actual HTTP listening)
$server->serve();
```

### Request body parsing

The `$body` parameter in route handlers is parsed automatically based on the request's `Content-Type`:

- `application/json` — decoded from the raw input stream
- `application/x-www-form-urlencoded` — from `$_POST`

## Range Requests

Supports HTTP range requests for video/audio seeking and resumable downloads. Single-range requests (`Range: bytes=0-499`, `Range: bytes=500-`, `Range: bytes=-500`) return `206 Partial Content`. Multipart range requests are not supported and return `416 Range Not Satisfiable`.

## `.htaccess`

The included `.htaccess` routes all requests through `index.php`:

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.php [L]
```

Note there is **no** `!-f` condition. This means raw `.html` files are never served directly by Apache — all requests go through `index.php`. This prevents React hydration mismatches that would occur if a user accessed `/about.html` instead of `/about`.

## Local Development

PHP's built-in server works for local testing (`.htaccess` rules don't apply, but all requests go through `index.php` automatically).

```bash
php -S localhost:8080 index.php
```

## Versioning

This package is versioned independently from the `unirend` npm package. It targets a specific use case (PHP shared hosting) and changes less frequently — version numbers will not match between the two.

## Contributing to unirend-php

The canonical source for this package is the [unirend monorepo](https://github.com/keverw/unirend) — open issues and PRs there. The repository at [github.com/keverw/unirend-php](https://github.com/keverw/unirend-php) is a publish-only mirror that Packagist reads from; do not commit to it directly.

### Running tests

From the monorepo root:

Install PHP dependencies (first time, or after dependency changes):

```bash
bun run php-install-deps
```

Run tests:

```bash
bun run php-test
```

### Running the demo locally

A minimal demo site is included in the monorepo under `unirend-php/demo/` for development and testing purposes. It exercises clean URLs, a custom 404, an immutable-cached asset, and custom routes.

**Note:** The demo is not included in the published Composer package — it's only available in the [monorepo](https://github.com/keverw/unirend).

```bash
cd unirend-php
composer install
cd demo
php -S localhost:8080 index.php
```

Open [http://localhost:8080](http://localhost:8080) and explore the links listed on the home page.

### Publishing a new version

1. Update `unirend-php/version.json` with the new version number.
2. Run the publish script from the monorepo root:

```bash
bun run php-publish
```

The script clones the mirror repo, syncs files (excluding `vendor/`, `demo/`, `version.json`, etc.), updates the version line in this README, commits `Release vX.Y.Z`, tags it, and pushes — which triggers Packagist to update automatically via webhook.

## License

MIT
