import { defineConfig } from 'vitest/config'

// shared 纯函数单测（node 环境，零 I/O、确定性）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
