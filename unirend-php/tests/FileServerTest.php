<?php

declare(strict_types=1);

namespace Unirend\StaticServer\Tests;

use PHPUnit\Framework\TestCase;
use Unirend\StaticServer\FileServer;
use Unirend\StaticServer\MimeTypes;

class FileServerTest extends TestCase
{
    private string $buildDir;

    protected function setUp(): void
    {
        $this->buildDir = realpath(__DIR__ . '/fixtures/build');
    }

    // -------------------------------------------------------------------------
    // MimeTypes
    // -------------------------------------------------------------------------

    public function testMimeFromKnownExtensions(): void
    {
        $this->assertSame(
            'application/javascript; charset=utf-8',
            MimeTypes::fromPath('/assets/app.js'),
        );
        $this->assertSame(
            'text/css; charset=utf-8',
            MimeTypes::fromPath('/styles/main.css'),
        );
        $this->assertSame(
            'text/html; charset=utf-8',
            MimeTypes::fromPath('/index.html'),
        );
        $this->assertSame('image/png', MimeTypes::fromPath('/logo.png'));
        $this->assertSame(
            'font/woff2',
            MimeTypes::fromPath('/fonts/font.woff2'),
        );
    }

    public function testMimeFromUnknownExtensionFallsBack(): void
    {
        $this->assertSame(
            'application/octet-stream',
            MimeTypes::fromPath('/file.xyz'),
        );
    }

    public function testMimeExtensionIsCaseInsensitive(): void
    {
        $this->assertSame(
            'application/javascript; charset=utf-8',
            MimeTypes::fromPath('/app.JS'),
        );
        $this->assertSame('image/png', MimeTypes::fromPath('/logo.PNG'));
    }

    // -------------------------------------------------------------------------
    // Immutable asset detection
    // -------------------------------------------------------------------------

    public function testDetectsImmutableAssetDotSeparator(): void
    {
        // Dot-separated pattern: .{hash}.{ext}
        $this->assertTrue(FileServer::isImmutableAsset('app.abc123ef.js'));
        $this->assertTrue(
            FileServer::isImmutableAsset('chunk-vendors.1a2b3c4d.css'),
        );
        $this->assertTrue(FileServer::isImmutableAsset('main.CTpDmzGw.js'));
        $this->assertTrue(FileServer::isImmutableAsset('style.A1B2C3.css'));
    }

    public function testDetectsImmutableAssetDashSeparator(): void
    {
        // Dash-separated pattern: -{hash}.{ext}
        $this->assertTrue(FileServer::isImmutableAsset('chunk-abc123ef.js'));
        $this->assertTrue(FileServer::isImmutableAsset('vendor-1a2b3c.css'));
        $this->assertTrue(FileServer::isImmutableAsset('bundle-CTpDmzGw.js'));
        $this->assertTrue(
            FileServer::isImmutableAsset('polyfill-A1B2C3D4E5F6.js'),
        );
    }

    public function testDetectsAlphanumericHashes(): void
    {
        // Alphanumeric hashes (not just hex)
        $this->assertTrue(FileServer::isImmutableAsset('app.XYZ123.js'));
        $this->assertTrue(FileServer::isImmutableAsset('chunk-ABC123XYZ.css'));
        $this->assertTrue(FileServer::isImmutableAsset('main.MixedCase123.js'));
    }

    public function testNonHashedFileIsNotImmutable(): void
    {
        $this->assertFalse(FileServer::isImmutableAsset('app.js'));
        $this->assertFalse(FileServer::isImmutableAsset('main.css'));
        $this->assertFalse(FileServer::isImmutableAsset('index.html'));
        $this->assertFalse(FileServer::isImmutableAsset('bundle.min.js'));
    }

    public function testShortHashIsNotImmutable(): void
    {
        // Less than 6 chars — not treated as a content hash
        $this->assertFalse(FileServer::isImmutableAsset('app.abc12.js'));
        $this->assertFalse(FileServer::isImmutableAsset('chunk-12345.css'));
        $this->assertFalse(FileServer::isImmutableAsset('main.a1b2c.js'));
    }

    public function testHashWithoutProperSeparatorIsNotImmutable(): void
    {
        // Hash exists but not with proper separator pattern
        $this->assertFalse(FileServer::isImmutableAsset('app_abc123ef.js'));
        $this->assertFalse(FileServer::isImmutableAsset('appabc123ef.js'));
    }

    // -------------------------------------------------------------------------
    // Path traversal protection
    // -------------------------------------------------------------------------

    public function testSafePathResolvesValidFile(): void
    {
        $result = FileServer::safePath(
            $this->buildDir . '/index.html',
            $this->buildDir,
        );
        $this->assertNotNull($result);
        $this->assertFileExists($result);
    }

    public function testSafePathBlocksTraversal(): void
    {
        $result = FileServer::safePath(
            $this->buildDir . '/../../../etc/passwd',
            $this->buildDir,
        );
        $this->assertNull($result);
    }

    public function testSafePathBlocksNonExistentFile(): void
    {
        $result = FileServer::safePath(
            $this->buildDir . '/does-not-exist.html',
            $this->buildDir,
        );
        $this->assertNull($result);
    }

    // -------------------------------------------------------------------------
    // Range parsing
    // -------------------------------------------------------------------------

    public function testParseRangeExplicit(): void
    {
        $result = FileServer::parseRange('bytes=0-499', 1000);
        $this->assertSame([0, 499], $result);
    }

    public function testParseRangeOpenEnd(): void
    {
        $result = FileServer::parseRange('bytes=500-', 1000);
        $this->assertSame([500, 999], $result);
    }

