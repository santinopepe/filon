// Lint de todo el JavaScript del proyecto (servidor, navegador, scripts y pruebas).
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'filon/**', 'test-results/**', 'playwright-report/**', 'cobertura/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['publico/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Pruebas de navegador: parte del código corre dentro de la página (page.evaluate).
    files: ['pruebas/navegador/**', 'pruebas/e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
