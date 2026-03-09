<?php

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use Unirend\StaticServer\StaticServer;

$server = new StaticServer([
    // Path to your Unirend SSG build output (must contain page-map.json)
    'buildDir' => __DIR__ . '/build/client',

    // All options below are optional — shown with their defaults:
    // 'pageMapPath'           => 'page-map.json',
    // 'assetFolders'          => ['/assets' => 'assets'],
    // 'singleAssets'          => ['/robots.txt' => 'robots.txt'],
    // 'notFoundPage'          => null,   // custom 404, relative to buildDir
    // 'errorPage'             => null,   // custom 500, relative to buildDir
    // 'cacheControl'          => 'public, max-age=0, must-revalidate',
    // 'immutableCacheControl' => 'public, max-age=31536000, immutable',
    // 'detectImmutableAssets' => true,
    // 'isDevelopment'         => false,  // set true locally to see 500 stack traces
    // 'logErrors'             => true,   // log exceptions to PHP's error log
]);

// Optional: add custom routes before serve().
// Checked before static file lookup — useful for form submissions, APIs, etc.
//
// $server->addRoute('POST', '/api/contact', function(array $params, array $body): void {
//     $name = $body['name'] ?? 'stranger';
//     // send email, save to DB, etc.
//     header('Content-Type: application/json');
//     echo json_encode(['ok' => true]);
// });

// Start serving requests — handles routing, static files, and error pages
// (Your web server with PHP handles the actual HTTP listening)
$server->serve();
