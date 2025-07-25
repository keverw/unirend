import { test, expect, describe, beforeEach, mock } from "bun:test";
import { LRUCache } from "./index";

describe("LRUCache", () => {
  describe("Basic operations", () => {
    let cache: LRUCache<string, string>;

    beforeEach(() => {
      cache = new LRUCache<string, string>(3);
    });

    test("should store and retrieve values", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    test("should return undefined for non-existent keys", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    test("should update existing keys", () => {
      cache.set("key1", "value1");
      cache.set("key1", "updated");
      expect(cache.get("key1")).toBe("updated");
    });

    test("should track size correctly", () => {
      expect(cache.size).toBe(0);
      cache.set("key1", "value1");
      expect(cache.size).toBe(1);
      cache.set("key2", "value2");
      expect(cache.size).toBe(2);
    });

    test("should clear all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get("key1")).toBeUndefined();
    });
  });

  describe("LRU eviction", () => {
    test("should evict least recently used items when max entries is reached", () => {
      const cache = new LRUCache<string, string>(3);

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      // All keys should be present
      expect(cache.get("key1")).toBe("value1");
      expect(cache.get("key2")).toBe("value2");
      expect(cache.get("key3")).toBe("value3");

      // Access key1 to make it most recently used
      cache.get("key1");

      // Add a new key, which should evict key2 (least recently used)
      cache.set("key4", "value4");

      expect(cache.get("key1")).toBe("value1"); // Still present (was accessed)
      expect(cache.get("key2")).toBeUndefined(); // Evicted (least recently used)
      expect(cache.get("key3")).toBe("value3"); // Still present
      expect(cache.get("key4")).toBe("value4"); // Newly added
    });
  });

  describe("TTL expiration", () => {
    test("should expire items after TTL", async () => {
      // Mock Date.now to control time
      const originalNow = Date.now;
      let currentTime = 1000;

      try {
        Date.now = mock(() => currentTime);

        const cache = new LRUCache<string, string>(10, { defaultTtl: 100 });

        cache.set("key1", "value1");
        expect(cache.get("key1")).toBe("value1");

        // Advance time past TTL
        currentTime += 150;

        // Item should be expired
        expect(cache.get("key1")).toBeUndefined();
      } finally {
        // Restore original Date.now
        Date.now = originalNow;
      }
    });

    test("should respect custom TTL for specific entries", async () => {
      // Mock Date.now to control time
      const originalNow = Date.now;
      let currentTime = 1000;

      try {
        Date.now = mock(() => currentTime);

        const cache = new LRUCache<string, string>(10, { defaultTtl: 100 });

        cache.set("key1", "default ttl");
        cache.set("key2", "custom ttl", 50); // Shorter TTL

        expect(cache.get("key1")).toBe("default ttl");
        expect(cache.get("key2")).toBe("custom ttl");

        // Advance time past custom TTL but before default TTL
        currentTime += 75;

        expect(cache.get("key1")).toBe("default ttl"); // Still valid
        expect(cache.get("key2")).toBeUndefined(); // Expired (custom TTL)

        // Advance time past default TTL
        currentTime += 50;

        expect(cache.get("key1")).toBeUndefined(); // Now expired
      } finally {
        // Restore original Date.now
        Date.now = originalNow;
      }
    });
  });

  describe("Size-based eviction", () => {
    test("should evict items when max size is reached", () => {
      // Create a cache with max 100 bytes
      const cache = new LRUCache<string, string>(10, { maxSize: 100 });

      // Add items with known sizes (strings are ~2 bytes per char)
      cache.set("key1", "a".repeat(20)); // ~40 bytes
      cache.set("key2", "b".repeat(20)); // ~40 bytes

      // Both should be present
      expect(cache.get("key1")).toBeDefined();
      expect(cache.get("key2")).toBeDefined();

      // Add another item that pushes us over the limit
      cache.set("key3", "c".repeat(30)); // ~60 bytes

      // The oldest item should be evicted
      expect(cache.get("key1")).toBeUndefined(); // Evicted
      expect(cache.get("key2")).toBeDefined(); // Still present
      expect(cache.get("key3")).toBeDefined(); // Newly added
    });

    test("should track byte size correctly", () => {
      const cache = new LRUCache<string, string>(10, { maxSize: 1000 });

      expect(cache.byteSize).toBe(0);

      cache.set("key1", "a".repeat(10)); // ~20 bytes
      expect(cache.byteSize).toBeGreaterThan(0);

      const initialSize = cache.byteSize;
      cache.set("key2", "b".repeat(20)); // ~40 bytes
      expect(cache.byteSize).toBeGreaterThan(initialSize);

      // Remove an item
      cache.set("key1", ""); // Replace with empty string
      expect(cache.byteSize).toBeLessThan(initialSize + 40);
    });
  });

  describe("Custom size calculator", () => {
    test("should use custom size calculator when provided", () => {
      const sizeCalculator = (value: any) => {
        return typeof value === "string" ? value.length * 3 : 10;
      };

      const cache = new LRUCache<string, any>(10, {
        maxSize: 100,
        sizeCalculator,
      });

      // Add a string that would be under the limit with default calculation
      // but over the limit with our custom calculator (length * 3)
      cache.set("key1", "a".repeat(20)); // Custom size: 60
      cache.set("key2", "b".repeat(20)); // Custom size: 60

      // Second item should have caused first to be evicted due to custom sizing
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeDefined();
    });

    test("should handle different value types with custom calculator", () => {
      const sizeCalculator = (value: any) => {
        if (typeof value === "string") return value.length;
        if (typeof value === "number") return 8;
        if (Array.isArray(value)) return value.length * 10;
        return 50; // Default for objects
      };

      // Create a cache with a small max size
      const cache = new LRUCache<string, any>(10, {
        maxSize: 40, // Small size limit
        sizeCalculator,
      });

      // Add a string
      cache.set("str", "hello"); // Size: 5
      expect(cache.get("str")).toBeDefined();
      expect(cache.byteSize).toBe(5);

      // Add a number
      cache.set("num", 42); // Size: 8
      expect(cache.get("num")).toBeDefined();
      expect(cache.byteSize).toBe(13); // 5 + 8

      // Add an array that fits within the limit
      cache.set("arr", [1, 2]); // Size: 20 (2 * 10)
      expect(cache.get("arr")).toBeDefined();

      // The total should be 33 (5 + 8 + 20)
      expect(cache.byteSize).toBe(33);

      // All items should still be in the cache
      expect(cache.get("str")).toBeDefined();
      expect(cache.get("num")).toBeDefined();

      // Now add an item that's larger than what's left in the cache
      // but smaller than maxSize
      cache.set("bigArr", [1, 2, 3]); // Size: 30 (3 * 10)

      // This should evict at least the oldest item to make room
      expect(cache.get("str")).toBeUndefined(); // Evicted (oldest)

      // Verify the new item was added
      expect(cache.get("bigArr")).toBeDefined(); // Newly added

      // Check the total size is within the maxSize limit
      expect(cache.byteSize).toBeLessThanOrEqual(40);

      // Clear the cache
      cache.clear();
      expect(cache.byteSize).toBe(0);
    });
  });
});
