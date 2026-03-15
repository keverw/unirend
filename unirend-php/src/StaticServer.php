<?php

declare(strict_types=1);

namespace Unirend\StaticServer;

/**
 * PHP static file server for Unirend SSG output.
 *
 * Mirrors StaticWebServer from the Node.js package. Reads page-map.json,
 * serves clean URLs, handles error pages with correct status codes,
 * supports range requests and custom API routes.
 *
 * Usage — copy templates/index.php to your project root:
 *
 *   $server = new StaticServer([
 *       'buildDir'    => __DIR__ . '/build/client',
 *       'pageMapPath' => 'page-map.json',
 *       'assetFolders' => ['/assets' => 'assets'],
 *       'singleAssets' => ['/robots.txt' => 'robots.txt'],
 *   ]);
 *
 *   $server->addRoute('POST', '/api/contact', function(array $params, array $body) {
 *       header('Content-Type: application/json');
 *       echo json_encode(['ok' => true]);
 *   });
 *
 *   $server->serve();
 */
class StaticServer
{
    /** @var array<string, mixed> */
    private array $options;

    private Router $router;

    /** @var array<string, string> URL path → absolute file path */
    private array $pageMap = [];

    private ?string $notFoundHtml = null;
    private ?string $errorHtml = null;

    /** @var array<string, mixed> */
    private const DEFAULTS = [
        'buildDir' => '',
        'pageMapPath' => 'page-map.json',
        'singleAssets' => [],
        'assetFolders' => [],
        'notFoundPage' => null,
        'errorPage' => null,
        'cacheControl' => 'public, max-age=0, must-revalidate',
        'immutableCacheControl' => 'public, max-age=31536000, immutable',
        'detectImmutableAssets' => true,
        'isDevelopment' => false,
        'logErrors' => true,
        'onError' => null,
    ];

    /**
     * @param array<string, mixed> $options
     */
    public function __construct(array $options)
    {
        if (empty($options['buildDir']) || !is_string($options['buildDir'])) {
            throw new \InvalidArgumentException(
                'StaticServer: buildDir is required and must be a non-empty string',
            );
        }

        if (
            isset($options['pageMapPath']) &&
            (!is_string($options['pageMapPath']) ||
                $options['pageMapPath'] === '')
        ) {
            throw new \InvalidArgumentException(
                'StaticServer: pageMapPath must be a non-empty string',
            );
        }

        if (
            isset($options['notFoundPage']) &&
            !is_string($options['notFoundPage'])
        ) {
            throw new \InvalidArgumentException(
                'StaticServer: notFoundPage must be a string',
            );
        }

        if (isset($options['errorPage']) && !is_string($options['errorPage'])) {
            throw new \InvalidArgumentException(
                'StaticServer: errorPage must be a string',
            );
        }

        if (
            isset($options['onError']) &&
            $options['onError'] !== null &&
            !is_callable($options['onError'])
        ) {
            throw new \InvalidArgumentException(
                'StaticServer: onError must be a callable or null',
            );
        }

        if (
            isset($options['singleAssets']) &&
            (!is_array($options['singleAssets']) ||
                (!empty($options['singleAssets']) &&
                    array_is_list($options['singleAssets'])))
        ) {
            throw new \InvalidArgumentException(
                'StaticServer: singleAssets must be an associative array',
            );
        }

        if (isset($options['singleAssets'])) {
            foreach ($options['singleAssets'] as $urlPath => $filePath) {
                if (!is_string($urlPath) || !is_string($filePath)) {
                    throw new \InvalidArgumentException(
                        'StaticServer: singleAssets keys and values must be strings',
                    );
                }
            }
        }

        if (
            isset($options['assetFolders']) &&
            (!is_array($options['assetFolders']) ||
                (!empty($options['assetFolders']) &&
                    array_is_list($options['assetFolders'])))
        ) {
            throw new \InvalidArgumentException(
                'StaticServer: assetFolders must be an associative array',
            );
        }

        if (isset($options['assetFolders'])) {
            foreach ($options['assetFolders'] as $urlPrefix => $fsPath) {
                if (!is_string($urlPrefix) || !is_string($fsPath)) {
                    throw new \InvalidArgumentException(
                        'StaticServer: assetFolders keys and values must be strings',
                    );
                }
            }
        }

        $this->options = array_merge(self::DEFAULTS, $options);
        $this->router = new Router();
    }

