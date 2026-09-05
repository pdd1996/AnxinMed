import { defineConfig } from 'vitest/config'

// T5：最小 node 环境配置。集成测试跑 dev 库（只读：health ping + resolveUser 读 p-001）。
// T6 正式化：引入独立 anxin_medication_test + globalSetup（迁移 + seed-users）后迁移测试。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
