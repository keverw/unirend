# LRUCache

A TypeScript implementation of a Least Recently Used (LRU) cache with TTL and size-based eviction.

## Features

- **LRU Eviction Policy**: Automatically removes the least recently used items when the cache reaches capacity
- **TTL Support**: Optional time-to-live for cache entries with automatic expiration
- **Size-Based Eviction**: Limit cache by both entry count and total memory usage
- **Flexible Size Calculation**: Built-in size estimation with option for custom size calculation functions
- **Type Safety**: Full TypeScript support with generics for keys and values
- **Efficient Implementation**: Uses JavaScript's Map for O(1) operations

## Usage

### Basic Usage

```typescript
import { LRUCache } from '@/libs/lru-cache';

// Create a cache with maximum 100 entries
const cache = new LRUCache<string, any>(100);

// Set values
cache.set('key1', 'value1');
cache.set('key2', { complex: 'object' });

// Get values
const value = cache.get('key1'); // 'value1'
```

### With TTL (Time-To-Live)

```typescript
// Create a cache with TTL of 60 seconds
const cache = new LRUCache<string, string>(100, {
  defaultTtl: 60 * 1000, // 60 seconds in milliseconds
});

// Set a value with default TTL
cache.set('key1', 'expires in 60 seconds');

// Set a value with custom TTL
cache.set('key2', 'expires in 10 seconds', 10 * 1000);

// After 10 seconds, key2 will be automatically removed
// After 60 seconds, key1 will be automatically removed
```

### With Size Limits

```typescript
// Create a cache with both entry count and size limits
const cache = new LRUCache<string, Buffer>(100, {
  maxSize: 10 * 1024 * 1024, // 10MB limit
});

// The cache will automatically evict entries when either:
// 1. The number of entries exceeds 100
// 2. The total estimated size exceeds 10MB
```

### With Custom Size Calculator

```typescript
// Create a cache with a custom size calculator
const cache = new LRUCache<string, any>(100, {
  maxSize: 1000000, // 1MB
  sizeCalculator: (value) => {
    // Custom logic to calculate size of value
    if (typeof value === 'string') {
      return value.length * 2; // UTF-16 strings use ~2 bytes per character
    }
    if (Buffer.isBuffer(value)) {
      return value.length;
    }
    // Default size for other types
    return 100;
  },
});
```

## API Reference

### Constructor

```typescript
constructor(
  maxEntries: number,
  options?: {
    defaultTtl?: number;
    maxSize?: number;
    sizeCalculator?: (value: V) => number;
  }
)
```

- `maxEntries`: Maximum number of entries to store in the cache
- `options.defaultTtl`: (Optional) Default time-to-live in milliseconds for all cache entries
- `options.maxSize`: (Optional) Maximum total size in bytes for all cache entries
- `options.sizeCalculator`: (Optional) Function to calculate the size of a value

### Methods

#### `get(key: K): V | undefined`

Retrieves a value from the cache. Returns `undefined` if the key doesn't exist or the entry has expired.

#### `set(key: K, value: V, customTtl?: number): void`

Adds or updates a value in the cache.

- `key`: The key to store the value under
- `value`: The value to store
- `customTtl`: (Optional) Custom TTL for this specific entry, overriding the default

#### `clear(): void`

Removes all entries from the cache.

### Properties

#### `size: number`

Get the current number of entries in the cache.

#### `byteSize: number`

Get the current total size in bytes of all cached items.

## Internal Size Calculation

If no custom `sizeCalculator` is provided, the cache uses a built-in algorithm to estimate the size of different types:

- `null` or `undefined`: 0 bytes
- `boolean`: 4 bytes
- `number`: 8 bytes (double precision)
- `string`: 2 bytes per character (UTF-16 encoding)
- `Buffer`: Actual buffer length
- `TypedArray` or `ArrayBuffer`: Actual byte length
- `Array`: 40 bytes plus the sum of its items' sizes
- `Object`: Estimated based on JSON string size
- Other types: 100 bytes (default fallback)

This estimation is approximate and may not reflect the exact memory usage in all cases.
