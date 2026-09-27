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
    // M5-T2 架构纪律：core 是 web / RN 共用的逻辑层，禁一切 DOM 用途与 react-dom。
    // 按「用途」限制全局（setInterval/setTimeout 这类 RN 亦有的全局不误伤）；
    // 与 core tsconfig 的无 DOM lib 互为两道闸门——报错说明闸门在工作，不是环境问题。
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'document',
        'window',
        'navigator',
        'localStorage',
        'sessionStorage',
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'sonner', message: 'core 禁 sonner：API 错误提示由平台层经 setApiNotifier 装配。' },
            { name: 'react-native', message: 'core 禁 react-native：平台专属实现留在各端注入。' },
            { name: 'expo', message: 'core 禁 expo：平台专属实现留在各端注入。' },
          ],
          patterns: [
            { group: ['react-dom', 'react-dom/*'], message: 'core 禁 react-dom：渲染层专属。' },
          ],
        },
      ],
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
    // M5-T3 补修（随 M5-T2 验证发现）：mobile 的 CJS 配置文件（babel/metro/tailwind）不是 TS，
    // 上面那段只给 **/*.{ts,tsx} 配了语言环境 → 这些文件里的 module/require/__dirname 全报 no-undef。
    // 本段补 Node 全局并放行 require 写法（不改上游脚手架产物形态，Expo 生成的就是 CJS 配置）。
    files: ['packages/mobile/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
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
