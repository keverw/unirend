import type { ESLint, Rule } from 'eslint';
import { PKG_VERSION } from '../../../version';
import { createPreferAliasImportsRule } from './prefer-alias-imports';

/**
 * The default-configured `prefer-alias-imports` rule (uses `@/` -> `src`).
 * Exported on its own for consumers who register rules manually.
 */
export const preferAliasImportsRule: Rule.RuleModule =
  createPreferAliasImportsRule();

/**
 * The unirend ESLint plugin. Register it in a flat config and enable the rule:
 *
 * ```js
 * import unirend from 'unirend/eslint-plugin';
 *
 * export default [
 *   {
 *     plugins: { unirend },
 *     rules: { 'unirend/prefer-alias-imports': 'error' },
 *   },
 * ];
 * ```
 */
export const plugin: ESLint.Plugin = {
  meta: {
    name: 'unirend',
    version: PKG_VERSION,
  },
  rules: {
    'prefer-alias-imports': preferAliasImportsRule,
  },
};
