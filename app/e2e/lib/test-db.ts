/**
 * E2E 测试库连接串（M2-T10 本地 / M5-T1 远端）。
 * 本地：与单测同一独立库 anxin_medication_test，互不污染生产/开发数据。
 *      不硬编码凭据：读 app/packages/api/.env 的 DATABASE_URL，仅替换库名段（同 __tests__/test-db-url.ts 思路）。
 * 远端（对火山部署跑验收）：`E2E_DB_URL` 给整套 e2e 用的库连接（经 SSH 隧道可达），此时**不再建/删测试库**，
 *      迁移与 golden 行直接准备在该库上——远端 api 用的就是它。须同时 `E2E_ALLOW_REMOTE_DB=1` 显式确认。
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// 显式加载 api 包的 .env（e2e 进程 cwd 不在 api，dotenv/config 默认找不到）
config({ path: fileURLToPath(new URL('../../packages/api/.env', import.meta.url)) })

export const TEST_DB_NAME = 'anxin_medication_test'

export const REMOTE_DB_URL = process.env.E2E_DB_URL || undefined
/** 远端模式下 e2e 读写的是部署自身的库——必须显式授权，避免误把本地串填进去跑坏云端数据。 */
if (REMOTE_DB_URL && process.env.E2E_ALLOW_REMOTE_DB !== '1') {
  throw new Error(
    '设了 E2E_DB_URL 但未设 E2E_ALLOW_REMOTE_DB=1：远端 e2e 会直接读写该库（见 app/deploy/README.md §8）',
  )
}
export const isRemoteDbTarget = Boolean(REMOTE_DB_URL)

function withDb(url: string, db: string): string {
  const [base, qs] = url.split('?')
  const i = base.lastIndexOf('/')
  const swapped = base.slice(0, i + 1) + db
  return qs ? `${swapped}?${qs}` : swapped
}

const devUrl = REMOTE_DB_URL ?? process.env.DATABASE_URL
if (!devUrl) throw new Error('DATABASE_URL 未设置（app/packages/api/.env 缺失），无法派生测试库连接串')

export const TEST_URL = REMOTE_DB_URL ?? withDb(devUrl, TEST_DB_NAME)
export const ADMIN_URL = withDb(devUrl, 'postgres')
/** api 迁移 SQL 目录（纯 SQL 进 git，见 packages/api/drizzle）。 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../packages/api/drizzle', import.meta.url))