    /**
     * Register a custom route. Checked before static file lookup.
     *
     * The handler receives (array $params, array $body) where:
     *   $params — named :param segments from the URL
     *   $body   — parsed request body ($_POST or JSON-decoded input stream)
     *
     * Example:
     *   $server->addRoute('POST', '/api/contact', function(array $params, array $body) {
     *       header('Content-Type: application/json');
     *       echo json_encode(['ok' => true]);
     *   });
     */
    public function addRoute(
        string $method,
        string $path,
        callable $handler,
    ): void {
        $this->router->add($method, $path, $handler);
    }

    /**
     * Load page-map.json, resolve error pages, and handle the current request.
     * Call this once at the bottom of your index.php.
     */
    public function serve(): void
    {
        $this->buildMaps();
        $this->dispatch();
    }

    // -------------------------------------------------------------------------
    // Private — core logic
    // -------------------------------------------------------------------------

    /**
     * Read page-map.json, resolve singleAssets overrides, and load error pages.
     * Mirrors StaticWebServer::buildMaps() from the Node.js package.
     */
    private function buildMaps(): void
    {
        $buildDir = $this->options['buildDir'];

        // 1. Load and validate page-map.json
        $pageMapPath = $buildDir . '/' . $this->options['pageMapPath'];

        if (!is_file($pageMapPath)) {
            throw new \RuntimeException(
                "StaticServer: page-map.json not found at: {$pageMapPath}",
            );
        }

        $json = file_get_contents($pageMapPath);

        if ($json === false) {
            throw new \RuntimeException(
                "StaticServer: failed to read page-map.json at: {$pageMapPath}",
            );
        }

        $raw = json_decode(
            $json,
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );

        if (!is_array($raw) || (!empty($raw) && array_is_list($raw))) {
            throw new \RuntimeException(
                'StaticServer: invalid page-map.json — expected a JSON object',
            );
        }

        // 2. Build URL → absolute path map from page-map entries
        $assetMap = [];

        foreach ($raw as $urlPath => $filename) {
            if (!is_string($urlPath) || !is_string($filename)) {
                throw new \RuntimeException(
                    'StaticServer: invalid page-map.json — keys and values must be strings',
                );
            }

            // Use realpath to safely resolve paths (handles leading slashes, prevents traversal)
            $resolved = realpath($buildDir . '/' . ltrim($filename, '/'));
            if ($resolved !== false) {
                $assetMap[$urlPath] = $resolved;
            }
        }

        // 3. Merge user-provided singleAssets (can override page-map entries)
        foreach ($this->options['singleAssets'] as $urlPath => $filePath) {
            // Use realpath to safely resolve paths (handles leading slashes, prevents traversal)
            $resolved = realpath($buildDir . '/' . ltrim($filePath, '/'));
            if ($resolved !== false) {
                $assetMap[$urlPath] = $resolved;
            }
        }

        // 4. Load error pages — same priority chain as Node version:
        //    (a) page-map entry at /404 or /500 (already in memory)
        //    (b) custom notFoundPage / errorPage option
        //    (c) 404.html / 500.html in buildDir
        //    (d) null — falls back to built-in default HTML
        $notFoundResult = $this->loadErrorPageHtml(
            $this->options['notFoundPage'],
            $assetMap['/404'] ?? null,
            '404.html',
        );

        $errorResult = $this->loadErrorPageHtml(
            $this->options['errorPage'],
            $assetMap['/500'] ?? null,
            '500.html',
        );

        // 5. Remove error page routes from normal page map so they can only
        //    be served via error handlers (with the correct 404/500 status code).
        $errorFilePaths = array_filter([
            $notFoundResult['filePath'] ?? null,
            $errorResult['filePath'] ?? null,
        ]);

        foreach (array_keys($assetMap) as $url) {
            if (in_array($assetMap[$url], $errorFilePaths, true)) {
                unset($assetMap[$url]);
            }
        }

        $this->pageMap = $assetMap;
        $this->notFoundHtml = $notFoundResult['html'] ?? null;
        $this->errorHtml = $errorResult['html'] ?? null;
    }

