import type { Rule } from 'eslint';
import type {
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
} from 'estree';
import { dirname } from 'path';
import { analyzeRelativeImport } from './analyze-import';
import { findNearestTsconfigDir } from './find-tsconfig';

/**
 * Per-invocation options for the `prefer-alias-imports` rule. Defaults match the
 * `@/*` -> `./src/*` alias in the generated tsconfig.
 */
export interface PreferAliasImportsOptions {
  /** Directory the alias maps to, as a single path segment (default `"src"`). */
  rootDir?: string;
  /** Alias prefix that stands in for `rootDir` (default `"@/"`). */
  prefix?: string;
}

/**
 * Dependencies for {@link createPreferAliasImportsRule}, injectable so the rule
 * can be tested without walking the real filesystem.
 */
export interface PreferAliasImportsDeps {
  /** Locate the boundary directory for a given importing-file directory. */
  findBoundaryDir?: (fromDir: string) => string | null;
}

// The import/export node kinds that carry a module `source` we care about.
type ImportOrExportNode =
  | ImportDeclaration
  | ExportNamedDeclaration
  | ExportAllDeclaration;

/**
 * Build the `prefer-alias-imports` ESLint rule.
 *
 * Flags relative imports that escape the importing file's project boundary (its
 * nearest tsconfig directory) and offers an autofix to the `@/` alias. Relative
 * imports that stay within the boundary are left alone, so it complements — not
 * fights — VSCode's `importModuleSpecifier: "project-relative"`: the editor
 * generates the right specifier, this rule guards hand-written/pasted ones.
 *
 * Unlike off-the-shelf rules, the boundary is derived from the actual tsconfig
 * layout rather than a single static root, so intra-app deep relative imports
 * (`../../components/Foo`) are permitted while cross-boundary ones are not.
 */
export function createPreferAliasImportsRule(
  deps: PreferAliasImportsDeps = {},
): Rule.RuleModule {
  const findBoundaryDir = deps.findBoundaryDir ?? findNearestTsconfigDir;

  return {
    meta: {
      type: 'suggestion',
      docs: {
        description:
          'Prefer the path alias over relative imports that escape the file’s project (tsconfig) boundary',
        recommended: false,
      },
      fixable: 'code',
      schema: [
        {
          type: 'object',
          properties: {
            rootDir: { type: 'string' },
            prefix: { type: 'string' },
          },
          additionalProperties: false,
        },
      ],
    },
    create(context): Rule.RuleListener {
      const options = (context.options[0] ?? {}) as PreferAliasImportsOptions;
      const rootDir = options.rootDir ?? 'src';
      const prefix = options.prefix ?? '@/';

      // ESLint 9 exposes `context.filename`; fall back for older tooling.
      const filename = context.filename ?? context.getFilename();
      const boundaryDir = findBoundaryDir(dirname(filename));

      // No tsconfig anywhere above the file → no boundary to enforce.
      if (!boundaryDir) {
        return {};
      }

      const check = (node: ImportOrExportNode): void => {
        const source = node.source;

        if (!source || typeof source.value !== 'string') {
          return;
        }

        const importSource = source.value;
        const result = analyzeRelativeImport({
          importerFile: filename,
          importSource,
          boundaryDir,
          rootDir,
          prefix,
        });

        if (!result.shouldUseAlias || !result.aliasedSource) {
          return;
        }

        const aliasedSource = result.aliasedSource;
        // Preserve the original quote style.
        const quote = source.raw?.[0] ?? "'";

        context.report({
          node: source,
          message: `Use the '${aliasedSource}' alias instead of the relative path '${importSource}' that escapes this project's boundary.`,
          fix(fixer) {
            return fixer.replaceText(
              source,
              `${quote}${aliasedSource}${quote}`,
            );
          },
        });
      };

      return {
        ImportDeclaration: check,
        ExportNamedDeclaration: check,
        ExportAllDeclaration: check,
      };
    },
  };
}
