/**
 * Recursively freezes an object and all nested objects, making the entire
 * structure immutable (deep freeze, vs Object.freeze which is shallow).
 *
 * Pure utility with no dependencies — safe to import in both server and
 * client code.
 *
 * Used to freeze frontendAppConfig clones (so they cannot be mutated within
 * a request, even on nested sub-objects) and debug context snapshots returned
 * by useRequestContextObjectRaw(). The source object is never affected.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  Object.freeze(obj);

  for (const value of Object.values(obj as object)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }

  return obj;
}
