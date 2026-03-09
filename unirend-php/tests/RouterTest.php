<?php

declare(strict_types=1);

namespace Unirend\StaticServer\Tests;

use PHPUnit\Framework\TestCase;
use Unirend\StaticServer\Router;

class RouterTest extends TestCase
{
    public function testNoMatchReturnsNull(): void
    {
        $router = new Router();
        $this->assertNull($router->match('GET', '/about'));
    }

    public function testMatchesExactPath(): void
    {
        $router = new Router();
        $router->add('GET', '/about', fn() => null);

        $match = $router->match('GET', '/about');

        $this->assertNotNull($match);
        $this->assertEmpty($match['params']);
    }

    public function testNoMatchOnWrongMethod(): void
    {
        $router = new Router();
        $router->add('GET', '/about', fn() => null);

        $this->assertNull($router->match('POST', '/about'));
    }

    public function testMethodMatchingIsCaseInsensitive(): void
    {
        $router = new Router();
        $router->add('post', '/api/submit', fn() => null);

        $this->assertNotNull($router->match('POST', '/api/submit'));
    }

    public function testExtractsSingleNamedParam(): void
    {
        $router = new Router();
        $router->add('GET', '/posts/:id', fn() => null);

        $match = $router->match('GET', '/posts/42');

        $this->assertNotNull($match);
        $this->assertSame(['id' => '42'], $match['params']);
    }

    public function testExtractsMultipleNamedParams(): void
    {
        $router = new Router();
        $router->add('GET', '/posts/:postId/comments/:commentId', fn() => null);

        $match = $router->match('GET', '/posts/5/comments/99');

        $this->assertNotNull($match);
        $this->assertSame(
            ['postId' => '5', 'commentId' => '99'],
            $match['params'],
        );
    }

    public function testParamDoesNotMatchSlash(): void
    {
        $router = new Router();
        $router->add('GET', '/posts/:id', fn() => null);

        // :id should not swallow the next path segment
        $this->assertNull($router->match('GET', '/posts/5/comments'));
    }

    public function testMatchesFirstRegisteredRoute(): void
    {
        $router = new Router();
        $router->add('GET', '/about', fn() => 'first');
        $router->add('GET', '/about', fn() => 'second');

        $match = $router->match('GET', '/about');

        $this->assertNotNull($match);
        $this->assertSame('first', $match['handler']());
    }

    public function testSupportsDifferentMethodsOnSamePath(): void
    {
        $router = new Router();
        $router->add('GET', '/api/users', fn() => 'get-handler');
        $router->add('POST', '/api/users', fn() => 'post-handler');
        $router->add('PUT', '/api/users', fn() => 'put-handler');
        $router->add('DELETE', '/api/users', fn() => 'delete-handler');

        $this->assertSame(
            'get-handler',
            $router->match('GET', '/api/users')['handler'](),
        );

        $this->assertSame(
            'post-handler',
            $router->match('POST', '/api/users')['handler'](),
        );

        $this->assertSame(
            'put-handler',
            $router->match('PUT', '/api/users')['handler'](),
        );

        $this->assertSame(
            'delete-handler',
            $router->match('DELETE', '/api/users')['handler'](),
        );
    }

    public function testDuplicateMethodPathUsesFirstRegistered(): void
    {
        $router = new Router();
        $router->add('POST', '/api/submit', fn() => 'first-post');
        $router->add('POST', '/api/submit', fn() => 'second-post');

        $match = $router->match('POST', '/api/submit');

        $this->assertNotNull($match);
        $this->assertSame('first-post', $match['handler']());
    }

    public function testHasRoutesReturnsFalseWhenEmpty(): void
    {
        $router = new Router();
        $this->assertFalse($router->hasRoutes());
    }

    public function testHasRoutesReturnsTrueAfterAdd(): void
    {
        $router = new Router();
        $router->add('GET', '/', fn() => null);
        $this->assertTrue($router->hasRoutes());
    }

