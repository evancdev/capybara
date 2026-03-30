import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default defineConfig(
  globalIgnores(['out/**', 'dist/**', 'node_modules/**', '*.config.{js,ts}']),

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

  // Prettier must be last to override formatting rules
  prettier
)
