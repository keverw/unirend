import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    ignores: [
      // Build outputs
      '**/dist/**',
      '**/coverage/**',
      // Dependencies
      '**/node_modules/**',
      // Config files
      '*.config.js',
      '*.config.mjs',
      // Logs
      '**/*.log',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
    ],
  },
  {
    // Lint TypeScript files in src/, scripts/, and all other directories
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      react,
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      // Enforce boolean variable naming conventions
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase', 'UPPER_CASE'],
          prefix: [
            'is',
            'has',
            'should',
            'can',
            'did',
            'will',
            'was',
            'does',
            'enable',
            'allow',
            'use',
            'show',
          ],
          // Allow UPPER_CASE without prefix for constants
          filter: {
            regex: '^[A-Z][A-Z0-9_]*$',
            match: false,
          },
        },
        {
          // Allow uppercase constants without prefix requirement
          selector: 'variable',
          types: ['boolean'],
          format: ['UPPER_CASE'],
        },
        {
          selector: 'parameter',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: [
            'is',
            'has',
            'should',
            'can',
            'did',
            'will',
            'was',
            'does',
            'enable',
            'allow',
            'use',
            'show',
          ],
        },
      ],
      // Detect unused variables
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      // React-specific rules
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/react-in-jsx-scope': 'off', // Not needed for React 17+
      // TypeScript specific rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // General code quality rules
      'no-console': 'warn',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      // Import/export rules
      'no-duplicate-imports': 'error',
      // Enforce case-sensitive import paths (prevents macOS/Windows vs Linux issues)
      'import/no-unresolved': [
        'error',
        {
          caseSensitive: true,
          // Ignore runtime-provided built-in modules
          ignore: ['^bun:', '^electron$'],
        },
      ],
      // Forbid importing deprecated modules/exports
      'import/no-deprecated': 'warn',
      // Forbid importing packages not listed in dependencies
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.test.ts',
            '**/*.test.tsx',
            '**/*.spec.ts',
            '**/*.spec.tsx',
            '**/vite.config.ts',
            '**/vitest.config.ts',
            'scripts/**/*.ts',
          ],
        },
      ],
      // Forbid mutable exports (helps with predictable module behavior)
      'import/no-mutable-exports': 'error',
      // Best practices
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      // Class member accessibility - require explicit public/private/protected
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {
          accessibility: 'explicit',
          overrides: {
            constructors: 'no-public', // Don't require public on constructors
          },
        },
      ],
      // Class member ordering - public first, then protected, then private
      '@typescript-eslint/member-ordering': [
        'error',
        {
          default: [
            'public-field',
            'protected-field',
            'private-field',
            'constructor',
            'public-method',
            'protected-method',
            'private-method',
          ],
        },
      ],
    },
  },
  {
    // Test files: allow console and any for mocking
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    // Scripts: allow console for CLI output
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    ...tseslint.configs.disableTypeChecked,
  },
);
