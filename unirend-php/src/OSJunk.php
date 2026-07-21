<?php

declare(strict_types=1);

namespace Unirend\StaticServer;

/**
 * Common operating-system metadata entries that should never be treated as
 * application content. Mirrors os-junk.ts from the Node.js package so the PHP
 * static server filters the same junk files and directories that
 * StaticWebServer does.
 *
 * Names are matched case-insensitively because macOS and Windows commonly use
 * case-insensitive filesystems.
 */
class OSJunk
{
    /**
     * Lowercased junk basenames, keyed for O(1) lookup.
     *
     * @var array<string, true>
     */
    private const NAMES = [
        // macOS
        '.ds_store' => true,
        '.appledouble' => true,
        '.lsoverride' => true,
        '.spotlight-v100' => true,
        '.trashes' => true,
        '.fseventsd' => true,
        "icon\r" => true,
        // Windows
        'thumbs.db' => true,
        'ehthumbs.db' => true,
        'desktop.ini' => true,
        // Linux
        '.directory' => true,
    ];

    /**
     * Regex patterns matched against the lowercased basename.
     *
     * @var array<int, string>
     */
    private const BASENAME_PATTERNS = [
        '/^\._.*$/', // macOS AppleDouble resource forks (._*)
        '/^\.trash-.*$/', // Linux trash directories (.Trash-*)
    ];

    /**
     * Whether a single filesystem basename is operating-system metadata rather
     * than application content.
     */
    public static function isOSJunkBasename(string $basename): bool
    {
        $lowered = strtolower($basename);

        if (isset(self::NAMES[$lowered])) {
            return true;
        }

        foreach (self::BASENAME_PATTERNS as $pattern) {
            if (preg_match($pattern, $lowered) === 1) {
                return true;
            }
        }

        return false;
    }

    /**
     * Whether any segment of a path is OS metadata, not just its basename.
     * Several recognized names are directories (.AppleDouble, .Spotlight-V100,
     * .Trashes, .fseventsd, and the rest), so a path like
     * '/assets/.AppleDouble/metadata' is junk even though its basename
     * ('metadata') is not, and serving it would expose the contents of an OS
     * metadata directory. Splits on either path separator and ignores empty
     * segments (leading slash, doubled slashes), so it accepts URL paths and
     * mount-relative paths on any platform.
     */
    public static function isOSJunkPath(string $urlPath): bool
    {
        foreach (self::segments($urlPath) as $segment) {
            if (self::isOSJunkBasename($segment)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The first OS metadata segment in a path, or null if none. Names the
     * actual offender in guidance: for '/images/.AppleDouble/metadata' the fix
     * is to gitignore '.AppleDouble', not the file name 'metadata' inside it.
     */
    public static function firstOSJunkSegment(string $urlPath): ?string
    {
        foreach (self::segments($urlPath) as $segment) {
            if (self::isOSJunkBasename($segment)) {
                return $segment;
            }
        }

        return null;
    }

    /**
     * Split a path on either separator, dropping empty segments.
     *
     * Both separators are honored, so the segment checks stay correct wherever
     * the path is later resolved. A URL uses '/', but a request like
     * '/x/.AppleDouble\metadata' would otherwise walk into the junk directory
     * unrecognized. Mirrors os-junk.ts's PATH_SEPARATOR, which checks both.
     *
     * @return array<int, string>
     */
    private static function segments(string $urlPath): array
    {
        $parts = preg_split('#[/\\\\]#', $urlPath);

        if ($parts === false) {
            return [];
        }

        return array_values(
            array_filter(
                $parts,
                static fn(string $segment): bool => $segment !== '',
            ),
        );
    }
}
