import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// web 测试（M1-T8 起）：jsdom 环境 + `@` 别名，支撑 @testing-library/react 组件/store 冒烟测试。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
