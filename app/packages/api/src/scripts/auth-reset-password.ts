/**
 * G7 CLI：重置账号密码（无邮件/短信，找回只能走这里）。
 *
 * 用法（在 app/ 下）：
 *   pnpm --filter @anxin/api auth:reset-password -- --username p-001
 *   pnpm --filter @anxin/api auth:reset-password -- --username p-001 --password '新密码'
 *
 * 说明：
 * - 不传 --password 时生成随机新密码，**只在本次 stdout 显示一次**；
 * - 账号不存在 → 非零退出（不静默成功）；
 * - 重置后该账号的既有 session 不逐个失效（7 天后自然过期）；如需强制下线可重启实例或后续加 CLI。
 */
import '../lib/env.js'
import { client } from '../db/client.js'
import { generateInitialPassword } from '../lib/auth/password.js'
import { resetPassword } from '../services/auth.service.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const username = (arg('username') ?? '').trim()
if (!username) {
  console.error('❌ 缺少 --username（例如 --username p-001）')
  process.exit(1)
}

const explicitPassword = arg('password')
const password = explicitPassword ?? generateInitialPassword()

resetPassword(username, password)
  .then(async (user) => {
    if (!user) {
      console.error(`❌ 账号不存在：${username}`)
      await client.end()
      process.exit(1)
    }
    console.log(`✅ 密码已重置：${user.username}（用户 ${user.id}）`)
    if (!explicitPassword) {
      console.log('   ⚠️ 新密码（仅本次显示，请立即记录）：')
      console.log(`   ${password}`)
    }
    await client.end()
    process.exit(0)
  })
  .catch(async (err: unknown) => {
    console.error(`❌ 重置密码失败：${err instanceof Error ? err.message : String(err)}`)
    await client.end().catch(() => {})
    process.exit(1)
  })
