// ESLint plugin: enforce the `@/` path alias over relative imports that escape
// a file's project (tsconfig) boundary. Pairs with the generated projects'
// `importModuleSpecifier: "project-relative"` editor setting — the editor picks
// the right specifier, this rule guards hand-written/pasted ones.

// Default export is the plugin object so it reads naturally in a flat config:
//   import unirend from 'unirend/eslint-plugin';
export {
  plugin as default,
  plugin,
  preferAliasImportsRule,
} from './lib/internal/eslint-plugin/plugin';

// Rule factory + types for consumers wiring things up manually or with
// non-default alias/root settings.
export {
  createPreferAliasImportsRule,
  type PreferAliasImportsOptions,
  type PreferAliasImportsDeps,
} from './lib/internal/eslint-plugin/prefer-alias-imports';

// Lower-level helpers, exported so the boundary/alias logic can be reused or
// tested independently of ESLint.
export {
  analyzeRelativeImport,
  type AnalyzeImportOptions,
  type AnalyzeImportResult,
} from './lib/internal/eslint-plugin/analyze-import';
export {
  findNearestTsconfigDir,
  clearTsconfigDirCache,
} from './lib/internal/eslint-plugin/find-tsconfig';
