<?php

declare(strict_types=1);

namespace Unirend\StaticServer\Tests;

use PHPUnit\Framework\TestCase;
use Unirend\StaticServer\StaticServer;

class StaticServerTest extends TestCase
{
    private string $buildDir;

    protected function setUp(): void
    {
        $this->buildDir = realpath(__DIR__ . '/fixtures/build');

        // Reset HTTP state before each test
        http_response_code(200);
        unset(
            $_SERVER['REQUEST_METHOD'],
            $_SERVER['REQUEST_URI'],
            $_SERVER['HTTP_IF_NONE_MATCH'],
            $_SERVER['HTTP_RANGE'],
            $_SERVER['CONTENT_TYPE'],
        );
        $_POST = [];
    }

    // -------------------------------------------------------------------------
    // Constructor validation
    // -------------------------------------------------------------------------

    public function testConstructorRequiresBuildDir(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/buildDir/');

        new StaticServer([]);
    }

    public function testConstructorRequiresBuildDirToBeString(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new StaticServer(['buildDir' => 123]);
    }

    public function testConstructorAcceptsValidOptions(): void
    {
        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'pageMapPath' => 'page-map.json',
        ]);

        $this->assertInstanceOf(StaticServer::class, $server);
    }

    public function testConstructorRejectsBadNotFoundPage(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new StaticServer([
            'buildDir' => $this->buildDir,
            'notFoundPage' => 123,
        ]);
    }

    public function testConstructorRejectsBadErrorPage(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new StaticServer([
            'buildDir' => $this->buildDir,
            'errorPage' => ['not', 'a', 'string'],
        ]);
    }

    public function testConstructorRejectsListSingleAssets(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new StaticServer([
            'buildDir' => $this->buildDir,
            'singleAssets' => ['robots.txt'], // list, not associative
        ]);
    }

    public function testConstructorAcceptsEmptySingleAssets(): void
    {
        // In PHP, array_is_list([]) === true, so an empty array must not be
        // rejected by the "must be associative" guard.
        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'singleAssets' => [],
        ]);

        $this->assertInstanceOf(StaticServer::class, $server);
    }

    public function testConstructorRejectsListAssetFolders(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => ['assets'], // list, not associative
        ]);
    }

    public function testConstructorAcceptsEmptyAssetFolders(): void
    {
        // Same empty-array edge case as singleAssets.
        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => [],
        ]);

        $this->assertInstanceOf(StaticServer::class, $server);
    }

    public function testAddRouteDoesNotThrow(): void
    {
        $server = new StaticServer(['buildDir' => $this->buildDir]);

        $this->expectNotToPerformAssertions();

        $server->addRoute('POST', '/api/contact', fn() => null);
    }

    // -------------------------------------------------------------------------
    // buildMaps — tested via Reflection (private method)
    // -------------------------------------------------------------------------

    public function testBuildMapsLoadsPageMap(): void
    {
        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $this->callBuildMaps($server);

        $pageMap = $this->getProperty($server, 'pageMap');

        $this->assertArrayHasKey('/', $pageMap);
        $this->assertArrayHasKey('/about', $pageMap);
        $this->assertStringEndsWith('index.html', $pageMap['/']);
        $this->assertStringEndsWith('about.html', $pageMap['/about']);
    }

    public function testBuildMapsRemovesNotFoundRouteFromPageMap(): void
    {
        // /404 is in page-map.json — must be removed from normal routes
        // so it is never served with a 200 status code
        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $this->callBuildMaps($server);

        $pageMap = $this->getProperty($server, 'pageMap');

        $this->assertArrayNotHasKey('/404', $pageMap);
    }

    public function testBuildMapsRemovesErrorRouteFromPageMap(): void
    {
        // /500 is in page-map.json — must be removed from normal routes
        // so it is never served with a 200 status code
        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $this->callBuildMaps($server);

        $pageMap = $this->getProperty($server, 'pageMap');

        $this->assertArrayNotHasKey('/500', $pageMap);
    }

    public function testBuildMapsLoadsNotFoundHtml(): void
    {
        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $this->callBuildMaps($server);

        $notFoundHtml = $this->getProperty($server, 'notFoundHtml');

        $this->assertNotNull($notFoundHtml);
        $this->assertStringContainsString('404 fixture', $notFoundHtml);
    }

    public function testBuildMapsLoadsErrorHtml(): void
    {
        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $this->callBuildMaps($server);

        $errorHtml = $this->getProperty($server, 'errorHtml');

        $this->assertNotNull($errorHtml);
        $this->assertStringContainsString('500 fixture', $errorHtml);
    }

    public function testBuildMapsSingleAssetsAddToPageMap(): void
    {
        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'singleAssets' => ['/robots.txt' => 'robots.txt'],
        ]);

        $this->callBuildMaps($server);

        $pageMap = $this->getProperty($server, 'pageMap');

        $this->assertArrayHasKey('/robots.txt', $pageMap);
        $this->assertStringEndsWith('robots.txt', $pageMap['/robots.txt']);
    }

    public function testBuildMapsSingleAssetsOverridePageMap(): void
    {
        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'singleAssets' => ['/' => 'about.html'],
        ]);
        $this->callBuildMaps($server);

        $pageMap = $this->getProperty($server, 'pageMap');

        $this->assertStringEndsWith('about.html', $pageMap['/']);
    }

    public function testBuildMapsThrowsOnMissingPageMap(): void
    {
        $server = new StaticServer(['buildDir' => '/nonexistent/path']);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/page-map\.json not found/');

        $this->callBuildMaps($server);
    }

    public function testBuildMapsThrowsOnInvalidJsonStructure(): void
    {
        $buildDir = realpath(__DIR__ . '/fixtures/build-invalid-json');

        $server = new StaticServer(['buildDir' => $buildDir]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/expected a JSON object/');

        $this->callBuildMaps($server);
    }

    public function testBuildMapsAcceptsEmptyPageMap(): void
    {
        // An empty JSON object {} decoded by json_decode() produces [] in PHP.
        // array_is_list([]) === true, so without the empty-array guard this
        // would incorrectly throw "expected a JSON object".
        $buildDir = realpath(__DIR__ . '/fixtures/build-empty-page-map');

        $server = new StaticServer(['buildDir' => $buildDir]);

        // Should not throw — an empty page map is valid (no pages yet).
        $this->callBuildMaps($server);

        $pageMap = $this->getProperty($server, 'pageMap');
        $this->assertSame([], $pageMap);
    }

    public function testBuildMapsThrowsOnMalformedJson(): void
    {
        $buildDir = realpath(__DIR__ . '/fixtures/build-malformed-json');

        $server = new StaticServer(['buildDir' => $buildDir]);

        $this->expectException(\JsonException::class);

        $this->callBuildMaps($server);
    }

    // -------------------------------------------------------------------------
    // dispatch — tested via $_SERVER mocking + output buffering
    // -------------------------------------------------------------------------

    public function testDispatchServesIndexPage(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('Home page fixture', $output);
    }

    public function testDispatchServesAboutPage(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/about';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('About page fixture', $output);
    }

    public function testDispatchReturns404ForUnknownRoute(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/nonexistent';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(404, http_response_code());
        $this->assertStringContainsString('404 fixture', $output);
    }

    public function testDispatchDoesNotServeHtmlPagesWithPost(): void
    {
        // POST to a page-map URL must 404, not serve the HTML with 200
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/about';

        $this->capture(new StaticServer(['buildDir' => $this->buildDir]));

        $this->assertSame(404, http_response_code());
    }

    public function testDispatchServesAssetFolder(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/assets/app.abc123ef.js';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => ['/assets' => 'assets'],
        ]);

        $output = $this->capture($server);

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('fixture: hashed asset', $output);
    }

    public function testDispatchAssetFolderReturns404ForMissingFile(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/assets/nonexistent.js';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => ['/assets' => 'assets'],
        ]);

        $this->capture($server);

        $this->assertSame(404, http_response_code());
    }

    public function testDispatchServesJsBundleWithFullContent(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/assets/app.abc123ef.js';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => ['/assets' => 'assets'],
        ]);

        $output = $this->capture($server);

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString(
            '// fixture: hashed asset (immutable cache headers)',
            $output,
        );
        $this->assertStringContainsString("console.log('app');", $output);
    }

    public function testDispatchCustomRoute(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/api/contact';

        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $server->addRoute('POST', '/api/contact', function (
            array $params,
            array $body,
        ): void {
            echo json_encode(['ok' => true]);
        });

        $output = $this->capture($server);

        $this->assertStringContainsString('"ok":true', $output);
    }

    public function testDispatchCustomRouteWithParams(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/posts/42';

        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $server->addRoute('GET', '/api/posts/:id', function (
            array $params,
            array $body,
        ): void {
            echo json_encode(['id' => $params['id']]);
        });

        $output = $this->capture($server);

        $this->assertStringContainsString('"id":"42"', $output);
    }

    public function testDispatchCustomRouteTakesPriorityOverPageMap(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/';

        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $server->addRoute('GET', '/', function (): void {
            echo 'custom root handler';
        });

        $output = $this->capture($server);

        $this->assertStringContainsString('custom root handler', $output);
        $this->assertStringNotContainsString('Home page fixture', $output);
    }

    public function testDispatchQueryStringIsIgnored(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/about?utm_source=newsletter';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('About page fixture', $output);
    }

    public function testDispatchCustomRouteErrorReturns500(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/error';

        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $server->addRoute('GET', '/api/error', function (): void {
            throw new \RuntimeException('Test error');
        });

        $output = $this->capture($server);

        $this->assertSame(500, http_response_code());
        $this->assertStringContainsString('500 fixture', $output);
    }

    // -------------------------------------------------------------------------
    // HEAD request tests
    // -------------------------------------------------------------------------

    public function testHeadRequestForPageReturns200WithNoBody(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'HEAD';
        $_SERVER['REQUEST_URI'] = '/about';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(200, http_response_code());
        $this->assertSame('', $output);
    }

    public function testHeadRequestForAssetReturns200WithNoBody(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'HEAD';
        $_SERVER['REQUEST_URI'] = '/assets/app.abc123ef.js';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => ['/assets' => 'assets'],
        ]);

        $output = $this->capture($server);

        $this->assertSame(200, http_response_code());
        $this->assertSame('', $output);
    }

    public function testHeadRequestForRangeReturns206WithNoBody(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'HEAD';
        $_SERVER['REQUEST_URI'] = '/assets/app.abc123ef.js';
        $_SERVER['HTTP_RANGE'] = 'bytes=0-9';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => ['/assets' => 'assets'],
        ]);

        $output = $this->capture($server);

        $this->assertSame(206, http_response_code());
        $this->assertSame('', $output);
    }

    public function testHeadRequestForMissingPageReturns404WithNoBody(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'HEAD';
        $_SERVER['REQUEST_URI'] = '/nonexistent';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(404, http_response_code());
        $this->assertSame('', $output);
    }

    public function testHeadRequestForRouteErrorReturns500WithNoBody(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'HEAD';
        $_SERVER['REQUEST_URI'] = '/api/error';

        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $server->addRoute('HEAD', '/api/error', function (): void {
            throw new \RuntimeException('Test error');
        });

        $output = $this->capture($server);

        $this->assertSame(500, http_response_code());
        $this->assertSame('', $output);
    }

    // -------------------------------------------------------------------------
    // File content verification tests
    // -------------------------------------------------------------------------

    public function testDispatchServesRobotsTxtWithCorrectContent(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/robots.txt';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'singleAssets' => ['/robots.txt' => 'robots.txt'],
        ]);

        $output = $this->capture($server);

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('User-agent: *', $output);
        $this->assertStringContainsString('Allow: /', $output);
        $this->assertStringContainsString(
            'https://www.robotstxt.org/robotstxt.html',
            $output,
        );
    }

    public function testDispatchServesIndexHtmlWithFullContent(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('<!doctype html>', $output);
        $this->assertStringContainsString('<html lang="en">', $output);
        $this->assertStringContainsString('<title>Home</title>', $output);
        $this->assertStringContainsString(
            '<div id="root">Home page fixture</div>',
            $output,
        );
    }

    public function testDispatchServesAboutHtmlWithFullContent(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/about';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('<!doctype html>', $output);
        $this->assertStringContainsString('<html lang="en">', $output);
        $this->assertStringContainsString('<title>About</title>', $output);
        $this->assertStringContainsString(
            '<div id="root">About page fixture</div>',
            $output,
        );
    }

    public function testDispatchServes404HtmlWithFullContent(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/nonexistent-page';

        $output = $this->capture(
            new StaticServer(['buildDir' => $this->buildDir]),
        );

        $this->assertSame(404, http_response_code());
        $this->assertStringContainsString('<!doctype html>', $output);
        $this->assertStringContainsString('<html lang="en">', $output);
        $this->assertStringContainsString(
            '<title>404 Not Found</title>',
            $output,
        );
        $this->assertStringContainsString(
            '<div id="root">404 fixture</div>',
            $output,
        );
    }

    public function testBuildMapsLoadsIndexHtmlWithFullContent(): void
    {
        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $this->callBuildMaps($server);

        $pageMap = $this->getProperty($server, 'pageMap');
        $indexPath = $pageMap['/'];

        $content = file_get_contents($indexPath);

        $this->assertStringContainsString('<!doctype html>', $content);
        $this->assertStringContainsString('<title>Home</title>', $content);
        $this->assertStringContainsString('Home page fixture', $content);
    }

    public function testBuildMapsLoadsAboutHtmlWithFullContent(): void
    {
        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $this->callBuildMaps($server);

        $pageMap = $this->getProperty($server, 'pageMap');
        $aboutPath = $pageMap['/about'];

        $content = file_get_contents($aboutPath);

        $this->assertStringContainsString('<!doctype html>', $content);
        $this->assertStringContainsString('<title>About</title>', $content);
        $this->assertStringContainsString('About page fixture', $content);
    }

    public function testBuildMapsLoads404HtmlWithFullContent(): void
    {
        $server = new StaticServer(['buildDir' => $this->buildDir]);
        $this->callBuildMaps($server);

        $notFoundHtml = $this->getProperty($server, 'notFoundHtml');

        $this->assertStringContainsString('<!doctype html>', $notFoundHtml);
        $this->assertStringContainsString(
            '<title>404 Not Found</title>',
            $notFoundHtml,
        );
        $this->assertStringContainsString('404 fixture', $notFoundHtml);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function capture(StaticServer $server): string
    {
        ob_start();
        $server->serve();
        return (string) ob_get_clean();
    }

    private function callBuildMaps(StaticServer $server): void
    {
        $m = new \ReflectionMethod(StaticServer::class, 'buildMaps');
        $m->invoke($server);
    }

    private function getProperty(StaticServer $server, string $name): mixed
    {
        $p = new \ReflectionProperty(StaticServer::class, $name);
        return $p->getValue($server);
    }
}
