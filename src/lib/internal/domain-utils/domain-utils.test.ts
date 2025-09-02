import { describe, it, expect } from "bun:test";
import {
  normalizeDomain,
  normalizeOrigin,
  matchesWildcardDomain,
  matchesWildcardOrigin,
  matchesDomainList,
  matchesOriginList,
  matchesCORSCredentialsList,
  isIPAddress,
  validateConfigEntry,
} from "./domain-utils";

describe("domain-utils", () => {
  describe("isIPAddress", () => {
    it("should detect IPv4 addresses", () => {
      expect(isIPAddress("192.168.1.1")).toBe(true);
      expect(isIPAddress("127.0.0.1")).toBe(true);
      expect(isIPAddress("10.0.0.1")).toBe(true);
      expect(isIPAddress("255.255.255.255")).toBe(true);
      expect(isIPAddress("0.0.0.0")).toBe(true);
    });

    it("should detect IPv6 addresses", () => {
      expect(isIPAddress("::1")).toBe(true);
      expect(isIPAddress("::")).toBe(true);
      expect(isIPAddress("2001:db8::1")).toBe(true);
      expect(isIPAddress("fe80::1")).toBe(true);
      expect(isIPAddress("[::1]")).toBe(true);
      expect(isIPAddress("[2001:db8::1]")).toBe(true);
    });

    it("should reject non-IP addresses", () => {
      expect(isIPAddress("example.com")).toBe(false);
      expect(isIPAddress("192.168.1.256")).toBe(false);
      expect(isIPAddress("not-an-ip")).toBe(false);
      expect(isIPAddress("192.168.1")).toBe(false);
    });

    it("should accept IPv6 zone-IDs with unreserved characters", () => {
      // Unbracketed textual form
      expect(isIPAddress("fe80::1%eth0")).toBe(true);
      expect(isIPAddress("fe80::1%ETH0")).toBe(true);
      expect(isIPAddress("fe80::1%eth0-._~Z9")).toBe(true);

      // Bracketed URL form (zone delimiter percent-encoded as %25)
      expect(isIPAddress("[fe80::1%25eth0]")).toBe(true);
      expect(isIPAddress("[fe80::1%25ETH0]")).toBe(true);
      expect(isIPAddress("[fe80::1%25eth0-._~Z9]")).toBe(true);
    });

    it("should accept IPv6 zone-IDs with pct-encoded bytes", () => {
      // Percent-encoded hyphen and colon in zone-id
      expect(isIPAddress("fe80::1%eth0%2D1%3A")).toBe(true);
      expect(isIPAddress("[fe80::1%25eth0%2D1%3A]")).toBe(true);
    });

    it("should reject IPv6 with empty or invalid zone-IDs", () => {
      // Empty zone-id
      expect(isIPAddress("fe80::1%")).toBe(false);
      expect(isIPAddress("[fe80::1%25]")).toBe(false);

      // Illegal characters (must be unreserved or pct-encoded)
      expect(isIPAddress("[fe80::1%25eth0!]")).toBe(false);
      expect(isIPAddress("[fe80::1%25eth0:]")).toBe(false);

      // Invalid percent-encodings in zone-id
      expect(isIPAddress("[fe80::1%25eth0%G1]")).toBe(false);
      expect(isIPAddress("[fe80::1%25eth0%2]")).toBe(false);
      expect(isIPAddress("[fe80::1%25eth0%]")).toBe(false);
    });
  });

  describe("normalizeDomain", () => {
    it("should normalize basic domains", () => {
      expect(normalizeDomain("Example.COM")).toBe("example.com");
      expect(normalizeDomain("API.Example.com")).toBe("api.example.com");
    });

    it("should handle trailing dots (FQDN)", () => {
      expect(normalizeDomain("example.com.")).toBe("example.com");
      expect(normalizeDomain("api.example.com.")).toBe("api.example.com");
      expect(normalizeDomain("Example.COM.")).toBe("example.com");
    });

    it("should handle IP addresses", () => {
      expect(normalizeDomain("192.168.1.1")).toBe("192.168.1.1");
      expect(normalizeDomain("127.0.0.1")).toBe("127.0.0.1");
      expect(normalizeDomain("::1")).toBe("::1");
      expect(normalizeDomain("2001:DB8::1")).toBe("2001:db8::1");
      expect(normalizeDomain("[::1]")).toBe("::1");
    });

    it("should handle Unicode normalization", () => {
      // Test NFC normalization
      expect(normalizeDomain("café.com")).toBe("xn--caf-dma.com");
      expect(normalizeDomain("CAFÉ.COM")).toBe("xn--caf-dma.com");
    });

    it("should handle punycode domains", () => {
      expect(normalizeDomain("xn--nxasmq6b.com")).toBe("xn--nxasmq6b.com");
      expect(normalizeDomain("münchen.de")).toBe("xn--mnchen-3ya.de");
    });

    it("should reject domains with interior empty labels", () => {
      // Interior empty labels should be invalid (a..b should fail)
      expect(normalizeDomain("a..b")).toBe("");
      expect(normalizeDomain("example..com")).toBe("");
      expect(normalizeDomain("api...example.com")).toBe("");
      expect(normalizeDomain("..example.com")).toBe("");

      // Trailing dots should still be allowed (FQDN)
      expect(normalizeDomain("example.com.")).toBe("example.com");
      expect(normalizeDomain("api.example.com.")).toBe("api.example.com");
    });

    it("should return empty string for labels exceeding 63 octets (ASCII)", () => {
      const tooLongLabel = "a".repeat(64);
      expect(normalizeDomain(`${tooLongLabel}.com`)).toBe("");
    });

    it("should return empty string for punycoded labels exceeding 63 octets (IDN)", () => {
      // Create a Unicode label that becomes >63 chars after punycode
      const longUnicodeLabel = "café".repeat(20);
      expect(normalizeDomain(`${longUnicodeLabel}.com`)).toBe("");
    });

    it("should return empty string when total FQDN exceeds 255 octets", () => {
      const label63 = "a".repeat(63);
      const domain = [label63, label63, label63, label63, label63].join(".");
      // 5 labels * 63 + 4 dots = 319 > 255
      expect(normalizeDomain(domain)).toBe("");
    });

    it("should handle pathological long IDN patterns in wildcards", () => {
      // Create a very long IDN label that exceeds DNS limits after punycode conversion
      const longUnicodeLabel = "café".repeat(20); // 80 chars, will be much longer in punycode
      const pathologicalPattern = `*.${longUnicodeLabel}.com`;

      // normalizeWildcardPattern should detect this and return original pattern
      // The caller (matchesWildcardDomain) will then handle it appropriately
      const result = matchesWildcardDomain(
        "test.example.com",
        pathologicalPattern,
      );
      expect(result).toBe(false); // Should not match due to invalid pattern

      // Test with double asterisk pattern
      const pathologicalPattern2 = `**.${longUnicodeLabel}.example.com`;
      const result2 = matchesWildcardDomain(
        "api.test.example.com",
        pathologicalPattern2,
      );
      expect(result2).toBe(false); // Should not match due to invalid pattern

      // Test with multiple long labels
      const multiLongPattern = `*.${longUnicodeLabel}.${longUnicodeLabel}.com`;
      const result3 = matchesWildcardDomain(
        "api.test.example.com",
        multiLongPattern,
      );
      expect(result3).toBe(false); // Should not match due to invalid pattern
    });

    it("should validate concrete labels in wildcard patterns", () => {
      // Valid patterns should work normally
      expect(matchesWildcardDomain("api.example.com", "*.example.com")).toBe(
        true,
      );
      expect(matchesWildcardDomain("test.café.com", "*.café.com")).toBe(true);

      // Pattern with interior empty labels in concrete parts should fail
      expect(matchesWildcardDomain("api.example.com", "*.example..com")).toBe(
        false,
      );
      expect(
        matchesWildcardDomain("api.test.com", "**.test..example.com"),
      ).toBe(false);

      // Global wildcard pattern should work (no concrete labels to validate)
      expect(matchesWildcardDomain("anything.com", "*")).toBe(true); // Global wildcard now supported
    });

    it("should reject wildcard patterns with a single oversized label", () => {
      // This label becomes > 63 chars after punycode, triggering the early return
      const longLabel = "a".repeat(60) + "é"; // "é"
      const pattern = `*.${longLabel}.com`;

      // The function should return the original pattern, and matching should fail.
      const result = matchesWildcardDomain("test.whatever.com", pattern);
      expect(result).toBe(false);
    });

    it("should reject wildcard patterns with a single oversized label (pre-punycode)", () => {
      const longLabel = "a".repeat(64);
      const pattern = `*.${longLabel}.com`;

      const result = matchesWildcardDomain("test.whatever.com", pattern);
      expect(result).toBe(false);
    });

    it("should accept boundary-length ASCII labels (63) in wildcard patterns", () => {
      const label63 = "a".repeat(63);
      const pattern = `*.${label63}.com`;
      expect(matchesWildcardDomain(`x.${label63}.com`, pattern)).toBe(true);
      // Apex should still not match
      expect(matchesWildcardDomain(`${label63}.com`, pattern)).toBe(false);
    });
  });

  describe("normalizeOrigin", () => {
    it("should normalize origins with protocol and port", () => {
      expect(normalizeOrigin("https://Example.COM")).toBe(
        "https://example.com",
      );
      expect(normalizeOrigin("http://api.example.com:8080")).toBe(
        "http://api.example.com:8080",
      );
      expect(normalizeOrigin("https://api.example.com:443")).toBe(
        "https://api.example.com",
      );
    });

    it("should handle IP address origins", () => {
      expect(normalizeOrigin("http://192.168.1.1")).toBe("http://192.168.1.1");
      expect(normalizeOrigin("https://127.0.0.1:8080")).toBe(
        "https://127.0.0.1:8080",
      );
      expect(normalizeOrigin("http://[::1]")).toBe("http://[::1]");
      expect(normalizeOrigin("https://[2001:db8::1]:3000")).toBe(
        "https://[2001:db8::1]:3000",
      );
    });

    it("should handle IPv4-mapped IPv6 and IPv6 scope identifiers", () => {
      // IPv4-mapped IPv6
      expect(normalizeOrigin("http://[::ffff:192.0.2.128]")).toBe(
        "http://[::ffff:192.0.2.128]",
      );
      expect(normalizeOrigin("https://[::ffff:192.0.2.128]:443")).toBe(
        "https://[::ffff:192.0.2.128]",
      );
      expect(normalizeOrigin("http://[::ffff:192.0.2.128]:8080")).toBe(
        "http://[::ffff:192.0.2.128]:8080",
      );

      // IPv6 with scope identifier (percent-encoded in URL)
      expect(normalizeOrigin("http://[fe80::1%25eth0]")).toBe(
        "http://[fe80::1%25eth0]",
      );
      expect(normalizeOrigin("https://[fe80::1%25eth0]:443")).toBe(
        "https://[fe80::1%25eth0]",
      );
      expect(normalizeOrigin("http://[fe80::1%25eth0]:3000")).toBe(
        "http://[fe80::1%25eth0]:3000",
      );
    });

    it("should handle trailing dots in origins", () => {
      expect(normalizeOrigin("https://example.com.")).toBe(
        "https://example.com",
      );
      expect(normalizeOrigin("http://api.example.com.:8080")).toBe(
        "http://api.example.com:8080",
      );
    });

    it("should handle invalid URLs gracefully (empty sentinel, preserve 'null')", () => {
      expect(normalizeOrigin("invalid-url")).toBe("");
      expect(normalizeOrigin("null")).toBe("null");
    });

    it("should return empty sentinel when hostname normalization fails (pathological IDN)", () => {
      const longUnicodeLabel = "café".repeat(20);
      const input = `https://${longUnicodeLabel}.com`;
      // When hostname normalizes to empty sentinel, normalizeOrigin returns empty sentinel
      expect(normalizeOrigin(input)).toBe("");
    });

    it("should canonicalize IPv6 bracket content (including scope) to lowercase", () => {
      // Bracket content, including scope identifiers, is normalized to lowercase deterministically
      expect(normalizeOrigin("http://[fe80::1%25ETH0]")).toBe(
        "http://[fe80::1%25eth0]",
      );
      expect(normalizeOrigin("https://[fe80::1%25Eth0]:443")).toBe(
        "https://[fe80::1%25eth0]",
      );
      expect(normalizeOrigin("http://[FE80::1%25eTh0]:3000")).toBe(
        "http://[fe80::1%25eth0]:3000",
      );
    });

    it("should lowercase zone-IDs and pct-encoded hex digits in normalized origins", () => {
      expect(normalizeOrigin("http://[fe80::1%25ETH0%2D1%3A]")).toBe(
        "http://[fe80::1%25eth0%2d1%3a]",
      );
      expect(normalizeOrigin("https://[fe80::1%25Eth0%2d1%3A]:443")).toBe(
        "https://[fe80::1%25eth0%2d1%3a]",
      );
    });

    it("should accept unreserved characters in zone-IDs and normalize case", () => {
      expect(normalizeOrigin("http://[fe80::1%25eTh0-._~Z9]")).toBe(
        "http://[fe80::1%25eth0-._~z9]",
      );
    });
  });

  describe("matchesWildcardDomain - Smart wildcard matching", () => {
    describe("Global wildcard (*)", () => {
      it("should support global wildcard '*' matching any domain", () => {
        // Global wildcard should match any valid domain
        expect(matchesWildcardDomain("example.com", "*")).toBe(true);
        expect(matchesWildcardDomain("api.example.com", "*")).toBe(true);
        expect(matchesWildcardDomain("sub.domain.example.com", "*")).toBe(true);
        expect(matchesWildcardDomain("localhost", "*")).toBe(true);
        expect(matchesWildcardDomain("test.localhost", "*")).toBe(true);

        // Global wildcard should match IP addresses (special case for global wildcard)
        expect(matchesWildcardDomain("192.168.1.1", "*")).toBe(true);
        expect(matchesWildcardDomain("::1", "*")).toBe(true);

        // Should reject invalid domains
        expect(matchesWildcardDomain("", "*")).toBe(false);
        expect(matchesWildcardDomain("invalid..domain", "*")).toBe(false);
      });

      it("should reject invalid all-wildcard patterns like '*.*'", () => {
        // These patterns should be rejected as invalid
        expect(matchesWildcardDomain("example.com", "*.*")).toBe(false);
        expect(matchesWildcardDomain("api.example.com", "**.*")).toBe(false);
        expect(matchesWildcardDomain("example.com", "*.**")).toBe(false);
        expect(matchesWildcardDomain("example.com", "**.**")).toBe(false);
      });

      it("should comprehensively test IP address matching with global wildcard", () => {
        // IPv4 addresses
        expect(matchesWildcardDomain("192.168.1.1", "*")).toBe(true);
        expect(matchesWildcardDomain("10.0.0.1", "*")).toBe(true);
        expect(matchesWildcardDomain("172.16.0.1", "*")).toBe(true);
        expect(matchesWildcardDomain("127.0.0.1", "*")).toBe(true);
        expect(matchesWildcardDomain("0.0.0.0", "*")).toBe(true);
        expect(matchesWildcardDomain("255.255.255.255", "*")).toBe(true);

        // IPv6 addresses
        expect(matchesWildcardDomain("::1", "*")).toBe(true);
        expect(matchesWildcardDomain("2001:db8::1", "*")).toBe(true);
        expect(matchesWildcardDomain("fe80::1", "*")).toBe(true);
        expect(matchesWildcardDomain("::ffff:192.168.1.1", "*")).toBe(true);
        expect(
          matchesWildcardDomain("2001:0db8:85a3:0000:0000:8a2e:0370:7334", "*"),
        ).toBe(true);

        // Non-global wildcards should reject IP addresses
        expect(matchesWildcardDomain("192.168.1.1", "*.example.com")).toBe(
          false,
        );
        expect(matchesWildcardDomain("::1", "**.example.com")).toBe(false);
        expect(matchesWildcardDomain("127.0.0.1", "*.*.example.com")).toBe(
          false,
        );
      });

      it("should reject patterns with backslashes (hardening against pasted paths)", () => {
        // Backslashes should be rejected to prevent Windows path confusion
        expect(
          matchesWildcardDomain("example.com", "*.example.com\\path"),
        ).toBe(false);
        expect(
          matchesWildcardDomain("api.example.com", "\\*.example.com"),
        ).toBe(false);
        expect(matchesWildcardDomain("test.com", "*.test\\domain.com")).toBe(
          false,
        );
        expect(matchesWildcardDomain("sub.domain.com", "**\\domain.com")).toBe(
          false,
        );
      });
    });

    describe("Single asterisk (*) - Direct subdomains only", () => {
      it("should match direct subdomains", () => {
        expect(matchesWildcardDomain("api.example.com", "*.example.com")).toBe(
          true,
        );
        expect(matchesWildcardDomain("app.example.com", "*.example.com")).toBe(
          true,
        );
        expect(matchesWildcardDomain("v2.example.com", "*.example.com")).toBe(
          true,
        );
      });

      it("should NOT match nested subdomains", () => {
        expect(
          matchesWildcardDomain("app.api.example.com", "*.example.com"),
        ).toBe(false);
        expect(
          matchesWildcardDomain("v2.app.api.example.com", "*.example.com"),
        ).toBe(false);
      });

      it("should NOT match apex domain", () => {
        expect(matchesWildcardDomain("example.com", "*.example.com")).toBe(
          false,
        );
      });

      it("should handle case insensitive matching", () => {
        expect(matchesWildcardDomain("API.Example.COM", "*.example.com")).toBe(
          true,
        );
        expect(matchesWildcardDomain("api.example.com", "*.EXAMPLE.COM")).toBe(
          true,
        );
      });
    });

    describe("Double asterisk (**) - All subdomains including nested", () => {
      it("should match direct subdomains", () => {
        expect(matchesWildcardDomain("api.example.com", "**.example.com")).toBe(
          true,
        );
        expect(matchesWildcardDomain("app.example.com", "**.example.com")).toBe(
          true,
        );
      });

      it("should match nested subdomains with double asterisk", () => {
        expect(matchesWildcardDomain("api.example.com", "**.example.com")).toBe(
          true,
        );
        expect(
          matchesWildcardDomain("app.api.example.com", "**.example.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "deep.nested.api.example.com",
            "**.example.com",
          ),
        ).toBe(true);
        expect(matchesWildcardDomain("example.com", "**.example.com")).toBe(
          false,
        ); // apex not allowed
      });

      it("should match any prefix before base domain with double asterisk", () => {
        // **.foo.com allows anything before foo.com
        expect(matchesWildcardDomain("api.foo.com", "**.foo.com")).toBe(true);
        expect(matchesWildcardDomain("blog.api.foo.com", "**.foo.com")).toBe(
          true,
        );
        expect(
          matchesWildcardDomain("deep.nested.api.foo.com", "**.foo.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("anything.else.foo.com", "**.foo.com"),
        ).toBe(true);
        expect(matchesWildcardDomain("foo.com", "**.foo.com")).toBe(false); // apex not allowed

        // **.blogs.foo.com allows anything before blogs.foo.com
        expect(
          matchesWildcardDomain("a.blogs.foo.com", "**.blogs.foo.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("api.blogs.foo.com", "**.blogs.foo.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("a.b.blogs.foo.com", "**.blogs.foo.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "deep.nested.blogs.foo.com",
            "**.blogs.foo.com",
          ),
        ).toBe(true);
        expect(matchesWildcardDomain("blogs.foo.com", "**.blogs.foo.com")).toBe(
          false,
        ); // ** expects something before the remainder
        expect(matchesWildcardDomain("other.foo.com", "**.blogs.foo.com")).toBe(
          false,
        ); // different subdomain
      });

      it("should support nested wildcard patterns", () => {
        expect(
          matchesWildcardDomain("api.blogs.foo.com", "**.blogs.foo.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("v2.api.blogs.foo.com", "**.blogs.foo.com"),
        ).toBe(true);
        expect(matchesWildcardDomain("blogs.foo.com", "**.blogs.foo.com")).toBe(
          false,
        ); // ** expects something before the remainder
      });

      it("should enforce leftmost ** requires at least one label", () => {
        // Leftmost ** should require at least one domain label before the remainder
        expect(
          matchesWildcardDomain("api.example.com", "**.api.example.com"),
        ).toBe(false); // No labels before "api"
        expect(matchesWildcardDomain("blogs.foo.com", "**.blogs.foo.com")).toBe(
          false,
        ); // No labels before "blogs"
        expect(matchesWildcardDomain("example.com", "**.example.com")).toBe(
          false,
        ); // No labels before "example"

        // But should match when there are labels before the remainder
        expect(
          matchesWildcardDomain(
            "staging.api.example.com",
            "**.api.example.com",
          ),
        ).toBe(true); // "staging" before "api"
        expect(
          matchesWildcardDomain("www.blogs.foo.com", "**.blogs.foo.com"),
        ).toBe(true); // "www" before "blogs"
        expect(
          matchesWildcardDomain(
            "v1.staging.api.example.com",
            "**.api.example.com",
          ),
        ).toBe(true); // "v1.staging" before "api"
      });
    });

    describe("Multi-label wildcard patterns", () => {
      it("should support *.*.example.com patterns", () => {
        // Should match exactly two subdomain levels
        expect(
          matchesWildcardDomain("a.b.example.com", "*.*.example.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("app.api.example.com", "*.*.example.com"),
        ).toBe(true);

        // Should NOT match single level
        expect(
          matchesWildcardDomain("api.example.com", "*.*.example.com"),
        ).toBe(false);

        // Should NOT match three levels
        expect(
          matchesWildcardDomain("x.y.z.example.com", "*.*.example.com"),
        ).toBe(false);

        // Should NOT match apex
        expect(matchesWildcardDomain("example.com", "*.*.example.com")).toBe(
          false,
        );
      });

      it("should support complex multi-label patterns", () => {
        // *.api.*.example.com should match v1.api.staging.example.com
        expect(
          matchesWildcardDomain(
            "v1.api.staging.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "v2.api.prod.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(true);

        // Should NOT match without the fixed "api" label
        expect(
          matchesWildcardDomain(
            "v1.web.staging.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(false);

        // Should NOT match with wrong number of wildcards
        expect(
          matchesWildcardDomain(
            "api.staging.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(false);
        expect(
          matchesWildcardDomain(
            "x.y.api.staging.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(false);
      });

      it("should support mixed * and ** patterns", () => {
        // **.api.example.com should match any depth before "api"
        expect(
          matchesWildcardDomain(
            "v1.staging.api.example.com",
            "**.api.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardDomain("api.example.com", "**.api.example.com"),
        ).toBe(false); // ** expects something before the remainder
        expect(
          matchesWildcardDomain(
            "deep.nested.path.api.example.com",
            "**.api.example.com",
          ),
        ).toBe(true);

        // *.**.example.com should match one label followed by any depth
        expect(
          matchesWildcardDomain(
            "v1.api.staging.example.com",
            "*.**.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardDomain("v1.example.com", "*.**.example.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "v1.deep.nested.path.example.com",
            "*.**.example.com",
          ),
        ).toBe(true);

        // Should match because it has at least one label
        expect(
          matchesWildcardDomain("api.staging.example.com", "*.**.example.com"),
        ).toBe(true);
      });

      it("should handle edge cases in multi-label patterns", () => {
        // Multiple ** wildcards
        expect(
          matchesWildcardDomain("a.b.c.d.example.com", "**.**.example.com"),
        ).toBe(true);
        // ** patterns require at least one label before the remainder
        // "**.**.example.com" has ambiguous semantics, but should not match apex
        expect(matchesWildcardDomain("example.com", "**.**.example.com")).toBe(
          false,
        );

        // Pattern with more labels than domain
        expect(
          matchesWildcardDomain("api.example.com", "*.*.*.example.com"),
        ).toBe(false);

        // Empty wildcard sections should not match
        expect(
          matchesWildcardDomain("api.example.com", "*.*.example.com"),
        ).toBe(false);
      });
    });

    it("should return false for non-wildcard patterns", () => {
      expect(matchesWildcardDomain("api.example.com", "example.com")).toBe(
        false,
      );
      expect(matchesWildcardDomain("example.com", "example.com")).toBe(false);
    });
  });

  describe("matchesWildcardOrigin - Protocol-specific wildcards", () => {
    describe("Global wildcard", () => {
      it("should support global wildcard '*' matching any origin", () => {
        // Global wildcard should match any valid origin
        expect(matchesWildcardOrigin("https://example.com", "*")).toBe(true);
        expect(matchesWildcardOrigin("http://api.example.com", "*")).toBe(true);
        expect(
          matchesWildcardOrigin("https://sub.domain.example.com", "*"),
        ).toBe(true);
        expect(matchesWildcardOrigin("http://localhost:3000", "*")).toBe(true);
        expect(matchesWildcardOrigin("https://192.168.1.1", "*")).toBe(true);
        expect(matchesWildcardOrigin("http://[::1]:8080", "*")).toBe(true);

        // Should still reject non-HTTP(S) schemes
        expect(matchesWildcardOrigin("ftp://example.com", "*")).toBe(false);
        expect(matchesWildcardOrigin("file://example.com", "*")).toBe(false);

        // Should reject invalid origins
        expect(matchesWildcardOrigin("not-a-url", "*")).toBe(false);
        expect(matchesWildcardOrigin("", "*")).toBe(false);
      });

      it("should reject invalid all-wildcard patterns like '*.*'", () => {
        // These patterns should be rejected as invalid
        expect(matchesWildcardOrigin("https://example.com", "*.*")).toBe(false);
        expect(matchesWildcardOrigin("https://api.example.com", "**.*")).toBe(
          false,
        );
        expect(matchesWildcardOrigin("https://example.com", "*.**")).toBe(
          false,
        );
        expect(matchesWildcardOrigin("https://example.com", "**.**")).toBe(
          false,
        );
      });
    });

    describe("Protocol-only wildcards", () => {
      it("should match https://* for any HTTPS origin", () => {
        expect(matchesWildcardOrigin("https://example.com", "https://*")).toBe(
          true,
        );
        expect(
          matchesWildcardOrigin("https://api.example.com", "https://*"),
        ).toBe(true);
        expect(
          matchesWildcardOrigin("https://www.api.example.com", "https://*"),
        ).toBe(true);
        expect(matchesWildcardOrigin("https://localhost", "https://*")).toBe(
          true,
        );
      });

      it("should match http://* for any HTTP origin", () => {
        expect(matchesWildcardOrigin("http://example.com", "http://*")).toBe(
          true,
        );
        expect(
          matchesWildcardOrigin("http://api.example.com", "http://*"),
        ).toBe(true);
        expect(matchesWildcardOrigin("http://localhost:3000", "http://*")).toBe(
          true,
        );
      });

      it("should NOT match https://* for HTTP origins", () => {
        expect(matchesWildcardOrigin("http://example.com", "https://*")).toBe(
          false,
        );
        expect(
          matchesWildcardOrigin("http://api.example.com", "https://*"),
        ).toBe(false);
      });

      it("should NOT match http://* for HTTPS origins", () => {
        expect(matchesWildcardOrigin("https://example.com", "http://*")).toBe(
          false,
        );
        expect(
          matchesWildcardOrigin("https://api.example.com", "http://*"),
        ).toBe(false);
      });
    });

    describe("Protocol-specific domain wildcards", () => {
      it("should match https://*.example.com for HTTPS subdomains only", () => {
        expect(
          matchesWildcardOrigin(
            "https://api.example.com",
            "https://*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "https://www.example.com",
            "https://*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "http://api.example.com",
            "https://*.example.com",
          ),
        ).toBe(false);
      });

      it("should handle IP address origins with protocol wildcards", () => {
        // Protocol-only wildcards should match IP addresses
        expect(matchesWildcardOrigin("https://192.168.1.1", "https://*")).toBe(
          true,
        );
        expect(matchesWildcardOrigin("http://127.0.0.1:8080", "http://*")).toBe(
          true,
        );
        expect(matchesWildcardOrigin("https://[::1]", "https://*")).toBe(true);
        expect(
          matchesWildcardOrigin("http://[2001:db8::1]:3000", "http://*"),
        ).toBe(true);

        // Wrong protocol should not match
        expect(matchesWildcardOrigin("http://192.168.1.1", "https://*")).toBe(
          false,
        );
        expect(matchesWildcardOrigin("https://127.0.0.1", "http://*")).toBe(
          false,
        );
      });

      it("should handle trailing dots in wildcard matching", () => {
        expect(
          matchesWildcardOrigin(
            "https://api.example.com.",
            "https://*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "https://api.example.com",
            "https://*.example.com.",
          ),
        ).toBe(true);
      });

      it("should match http://*.example.com for HTTP subdomains only", () => {
        expect(
          matchesWildcardOrigin(
            "http://api.example.com",
            "http://*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "http://www.example.com",
            "http://*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "https://api.example.com",
            "http://*.example.com",
          ),
        ).toBe(false);
      });

      it("should support double asterisk with protocol: https://**.example.com", () => {
        expect(
          matchesWildcardOrigin(
            "https://www.api.example.com",
            "https://**.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "https://api.example.com",
            "https://**.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "http://www.api.example.com",
            "https://**.example.com",
          ),
        ).toBe(false);
      });

      it("should NOT match apex domains with protocol-specific wildcards", () => {
        expect(
          matchesWildcardOrigin("https://example.com", "https://*.example.com"),
        ).toBe(false);
        expect(
          matchesWildcardOrigin("http://example.com", "http://*.example.com"),
        ).toBe(false);
      });

      it("should handle IPv4-mapped IPv6 and IPv6 scope identifiers with protocol wildcards", () => {
        // Protocol-only wildcards should match valid IPv6 forms
        expect(
          matchesWildcardOrigin("https://[::ffff:192.0.2.128]", "https://*"),
        ).toBe(true);
        expect(matchesWildcardOrigin("http://[2001:db8::1]", "http://*")).toBe(
          true,
        );

        // Invalid IPv6 URLs should not match (security improvement)
        expect(
          matchesWildcardOrigin("http://[fe80::1%25eth0]", "http://*"),
        ).toBe(false); // Invalid URL format

        // Domain wildcards should not match IP literals
        expect(
          matchesWildcardOrigin(
            "https://[::ffff:192.0.2.128]",
            "*.example.com",
          ),
        ).toBe(false);
        expect(
          matchesWildcardOrigin("http://[2001:db8::1]", "**.example.com"),
        ).toBe(false);
      });

      it("should handle uppercase wildcard patterns (protocol and host) case-insensitively", () => {
        expect(
          matchesWildcardOrigin(
            "https://api.example.com",
            "HTTPS://**.EXAMPLE.COM",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "https://www.api.example.com",
            "HTTPS://**.EXAMPLE.COM",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "http://api.example.com",
            "HTTPS://**.EXAMPLE.COM",
          ),
        ).toBe(false);
        expect(
          matchesWildcardOrigin(
            "https://API.EXAMPLE.COM",
            "https://*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "HTTPS://API.EXAMPLE.COM",
            "https://*.example.com",
          ),
        ).toBe(true);
      });
    });
  });

  describe("matchesWildcardOrigin - Protocol-agnostic matching", () => {
    describe("Single asterisk (*) - Direct subdomains only", () => {
      it("should match direct subdomains with any protocol", () => {
        expect(
          matchesWildcardOrigin("https://api.example.com", "*.example.com"),
        ).toBe(true);
        expect(
          matchesWildcardOrigin("http://api.example.com", "*.example.com"),
        ).toBe(true);
      });

      it("should NOT match nested subdomains", () => {
        expect(
          matchesWildcardOrigin("https://app.api.example.com", "*.example.com"),
        ).toBe(false);
        expect(
          matchesWildcardOrigin(
            "http://v2.app.api.example.com",
            "*.example.com",
          ),
        ).toBe(false);
      });

      it("should NOT match apex domain", () => {
        expect(
          matchesWildcardOrigin("https://example.com", "*.example.com"),
        ).toBe(false);
        expect(
          matchesWildcardOrigin("http://example.com", "*.example.com"),
        ).toBe(false);
      });

      it("should handle ports correctly", () => {
        expect(
          matchesWildcardOrigin(
            "https://api.example.com:8080",
            "*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin("http://api.example.com:3000", "*.example.com"),
        ).toBe(true);
      });
    });

    describe("Double asterisk (**) - All subdomains including nested", () => {
      it("should match direct subdomains", () => {
        expect(
          matchesWildcardOrigin("https://api.example.com", "**.example.com"),
        ).toBe(true);
        expect(
          matchesWildcardOrigin("http://app.example.com", "**.example.com"),
        ).toBe(true);
      });

      it("should match nested subdomains", () => {
        expect(
          matchesWildcardOrigin(
            "https://app.api.example.com",
            "**.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "http://v2.app.api.example.com",
            "**.example.com",
          ),
        ).toBe(true);
      });

      it("should support nested wildcard patterns", () => {
        expect(
          matchesWildcardOrigin(
            "https://api.blogs.foo.com",
            "**.blogs.foo.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "https://v2.api.blogs.foo.com",
            "**.blogs.foo.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin("https://blogs.foo.com", "**.blogs.foo.com"),
        ).toBe(false);
      });
    });

    it("should handle invalid origins gracefully", () => {
      expect(matchesWildcardOrigin("invalid-url", "*.example.com")).toBe(false);
      expect(matchesWildcardOrigin("null", "*.example.com")).toBe(false);
    });

    it("should return false for non-wildcard patterns", () => {
      expect(
        matchesWildcardOrigin("https://api.example.com", "example.com"),
      ).toBe(false);
    });
  });

  // New tests for security hardening guards
  describe("Wildcard hardening - security guards", () => {
    it("should reject non-HTTP(S) schemes in origin wildcard matching", () => {
      expect(
        matchesWildcardOrigin("ws://api.example.com", "*.example.com"),
      ).toBe(false);
      expect(matchesWildcardOrigin("ftp://example.com", "https://*")).toBe(
        false,
      );
      expect(
        matchesWildcardOrigin("chrome-extension://abcd", "https://*"),
      ).toBe(false);
      expect(matchesWildcardOrigin("file:///etc/hosts", "http://*")).toBe(
        false,
      );
    });

    it("should prevent wildcard matching of IP addresses in domain wildcards", () => {
      expect(matchesWildcardDomain("127.0.0.1", "*.0.0.1")).toBe(false);
      expect(matchesWildcardDomain("127.0.0.1", "**.example.com")).toBe(false);
      expect(matchesWildcardDomain("[::1]", "*.example.com")).toBe(false);
      expect(
        matchesWildcardDomain("[::ffff:192.0.2.128]", "**.example.com"),
      ).toBe(false);
    });

    it("should reject wildcard patterns with ports/paths/query/fragment/brackets (domain)", () => {
      expect(
        matchesWildcardDomain("api.example.com", "*.example.com:8080"),
      ).toBe(false);
      expect(
        matchesWildcardDomain("api.example.com", "*.example.com/path"),
      ).toBe(false);
      expect(
        matchesWildcardDomain("api.example.com", "*.example.com?x=1"),
      ).toBe(false);
      expect(
        matchesWildcardDomain("api.example.com", "*.example.com#frag"),
      ).toBe(false);
      expect(matchesWildcardDomain("api.example.com", "**.[::1]")).toBe(false);
    });

    it("should reject wildcard patterns with ports/paths/query/fragment/brackets in protocol-specific origin patterns", () => {
      expect(
        matchesWildcardOrigin(
          "https://api.example.com",
          "https://*.example.com:8080",
        ),
      ).toBe(false);
      expect(
        matchesWildcardOrigin(
          "https://api.example.com",
          "https://*.example.com/path",
        ),
      ).toBe(false);
      expect(
        matchesWildcardOrigin(
          "https://api.example.com",
          "https://*.example.com?x=1",
        ),
      ).toBe(false);
      expect(
        matchesWildcardOrigin(
          "https://api.example.com",
          "https://*.example.com#frag",
        ),
      ).toBe(false);
      expect(matchesWildcardOrigin("https://[::1]", "https://**.[::1]")).toBe(
        false,
      );
    });

    it("should reject wildcard patterns that target public suffixes (PSL tails)", () => {
      // Domain wildcard patterns with a fixed tail equal to a public suffix must be rejected
      expect(matchesWildcardDomain("api.com", "*.com")).toBe(false);
      expect(matchesWildcardDomain("a.b.co.uk", "**.co.uk")).toBe(false);
      expect(matchesWildcardDomain("x.y.z.net", "*.*.net")).toBe(false);
      expect(matchesWildcardDomain("api.com", "api.*.com")).toBe(false);

      // Protocol-specific origin patterns should inherit the same PSL guard via domain-utils
      expect(matchesWildcardOrigin("https://api.com", "*.com")).toBe(false);
      expect(matchesWildcardOrigin("https://a.b.co.uk", "**.co.uk")).toBe(
        false,
      );
      expect(matchesWildcardOrigin("https://x.y.z.net", "*.*.net")).toBe(false);

      // Non-PSL tails (e.g., localhost) should still be allowed
      expect(matchesWildcardDomain("api.localhost", "*.localhost")).toBe(true);
      expect(
        matchesWildcardOrigin("https://api.localhost", "*.localhost"),
      ).toBe(true);

      // Apex localhost should not match wildcard (must be explicit)
      expect(matchesWildcardDomain("localhost", "*.localhost")).toBe(false);
    });
  });

  describe("matchesDomainList", () => {
    it("should match exact domains", () => {
      expect(
        matchesDomainList("example.com", ["example.com", "test.com"]),
      ).toBe(true);
      expect(matchesDomainList("test.com", ["example.com", "test.com"])).toBe(
        true,
      );
      expect(matchesDomainList("other.com", ["example.com", "test.com"])).toBe(
        false,
      );
    });

    it("should match single asterisk wildcard domains", () => {
      expect(matchesDomainList("api.example.com", ["*.example.com"])).toBe(
        true,
      );
      expect(matchesDomainList("app.api.example.com", ["*.example.com"])).toBe(
        false,
      ); // nested not allowed
      expect(matchesDomainList("example.com", ["*.example.com"])).toBe(false);
    });

    it("should match double asterisk wildcard domains", () => {
      expect(matchesDomainList("api.example.com", ["**.example.com"])).toBe(
        true,
      );
      expect(matchesDomainList("app.api.example.com", ["**.example.com"])).toBe(
        true,
      ); // nested allowed
      expect(matchesDomainList("example.com", ["**.example.com"])).toBe(false);
    });

    it("should support mixed exact and wildcard patterns", () => {
      const domains = ["example.com", "*.api.example.com", "test.com"];
      expect(matchesDomainList("example.com", domains)).toBe(true);
      expect(matchesDomainList("v1.api.example.com", domains)).toBe(true); // direct subdomain
      expect(matchesDomainList("app.v1.api.example.com", domains)).toBe(false); // nested not allowed with *
      expect(matchesDomainList("api.example.com", domains)).toBe(false); // apex of wildcard
      expect(matchesDomainList("test.com", domains)).toBe(true);
    });

    it("should throw on origin-style patterns in domain lists", () => {
      // Alone, an origin-style wildcard should cause a throw
      expect(() =>
        matchesDomainList("api.example.com", ["https://*.example.com"]),
      ).toThrowError(/origin-style patterns are not allowed/i);

      // When combined with a proper domain wildcard, it should still throw
      expect(() =>
        matchesDomainList("api.example.com", [
          "https://*.example.com",
          "*.example.com",
        ]),
      ).toThrowError(/origin-style patterns are not allowed/i);

      // Mixed protocol-specific origin patterns should also throw
      expect(() =>
        matchesDomainList("app.api.example.com", [
          "http://**.example.com",
          "https://**.example.com",
        ]),
      ).toThrowError(/origin-style patterns are not allowed/i);
    });

    it("should throw on non-wildcard origin entries", () => {
      expect(() =>
        matchesDomainList("example.com", ["https://example.com"]),
      ).toThrowError(/origin-style patterns are not allowed/i);
      expect(() =>
        matchesDomainList("example.com", ["http://example.com"]),
      ).toThrowError(/origin-style patterns are not allowed/i);
    });

    it("should trim and skip empty entries", () => {
      expect(
        matchesDomainList("api.example.com", ["  ", "\t\n", "*.example.com"]),
      ).toBe(true);
    });

    it("should early-return false for invalid input domains", () => {
      expect(matchesDomainList("   ", ["*.example.com"])).toBe(false);
      expect(matchesDomainList("\t\n", ["example.com"])).toBe(false);
    });
  });

  describe("matchesOriginList", () => {
    it("should support global wildcard '*' in origin lists", () => {
      const allowedOrigins = ["*"];

      // Global wildcard should match any valid origin
      expect(matchesOriginList("https://example.com", allowedOrigins)).toBe(
        true,
      );
      expect(matchesOriginList("http://api.example.com", allowedOrigins)).toBe(
        true,
      );
      expect(
        matchesOriginList("https://sub.domain.example.com", allowedOrigins),
      ).toBe(true);
      expect(matchesOriginList("http://localhost:3000", allowedOrigins)).toBe(
        true,
      );
      expect(matchesOriginList("https://192.168.1.1", allowedOrigins)).toBe(
        true,
      );

      // Should reject undefined/null origins by default
      expect(matchesOriginList(undefined, allowedOrigins)).toBe(false);
      expect(matchesOriginList("", allowedOrigins)).toBe(false);
    });

    it("should support treatNoOriginAsAllowed option with global wildcard", () => {
      const allowedOrigins = ["*"];

      // With treatNoOriginAsAllowed: true, undefined origins should be allowed when "*" is present
      expect(
        matchesOriginList(undefined, allowedOrigins, {
          treatNoOriginAsAllowed: true,
        }),
      ).toBe(true);

      // Without the option, should still reject
      expect(
        matchesOriginList(undefined, allowedOrigins, {
          treatNoOriginAsAllowed: false,
        }),
      ).toBe(false);
      expect(matchesOriginList(undefined, allowedOrigins)).toBe(false); // default behavior
    });

    it("should require global wildcard for treatNoOriginAsAllowed to work", () => {
      const allowedOriginsWithoutWildcard = [
        "https://example.com",
        "http://api.com",
      ];

      // Even with treatNoOriginAsAllowed: true, should reject if no "*" in the list
      expect(
        matchesOriginList(undefined, allowedOriginsWithoutWildcard, {
          treatNoOriginAsAllowed: true,
        }),
      ).toBe(false);

      const allowedOriginsWithWildcard = [
        "https://example.com",
        "*",
        "http://api.com",
      ];

      // Should allow when "*" is present
      expect(
        matchesOriginList(undefined, allowedOriginsWithWildcard, {
          treatNoOriginAsAllowed: true,
        }),
      ).toBe(true);
      expect(matchesOriginList("", allowedOriginsWithWildcard)).toBe(false);
    });

    it("should work with mixed patterns including global wildcard", () => {
      const allowedOrigins = ["https://example.com", "*", "*.api.com"];

      // All should match due to global wildcard
      expect(matchesOriginList("https://example.com", allowedOrigins)).toBe(
        true,
      );
      expect(matchesOriginList("http://different.com", allowedOrigins)).toBe(
        true,
      );
      expect(matchesOriginList("https://test.api.com", allowedOrigins)).toBe(
        true,
      );
    });

    it("should reject invalid all-wildcard patterns in origin lists", () => {
      // These should not match due to invalid patterns
      expect(matchesOriginList("https://example.com", ["*.*"])).toBe(false);
      expect(matchesOriginList("https://example.com", ["**.*"])).toBe(false);
      expect(matchesOriginList("https://example.com", ["*.**"])).toBe(false);
    });
    it("should match exact origins", () => {
      const origins = ["https://example.com", "http://test.com"];
      expect(matchesOriginList("https://example.com", origins)).toBe(true);
      expect(matchesOriginList("http://test.com", origins)).toBe(true);
      expect(matchesOriginList("https://other.com", origins)).toBe(false);
    });

    it("should match single asterisk wildcard origins", () => {
      const origins = ["*.example.com"];
      expect(matchesOriginList("https://api.example.com", origins)).toBe(true);
      expect(matchesOriginList("http://api.example.com", origins)).toBe(true);
      expect(matchesOriginList("https://app.api.example.com", origins)).toBe(
        false,
      ); // nested not allowed
      expect(matchesOriginList("https://example.com", origins)).toBe(false);
    });

    it("should match double asterisk wildcard origins", () => {
      const origins = ["**.example.com"];
      expect(matchesOriginList("https://api.example.com", origins)).toBe(true);
      expect(matchesOriginList("https://app.api.example.com", origins)).toBe(
        true,
      ); // nested allowed
      expect(matchesOriginList("https://example.com", origins)).toBe(false);
    });

    it("should handle undefined origin", () => {
      expect(matchesOriginList(undefined, ["*.example.com"])).toBe(false);
    });

    it("should support nested wildcard patterns with double asterisk", () => {
      const origins = ["**.blogs.foo.com"];
      expect(matchesOriginList("https://api.blogs.foo.com", origins)).toBe(
        true,
      );
      expect(matchesOriginList("https://v2.api.blogs.foo.com", origins)).toBe(
        true,
      );
      expect(matchesOriginList("https://blogs.foo.com", origins)).toBe(false);
    });

    it("should NOT match nested with single asterisk", () => {
      const origins = ["*.blogs.foo.com"];
      expect(matchesOriginList("https://api.blogs.foo.com", origins)).toBe(
        true,
      ); // direct subdomain
      expect(matchesOriginList("https://v2.api.blogs.foo.com", origins)).toBe(
        false,
      ); // nested not allowed
      expect(matchesOriginList("https://blogs.foo.com", origins)).toBe(false);
    });
  });

  describe("matchesCORSCredentialsList", () => {
    it("should match exact origins in credentials list", () => {
      const allowedOrigins = ["https://example.com", "https://api.example.com"];
      expect(
        matchesCORSCredentialsList("https://example.com", allowedOrigins),
      ).toBe(true);
      expect(
        matchesCORSCredentialsList("https://api.example.com", allowedOrigins),
      ).toBe(true);
      expect(
        matchesCORSCredentialsList("https://other.com", allowedOrigins),
      ).toBe(false);
    });

    it("should handle case-insensitive matching", () => {
      const allowedOrigins = ["https://Example.COM"];
      expect(
        matchesCORSCredentialsList("https://example.com", allowedOrigins),
      ).toBe(true);
      expect(
        matchesCORSCredentialsList("HTTPS://EXAMPLE.COM", allowedOrigins),
      ).toBe(true);
    });

    it("should return false for undefined origin", () => {
      const allowedOrigins = ["https://example.com"];
      expect(matchesCORSCredentialsList(undefined, allowedOrigins)).toBe(false);
    });

    it("should handle port normalization", () => {
      const allowedOrigins = [
        "https://example.com:443",
        "http://api.example.com:80",
      ];
      expect(
        matchesCORSCredentialsList("https://example.com", allowedOrigins),
      ).toBe(true);
      expect(
        matchesCORSCredentialsList("http://api.example.com", allowedOrigins),
      ).toBe(true);
    });

    it("should not support wildcards for security", () => {
      const allowedOrigins = ["*.example.com"];
      expect(
        matchesCORSCredentialsList("https://api.example.com", allowedOrigins),
      ).toBe(false);
      expect(matchesCORSCredentialsList("*.example.com", allowedOrigins)).toBe(
        true,
      ); // exact match only
    });
  });

  describe("matchesCORSCredentialsList (unified)", () => {
    it("supports exact-only by default", () => {
      const allowed = [
        "https://admin.example.com",
        "https://console.example.com",
      ];
      expect(
        matchesCORSCredentialsList("https://admin.example.com", allowed),
      ).toBe(true);
      expect(
        matchesCORSCredentialsList("https://sub.admin.example.com", allowed),
      ).toBe(false);
    });

    it("supports subdomain wildcards when enabled", () => {
      const allowed = ["https://*.example.com", "https://partner.io"];
      expect(
        matchesCORSCredentialsList("https://admin.example.com", allowed, {
          allowWildcardSubdomains: true,
        }),
      ).toBe(true);
      expect(
        matchesCORSCredentialsList("https://deep.admin.example.com", allowed, {
          allowWildcardSubdomains: true,
        }),
      ).toBe(false); // *.example.com is direct subdomains only
    });
  });

  describe("Edge Cases and Advanced Scenarios", () => {
    describe("IDN (Internationalized Domain Names) + Wildcard", () => {
      it("should handle punycode conversion in wildcard patterns", () => {
        // Test that IDN domains are properly converted to punycode for matching
        expect(matchesWildcardDomain("tést.例え.com", "*.例え.com")).toBe(true);
        expect(matchesWildcardDomain("café.münchen.de", "*.münchen.de")).toBe(
          true,
        );
        expect(
          matchesWildcardDomain("api.xn--nxasmq6b.com", "*.xn--nxasmq6b.com"),
        ).toBe(true);

        // Mixed IDN and ASCII
        expect(matchesWildcardDomain("api.例え.com", "*.例え.com")).toBe(true);
        expect(matchesWildcardDomain("tést.example.com", "*.example.com")).toBe(
          true,
        );

        // Should work with origins too
        expect(
          matchesWildcardOrigin("https://tést.例え.com", "*.例え.com"),
        ).toBe(true);
        expect(
          matchesWildcardOrigin("https://café.münchen.de", "*.münchen.de"),
        ).toBe(true);
      });

      it("should handle IDN with double asterisk patterns", () => {
        expect(matchesWildcardDomain("sub.tést.例え.com", "**.例え.com")).toBe(
          true,
        );
        expect(
          matchesWildcardDomain("deep.nested.café.münchen.de", "**.münchen.de"),
        ).toBe(true);

        // Apex should still not match
        expect(matchesWildcardDomain("例え.com", "**.例え.com")).toBe(false);
        expect(matchesWildcardDomain("münchen.de", "**.münchen.de")).toBe(
          false,
        );
      });
    });

    describe("Apex Exclusions with Complex TLDs", () => {
      it("should handle apex exclusions with country code TLDs", () => {
        // Single asterisk should not match apex
        expect(matchesWildcardDomain("example.co.uk", "*.example.co.uk")).toBe(
          false,
        );
        expect(
          matchesWildcardDomain("example.com.au", "*.example.com.au"),
        ).toBe(false);
        expect(
          matchesWildcardDomain("example.org.nz", "*.example.org.nz"),
        ).toBe(false);

        // But should match direct subdomains
        expect(
          matchesWildcardDomain("api.example.co.uk", "*.example.co.uk"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("www.example.com.au", "*.example.com.au"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("blog.example.org.nz", "*.example.org.nz"),
        ).toBe(true);
      });

      it("should handle double asterisk apex exclusions with complex TLDs", () => {
        // Double asterisk should not match apex
        expect(matchesWildcardDomain("example.co.uk", "**.example.co.uk")).toBe(
          false,
        );
        expect(
          matchesWildcardDomain("example.com.au", "**.example.com.au"),
        ).toBe(false);

        // But should match subdomains at any depth
        expect(
          matchesWildcardDomain("a.example.co.uk", "**.example.co.uk"),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "api.staging.example.co.uk",
            "**.example.co.uk",
          ),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "deep.nested.api.example.com.au",
            "**.example.com.au",
          ),
        ).toBe(true);
      });

      it("should handle origins with complex TLD apex exclusions", () => {
        // Origin matching should follow same rules
        expect(
          matchesWildcardOrigin("https://example.co.uk", "*.example.co.uk"),
        ).toBe(false);
        expect(
          matchesWildcardOrigin("https://example.co.uk", "**.example.co.uk"),
        ).toBe(false);

        expect(
          matchesWildcardOrigin("https://api.example.co.uk", "*.example.co.uk"),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "https://api.staging.example.co.uk",
            "**.example.co.uk",
          ),
        ).toBe(true);
      });
    });

    describe("Multi-Wildcards Edge Cases", () => {
      it("should handle *.api.*.example.com patterns correctly", () => {
        // Should match when both wildcards have exactly one label
        expect(
          matchesWildcardDomain("x.api.y.example.com", "*.api.*.example.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "v1.api.staging.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "prod.api.west.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(true);

        // Should NOT match when first wildcard is missing (leading * needs 1 label)
        expect(
          matchesWildcardDomain("api.y.example.com", "*.api.*.example.com"),
        ).toBe(false);
        expect(
          matchesWildcardDomain(
            "api.staging.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(false);

        // Should NOT match when second wildcard is missing
        expect(
          matchesWildcardDomain("x.api.example.com", "*.api.*.example.com"),
        ).toBe(false);

        // Should NOT match when either wildcard has multiple labels
        expect(
          matchesWildcardDomain("a.b.api.y.example.com", "*.api.*.example.com"),
        ).toBe(false);
        expect(
          matchesWildcardDomain("x.api.a.b.example.com", "*.api.*.example.com"),
        ).toBe(false);
      });

      it("should handle mixed * and ** in multi-wildcard patterns", () => {
        // **.api.*.example.com - any depth before api, exactly one after
        expect(
          matchesWildcardDomain(
            "deep.nested.api.staging.example.com",
            "**.api.*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "v1.api.prod.example.com",
            "**.api.*.example.com",
          ),
        ).toBe(true);

        // Should not match when second wildcard has multiple labels
        expect(
          matchesWildcardDomain(
            "v1.api.a.b.example.com",
            "**.api.*.example.com",
          ),
        ).toBe(false);

        // *.api.**.example.com - exactly one before api, any depth after
        expect(
          matchesWildcardDomain(
            "v1.api.staging.west.example.com",
            "*.api.**.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardDomain(
            "prod.api.deep.nested.path.example.com",
            "*.api.**.example.com",
          ),
        ).toBe(true);

        // Should not match when first wildcard has multiple labels
        expect(
          matchesWildcardDomain(
            "a.b.api.staging.example.com",
            "*.api.**.example.com",
          ),
        ).toBe(false);
      });

      it("should handle origin matching with multi-wildcards", () => {
        // Should work with origins too
        expect(
          matchesWildcardOrigin(
            "https://x.api.y.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "http://api.y.example.com",
            "*.api.*.example.com",
          ),
        ).toBe(false);

        // Protocol-specific multi-wildcards
        expect(
          matchesWildcardOrigin(
            "https://x.api.y.example.com",
            "https://*.api.*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "http://x.api.y.example.com",
            "https://*.api.*.example.com",
          ),
        ).toBe(false);
      });

      it("should support *.bar.*.demo.com pattern precisely", () => {
        // Domain matching
        expect(
          matchesWildcardDomain("x.bar.y.demo.com", "*.bar.*.demo.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("api.bar.stg.demo.com", "*.bar.*.demo.com"),
        ).toBe(true);

        // Missing first * (needs exactly one label before bar)
        expect(
          matchesWildcardDomain("bar.y.demo.com", "*.bar.*.demo.com"),
        ).toBe(false);
        // Missing second * (needs exactly one label between bar and demo.com)
        expect(
          matchesWildcardDomain("x.bar.demo.com", "*.bar.*.demo.com"),
        ).toBe(false);
        // Too many labels for the second *
        expect(
          matchesWildcardDomain("x.bar.a.b.demo.com", "*.bar.*.demo.com"),
        ).toBe(false);
        // Apex should never match
        expect(matchesWildcardDomain("demo.com", "*.bar.*.demo.com")).toBe(
          false,
        );

        // Origin matching (protocol-agnostic host pattern)
        expect(
          matchesWildcardOrigin("https://x.bar.y.demo.com", "*.bar.*.demo.com"),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "http://api.bar.stg.demo.com",
            "*.bar.*.demo.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin("https://bar.y.demo.com", "*.bar.*.demo.com"),
        ).toBe(false);
        expect(
          matchesWildcardOrigin("https://x.bar.demo.com", "*.bar.*.demo.com"),
        ).toBe(false);
        expect(
          matchesWildcardOrigin(
            "https://x.bar.a.b.demo.com",
            "*.bar.*.demo.com",
          ),
        ).toBe(false);
        expect(
          matchesWildcardOrigin("https://demo.com", "*.bar.*.demo.com"),
        ).toBe(false);
      });
    });

    describe("IPv6 Origins", () => {
      it("should handle IPv6 origins without treating colons as label separators", () => {
        // IPv6 addresses should be treated as single units, not parsed for subdomains
        const ipv6Origins = [
          "https://[2001:db8::1]",
          "http://[::1]",
          "https://[fe80::1234:5678]",
          "http://[2001:db8:85a3::8a2e:370:7334]",
          "https://[2001:db8::1]:8080",
        ];

        // IPv6 zone ID with default port should remove port
        expect(normalizeOrigin("https://[fe80::1%25eth0]:443")).toBe(
          "https://[fe80::1%25eth0]",
        );

        // IPv6 addresses should normalize correctly
        ipv6Origins.forEach((origin) => {
          const normalized = normalizeOrigin(origin);
          expect(normalized).toBe(origin);
          expect(typeof normalized).toBe("string");
          expect(normalized.includes("[")).toBe(true);
          expect(normalized.includes("]")).toBe(true);
        });

        // IPv6 addresses should not match domain wildcards
        expect(
          matchesWildcardOrigin("https://[2001:db8::1]", "*.example.com"),
        ).toBe(false);
        expect(matchesWildcardOrigin("http://[::1]", "**.example.com")).toBe(
          false,
        );

        // But should match protocol-only wildcards
        expect(
          matchesWildcardOrigin("https://[2001:db8::1]", "https://*"),
        ).toBe(true);
        expect(matchesWildcardOrigin("http://[::1]", "http://*")).toBe(true);
        expect(matchesWildcardOrigin("https://[2001:db8::1]", "http://*")).toBe(
          false,
        );
      });

      it("should handle IPv6 with ports correctly", () => {
        // IPv6 with non-default ports
        expect(normalizeOrigin("https://[2001:db8::1]:8080")).toBe(
          "https://[2001:db8::1]:8080",
        );
        expect(normalizeOrigin("http://[::1]:3000")).toBe("http://[::1]:3000");

        // IPv6 with default ports should be normalized
        expect(normalizeOrigin("https://[2001:db8::1]:443")).toBe(
          "https://[2001:db8::1]",
        );
        expect(normalizeOrigin("http://[::1]:80")).toBe("http://[::1]");
      });

      it("should handle IPv6 in origin lists", () => {
        const origins = ["https://[2001:db8::1]", "http://[::1]:3000"];

        expect(matchesOriginList("https://[2001:db8::1]", origins)).toBe(true);
        expect(matchesOriginList("http://[::1]:3000", origins)).toBe(true);
        expect(matchesOriginList("https://[::1]", origins)).toBe(false);

        // Should work with port normalization
        expect(matchesOriginList("https://[2001:db8::1]:443", origins)).toBe(
          true,
        );
      });
    });

    describe("Null Origin Flow", () => {
      it("should handle 'null' origin normalization", () => {
        // normalizeOrigin should return "null" for string "null"
        expect(normalizeOrigin("null")).toBe("null");
        expect(normalizeOrigin("NULL")).toBe(""); // Case sensitive enforced

        // Other invalid URLs return empty sentinel
        expect(normalizeOrigin("invalid-url")).toBe("");
        expect(normalizeOrigin("")).toBe("");
        expect(normalizeOrigin("not-a-url")).toBe("");
      });

      it("should ensure wildcard patterns do not match 'null' origins", () => {
        // Wildcard domain matching should not match "null"
        expect(matchesWildcardDomain("null", "*.example.com")).toBe(false);
        expect(matchesWildcardDomain("null", "**.example.com")).toBe(false);
        expect(matchesWildcardDomain("null", "*.*.example.com")).toBe(false);

        // Wildcard origin matching should not match "null"
        expect(matchesWildcardOrigin("null", "*.example.com")).toBe(false);
        expect(matchesWildcardOrigin("null", "**.example.com")).toBe(false);
        expect(matchesWildcardOrigin("null", "https://*")).toBe(false);
        expect(matchesWildcardOrigin("null", "http://*.example.com")).toBe(
          false,
        );
      });

      it("should allow exact 'null' matches in origin lists", () => {
        // Exact string matching should work for "null"
        expect(matchesOriginList("null", ["null", "https://example.com"])).toBe(
          true,
        );
        expect(matchesOriginList("null", ["https://example.com"])).toBe(false);

        // CORS credentials should work with exact "null" matches
        expect(matchesCORSCredentialsList("null", ["null"])).toBe(true);
        expect(
          matchesCORSCredentialsList("null", ["https://example.com"]),
        ).toBe(false);

        // Wildcard credentials should not match "null" even if "null" is in pattern
        expect(
          matchesCORSCredentialsList("null", ["*.example.com"], {
            allowWildcardSubdomains: true,
          }),
        ).toBe(false);
        expect(
          matchesCORSCredentialsList("null", ["null", "*.example.com"], {
            allowWildcardSubdomains: true,
          }),
        ).toBe(true); // exact match
      });

      it("should handle domain list matching with 'null'", () => {
        // Domain matching should not work with "null" for wildcards
        expect(matchesDomainList("null", ["*.example.com"])).toBe(false);
        expect(matchesDomainList("null", ["**.example.com"])).toBe(false);

        // But exact domain matching should work
        expect(matchesDomainList("null", ["null", "example.com"])).toBe(true);
        expect(matchesDomainList("null", ["example.com"])).toBe(false);
      });

      it("rejects exact domains that equal a public suffix", () => {
        const r = validateConfigEntry("com", "domain");
        expect(r.valid).toBe(false);
        expect(r.info).toBe("entry equals a public suffix (not registrable)");
      });

      it("rejects protocol wildcards in domain context with clear message", () => {
        const r = validateConfigEntry("https://*", "domain");
        expect(r.valid).toBe(false);
        expect(r.info).toBe("protocols are not allowed in domain context");
      });

      it("rejects origin-style entries in domain context with clear message", () => {
        const r = validateConfigEntry("https://example.com", "domain");
        expect(r.valid).toBe(false);
        expect(r.info).toBe("protocols are not allowed in domain context");
      });

      it("allows exact IP addresses in domain context", () => {
        const r = validateConfigEntry("127.0.0.1", "domain");
        expect(r.valid).toBe(true);
      });

      it("rejects exact domains with invalid characters", () => {
        // @ character should be rejected
        expect(validateConfigEntry("example.com@evil", "domain")).toEqual({
          valid: false,
          info: "invalid characters in domain",
          wildcardKind: "none",
        });

        // Brackets should be rejected (unless valid IPv6)
        expect(validateConfigEntry("exa[mple].com", "domain")).toEqual({
          valid: false,
          info: "invalid characters in domain",
          wildcardKind: "none",
        });

        // Backslash should be rejected
        expect(validateConfigEntry("exa\\mple.com", "domain")).toEqual({
          valid: false,
          info: "invalid characters in domain",
          wildcardKind: "none",
        });

        // Other invalid characters
        expect(validateConfigEntry("example.com/path", "domain")).toEqual({
          valid: false,
          info: "invalid characters in domain",
          wildcardKind: "none",
        });

        expect(validateConfigEntry("example.com?query", "domain")).toEqual({
          valid: false,
          info: "invalid characters in domain",
          wildcardKind: "none",
        });

        expect(validateConfigEntry("example.com#fragment", "domain")).toEqual({
          valid: false,
          info: "invalid characters in domain",
          wildcardKind: "none",
        });

        expect(validateConfigEntry("example.com:8080", "domain")).toEqual({
          valid: false,
          info: "invalid characters in domain",
          wildcardKind: "none",
        });
      });
    });

    describe("validateConfigEntry", () => {
      it("should validate global wildcard '*' in origin context when allowed", () => {
        // Global wildcard should be valid when explicitly allowed
        expect(
          validateConfigEntry("*", "origin", { allowGlobalWildcard: true }),
        ).toEqual({
          valid: true,
          wildcardKind: "global",
        });

        // Should be invalid by default
        expect(validateConfigEntry("*", "origin")).toEqual({
          valid: false,
          info: "global wildcard '*' not allowed in this context",
          wildcardKind: "none",
        });

        expect(
          validateConfigEntry("*", "origin", { allowGlobalWildcard: false }),
        ).toEqual({
          valid: false,
          info: "global wildcard '*' not allowed in this context",
          wildcardKind: "none",
        });
      });

      it("should reject global wildcard '*' in domain context", () => {
        // Global wildcard should be rejected by default in domain context
        expect(validateConfigEntry("*", "domain")).toEqual({
          valid: false,
          info: "global wildcard '*' not allowed in this context",
          wildcardKind: "none",
        });

        expect(
          validateConfigEntry("*", "domain", { allowGlobalWildcard: true }),
        ).toEqual({
          valid: true,
          wildcardKind: "global",
        });
      });

      it("should reject invalid all-wildcard patterns", () => {
        // These should be rejected in both contexts
        expect(validateConfigEntry("*.*", "origin")).toEqual({
          valid: false,
          info: "all-wildcards pattern is not allowed",
          wildcardKind: "none",
        });

        expect(validateConfigEntry("**.*", "origin")).toEqual({
          valid: false,
          info: "all-wildcards pattern is not allowed",
          wildcardKind: "none",
        });

        expect(validateConfigEntry("*.*.com", "origin")).toEqual({
          valid: false,
          info: "wildcard tail targets public suffix or IP (disallowed)",
          wildcardKind: "none",
        });
      });

      it("should reject userinfo in origin entries", () => {
        expect(
          validateConfigEntry("https://user:pass@example.com", "origin"),
        ).toEqual({
          valid: false,
          info: "origin must not include userinfo",
          wildcardKind: "none",
        });

        expect(
          validateConfigEntry("http://admin@api.example.com", "origin"),
        ).toEqual({
          valid: false,
          info: "origin must not include userinfo",
          wildcardKind: "none",
        });

        expect(
          validateConfigEntry("https://user@localhost:3000", "origin"),
        ).toEqual({
          valid: false,
          info: "origin must not include userinfo",
          wildcardKind: "none",
        });
      });

      it("should require valid URL parsing for protocol-only wildcards", () => {
        // Valid URLs should match protocol wildcards
        expect(matchesWildcardOrigin("https://example.com", "https://*")).toBe(
          true,
        );
        expect(matchesWildcardOrigin("http://example.com", "http://*")).toBe(
          true,
        );

        // Invalid URLs should NOT match protocol wildcards (security improvement)
        expect(matchesWildcardOrigin("https://", "https://*")).toBe(false);
        expect(matchesWildcardOrigin("https:// bad", "https://*")).toBe(false);
        expect(matchesWildcardOrigin("not-a-url", "https://*")).toBe(false);

        // URLs that parse but have invalid hostnames should still be rejected by domain normalization
        expect(
          matchesWildcardOrigin(
            "https://invalid..domain",
            "https://*.example.com",
          ),
        ).toBe(false);

        // Wrong protocol should not match
        expect(matchesWildcardOrigin("http://example.com", "https://*")).toBe(
          false,
        );
        expect(matchesWildcardOrigin("https://example.com", "http://*")).toBe(
          false,
        );
      });

      it("should fast-fail on invalid wildcard patterns", () => {
        // Invalid patterns with non-domain characters should fail quickly
        expect(matchesWildcardDomain("example.com", "*.example.com:8080")).toBe(
          false,
        );
        expect(matchesWildcardDomain("example.com", "*.example.com/path")).toBe(
          false,
        );
        expect(
          matchesWildcardDomain("example.com", "*.example.com?query"),
        ).toBe(false);
        expect(
          matchesWildcardDomain("example.com", "*.example.com#fragment"),
        ).toBe(false);

        // Invalid patterns with oversized labels should fail quickly
        const longLabel = "a".repeat(64); // > 63 chars
        expect(matchesWildcardDomain("example.com", `*.${longLabel}.com`)).toBe(
          false,
        );

        // Invalid patterns with empty labels should fail quickly
        expect(matchesWildcardDomain("example.com", "*.example..com")).toBe(
          false,
        );
      });

      it("should normalize Unicode dot variants in wildcard patterns", () => {
        // Unicode dot variants should be normalized to ASCII dots for security
        expect(matchesWildcardDomain("api.example.com", "*．example.com")).toBe(
          true,
        ); // Full-width dot (U+FF0E)
        expect(matchesWildcardDomain("api.example.com", "*。example.com")).toBe(
          true,
        ); // Ideographic full stop (U+3002)
        expect(matchesWildcardDomain("api.example.com", "*｡example.com")).toBe(
          true,
        ); // Halfwidth ideographic period (U+FF61)

        // Mixed Unicode and ASCII dots should work
        expect(
          matchesWildcardDomain("api.sub.example.com", "*．*.example.com"),
        ).toBe(true);
        expect(
          matchesWildcardDomain("api.sub.example.com", "*.sub。example.com"),
        ).toBe(true);

        // Should also work in validateConfigEntry
        const result = validateConfigEntry("*．example.com", "domain");
        expect(result.valid).toBe(true);
        expect(result.wildcardKind).toBe("subdomain");
      });

      it("should normalize Unicode dot variants in regular domains", () => {
        // Unicode dots in domain names should be normalized to prevent bypasses
        expect(normalizeDomain("api．example.com")).toBe("api.example.com");
        expect(normalizeDomain("api。example.com")).toBe("api.example.com");
        expect(normalizeDomain("api｡example.com")).toBe("api.example.com");

        // Mixed Unicode and ASCII dots
        expect(normalizeDomain("api．sub.example。com")).toBe(
          "api.sub.example.com",
        );
      });

      it("should recognize Unicode dot IPv4 addresses consistently", () => {
        // Unicode dots in IPv4 addresses should be normalized and recognized as IPs
        expect(normalizeDomain("127。0。0。1")).toBe("127.0.0.1");
        expect(normalizeDomain("192．168．1．1")).toBe("192.168.1.1");
        expect(normalizeDomain("10｡0｡0｡1")).toBe("10.0.0.1");

        // Mixed Unicode and ASCII dots in IPs
        expect(normalizeDomain("127.0。0.1")).toBe("127.0.0.1");

        // Should also work in validation
        expect(validateConfigEntry("127。0。0。1", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });
        expect(validateConfigEntry("192．168．1．1", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });

        // Should work in origin normalization (Chrome compatibility)
        expect(normalizeOrigin("https://127。0。0。1")).toBe(
          "https://127.0.0.1",
        );
        expect(normalizeOrigin("http://192．168．1．1:8080")).toBe(
          "http://192.168.1.1:8080",
        );

        // Should work in wildcard origin matching
        expect(matchesWildcardOrigin("https://127。0。0。1", "https://*")).toBe(
          true,
        );
        expect(
          matchesWildcardOrigin(
            "http://api．example。com",
            "http://*.example.com",
          ),
        ).toBe(true);
        expect(
          matchesWildcardOrigin(
            "https://subdomain．example。com",
            "https://*.example.com",
          ),
        ).toBe(true);
      });

      it("should fix matchesOriginList global wildcard to properly validate origins", () => {
        // Global wildcard should delegate to matchesWildcardOrigin for proper validation
        expect(matchesOriginList("https://example.com", ["*"])).toBe(true);
        expect(matchesOriginList("http://example.com", ["*"])).toBe(true);

        // Should reject invalid origins that don't parse as valid HTTP(S) URLs
        expect(matchesOriginList("null", ["*"])).toBe(false);
        expect(matchesOriginList("ftp://example.com", ["*"])).toBe(false);
        expect(matchesOriginList("not-a-url", ["*"])).toBe(false);
        expect(matchesOriginList("https://", ["*"])).toBe(false);
      });

      it("should allow global wildcard in domain context when explicitly enabled", () => {
        // Global wildcard should be allowed in domain context when allowGlobalWildcard is true
        expect(
          validateConfigEntry("*", "domain", { allowGlobalWildcard: true }),
        ).toEqual({
          valid: true,
          wildcardKind: "global",
        });

        // Should be rejected when allowGlobalWildcard is false (default)
        expect(
          validateConfigEntry("*", "domain", { allowGlobalWildcard: false }),
        ).toEqual({
          valid: false,
          info: "global wildcard '*' not allowed in this context",
          wildcardKind: "none",
        });

        // Default behavior should reject it
        expect(validateConfigEntry("*", "domain")).toEqual({
          valid: false,
          info: "global wildcard '*' not allowed in this context",
          wildcardKind: "none",
        });
      });

      it("should allow IP addresses in domain context consistently", () => {
        // IPv4 addresses should be allowed
        expect(validateConfigEntry("127.0.0.1", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });
        expect(validateConfigEntry("192.168.1.1", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });

        // IPv6 addresses should be allowed (both with and without brackets)
        expect(validateConfigEntry("2001:db8::1", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });
        expect(validateConfigEntry("[2001:db8::1]", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });

        // IPv6 with zone identifier
        expect(validateConfigEntry("fe80::1%eth0", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });
        expect(validateConfigEntry("[fe80::1%25eth0]", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });

        // Invalid IP-like strings are treated as domain names (not IPs), so they may be valid domains
        // This is consistent with how browsers and DNS work - "999.999.999.999" could theoretically be a domain name
        expect(validateConfigEntry("999.999.999.999", "domain")).toEqual({
          valid: true,
          wildcardKind: "none",
        });
      });

      it("should detect wildcard types correctly", () => {
        // Global wildcard
        const global = validateConfigEntry("*", "origin", {
          allowGlobalWildcard: true,
        });
        expect(global.valid).toBe(true);
        expect(global.wildcardKind).toBe("global");

        // Protocol wildcard
        const protocol = validateConfigEntry("https://*", "origin");
        expect(protocol.valid).toBe(true);
        expect(protocol.wildcardKind).toBe("protocol");

        // Subdomain wildcard
        const subdomain = validateConfigEntry("*.example.com", "origin");
        expect(subdomain.valid).toBe(true);
        expect(subdomain.wildcardKind).toBe("subdomain");

        // Double asterisk subdomain wildcard
        const doubleSubdomain = validateConfigEntry("**.example.com", "domain");
        expect(doubleSubdomain.valid).toBe(true);
        expect(doubleSubdomain.wildcardKind).toBe("subdomain");

        // Protocol + subdomain wildcard
        const protocolSubdomain = validateConfigEntry(
          "https://*.example.com",
          "origin",
        );
        expect(protocolSubdomain.valid).toBe(true);
        expect(protocolSubdomain.wildcardKind).toBe("subdomain");

        // Exact domain (no wildcard)
        const exact = validateConfigEntry("example.com", "domain");
        expect(exact.valid).toBe(true);
        expect(exact.wildcardKind).toBe("none");

        // Exact origin (no wildcard)
        const exactOrigin = validateConfigEntry(
          "https://example.com",
          "origin",
        );
        expect(exactOrigin.valid).toBe(true);
        expect(exactOrigin.wildcardKind).toBe("none");
      });

      it("optionally allows global '*' when enabled", () => {
        const disallowed = validateConfigEntry("*", "origin");
        expect(disallowed.valid).toBe(false);
        expect(disallowed.info).toMatch(/global wildcard '\*' not allowed/i);

        const allowed = validateConfigEntry("*", "origin", {
          allowGlobalWildcard: true,
        });
        expect(allowed.valid).toBe(true);
      });

      it("still rejects all-wildcard domain patterns like '*.*'", () => {
        const r = validateConfigEntry("*.*", "origin", {
          allowGlobalWildcard: true,
        });
        expect(r.valid).toBe(false);
      });

      it("can disable protocol-only wildcard via option", () => {
        const def = validateConfigEntry("https://*", "origin");
        expect(def.valid).toBe(true); // default allows protocol wildcard

        const off = validateConfigEntry("https://*", "origin", {
          allowProtocolWildcard: false,
        });
        expect(off.valid).toBe(false);
        expect(off.info).toMatch(/protocol wildcard not allowed/i);
      });
      it("allows literal 'null' origin", () => {
        const r = validateConfigEntry("null", "origin");
        expect(r.valid).toBe(true);
        expect(r.info).toBeUndefined();
      });

      it("rejects missing host and disallows path/query/fragment", () => {
        const r1 = validateConfigEntry("https://", "origin");
        expect(r1.valid).toBe(false);
        expect(r1.info).toBe("missing host in origin");

        const r2 = validateConfigEntry("https://example.com/path", "origin");
        expect(r2.valid).toBe(false);
        expect(r2.info).toBe(
          "origin must not contain path, query, or fragment",
        );
      });

      it("supports protocol-only wildcards with scheme info", () => {
        const httpsAny = validateConfigEntry("https://*", "origin");
        expect(httpsAny.valid).toBe(true);
        expect(httpsAny.info).toBeUndefined();

        const wsAny = validateConfigEntry("ws://*", "origin");
        expect(wsAny.valid).toBe(true);
        expect(wsAny.info).toBe("non-http(s) scheme; CORS may not match");
      });

      it("rejects ports and IP-literals in wildcard origins", () => {
        const withPort = validateConfigEntry(
          "https://*.example.com:443",
          "origin",
        );
        expect(withPort.valid).toBe(false);
        expect(withPort.info).toBe("ports are not allowed in wildcard origins");

        const ipLit = validateConfigEntry("https://[*]", "origin");
        expect(ipLit.valid).toBe(false);
        expect(ipLit.info).toBe("wildcard host cannot be an IP literal");
      });

      it("rejects invalid wildcard host patterns in origin", () => {
        const partial = validateConfigEntry(
          "https://ex*.example.com",
          "origin",
        );
        expect(partial.valid).toBe(false);
        expect(partial.info).toBe("partial-label wildcards are not allowed");

        const psl = validateConfigEntry("https://*.com", "origin");
        expect(psl.valid).toBe(false);
        expect(psl.info).toBe(
          "wildcard tail targets public suffix or IP (disallowed)",
        );
      });

      it("rejects partial-label wildcards in domain and origin contexts", () => {
        // Domain context
        const dom = validateConfigEntry("ex*.demo.com", "domain");
        expect(dom.valid).toBe(false);
        expect(dom.info).toMatch(/partial-label wildcards/i);

        // matches helpers should also reject by treating pattern as invalid
        expect(matchesWildcardDomain("foo.demo.com", "ex*.demo.com")).toBe(
          false,
        );

        // Origin context (protocol-agnostic host pattern)
        const org = validateConfigEntry("ex*.demo.com", "origin");
        expect(org.valid).toBe(false);
        expect(org.info).toMatch(/partial-label wildcards/i);

        expect(
          matchesWildcardOrigin("https://foo.demo.com", "ex*.demo.com"),
        ).toBe(false);
      });

      it("accepts exact IPv6 and IP literal origins (with scheme info when non-http)", () => {
        const v6 = validateConfigEntry("https://[2001:db8::1]", "origin");
        expect(v6.valid).toBe(true);
        expect(v6.info).toBeUndefined();

        const ip = validateConfigEntry("ftp://127.0.0.1:21", "origin");
        expect(ip.valid).toBe(true);
        expect(ip.info).toBe("non-http(s) scheme; CORS may not match");
      });

      it("validates bracketed IPv6 structure in origins", () => {
        const unclosed = validateConfigEntry("https://[2001:db8::1", "origin");
        expect(unclosed.valid).toBe(false);
        expect(unclosed.info).toBe("unclosed IPv6 bracket");

        const extra = validateConfigEntry("https://[::1]abc", "origin");
        expect(extra.valid).toBe(false);
        expect(extra.info).toBe("unexpected characters after IPv6 host");
      });

      it("rejects exact origins where host equals a public suffix or has invalid domain", () => {
        const psl = validateConfigEntry("https://com", "origin");
        expect(psl.valid).toBe(false);
        expect(psl.info).toBe(
          "origin host equals a public suffix (not registrable)",
        );

        const bad = validateConfigEntry("https://a..b", "origin");
        expect(bad.valid).toBe(false);
        expect(bad.info).toBe("invalid domain in origin");
      });

      it("applies domain rules to bare domains in origin context", () => {
        const ok = validateConfigEntry("*.localhost", "origin");
        expect(ok.valid).toBe(true);

        const bad = validateConfigEntry("*.127.0.0.1", "origin");
        expect(bad.valid).toBe(false);
        expect(bad.info).toBe(
          "wildcard tail targets public suffix or IP (disallowed)",
        );
      });
    });
  });

  describe("matchesCORSCredentialsList (legacy patterns via option)", () => {
    it("should support global wildcard '*' for credentials when configured", () => {
      const allowedOrigins = ["*"];

      // Global wildcard should match any valid origin
      expect(
        matchesCORSCredentialsList("https://example.com", allowedOrigins, {
          allowWildcardSubdomains: true,
        }),
      ).toBe(true);
      expect(
        matchesCORSCredentialsList("http://api.example.com", allowedOrigins, {
          allowWildcardSubdomains: true,
        }),
      ).toBe(true);
      expect(
        matchesCORSCredentialsList(
          "https://sub.domain.example.com",
          allowedOrigins,
          { allowWildcardSubdomains: true },
        ),
      ).toBe(true);

      // Should reject undefined/null origins
      expect(
        matchesCORSCredentialsList(undefined, allowedOrigins, {
          allowWildcardSubdomains: true,
        }),
      ).toBe(false);
    });

    it("should reject invalid all-wildcard patterns for credentials", () => {
      // These should not match due to invalid patterns
      expect(
        matchesCORSCredentialsList("https://example.com", ["*.*"], {
          allowWildcardSubdomains: true,
        }),
      ).toBe(false);
      expect(
        matchesCORSCredentialsList("https://example.com", ["**.*"], {
          allowWildcardSubdomains: true,
        }),
      ).toBe(false);
    });
  });
  describe("Limits and guards", () => {
    it("caps label counts via MAX_LABELS for domains and patterns", () => {
      const manyLabelsDomain =
        Array.from({ length: 38 }, (_, i) => `l${i}`).join(".") +
        ".example.com";
      // Domain has > MAX_LABELS labels (38 + 2)
      expect(matchesWildcardDomain(manyLabelsDomain, "**.example.com")).toBe(
        false,
      );

      const manyLabelsPattern =
        Array.from({ length: 33 }, () => "*").join(".") + ".example.com";
      expect(matchesWildcardDomain("api.example.com", manyLabelsPattern)).toBe(
        false,
      );
    });

    it("enforces step limit to avoid exponential blowups", () => {
      const deepDomain =
        Array.from({ length: 28 }, () => "a").join(".") + ".example.com";
      const explosivePattern =
        Array.from({ length: 20 }, () => "**").join(".") + ".zzz.example.com";
      // Should fail without hanging due to step limit guard
      expect(matchesWildcardDomain(deepDomain, explosivePattern)).toBe(false);
    });
  });
});