    /**
     * Route the current request:
     *   1. Custom routes (addRoute)
     *   2. Page map  (HTML pages from page-map.json + singleAssets)
     *   3. Asset folders (assetFolders option)
     *   4. 404
     */
    private function dispatch(): void
    {
        $method = $this->requestMethod();
        $path = $this->requestPath();

        // 1. Custom routes — checked first so users can override anything
        if ($this->router->hasRoutes()) {
            $match = $this->router->match($method, $path);

            if ($match !== null) {
                try {
                    $match['handler']($match['params'], $this->requestBody());
                } catch (\Throwable $e) {
                    $this->logError($e, 'Custom route handler error');
                    $this->send500($e);
                }
                return;
            }
        }

        // 2. Page map — only GET/HEAD serve HTML pages
        if (
            in_array($method, ['GET', 'HEAD'], true) &&
            isset($this->pageMap[$path])
        ) {
            $filePath = $this->pageMap[$path];

            try {
                (new FileServer())->serve(
                    $filePath,
                    $this->options['cacheControl'],
                );
            } catch (\Throwable $e) {
                $this->logError($e, 'Page serving error');
                $this->send500($e);
            }

            return;
        }

        // 3. Asset folders — prefix-matched, immutable cache detection
        if (in_array($method, ['GET', 'HEAD'], true)) {
            foreach (
                $this->options['assetFolders']
                as $urlPrefix => $fsRelPath
            ) {
                if (!str_starts_with($path, $urlPrefix)) {
                    continue;
                }

                $assetDir = realpath(
                    $this->options['buildDir'] . '/' . $fsRelPath,
                );

                if ($assetDir === false) {
                    continue;
                }

                $remainder = substr($path, strlen($urlPrefix));
                $absPath = $assetDir . $remainder;

                $safePath = FileServer::safePath($absPath, $assetDir);

                if ($safePath === null) {
                    break; // file not found in this folder — fall through to 404
                }

                $detectImmutable =
                    (bool) ($this->options['detectImmutableAssets'] ?? true);

                $isImmutable =
                    $detectImmutable && FileServer::isImmutableAsset($safePath);

                $cacheControl = $isImmutable
                    ? $this->options['immutableCacheControl']
                    : $this->options['cacheControl'];

                try {
                    (new FileServer())->serve($safePath, $cacheControl);
                } catch (\Throwable $e) {
                    $this->logError($e, 'Asset serving error');
                    $this->send500($e);
                }
                return;
            }
        }

        // 4. Nothing matched
        $this->send404();
    }

