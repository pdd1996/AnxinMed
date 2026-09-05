/**
 * 测试库 URL 工具 —— 从 dev DATABASE_URL 派生独立测试库 / 维护库连接串。
 * 不硬编码凭据：只替换库名段，其余（用户/密码/主机/端口）沿用 .env。
 */
import 'dotenv/config'

export const TEST_DB_NAME = 'anxin_medication_test'

/** 把连接串末尾的库名替换为 db（保留可能的 ?query）。 */
export function withDb(url: string, db: string): string {
  const [base, qs] = url.split('?')
  const i = base.lastIndexOf('/')
  const swapped = base.slice(0, i + 1) + db
  return qs ? `${swapped}?${qs}` : swapped
}

const devUrl = process.env.DATABASE_URL
if (!devUrl) throw new Error('DATABASE_URL 未设置，无法派生测试库连接串')

/** dev 库（.env 原始）*/
export const DEV_URL = devUrl
/** 独立测试库 */
export const TEST_URL = withDb(devUrl, TEST_DB_NAME)
/** 维护库（postgres），用于 CREATE/DROP DATABASE */
export const ADMIN_URL = withDb(devUrl, 'postgres')
