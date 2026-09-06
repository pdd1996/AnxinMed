/**
 * E2E 测试库连接串（M2-T10）—— 与单测同一独立库 anxin_medication_test，互不污染生产/开发数据。
 * 不硬编码凭据：读 app/packages/api/.env 的 DATABASE_URL，仅替换库名段（同 __tests__/test-db-url.ts 思路）。
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// 显式加载 api 包的 .env（e2e 进程 cwd 不在 api，dotenv/config 默认找不到）
config({ path: fileURLToPath(new URL('../../packages/api/.env', import.meta.url)) })

export const TEST_DB_NAME = 'anxin_medication_test'

function withDb(url: string, db: string): string {
  const [base, qs] = url.split('?')
  const i = base.lastIndexOf('/')
  const swapped = base.slice(0, i + 1) + db
  return qs ? `${swapped}?${qs}` : swapped
}

const devUrl = process.env.DATABASE_URL
if (!devUrl) throw new Error('DATABASE_URL 未设置（app/packages/api/.env 缺失），无法派生测试库连接串')

export const TEST_URL = withDb(devUrl, TEST_DB_NAME)
export const ADMIN_URL = withDb(devUrl, 'postgres')
/** api 迁移 SQL 目录（纯 SQL 进 git，见 packages/api/drizzle）。 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../packages/api/drizzle', import.meta.url))