    /**
     * Load an error page HTML file using the same priority chain as the Node version.
     *
     * @param string|null $customPath  Path relative to buildDir from options
     * @param string|null $pageMapPath Absolute path from the page map (/404 or /500 entry)
     * @param string      $defaultFilename  e.g. '404.html' — checked in buildDir as last resort
     * @return array{html: string, filePath: string}|null
     */
    private function loadErrorPageHtml(
        ?string $customPath,
        ?string $pageMapPath,
        string $defaultFilename,
    ): ?array {
        $buildDir = $this->options['buildDir'];

        // (a) Page map entry already in memory (most efficient — no extra disk read).
        //     $pageMapPath is already the value stored in $assetMap, so returning it
        //     directly ensures the in_array() exclusion check on line ~230 always matches.
        if ($pageMapPath !== null && is_file($pageMapPath)) {
            $html = file_get_contents($pageMapPath);

            if ($html !== false) {
                return ['html' => $html, 'filePath' => $pageMapPath];
            }
        }

        // (b) Custom path from options
        if ($customPath !== null) {
            // Use realpath to safely resolve paths (handles leading slashes, prevents traversal)
            $full = realpath($buildDir . '/' . ltrim($customPath, '/'));
            if ($full !== false && is_file($full)) {
                $html = file_get_contents($full);
                if ($html !== false) {
                    return ['html' => $html, 'filePath' => $full];
                }
            }
        }

        // (c) Default filename in buildDir
        $default = realpath($buildDir . '/' . $defaultFilename);
        if ($default !== false && is_file($default)) {
            $html = file_get_contents($default);
            if ($html !== false) {
                return ['html' => $html, 'filePath' => $default];
            }
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Private — request helpers
    // -------------------------------------------------------------------------

    private function requestMethod(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    private function requestPath(): string
    {
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH);
        return is_string($path) ? $path : '/';
    }

    /**
     * Parse the request body into an associative array.
     * Supports application/json and application/x-www-form-urlencoded.
     *
     * @return array<string, mixed>
     */
    private function requestBody(): array
    {
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';

        if (str_contains($contentType, 'application/json')) {
            $raw = file_get_contents('php://input');

            if ($raw === false || $raw === '') {
                return [];
            }

            try {
                $decoded = json_decode(
                    $raw,
                    associative: true,
                    flags: JSON_THROW_ON_ERROR,
                );

                return is_array($decoded) ? $decoded : [];
            } catch (\JsonException) {
                return [];
            }
        }

        return $_POST;
    }

    // -------------------------------------------------------------------------
    // Private — error responses
    // -------------------------------------------------------------------------

    /**
     * Log an error to PHP's error log if logErrors option is enabled.
     * This ensures exceptions are written to server logs even when custom
     * error pages are displayed.
     */
    private function logError(\Throwable $e, string $context = ''): void
    {
        $logErrors = (bool) ($this->options['logErrors'] ?? true);
        $onError = $this->options['onError'] ?? null;

        // Custom hook always fires when provided (regardless of logErrors)
        if (is_callable($onError)) {
            try {
                $onError($e, $context);
                return;
            } catch (\Throwable) {
                // Hook itself threw — fall back to error_log only if logErrors is enabled
                if (!$logErrors) {
                    return;
                }
            }
        } elseif (!$logErrors) {
            // No hook and logging disabled — nothing to do
            return;
        }

        $prefix = $context ? "{$context}: " : '';

        // Use PHP's native exception string representation (includes message, file, line, and stack trace)
        error_log($prefix . (string) $e);
    }

    private function send404(): void
    {
        $isHead = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD';

        try {
            http_response_code(404);
            header('Content-Type: text/html; charset=utf-8');

            if (!$isHead) {
                echo $this->notFoundHtml ?? self::default404Html();
            }
        } catch (\Throwable $e) {
            // Error handler itself failed - use absolute minimal fallback
            http_response_code(404);

            if (!$isHead) {
                echo '404 Not Found';
            }
        }
    }

    private function send500(\Throwable $e): void
    {
        $isHead = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD';

        try {
            http_response_code(500);
            header('Content-Type: text/html; charset=utf-8');
            $isDev = (bool) ($this->options['isDevelopment'] ?? false);

            if (!$isHead) {
                echo $this->errorHtml ?? self::default500Html($isDev, $e);
            }
        } catch (\Throwable $fallbackError) {
            // Error handler itself failed - use absolute minimal fallback
            http_response_code(500);

            if (!$isHead) {
                echo '500 Internal Server Error';
            }
        }
    }

    private static function default404Html(): string
    {
        return <<<HTML
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>404 Not Found</title></head>
        <body><h1>404 Not Found</h1><p>The page you requested could not be found.</p></body>
        </html>
        HTML;
    }

    private static function default500Html(
        bool $isDevelopment,
        ?\Throwable $e = null,
    ): string {
        $trace = '';
        if ($isDevelopment && $e !== null) {
            $trace =
                '<pre>' .
                htmlspecialchars(
                    $e->getMessage() . "\n\n" . $e->getTraceAsString(),
                    ENT_QUOTES | ENT_SUBSTITUTE,
                    'UTF-8',
                ) .
                '</pre>';
        }

        return <<<HTML
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>500 Internal Server Error</title></head>
        <body><h1>500 Internal Server Error</h1><p>An error occurred while processing your request.</p>{$trace}</body>
        </html>
        HTML;
    }
}
