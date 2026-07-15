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

    public function testConstructorAcceptsPerFolderAssetConfig(): void
    {
        // Mirrors StaticWebServer's { path, detectImmutableAssets? } form
        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => [
                '/assets' => 'assets',
                '/downloads' => [
                    'path' => 'downloads',
                    'detectImmutableAssets' => true,
                ],
            ],
        ]);

        $this->assertInstanceOf(StaticServer::class, $server);
    }

    public function testConstructorRejectsFolderConfigWithoutPath(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('require a string "path"');

        new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => [
                '/assets' => ['detectImmutableAssets' => true],
            ],
        ]);
    }

    public function testConstructorRejectsNonBoolFolderDetectFlag(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('"detectImmutableAssets" must be a bool');

        new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => [
                '/assets' => [
                    'path' => 'assets',
                    'detectImmutableAssets' => 'yes',
                ],
            ],
        ]);
    }

    public function testConstructorRejectsRemovedTopLevelDetectFlag(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('set it per folder');

        new StaticServer([
            'buildDir' => $this->buildDir,
            'detectImmutableAssets' => true,
        ]);
    }

    public function testConstructorRejectsNonStringNonArrayFolderValue(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('values must be strings or');

        new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => ['/assets' => 42],
        ]);
    }

    public function testConstructorRejectsNonCallableOnError(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('onError must be a callable or null');

        new StaticServer([
            'buildDir' => $this->buildDir,
            'onError' => 'not-a-callable',
        ]);
    }

    public function testConstructorAcceptsNullOnError(): void
    {
        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'onError' => null,
        ]);

        $this->assertInstanceOf(StaticServer::class, $server);
    }

    public function testConstructorAcceptsCallableOnError(): void
    {
        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'onError' => fn(\Throwable $e, string $ctx) => null,
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

    public function testBuildMapsLoadsCustomNotFoundPageOption(): void
    {
        // The build-error-pages fixture has an empty page map, so the chain
        // skips (a) and the notFoundPage option (b) wins over the default
        // 404.html also present in the fixture (c).
        $server = new StaticServer([
            'buildDir' => realpath(__DIR__ . '/fixtures/build-error-pages'),
            'notFoundPage' => 'custom-404.html',
        ]);
        $this->callBuildMaps($server);

        $notFoundHtml = $this->getProperty($server, 'notFoundHtml');

        $this->assertNotNull($notFoundHtml);
        $this->assertStringContainsString(
            'custom notFoundPage option fixture',
            $notFoundHtml,
        );
    }

    public function testBuildMapsLoadsCustomErrorPageOption(): void
    {
        $server = new StaticServer([
            'buildDir' => realpath(__DIR__ . '/fixtures/build-error-pages'),
            'errorPage' => 'custom-500.html',
        ]);
        $this->callBuildMaps($server);

        $errorHtml = $this->getProperty($server, 'errorHtml');

        $this->assertNotNull($errorHtml);
        $this->assertStringContainsString(
            'custom errorPage option fixture',
            $errorHtml,
        );
    }

    public function testBuildMapsFallsBackToDefault404HtmlInBuildDir(): void
    {
        // No page-map entry and no notFoundPage option — step (c) picks up
        // 404.html sitting in buildDir.
        $server = new StaticServer([
            'buildDir' => realpath(__DIR__ . '/fixtures/build-error-pages'),
        ]);
        $this->callBuildMaps($server);

        $notFoundHtml = $this->getProperty($server, 'notFoundHtml');

        $this->assertNotNull($notFoundHtml);
        $this->assertStringContainsString(
            'default 404.html fixture',
            $notFoundHtml,
        );
    }

    public function testBuildMapsFallsBackToDefault500HtmlInBuildDir(): void
    {
        $server = new StaticServer([
            'buildDir' => realpath(__DIR__ . '/fixtures/build-error-pages'),
        ]);
        $this->callBuildMaps($server);

        $errorHtml = $this->getProperty($server, 'errorHtml');

        $this->assertNotNull($errorHtml);
        $this->assertStringContainsString(
            'default 500.html fixture',
            $errorHtml,
        );
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

    public function testDispatchServesAssetFolderWithPerFolderConfig(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/assets/app.abc123ef.js';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'assetFolders' => [
                '/assets' => [
                    'path' => 'assets',
                    'detectImmutableAssets' => false,
                ],
            ],
        ]);

        $output = $this->capture($server);

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('fixture: hashed asset', $output);
    }

    public function testDispatchNestedAssetFolderWinsByLongestPrefix(): void
    {
        // The shallow mount is declared first — without longest-prefix
        // matching it would swallow requests meant for the nested mount.
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/images/generated/pic.txt';

        $server = new StaticServer([
            'buildDir' => realpath(__DIR__ . '/fixtures/static-assets'),
            'assetFolders' => [
                '/images' => 'images',
                '/images/generated' => 'generated-images',
            ],
        ]);

        $output = $this->capture($server);

        // The nested mount points at a different directory than the shallow
        // one reaches, so first-match would serve 'wrong shadow content'
        // from images/generated/pic.txt instead.
        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString(
            'separate generated-images fixture',
            $output,
        );
    }

    public function testDispatchNestedMountMatchesOnSegmentBoundaryOnly(): void
    {
        // '/images/generated' must not capture '/images/generated-other/...'
        // — that request belongs to the shallow '/images' mount.
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/images/generated-other/pic.txt';

        $server = new StaticServer([
            'buildDir' => realpath(__DIR__ . '/fixtures/static-assets'),
            'assetFolders' => [
                '/images' => 'images',
                '/images/generated' => 'generated-images',
            ],
        ]);

        $output = $this->capture($server);

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString('boundary sibling fixture', $output);
    }

    public function testDispatchCollapsesRepeatedSlashesInPrefixKey(): void
    {
        // A config key with doubled slashes normalizes to a single-slash
        // mount and still serves (mirrors Node's normalizePrefix).
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/images/generated/pic.txt';

        $server = new StaticServer([
            'buildDir' => realpath(__DIR__ . '/fixtures/static-assets'),
            'assetFolders' => [
                '/images//generated' => 'generated-images',
            ],
        ]);

        $output = $this->capture($server);

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString(
            'separate generated-images fixture',
            $output,
        );
    }

    public function testDispatchDuplicateMountLastDeclaredWins(): void
    {
        // Two keys that normalize to the same mount — the last-declared
        // entry wins, matching Node's Map.set overwrite semantics.
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/images/generated/pic.txt';

        $server = new StaticServer([
            'buildDir' => realpath(__DIR__ . '/fixtures/static-assets'),
            'assetFolders' => [
                '/images/generated' => 'images/generated',
                'images/generated/' => 'generated-images',
            ],
        ]);

        $output = $this->capture($server);

        $this->assertSame(200, http_response_code());
        $this->assertStringContainsString(
            'separate generated-images fixture',
            $output,
        );
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

    public function testOnErrorHookIsCalledOnRouteError(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/error';

        $capturedErrors = [];

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'onError' => function (\Throwable $e, string $context) use (
                &$capturedErrors,
            ): void {
                $capturedErrors[] = [
                    'message' => $e->getMessage(),
                    'context' => $context,
                ];
            },
        ]);

        $server->addRoute('GET', '/api/error', function (): void {
            throw new \RuntimeException('Hook test error');
        });

        $this->capture($server);

        $this->assertCount(1, $capturedErrors);
        $this->assertSame('Hook test error', $capturedErrors[0]['message']);
        $this->assertSame(
            'Custom route handler error',
            $capturedErrors[0]['context'],
        );
        $this->assertSame(500, http_response_code());
    }

    public function testOnErrorHookFiresEvenWhenLogErrorsIsFalse(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/error';

        $hookCalled = false;

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'logErrors' => false,
            'onError' => function (\Throwable $e, string $context) use (
                &$hookCalled,
            ): void {
                $hookCalled = true;
            },
        ]);

        $server->addRoute('GET', '/api/error', function (): void {
            throw new \RuntimeException('Test error');
        });

        $this->capture($server);

        $this->assertTrue(
            $hookCalled,
            'onError hook should fire even when logErrors is false',
        );
        $this->assertSame(500, http_response_code());
    }

    public function testLogErrorsDisabledWithNoHookStillSends500(): void
    {
        // logErrors: false + no hook — nothing logged, 500 still sent correctly
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/error';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'logErrors' => false,
        ]);

        $server->addRoute('GET', '/api/error', function (): void {
            throw new \RuntimeException('Test error');
        });

        $output = $this->capture($server);

        $this->assertSame(500, http_response_code());
        $this->assertStringContainsString('500 fixture', $output);
    }

    public function testOnErrorHookFallsBackToErrorLogWhenHookThrows(): void
    {
        // logErrors: true (default) — broken hook falls back to error_log()
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/error';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'onError' => function (\Throwable $e, string $context): void {
                throw new \RuntimeException('Hook itself failed');
            },
        ]);

        $server->addRoute('GET', '/api/error', function (): void {
            throw new \RuntimeException('Original error');
        });

        // Should not throw — falls back to error_log() silently
        $output = $this->capture($server);

        // Response is still sent correctly despite the broken hook
        $this->assertSame(500, http_response_code());
        $this->assertStringContainsString('500 fixture', $output);
    }

    public function testOnErrorHookThrowsWithLogErrorsDisabledSwallowsSilently(): void
    {
        // logErrors: false — broken hook has no fallback, swallowed silently
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/error';

        $server = new StaticServer([
            'buildDir' => $this->buildDir,
            'logErrors' => false,
            'onError' => function (\Throwable $e, string $context): void {
                throw new \RuntimeException('Hook itself failed');
            },
        ]);

        $server->addRoute('GET', '/api/error', function (): void {
            throw new \RuntimeException('Original error');
        });

        // Should not throw — nothing logged, response still sent correctly
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
    // resolveDetectImmutable — per-folder immutable detection resolution
    // -------------------------------------------------------------------------

    public function testResolveDetectDefaultsOnForAssets(): void
    {
        $this->assertTrue(
            StaticServer::resolveDetectImmutable('/assets', 'assets'),
        );
    }

    public function testResolveDetectDefaultsOffForOtherFolders(): void
    {
        $this->assertFalse(
            StaticServer::resolveDetectImmutable('/images', 'images'),
        );
        $this->assertFalse(
            StaticServer::resolveDetectImmutable('/.well-known', '.well-known'),
        );
    }

    public function testResolveDetectNormalizesAssetsPrefix(): void
    {
        // 'assets', '/assets', and '/assets/' are the same mount for the default
        $this->assertTrue(
            StaticServer::resolveDetectImmutable('assets', 'assets'),
        );
        $this->assertTrue(
            StaticServer::resolveDetectImmutable('/assets/', 'assets'),
        );
    }

    public function testResolveDetectPerFolderValueWinsOverDefault(): void
    {
        // Explicit opt-out on /assets
        $this->assertFalse(
            StaticServer::resolveDetectImmutable('/assets', [
                'path' => 'assets',
                'detectImmutableAssets' => false,
            ]),
        );

        // Explicit opt-in on a non-assets folder
        $this->assertTrue(
            StaticServer::resolveDetectImmutable('/downloads', [
                'path' => 'downloads',
                'detectImmutableAssets' => true,
            ]),
        );
    }

    public function testResolveDetectConfigArrayWithoutFlagUsesDefault(): void
    {
        $this->assertTrue(
            StaticServer::resolveDetectImmutable('/assets', [
                'path' => 'assets',
            ]),
        );
        $this->assertFalse(
            StaticServer::resolveDetectImmutable('/downloads', [
                'path' => 'downloads',
            ]),
        );
    }

    // -------------------------------------------------------------------------
    // parseRequestBody — pure body-parsing half of requestBody()
    // -------------------------------------------------------------------------

    public function testParseRequestBodyDecodesJsonObject(): void
    {
        $body = StaticServer::parseRequestBody(
            'application/json',
            '{"name": "Kevin", "ok": true}',
            [],
        );

        $this->assertSame(['name' => 'Kevin', 'ok' => true], $body);
    }

    public function testParseRequestBodyDecodesJsonWithCharsetSuffix(): void
    {
        $body = StaticServer::parseRequestBody(
            'application/json; charset=utf-8',
            '{"ok": true}',
            [],
        );

        $this->assertSame(['ok' => true], $body);
    }

    public function testParseRequestBodyReturnsEmptyForMalformedJson(): void
    {
        $body = StaticServer::parseRequestBody(
            'application/json',
            '{not json',
            [],
        );

        $this->assertSame([], $body);
    }

    public function testParseRequestBodyReturnsEmptyForEmptyJsonBody(): void
    {
        $body = StaticServer::parseRequestBody('application/json', '', []);

        $this->assertSame([], $body);
    }

    public function testParseRequestBodyReturnsEmptyForJsonScalar(): void
    {
        // Valid JSON but not an array/object — normalized to empty
        $body = StaticServer::parseRequestBody('application/json', '"hi"', []);

        $this->assertSame([], $body);
    }

    public function testParseRequestBodyFallsBackToPostForFormData(): void
    {
        $post = ['name' => 'Kevin'];

        $body = StaticServer::parseRequestBody(
            'application/x-www-form-urlencoded',
            '',
            $post,
        );

        $this->assertSame($post, $body);
    }

    public function testParseRequestBodyIgnoresPostForJsonRequests(): void
    {
        $body = StaticServer::parseRequestBody('application/json', '{"a": 1}', [
            'stale' => 'post data',
        ]);

        $this->assertSame(['a' => 1], $body);
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
