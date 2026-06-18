import { describe, it } from 'bun:test';
import { RuleTester } from 'eslint';
import { createPreferAliasImportsRule } from './prefer-alias-imports';

// RuleTester drives ESLint's own harness, which calls describe/it. This project
// doesn't expose bun:test globals, so wire them up explicitly.
RuleTester.describe = describe;
RuleTester.it = it;

// Inject a fixed boundary so the rule doesn't touch the real filesystem — the
// FS walk itself is covered in find-tsconfig.test.ts.
const rule = createPreferAliasImportsRule({
  findBoundaryDir: () => '/repo/src/apps/blog',
});

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const filename = '/repo/src/apps/blog/pages/Home.js';

// A second rule instance whose boundary lookup finds no tsconfig — the rule
// should disable itself rather than flag anything.
const ruleWithoutBoundary = createPreferAliasImportsRule({
  findBoundaryDir: () => null,
});

ruleTester.run(
  'prefer-alias-imports (no tsconfig boundary)',
  ruleWithoutBoundary,
  {
    valid: [
      { filename, code: "import { format } from '../../../libs/format';" },
    ],
    invalid: [],
  },
);

ruleTester.run('prefer-alias-imports', rule, {
  valid: [
    // Relative within the boundary.
    { filename, code: "import x from './Sibling';" },
    { filename, code: "import x from '../components/Header';" },
    // Already aliased / bare.
    { filename, code: "import x from '@/libs/format';" },
    { filename, code: "import react from 'react';" },
    // Escapes the boundary but lands outside src/ — no alias form, left alone.
    { filename, code: "import seed from '../../../../scripts/seed';" },
    // Dynamic import within the boundary.
    { filename, code: "const lazy = () => import('./Lazy');" },
    // Dynamic import with a non-literal specifier — nothing to analyze.
    { filename, code: 'const load = (name) => import(name);' },
  ],
  invalid: [
    {
      filename,
      code: "import { format } from '../../../libs/format';",
      output: "import { format } from '@/libs/format';",
      errors: 1,
    },
    {
      // Double quotes are preserved by the fix.
      filename,
      code: 'export { price } from "../../shop/util";',
      output: 'export { price } from "@/apps/shop/util";',
      errors: 1,
    },
    {
      filename,
      code: "export * from '../../../libs/format';",
      output: "export * from '@/libs/format';",
      errors: 1,
    },
    {
      // Dynamic import that escapes the boundary is flagged and fixed.
      filename,
      code: "const lazy = () => import('../../../libs/format');",
      output: "const lazy = () => import('@/libs/format');",
      errors: 1,
    },
  ],
});