    public function testParseRangeSuffix(): void
    {
        // Last 200 bytes of a 1000-byte file
        $result = FileServer::parseRange('bytes=-200', 1000);
        $this->assertSame([800, 999], $result);
    }

    public function testParseRangeClampsEndToFileSize(): void
    {
        // end=9999 beyond EOF — clamped to 999
        $result = FileServer::parseRange('bytes=0-9999', 1000);
        $this->assertSame([0, 999], $result);
    }

    public function testParseRangeReturnsNullForMultipart(): void
    {
        $this->assertNull(FileServer::parseRange('bytes=0-499, 500-999', 1000));
    }

    public function testParseRangeReturnsNullWhenStartBeyondFile(): void
    {
        $this->assertNull(FileServer::parseRange('bytes=2000-', 1000));
    }

    public function testParseRangeReturnsNullWhenStartExceedsEnd(): void
    {
        $this->assertNull(FileServer::parseRange('bytes=500-100', 1000));
    }

    public function testParseRangeReturnsNullForBadPrefix(): void
    {
        $this->assertNull(FileServer::parseRange('items=0-499', 1000));
    }

    public function testParseRangeReturnsNullForEmptySpec(): void
    {
        $this->assertNull(FileServer::parseRange('bytes=-', 1000));
    }

    public function testParseRangeRejectsGarbageInput(): void
    {
        // Random garbage words should be safely rejected
        $this->assertNull(FileServer::parseRange('bytes=garbage', 1000));
        $this->assertNull(FileServer::parseRange('bytes=asdfghjkl', 1000));
        $this->assertNull(FileServer::parseRange('bytes=hello-world', 1000));
        $this->assertNull(FileServer::parseRange('bytes=🎉', 1000));
    }

    public function testParseRangeRejectsInjectionAttempts(): void
    {
        // SQL injection, XSS, etc. should be safely rejected
        $this->assertNull(FileServer::parseRange('bytes=DROP TABLE', 1000));
        $this->assertNull(FileServer::parseRange('bytes=<script>', 1000));
        $this->assertNull(
            FileServer::parseRange('bytes=../../etc/passwd', 1000),
        );
    }

    public function testParseRangeRejectsWhitespace(): void
    {
        // Whitespace should not be allowed in range spec
        $this->assertNull(FileServer::parseRange('bytes= 0-100', 1000));
        $this->assertNull(FileServer::parseRange('bytes=0 - 100', 1000));
        $this->assertNull(FileServer::parseRange('bytes=0-100 ', 1000));
    }

    // -------------------------------------------------------------------------
    // ETag
    // -------------------------------------------------------------------------

    public function testBuildEtagReturnsQuotedString(): void
    {
        $path = $this->buildDir . '/index.html';
        $etag = FileServer::buildEtag($path);

        $this->assertStringStartsWith('"', $etag);
        $this->assertStringEndsWith('"', $etag);
    }

    public function testBuildEtagIsDeterministic(): void
    {
        $path = $this->buildDir . '/index.html';
        $this->assertSame(
            FileServer::buildEtag($path),
            FileServer::buildEtag($path),
        );
    }

    public function testBuildEtagFormatContainsDashSeparator(): void
    {
        $path = $this->buildDir . '/index.html';
        $etag = FileServer::buildEtag($path);

        // Format should be "{mtime_hex}-{size_hex}"
        $this->assertMatchesRegularExpression(
            '/^"[0-9a-f]+-[0-9a-f]+"$/',
            $etag,
        );
    }

    public function testBuildEtagDifferentFilesHaveDifferentEtags(): void
    {
        $etag1 = FileServer::buildEtag($this->buildDir . '/index.html');
        $etag2 = FileServer::buildEtag($this->buildDir . '/about.html');

        $this->assertNotSame($etag1, $etag2);
    }

    public function testServeReturns304WhenEtagMatches(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/index.html';

        $path = $this->buildDir . '/index.html';
        $etag = FileServer::buildEtag($path);

        // Set If-None-Match header to match the file's ETag
        $_SERVER['HTTP_IF_NONE_MATCH'] = $etag;

        ob_start();
        (new FileServer())->serve($path, 'public, max-age=0');
        $output = ob_get_clean();

        $this->assertSame(304, http_response_code());
        $this->assertEmpty($output); // No body for 304
    }

    public function testServeReturns200WhenEtagDoesNotMatch(): void
    {
        http_response_code(200); // Reset response code
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/index.html';

        $path = $this->buildDir . '/index.html';

        // Set If-None-Match to a different ETag
        $_SERVER['HTTP_IF_NONE_MATCH'] = '"different-etag"';

        ob_start();
        (new FileServer())->serve($path, 'public, max-age=0');
        $output = ob_get_clean();

        $this->assertSame(200, http_response_code());
        $this->assertNotEmpty($output); // Should have body
    }

    public function testServeReturns200WhenNoIfNoneMatchHeader(): void
    {
        http_response_code(200); // Reset response code
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/index.html';

        $path = $this->buildDir . '/index.html';

        // No If-None-Match header
        unset($_SERVER['HTTP_IF_NONE_MATCH']);

        ob_start();
        (new FileServer())->serve($path, 'public, max-age=0');
        $output = ob_get_clean();

        $this->assertSame(200, http_response_code());
        $this->assertNotEmpty($output);
    }

    public function testEtagFormatIncludesMtimeAndSize(): void
    {
        $path = $this->buildDir . '/index.html';
        $etag = FileServer::buildEtag($path);

        // Extract mtime and size from ETag
        $mtime = filemtime($path);
        $size = filesize($path);

        $expectedEtag = '"' . dechex($mtime) . '-' . dechex($size) . '"';

        $this->assertSame($expectedEtag, $etag);
    }
}
