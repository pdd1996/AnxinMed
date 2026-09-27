import { defineConfig } from 'vitest/config'

// core 单测（M5-T2）：无 DOM 环境——包本身禁 DOM，测试同样不给 jsdom，
// 平台触点一律以注入的假实现驱动。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
