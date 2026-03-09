<?php

declare(strict_types=1);

namespace Unirend\StaticServer;

/**
 * Handles the low-level mechanics of serving a file over HTTP.
 *
 * Responsibilities:
 *   - ETag generation and conditional request handling (304 Not Modified)
 *   - Cache-Control and Content-Type headers
 *   - Range request support (206 Partial Content, 416 Range Not Satisfiable)
 *   - Path traversal protection (safePath)
 */
class FileServer
{
    /**
     * Serve a file with proper HTTP headers.
     *
     * Handles:
     *   - 304 Not Modified (ETag-based)
     *   - 206 Partial Content (Range requests: single range only, multipart → 416)
     *   - Content-Type from extension
     *   - Cache-Control as provided by caller
     *   - Accept-Ranges: bytes on all responses
     *
     * @param string $absolutePath Absolute filesystem path — must already be validated
     * @param string $cacheControl Cache-Control header value
     */
    public function serve(string $absolutePath, string $cacheControl): void
    {
        if (!is_file($absolutePath)) {
            throw new \RuntimeException(
                "FileServer: file not found: {$absolutePath}",
            );
        }

        $etag = self::buildEtag($absolutePath);
        $fileSize = (int) filesize($absolutePath);

        // Check for Range header early (needed for ETag+Range interaction)
        $rangeHeader = $_SERVER['HTTP_RANGE'] ?? null;

        // 304 Not Modified — but only if no Range header present
        // Per RFC 7232/7233: If client sends both If-None-Match and Range,
        // and ETag matches, we should still honor the Range request (206),
        // not return 304. The ETag validation confirms the resource hasn't
        // changed, but client still wants a partial response.
        $ifNoneMatch = $_SERVER['HTTP_IF_NONE_MATCH'] ?? null;

        if (
            $ifNoneMatch !== null &&
            $ifNoneMatch === $etag &&
            $rangeHeader === null
        ) {
            http_response_code(304);
            return;
        }

        $isHead = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD';

        header('Content-Type: ' . MimeTypes::fromPath($absolutePath));
        header('Cache-Control: ' . $cacheControl);
        header('ETag: ' . $etag);
        header('Accept-Ranges: bytes');

        // Range request
        if ($rangeHeader !== null) {
            $range = self::parseRange($rangeHeader, $fileSize);

            if ($range === null) {
                // 416 Range Not Satisfiable
                http_response_code(416);
                header('Content-Range: bytes */' . $fileSize);
                return;
            }

            [$start, $end] = $range;
            $length = $end - $start + 1;

            http_response_code(206);
            header(
                'Content-Range: bytes ' . $start . '-' . $end . '/' . $fileSize,
            );
            header('Content-Length: ' . $length);

            if ($isHead) {
                return;
            }

            $fp = fopen($absolutePath, 'rb');

            if ($fp === false) {
                throw new \RuntimeException(
                    "FileServer: unable to open file for reading: {$absolutePath}",
                );
            }

            fseek($fp, $start);
            $remaining = $length;

            while ($remaining > 0 && !feof($fp)) {
                $chunk = fread($fp, min(8192, $remaining));

                if ($chunk === false) {
                    break;
                }

                $remaining -= strlen($chunk);
                echo $chunk;
            }

            fclose($fp);
            return;
        }

        // Full file
        header('Content-Length: ' . $fileSize);

        if ($isHead) {
            return;
        }

        readfile($absolutePath);
    }

    /**
     * Parse a Range header into [start, end] byte offsets (both inclusive).
     *
     * Supports:
     *   bytes=0-499      explicit range
     *   bytes=500-       from offset to end of file
     *   bytes=-500       last 500 bytes (suffix range)
     *
     * Returns null (→ 416) for:
     *   - Multipart ranges (bytes=0-499, 500-999)
     *   - Malformed header
     *   - start > end
     *   - start >= fileSize (unsatisfiable)
     *
     * @return array{0: int, 1: int}|null
     */
    public static function parseRange(string $header, int $fileSize): ?array
    {
        if (!str_starts_with($header, 'bytes=')) {
            return null;
        }

        $spec = substr($header, 6);

        // Reject multipart ranges (bytes=0-499, 500-999)
        if (str_contains($spec, ',')) {
            return null;
        }

        if (!preg_match('/^(\d*)-(\d*)$/', $spec, $m)) {
            return null;
        }

        $startStr = $m[1];
        $endStr = $m[2];

        if ($startStr === '' && $endStr === '') {
            return null;
        }

        if ($startStr === '') {
            // Suffix range: bytes=-500 → last 500 bytes
            $suffix = (int) $endStr;
            $start = max(0, $fileSize - $suffix);
            $end = $fileSize - 1;
        } elseif ($endStr === '') {
            // Open-ended range: bytes=500-
            $start = (int) $startStr;
            $end = $fileSize - 1;
        } else {
            $start = (int) $startStr;
            $end = (int) $endStr;
        }

        // Validate: start must be within file, start must not exceed end
        if ($start >= $fileSize || $start > $end) {
            return null;
        }

        // Clamp end to last valid byte
        $end = min($end, $fileSize - 1);

        return [$start, $end];
    }

    /**
     * Detect if a filename appears to be a content-hashed asset.
     *
     * Vite and similar bundlers produce filenames like:
     *   app.abc123ef.js          (dot-separated)
     *   chunk-abc123ef.js        (dash-separated)
     *   main.CTpDmzGw.js         (alphanumeric hash)
     *
     * We look for at least 6 alphanumeric chars with either dot or dash separator
     * to indicate a content hash. If detected, the file can be cached with immutable headers.
     *
     * Patterns supported:
     *   1. .{hash}.{ext} pattern (e.g., main.CTpDmzGw.js)
     *   2. -{hash}.{ext} pattern (e.g., chunk-CTpDmzGw.js)
     *
     * Examples:
     *   app.abc123ef.js          →  true
     *   chunk-abc123ef.js        →  true
     *   main.CTpDmzGw.js         →  true
     *   app.js                   →  false
     *   index.html               →  false
     */
    public static function isImmutableAsset(string $filename): bool
    {
        $basename = basename($filename);

        // Check for fingerprint patterns:
        // 1. .{hash}.{ext} pattern (e.g., main.CTpDmzGw.js)
        // 2. -{hash}.{ext} pattern (e.g., chunk-CTpDmzGw.js)
        return (bool) (preg_match('/\.[A-Za-z0-9]{6,}\./', $basename) ||
            preg_match('/-[A-Za-z0-9]{6,}\./', $basename));
    }

    /**
     * Resolve and validate an absolute path, ensuring it stays within $rootDir.
     * Returns the real path string, or null if outside root or not a file.
     */
    public static function safePath(
        string $absolutePath,
        string $rootDir,
    ): ?string {
        $real = realpath($absolutePath);
        $realRoot = realpath($rootDir);

        if ($real === false || $realRoot === false) {
            return null;
        }

        // Path must start with root + separator (prevents /rootDir-extra matching /rootDir)
        if (
            !str_starts_with($real, $realRoot . DIRECTORY_SEPARATOR) &&
            $real !== $realRoot
        ) {
            return null;
        }

        if (!is_file($real)) {
            return null;
        }

        return $real;
    }

    /**
     * Build an ETag from the file's modification time and size.
     * Cheap to compute — no file read required, just stat().
     */
    public static function buildEtag(string $absolutePath): string
    {
        return '"' .
            dechex((int) filemtime($absolutePath)) .
            '-' .
            dechex((int) filesize($absolutePath)) .
            '"';
    }
}
