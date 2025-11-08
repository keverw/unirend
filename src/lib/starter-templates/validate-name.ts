import { builtinModules } from "module";
import type { NameValidationResult } from "./types";

/**
 * Validate a project or repo name
 * Returns an object with validation result and optional error message
 *
 * This validator is compatible with NPM package naming rules while being stricter:
 * - NPM rules: https://www.npmjs.com/package/validate-npm-package-name
 * - Maximum 214 characters
 * - Lowercase only
 * - Cannot start with dots, underscores, or dashes
 * - Cannot end with special characters
 * - No consecutive special characters
 * - No non-URL-safe characters
 * - No Node.js core module names or system reserved names
 * - Additional filesystem safety checks
 */
export function validateName(name: string): NameValidationResult {
  // Must not be empty
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Name cannot be empty" };
  }

  // NPM Rule: Must not exceed 214 characters
  if (name.length > 214) {
    return {
      valid: false,
      error: "Name cannot exceed 214 characters",
    };
  }

  // NPM Rule: Must be lowercase only (no uppercase letters)
  if (/[A-Z]/.test(name)) {
    return {
      valid: false,
      error: "Name must be lowercase only",
    };
  }

  // NPM Rule: Cannot start with a dot, underscore, or dash
  if (/^[._-]/.test(name)) {
    return {
      valid: false,
      error: "Name cannot start with a dot, underscore, or dash",
    };
  }

  // Must not end with special characters (stricter than npm)
  if (/[-_.]$/.test(name)) {
    return {
      valid: false,
      error: "Name cannot end with a dash, underscore, or dot",
    };
  }

  // NPM Rule: Cannot contain spaces
  if (/\s/.test(name)) {
    return {
      valid: false,
      error: "Name cannot contain spaces",
    };
  }

  // NPM Rule: Cannot contain non-URL-safe characters
  // Allowed: lowercase letters, digits, hyphens, dots, underscores
  // Prohibited: all other characters including ~)('!* and filesystem-unsafe chars
  if (!/^[a-z0-9._-]+$/.test(name)) {
    return {
      valid: false,
      error:
        "Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed",
    };
  }

  // Must not contain consecutive special characters (dash, underscore, dot)
  // Special characters must be surrounded by alphanumeric characters
  // Examples: "foo-bar" ✓, "foo--bar" ✗, "foo_.bar" ✗, "foo..bar" ✗
  const specialChars = new Set([".", "_", "-"]);
  for (let i = 0; i < name.length - 1; i++) {
    const current = name[i];
    const next = name[i + 1];

    // If current char is special and next char is also special, it's invalid
    if (specialChars.has(current) && specialChars.has(next)) {
      return {
        valid: false,
        error: `Name cannot contain consecutive special characters (found "${current}${next}"). Special characters must be surrounded by letters or numbers.`,
      };
    }
  }

  // NPM Rule: Cannot be Node.js core modules or reserved names
  // Use Node.js's built-in list of core modules (automatically stays up-to-date)
  // builtinModules may include "node:" prefixed versions, so we filter to base names only
  const nodeBuiltins = builtinModules
    .filter((mod) => !mod.startsWith("node:"))
    .map((mod) => mod.toLowerCase());

  // Additional reserved names (npm and filesystem)
  const additionalReserved = [
    // Runtime name it self
    "node",
    // NPM reserved
    "node_modules",
    "favicon.ico",
    // Windows reserved names
    "con",
    "prn",
    "aux",
    "nul",
    "com1",
    "com2",
    "com3",
    "com4",
    "com5",
    "com6",
    "com7",
    "com8",
    "com9",
    "lpt1",
    "lpt2",
    "lpt3",
    "lpt4",
    "lpt5",
    "lpt6",
    "lpt7",
    "lpt8",
    "lpt9",
    // Relative path references
    ".",
    "..",
  ];

  const allReserved = [...nodeBuiltins, ...additionalReserved];

  if (allReserved.includes(name.toLowerCase())) {
    return {
      valid: false,
      error: `Name "${name}" is reserved (Node.js core module, npm reserved name, or system reserved name)`,
    };
  }

  return { valid: true };
}
