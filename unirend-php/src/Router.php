<?php

declare(strict_types=1);

namespace Unirend\StaticServer;

/**
 * Minimal router for custom user-defined routes.
 *
 * Supports named :param segments, e.g.:
 *   /api/posts/:id          → params['id']
 *   /api/posts/:id/comments → params['id']
 *
 * Routes are checked in registration order.
 * HTTP method matching is case-insensitive ('get' and 'GET' both work).
 */
class Router
{
    /** @var list<array{method: string, pattern: string, params: list<string>, handler: callable}> */
    private array $routes = [];

    public function add(string $method, string $path, callable $handler): void
    {
        // Normalize path: treat empty string as root
        if ($path === '') {
            $path = '/';
        }

        // Normalize path: ensure leading slash
        if (!str_starts_with($path, '/')) {
            $path = '/' . $path;
        }

        // Normalize path: remove trailing slash (except for root "/")
        if ($path !== '/' && str_ends_with($path, '/')) {
            $path = rtrim($path, '/');
        }

        $params = [];

        // Split on :param tokens, capturing each param name as an odd-indexed element.
        // Even-indexed elements are literal path segments that must be quoted so regex
        // metacharacters (e.g. '.' in '/api/v1.0/', '#' which is our delimiter) are
        // treated as literals rather than pattern syntax.
        /** @var list<string> $parts */
        $parts = preg_split(
            '/:([a-zA-Z_][a-zA-Z0-9_]*)/',
            $path,
            -1,
            PREG_SPLIT_DELIM_CAPTURE,
        );

        $pattern = '';

        for ($i = 0, $count = count($parts); $i < $count; $i++) {
            if ($i % 2 === 0) {
                $pattern .= preg_quote($parts[$i], '#');
            } else {
                $params[] = $parts[$i];
                $pattern .= '([^/]+)';
            }
        }

        $this->routes[] = [
            'method' => strtoupper($method),
            'pattern' => '#^' . $pattern . '$#',
            'params' => $params,
            'handler' => $handler,
        ];
    }

    /**
     * @return array{handler: callable, params: array<string, string>}|null
     */
    public function match(string $method, string $path): ?array
    {
        $method = strtoupper($method);

        // Normalize incoming path: remove trailing slash (except for root "/")
        if ($path !== '/' && str_ends_with($path, '/')) {
            $path = rtrim($path, '/');
        }

        foreach ($this->routes as $route) {
            if ($route['method'] !== $method) {
                continue;
            }

            if (!preg_match($route['pattern'], $path, $matches)) {
                continue;
            }

            array_shift($matches); // remove full match, keep capture groups

            /** @var array<string, string> $params */
            $params = !empty($route['params'])
                ? array_combine($route['params'], $matches)
                : [];

            return ['handler' => $route['handler'], 'params' => $params];
        }

        return null;
    }

    public function hasRoutes(): bool
    {
        return !empty($this->routes);
    }
}
