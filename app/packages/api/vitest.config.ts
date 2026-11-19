import { defineConfig } from 'vitest/config'
import { TEST_URL } from './src/__tests__/test-db-url.js'

// T6：api 集成测试跑独立测试库 anxin_medication_test。
// globalSetup 负责建库 → 迁移 → seed users → teardown 清库；
// test.env.DATABASE_URL 指向测试库（worker 内 client.ts 的 dotenv 默认不覆盖已存在变量）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/__tests__/global-setup.ts'],
    env: {
      DATABASE_URL: TEST_URL,
      // 测试默认关闭「意图模型兜底」：避免带物质词的用例触发真实 DeepSeek 调用（本仓库对应测试显式开启）。
      ENABLE_INTENT_MODEL: 'false',
    },
    fileParallelism: false, // 共享单一测试库，串行更稳
  },
})
