<?php

declare(strict_types=1);

namespace Unirend\StaticServer\Tests;

use PHPUnit\Framework\TestCase;
use Unirend\StaticServer\OSJunk;

/**
 * Port of the Node.js package's os-junk.test.ts so both implementations
 * recognize the same OS metadata names and directory segments.
 */
class OSJunkTest extends TestCase
{
    // -------------------------------------------------------------------------
    // isOSJunkBasename
    // -------------------------------------------------------------------------

    public function testFlagsMacOSMetadataNames(): void
    {
        $this->assertTrue(OSJunk::isOSJunkBasename('.DS_Store'));
        $this->assertTrue(OSJunk::isOSJunkBasename('.AppleDouble'));
        $this->assertTrue(OSJunk::isOSJunkBasename('.LSOverride'));
        $this->assertTrue(OSJunk::isOSJunkBasename('.Spotlight-V100'));
        $this->assertTrue(OSJunk::isOSJunkBasename('.Trashes'));
        $this->assertTrue(OSJunk::isOSJunkBasename('.fseventsd'));
        $this->assertTrue(OSJunk::isOSJunkBasename("Icon\r"));
    }

    public function testFlagsWindowsMetadataNames(): void
    {
        $this->assertTrue(OSJunk::isOSJunkBasename('Thumbs.db'));
        $this->assertTrue(OSJunk::isOSJunkBasename('ehthumbs.db'));
        $this->assertTrue(OSJunk::isOSJunkBasename('desktop.ini'));
    }

    public function testFlagsLinuxMetadataNames(): void
    {
        $this->assertTrue(OSJunk::isOSJunkBasename('.directory'));
    }

    public function testMatchesCaseInsensitively(): void
    {
        $this->assertTrue(OSJunk::isOSJunkBasename('.ds_store'));
        $this->assertTrue(OSJunk::isOSJunkBasename('.DS_STORE'));
        $this->assertTrue(OSJunk::isOSJunkBasename('THUMBS.DB'));
        $this->assertTrue(OSJunk::isOSJunkBasename('DESKTOP.INI'));
    }

    public function testFlagsAppleDoubleResourceForks(): void
    {
        $this->assertTrue(OSJunk::isOSJunkBasename('._favicon.svg'));
        $this->assertTrue(OSJunk::isOSJunkBasename('._'));
        $this->assertTrue(OSJunk::isOSJunkBasename('._SomeFile'));
    }

    public function testFlagsLinuxTrashDirectories(): void
    {
        $this->assertTrue(OSJunk::isOSJunkBasename('.Trash-1000'));
        $this->assertTrue(OSJunk::isOSJunkBasename('.trash-user'));
    }

    public function testLeavesNormalContentUntouched(): void
    {
        $this->assertFalse(OSJunk::isOSJunkBasename('favicon.svg'));
        $this->assertFalse(OSJunk::isOSJunkBasename('index.html'));
        $this->assertFalse(OSJunk::isOSJunkBasename('robots.txt'));
        $this->assertFalse(OSJunk::isOSJunkBasename('.gitignore'));
        $this->assertFalse(OSJunk::isOSJunkBasename('desktop.png'));
        $this->assertFalse(OSJunk::isOSJunkBasename('my.ds_store.txt'));
        $this->assertFalse(OSJunk::isOSJunkBasename('trash.txt'));
        $this->assertFalse(OSJunk::isOSJunkBasename('_underscore.js'));
    }

    // -------------------------------------------------------------------------
    // isOSJunkPath
    // -------------------------------------------------------------------------

    public function testFlagsJunkBasenameInPath(): void
    {
        $this->assertTrue(OSJunk::isOSJunkPath('/.DS_Store'));
        $this->assertTrue(OSJunk::isOSJunkPath('.DS_Store'));
        $this->assertTrue(OSJunk::isOSJunkPath('/sub/Thumbs.db'));
    }

    public function testFlagsJunkDirectorySegmentEvenWhenBasenameIsClean(): void
    {
        // Several recognized names are directories, so a file inside one is
        // junk even though its own name is not.
        $this->assertTrue(
            OSJunk::isOSJunkPath('/assets/.AppleDouble/metadata'),
        );
        $this->assertTrue(OSJunk::isOSJunkPath('/.Trashes/secret.txt'));
        $this->assertTrue(OSJunk::isOSJunkPath('/x/.Spotlight-V100/store.db'));
        $this->assertTrue(OSJunk::isOSJunkPath('/x/.fseventsd/0000000000'));
        $this->assertTrue(OSJunk::isOSJunkPath('.Trash-1000/deleted'));
    }

    public function testMatchesSegmentsCaseInsensitively(): void
    {
        $this->assertTrue(OSJunk::isOSJunkPath('/x/.APPLEDOUBLE/y'));
        $this->assertTrue(OSJunk::isOSJunkPath('/X/.trashes/Y'));
    }

    public function testSplitsOnEitherPathSeparator(): void
    {
        $this->assertTrue(
            OSJunk::isOSJunkPath('/assets/.AppleDouble\\metadata'),
        );
        $this->assertTrue(OSJunk::isOSJunkPath('x\\.Trashes\\y'));
        $this->assertSame(
            '.AppleDouble',
            OSJunk::firstOSJunkSegment('/assets/.AppleDouble\\metadata'),
        );
    }

    public function testIgnoresEmptySegments(): void
    {
        $this->assertTrue(OSJunk::isOSJunkPath('//.DS_Store'));
        $this->assertFalse(OSJunk::isOSJunkPath('/assets//logo.svg'));
    }

    public function testLeavesCleanPathsUntouched(): void
    {
        $this->assertFalse(OSJunk::isOSJunkPath('/assets/logo.svg'));
        $this->assertFalse(OSJunk::isOSJunkPath('/.well-known/security.txt'));
        $this->assertFalse(OSJunk::isOSJunkPath('/trashes/index.html')); // no dot
        $this->assertFalse(OSJunk::isOSJunkPath('/my.ds_store.dir/file'));
        $this->assertFalse(OSJunk::isOSJunkPath(''));
    }

    // -------------------------------------------------------------------------
    // firstOSJunkSegment
    // -------------------------------------------------------------------------

    public function testFirstOSJunkSegmentNamesTheOffendingDirectory(): void
    {
        $this->assertSame(
            '.AppleDouble',
            OSJunk::firstOSJunkSegment('/images/.AppleDouble/metadata'),
        );
        $this->assertSame(
            '.DS_Store',
            OSJunk::firstOSJunkSegment('/assets/.DS_Store'),
        );
    }

    public function testFirstOSJunkSegmentReturnsNullForCleanPath(): void
    {
        $this->assertNull(OSJunk::firstOSJunkSegment('/assets/logo.svg'));
        $this->assertNull(OSJunk::firstOSJunkSegment(''));
    }
}
