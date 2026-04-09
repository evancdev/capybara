import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import vitest from '@vitest/eslint-plugin'
import globals from 'globals'

export default defineConfig(
  globalIgnores([
    'out/**',
    'dist/**',
    'node_modules/**',
    '*.{config,workspace}.{js,ts}'
  ]),

  // Base: ESLint recommended
  js.configs.recommended,

  // TypeScript: strict + type-checked rules
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Global settings for all TS files
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Strict TypeScript rules beyond the preset
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true }
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true }
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreVoidOperator: true }
      ],

      // General best practices
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',
      'object-shorthand': 'error',
      'no-param-reassign': 'error',
      curly: ['error', 'all'],
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['error', 'in-try-catch']
    }
  },

  // React files (renderer)
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react-hooks/exhaustive-deps': 'error',
      'react/prop-types': 'off',
      'react/self-closing-comp': 'error',
      'react/jsx-no-useless-fragment': 'error',
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
      'react/hook-use-state': 'error',
      'react/jsx-boolean-value': ['error', 'never'],
      'react/jsx-no-leaked-render': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['electron', 'electron/*'], message: 'Use window.sessionAPI instead.' },
            {
              group: ['node:*', 'fs', 'path', 'child_process', 'os'],
              message: 'Node.js modules are not available in the renderer.'
            },
            {
              group: ['@/main/*', '../main/*', '../../main/*'],
              message: 'Do not import from the main process.'
            },
            {
              group: ['@/preload/*', '../preload/*', '../../preload/*'],
              message: 'Do not import from the preload layer.'
            }
          ]
        }
      ]
    }
  },

  // Context files: disable react-refresh/only-export-components (provider + hook pattern)
  {
    files: ['src/renderer/context/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  },

  // Main process files
  {
    files: ['src/main/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowNullableBoolean: true, allowNullableObject: true }
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true }
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/renderer/*', '../renderer/*', '../../renderer/*'],
              message: 'Main process must not import from renderer.'
            },
            {
              group: ['@/preload/*', '../preload/*', '../../preload/*'],
              message: 'Main process must not import from preload.'
            }
          ]
        }
      ]
    }
  },

  // Preload files
  {
    files: ['src/preload/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/main/*', '../main/*', '../../main/*'],
              message: 'Preload must not import from main process.'
            },
            {
              group: ['@/renderer/*', '../renderer/*', '../../renderer/*'],
              message: 'Preload must not import from renderer.'
            }
          ]
        }
      ]
    }
  },

  // Shared files (no env-specific globals, no layer imports)
  {
    files: ['src/shared/**/*.ts'],
    languageOptions: {
      globals: {}
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/main/*', '../main/*', '../../main/*'],
              message: 'Shared must not import from main process.'
            },
            {
              group: ['@/renderer/*', '../renderer/*', '../../renderer/*'],
              message: 'Shared must not import from renderer.'
            },
            {
              group: ['@/preload/*', '../preload/*', '../../preload/*'],
              message: 'Shared must not import from preload.'
            },
            { group: ['electron', 'electron/*'], message: 'Shared must not depend on Electron.' },
            {
              group: ['node:*', 'fs', 'path', 'child_process', 'os'],
              message: 'Shared must not depend on Node.js modules.'
            }
          ]
        }
      ]
    }
  },

  // Test files: keep type-safety and style rules ON; relax only what fights
  // mocks, fixtures, and intentional error-path simulations.
  {
    files: ['test/**/*.{ts,tsx}'],
    plugins: { vitest },
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    settings: {
      vitest: { typecheck: true }
    },
    rules: {
      ...vitest.configs.recommended.rules,

      // Catch test anti-patterns
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/expect-expect': 'error',
      'vitest/no-standalone-expect': 'error',
      'vitest/valid-expect': 'error',
      'vitest/valid-title': 'error',
      'vitest/consistent-test-it': ['error', { fn: 'it' }],
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/prefer-hooks-in-order': 'error',

      // Mocks return `any` from third-party SDKs (Claude, Electron).
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',

      // Fixtures use `!` for known-non-null lookups.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',

      // `vi.fn()` spies receive unbound methods.
      '@typescript-eslint/unbound-method': 'off',

      // Mock factories are legitimately empty.
      '@typescript-eslint/no-empty-function': 'off',

      // Tests assert runtime conditions TS thinks are unreachable.
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // Generic test helpers (`createMock<T>()`) may not use their type param.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',

      // Tests simulate non-Error rejection paths to verify error normalization.
      '@typescript-eslint/only-throw-error': 'off',
      'no-throw-literal': 'off',
      'prefer-promise-reject-errors': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',

      // `delete process.env[key]` is the only correct env cleanup; mocked
      // storage (localStorage.removeItem) also needs dynamic-key delete.
      '@typescript-eslint/no-dynamic-delete': 'off',

      // `vi.fn(async () => value)` — async without await.
      '@typescript-eslint/require-await': 'off',

      // `expect(() => fn()).toThrow()` — void-returning arrow callbacks.
      '@typescript-eslint/no-confusing-void-expression': 'off',

      // Generator mocks may not yield.
      'require-yield': 'off'
    }
  },

  // Prettier must be last to override formatting rules
  prettier
)
