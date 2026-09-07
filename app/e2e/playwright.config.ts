/**
 * Playwright 配置（M2-T10 · golden case E2E）。
 *
 * webServer 同时起：api(8787，AI_MODE=fixtures + 测试库) 与 web(vite 5173，/api 代理→8787)。
 * E2E 验证的是**接线**（上传→编排→草稿→确认页→事务落库），模型 I/O 经 FixtureAiClients 回放冻结；
 * 编排/降级/回链/脱敏/事务/API 全走真代码。CI 独立 job 跑 `pnpm test:e2e`（无 key 可复现）。
 *
 * 模式：默认 fixtures（回放）；`pnpm test:e2e:live`（E2E_AI_MODE=live）起真实 AI 客户端，
 *       需 QWEN/BAICHUAN/OCR key 与 qwen3.5-ocr 云端 OpenAI 兼容端点（ADR #16），仅发布前/验收手动跑，非回归手段。
 */
import { defineConfig, devices } from '@playwright/test'
import { TEST_URL } from './lib/test-db.js'
import { API_PORT, WEB_PORT, API_BASE, WEB_BASE } from './lib/ports.js'

const live = process.env.E2E_AI_MODE === 'live'

export default defineConfig({
  testDir: './specs',
  // 共享单一测试库 + 同一 api 进程，串行更稳（避免草稿/药箱行交叉）
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  use: {
    baseURL: WEB_BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 本地已有 Chromium 时可用 PW_EXECUTABLE_PATH 指向它（免重复下载）；CI 不设则用官方 bundled chromium。
    launchOptions: process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // api：fixtures 回放模式 + 独立测试库（dotenv 不覆盖已存在 env，故此处注入生效）
      command: 'pnpm exec tsx src/index.ts',
      cwd: '../packages/api',
      port: API_PORT,
      env: {
        AI_MODE: live ? '' : 'fixtures',
        DATABASE_URL: TEST_URL,
        PORT: String(API_PORT),
        NODE_ENV: 'test',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // web：vite dev（/api 代理→E2E api 独立端口，避免与本地 dev 8787 冲突）
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      cwd: '../packages/web',
      port: WEB_PORT,
      env: { API_PROXY_TARGET: API_BASE },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