    public function testHandlerIsCallable(): void
    {
        $router = new Router();
        $router->add('POST', '/api/contact', function (): string {
            return 'called';
        });

        $match = $router->match('POST', '/api/contact');

        $this->assertNotNull($match);
        $result = $match['handler']();
        $this->assertSame('called', $result);
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    public function testPathsAreCaseSensitive(): void
    {
        $router = new Router();
        $router->add('GET', '/api/Users', fn() => 'uppercase');

        // Exact case matches
        $this->assertNotNull($router->match('GET', '/api/Users'));

        // Different case does NOT match
        $this->assertNull($router->match('GET', '/api/users'));
        $this->assertNull($router->match('GET', '/API/USERS'));
    }

    public function testMissingLeadingSlashIsNormalized(): void
    {
        $router = new Router();
        $router->add('GET', 'api/users', fn() => 'normalized');

        // Route registered without leading slash is auto-normalized to /api/users
        $this->assertNotNull($router->match('GET', '/api/users'));
        $this->assertSame(
            'normalized',
            $router->match('GET', '/api/users')['handler'](),
        );

        // Won't match without slash (since it was normalized to /api/users)
        $this->assertNull($router->match('GET', 'api/users'));
    }

    public function testTrailingSlashIsNormalized(): void
    {
        $router = new Router();
        $router->add('GET', '/users/', fn() => 'users-handler');
        $router->add('GET', '/posts', fn() => 'posts-handler');

        // Trailing slashes are normalized - both with and without slash match
        $this->assertNotNull($router->match('GET', '/users/'));
        $this->assertNotNull($router->match('GET', '/users'));
        $this->assertSame(
            'users-handler',
            $router->match('GET', '/users')['handler'](),
        );
        $this->assertSame(
            'users-handler',
            $router->match('GET', '/users/')['handler'](),
        );

        $this->assertNotNull($router->match('GET', '/posts'));
        $this->assertNotNull($router->match('GET', '/posts/'));
        $this->assertSame(
            'posts-handler',
            $router->match('GET', '/posts')['handler'](),
        );
        $this->assertSame(
            'posts-handler',
            $router->match('GET', '/posts/')['handler'](),
        );
    }

    public function testEmptyPathIsNormalizedToRoot(): void
    {
        $router = new Router();
        $router->add('GET', '', fn() => 'root');

        // Empty path is normalized to '/', so it matches root
        $this->assertNotNull($router->match('GET', '/'));
        $this->assertSame('root', $router->match('GET', '/')['handler']());

        // Won't match empty string (since it was normalized to /)
        $this->assertNull($router->match('GET', ''));
    }

    // -------------------------------------------------------------------------
    // Regex metacharacter safety in literal path segments
    // -------------------------------------------------------------------------

    public function testDotInPathIsLiteralNotWildcard(): void
    {
        $router = new Router();
        $router->add('GET', '/api/v1.0/status', fn() => 'versioned');

        // Exact match works
        $this->assertNotNull($router->match('GET', '/api/v1.0/status'));

        // '.' must NOT act as a wildcard — 'v1X0' must not match
        $this->assertNull($router->match('GET', '/api/v1X0/status'));
        $this->assertNull($router->match('GET', '/api/v100/status'));
    }

    public function testDotInPathWithParamIsLiteralNotWildcard(): void
    {
        $router = new Router();
        $router->add('GET', '/api/v1.0/posts/:id', fn() => 'versioned-post');

        $match = $router->match('GET', '/api/v1.0/posts/42');
        $this->assertNotNull($match);
        $this->assertSame(['id' => '42'], $match['params']);

        // '.' in the literal segment must not match other characters
        $this->assertNull($router->match('GET', '/api/v1X0/posts/42'));
    }

    public function testHashInPathDoesNotBreakRegex(): void
    {
        $router = new Router();

        // '#' is the preg delimiter — an unescaped '#' would break the pattern
        $router->add('GET', '/api/tags#featured', fn() => 'hash-route');

        // Exact match works (regex is not broken)
        $this->assertNotNull($router->match('GET', '/api/tags#featured'));

        // Must not match a different character in place of '#'
        $this->assertNull($router->match('GET', '/api/tagsXfeatured'));
    }

    public function testOtherRegexMetacharsInPathAreLiteral(): void
    {
        $router = new Router();
        // '(', ')', '+', '?' are all regex metacharacters
        $router->add('GET', '/api/search(v2)', fn() => 'search-v2');

        $this->assertNotNull($router->match('GET', '/api/search(v2)'));
        $this->assertNull($router->match('GET', '/api/searchXv2Y'));
    }
}
