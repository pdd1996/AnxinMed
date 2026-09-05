// 根 ESLint 扁平配置（M1-T6）。typescript-eslint + react 插件。
// 任务书 T6：本地先跑通；CI 接入在 M3。MVP 阶段部分规则降为 warn，M3 接 CI 前再收紧。
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 全部 TS/TSX：语言环境 + 通用规则松紧
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // 前端专属：react-hooks / react-refresh
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // shadcn/ui 组件（拷入仓库）会连同 variants 常量一起导出，react-refresh 的
    // only-export-components 对其为误报；保持与上游一致，不为此改动组件源码。
    files: ['packages/web/src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
