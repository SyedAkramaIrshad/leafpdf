import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'output', 'tmp', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      // Vite fast-refresh only works when a module exports components alone.
      'react-refresh/only-export-components': 'off',
      // `while (true)` polling loops are legitimate; the rest of no-constant-condition stays on.
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // Node-side files: configs, fixture scripts, and Playwright tests.
    files: ['*.config.{js,ts}', 'e2e/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
)
