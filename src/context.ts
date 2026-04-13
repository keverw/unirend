/**
 * Shared context objects for unirend.
 *
 * This entry point exists solely to guarantee that UnirendContext and
 * UnirendHeadContext are created exactly once at runtime. Both unirend/client
 * and unirend/server reference this subpath as an external import so that the
 * consuming bundler (Vite, webpack, etc.) deduplicates it — preventing the
 * duplicate createContext() calls that would break Provider/hook communication
 * in SSR bundles.
 *
 * Not intended for direct use by application code.
 */
export * from './lib/internal/UnirendContext/context';
export * from './lib/internal/UnirendHead/context';
