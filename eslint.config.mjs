import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Initial lint policy: correctness is blocking. Existing maintainability debt
// remains visible as warnings, not an ignored-source or passing baseline file.
const maintenanceWarnings = Object.fromEntries([
  'no-case-declarations', 'no-useless-escape', 'no-empty',
  'no-regex-spaces', 'no-unused-vars',
].map(rule => [rule, 'warn']));

export default [
  { ignores: ['**/node_modules/**', 'dist/**', 'android/app/src/main/assets/**',
    'android/**/build/**', 'android/.gradle/**', '.worktrees/**'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { ...js.configs.recommended.rules, ...maintenanceWarnings },
  },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    // These core rules conflict with type declarations or duplicate tsc's
    // semantic checks. Precision uses the TypeScript-aware replacement.
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off', 'no-redeclare': 'off',
      'no-dupe-class-members': 'off', 'no-loss-of-precision': 'off',
      '@typescript-eslint/no-loss-of-precision': 'error' },
  },
];
