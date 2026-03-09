<?php

declare(strict_types=1);

/**
 * Development demo for unirend/php-static-server.
 *
 * Run from this directory:
 *   cd unirend-php/demo
 *   php -S localhost:8080 index.php
 *
 * Then open:
 *   http://localhost:8080        — Home page (clean URL)
 *   http://localhost:8080/about  — About page (clean URL)
 *   http://localhost:8080/nope   — Custom 404 page
 *   http://localhost:8080/assets/app.abc123ef.js — Immutable-cached asset
 *   http://localhost:8080/robots.txt — Single asset mapping
 *
 *   POST http://localhost:8080/api/contact  — Custom route example
 *     body: {"name": "Alice"}
 */

// Use the vendor/ directory from the parent unirend-php/ directory.
require_once __DIR__ . '/../vendor/autoload.php';

use Unirend\StaticServer\StaticServer;

$server = new StaticServer([
    'buildDir' => __DIR__ . '/build/client',
    'assetFolders' => ['/assets' => 'assets'],
    'singleAssets' => ['/robots.txt' => 'robots.txt'],
    'isDevelopment' => true, // Show stack traces in default error page HTML (when no custom error page is provided)
]);

// Example custom POST route (e.g. contact form, API endpoint)
$server->addRoute('POST', '/api/contact', function (
    array $params,
    array $body,
): void {
    $name = $body['name'] ?? 'stranger';

    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'message' => "Hello, {$name}!"]);
});

// Example route that throws — triggers the 500 error handler (shows stack trace in isDevelopment mode)
$server->addRoute('GET', '/trigger-500', function (
    array $params,
    array $body,
): void {
    throw new \RuntimeException('This is a demo 500 error.');
});

// Example dynamic route with a named :param segment
$server->addRoute('GET', '/api/posts/:id', function (
    array $params,
    array $body,
): void {
    $id = (int) $params['id'];

    header('Content-Type: application/json');
    echo json_encode(['id' => $id, 'title' => "Post #{$id}"]);
});

// Start serving requests — handles routing, static files, and error pages
// (Your web server with PHP handles the actual HTTP listening)
$server->serve();
