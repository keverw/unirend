<?php

declare(strict_types=1);

namespace Unirend\StaticServer;

class MimeTypes
{
    private const MAP = [
        'avif' => 'image/avif',
        'css' => 'text/css; charset=utf-8',
        'gif' => 'image/gif',
        'html' => 'text/html; charset=utf-8',
        'ico' => 'image/x-icon',
        'jpeg' => 'image/jpeg',
        'jpg' => 'image/jpeg',
        'js' => 'application/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'map' => 'application/json; charset=utf-8',
        'mp4' => 'video/mp4',
        'pdf' => 'application/pdf',
        'png' => 'image/png',
        'svg' => 'image/svg+xml; charset=utf-8',
        'txt' => 'text/plain; charset=utf-8',
        'wasm' => 'application/wasm',
        'webmanifest' => 'application/manifest+json; charset=utf-8',
        'webp' => 'image/webp',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'xml' => 'application/xml; charset=utf-8',
    ];

    public static function fromPath(string $absolutePath): string
    {
        $ext = strtolower(pathinfo($absolutePath, PATHINFO_EXTENSION));

        return self::MAP[$ext] ?? 'application/octet-stream';
    }
}
