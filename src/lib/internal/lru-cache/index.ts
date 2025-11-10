/**
 * TTL-aware LRU (Least Recently Used) Cache implementation
 *
 * Features:
 * - Configurable maximum entries to limit item count
 * - Optional maximum size in bytes to limit memory usage
 * - Optional TTL (Time To Live) for cache entries
 * - Automatic cleanup of expired entries
 * - Efficient LRU eviction policy
 * - Size-aware eviction when memory limits are reached
 */

export class LRUCache<K, V> {
  private maxEntries: number;
  private maxSize?: number; // Optional maximum size in bytes
  private defaultTtl?: number; // Optional default TTL in milliseconds
  private lastCleanup = Date.now();
  private cleanupInterval = 60 * 1000; // Run cleanup once per minute at most
  private currentSize = 0; // Track current total size in bytes
  private sizeCalculator?: (value: V) => number; // Optional function to calculate item size

  // Store values with their expiration time and size
  private map = new Map<K, { value: V; expires?: number; size: number }>();

  /**
   * Create a new LRU cache
   * @param maxEntries Maximum number of entries to store
   * @param options Configuration options
   * @param options.defaultTtl Default time to live in milliseconds for all entries
   * @param options.maxSize Maximum total size in bytes
   * @param options.sizeCalculator Function to calculate the size of a value
   */

  constructor(
    maxEntries: number,
    options?: {
      defaultTtl?: number;
      maxSize?: number;
      sizeCalculator?: (value: V) => number;
    },
  ) {
    this.maxEntries = maxEntries;
    this.defaultTtl = options?.defaultTtl;
    this.maxSize = options?.maxSize;
    this.sizeCalculator = options?.sizeCalculator;
  }

  /**
   * Get the current number of entries in the cache
   */

  get size(): number {
    return this.map.size;
  }

  /**
   * Get the current total size in bytes of all cached items
   */

  get byteSize(): number {
    return this.currentSize;
  }

  /**
   * Calculate the size of a value in bytes
   * Uses the provided sizeCalculator if available, otherwise makes a best guess
   */

  private calculateSize(value: unknown): number {
    // Use custom size calculator if provided (cast to V for the callback)
    if (this.sizeCalculator) {
      return this.sizeCalculator(value as V);
    }

    // Default size estimation logic
    if (value === null || value === undefined) {
      return 0;
    } else if (typeof value === 'boolean') {
      return 4; // Boolean is typically 4 bytes
    } else if (typeof value === 'number') {
      return 8; // Number is typically 8 bytes (double)
    } else if (typeof value === 'string') {
      return value.length * 2; // String is ~2 bytes per character in UTF-16
    } else if (Buffer.isBuffer(value)) {
      return value.length; // Buffer size in bytes
    } else if (ArrayBuffer.isView(value)) {
      return value.byteLength; // TypedArray size
    } else if (value instanceof ArrayBuffer) {
      return value.byteLength; // ArrayBuffer size
    } else if (Array.isArray(value)) {
      // Rough estimate for arrays
      return (
        40 +
        value.reduce(
          (acc: number, item: unknown) => acc + this.calculateSize(item),
          0,
        )
      );
    } else if (typeof value === 'object') {
      try {
        // Rough estimate based on JSON size
        const jsonSize = JSON.stringify(value).length * 2;
        return Math.max(jsonSize, 40); // At least 40 bytes for object overhead
      } catch {
        // Ignore JSON serialization errors for non-serializable objects
        return 1000; // Fallback size for non-serializable objects
      }
    }

    return 100; // Default fallback size
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);

    if (entry) {
      // Check if entry has expired
      if (entry.expires && Date.now() > entry.expires) {
        this.removeEntry(key);
        return undefined;
      }

      // Move to end of LRU (most recently used)
      this.map.delete(key);
      this.map.set(key, entry);

      // Run periodic cleanup if needed
      this.maybeCleanup();

      return entry.value;
    }

    return undefined;
  }

  /**
   * Remove an entry and update the size tracking
   */

  private removeEntry(key: K): void {
    const entry = this.map.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      this.map.delete(key);
    }
  }

  set(key: K, value: V, customTtl?: number): void {
    // Calculate the size of the new value
    const size = this.calculateSize(value);

    // Remove existing entry if present
    if (this.map.has(key)) {
      this.removeEntry(key);
    }

    // Calculate expiration if TTL is set
    const expires =
      this.defaultTtl || customTtl
        ? Date.now() + (customTtl ?? this.defaultTtl ?? 0)
        : undefined;

    // Add new entry
    this.map.set(key, { value, expires, size });
    this.currentSize += size;

    // Evict entries if we exceed capacity (either by count or size)
    this.evictIfNeeded();

    // Run periodic cleanup if needed
    this.maybeCleanup();
  }

  /**
   * Evict entries if we exceed either max entries or max size
   */

  private evictIfNeeded(): void {
    // First check if we need to evict based on entry count
    if (this.map.size > this.maxEntries) {
      this.evictOldest();
    }

    // Then check if we need to evict based on total size
    if (this.maxSize && this.currentSize > this.maxSize) {
      // Keep evicting until we're under the size limit or the cache is empty
      while (this.currentSize > this.maxSize && this.map.size > 0) {
        this.evictOldest();
      }
    }
  }

  /**
   * Evict the oldest (least recently used) entry
   */

  private evictOldest(): void {
    if (this.map.size > 0) {
      const oldest = this.map.keys().next().value as K; // Safe: map.size > 0 guarantees a key exists
      this.removeEntry(oldest);
    }
  }

  private maybeCleanup(): void {
    const now = Date.now();

    // Only run cleanup occasionally to avoid performance impact
    if (this.defaultTtl && now - this.lastCleanup > this.cleanupInterval) {
      this.lastCleanup = now;

      // Remove all expired entries
      for (const [key, entry] of this.map.entries()) {
        if (entry.expires && now > entry.expires) {
          this.removeEntry(key);
        }
      }
    }
  }

  /**
   * Clear all entries from the cache
   */

  clear(): void {
    this.map.clear();
    this.currentSize = 0;
  }
}

export default LRUCache;
