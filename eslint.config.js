import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },

  js.configs.recommended,

  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Guard rails against the XSS class of bug this app is most exposed to:
      // untrusted registry data flowing into the DOM.
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'write',
          message: 'document.write is unsafe and blocked by our CSP.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression > MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
          message:
            'Assigning innerHTML/outerHTML risks XSS. Use the helpers in src/ui/dom.ts instead.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'insertAdjacentHTML risks XSS. Use the helpers in src/ui/dom.ts instead.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Match the underscore convention tsc already honours via noUnusedParameters,
      // so the two tools agree on what an intentionally unused binding looks like.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        // noUncheckedIndexedAccess makes index access legitimately nullable.
        { allowConstantLoopConditions: true },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],
    },
  },

  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  {
    // Config files are TypeScript too, but outside the app's type-checked
    // program — so they get the parser without the type-aware rule set.
    files: ['*.config.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { project: false },
    },
  },

  {
    files: ['*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  prettier,
);
