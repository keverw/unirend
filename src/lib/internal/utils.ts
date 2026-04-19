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

export const MINIMUM_SUPPORTED_NODE_MAJOR = 25;

export type RuntimeName = 'bun' | 'node' | 'unknown';

export interface RuntimeSupportInfo {
  runtime: RuntimeName;
  isSupported: boolean;
  minimumNodeMajor: number;
  nodeVersion?: string;
  bunVersion?: string;
}

interface RuntimeEnvironmentLike {
  Bun?: unknown;
  process?: {
    versions?: Partial<Record<'node' | 'bun', string>>;
  };
}

function parseMajorVersion(version?: string): number | undefined {
  if (!version) {
    return undefined;
  }

  const [majorPart] = version.split('.');
  const major = Number.parseInt(majorPart, 10);

  return Number.isFinite(major) ? major : undefined;
}

/**
 * Detect the current JavaScript runtime and whether it satisfies Unirend's
 * runtime requirement. Bun is treated as supported even if it reports an older
 * Node compatibility version via `process.versions.node`.
 */
export function getRuntimeSupportInfo(
  minimumNodeMajor = MINIMUM_SUPPORTED_NODE_MAJOR,
  environment: RuntimeEnvironmentLike = globalThis as RuntimeEnvironmentLike,
): RuntimeSupportInfo {
  const versions = environment.process?.versions;
  const nodeVersion =
    typeof versions?.node === 'string' ? versions.node : undefined;
  const bunVersion =
    typeof versions?.bun === 'string' ? versions.bun : undefined;
  const isBun =
    typeof environment.Bun !== 'undefined' || typeof bunVersion === 'string';

  if (isBun) {
    return {
      runtime: 'bun',
      isSupported: true,
      minimumNodeMajor,
      nodeVersion,
      bunVersion,
    };
  }

  if (!nodeVersion) {
    return {
      runtime: 'unknown',
      isSupported: false,
      minimumNodeMajor,
    };
  }

  const nodeMajor = parseMajorVersion(nodeVersion);

  return {
    runtime: 'node',
    isSupported: typeof nodeMajor === 'number' && nodeMajor >= minimumNodeMajor,
    minimumNodeMajor,
    nodeVersion,
  };
}

/**
 * Convenience boolean check for Unirend's runtime requirement.
 */
export function isSupportedRuntime(
  minimumNodeMajor = MINIMUM_SUPPORTED_NODE_MAJOR,
  environment?: RuntimeEnvironmentLike,
): boolean {
  return getRuntimeSupportInfo(minimumNodeMajor, environment).isSupported;
}

/**
 * Throw a descriptive error when the current runtime does not satisfy
 * Unirend's runtime requirement.
 */
export function assertSupportedRuntime(
  minimumNodeMajor = MINIMUM_SUPPORTED_NODE_MAJOR,
  environment?: RuntimeEnvironmentLike,
): void {
  const runtimeInfo = getRuntimeSupportInfo(minimumNodeMajor, environment);

  if (runtimeInfo.isSupported) {
    return;
  }

  const detectedVersion = runtimeInfo.nodeVersion ?? 'unknown';

  throw new Error(
    `Unirend requires Node >= ${minimumNodeMajor} or Bun. Detected ${runtimeInfo.runtime} runtime with Node version ${detectedVersion}.`,
  );
}
