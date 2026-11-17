/**
 * G7 CLI：开通 / 更新账号密码（不开放 HTTP 自助注册）。
 *
 * 用法（在 app/ 下）：
 *   pnpm --filter @anxin/api auth:create-user -- --username p-001 --id p-001 --name 张某某
 *   pnpm --filter @anxin/api auth:create-user -- --username demo01 --name 演示账号 --password '***'
 *
 * 说明：
 * - --id 指向已有用户（如 seed 的 p-001）则只更新凭据；不传则新建用户（id 自动生成 u-<uuid>）；
 * - 不传 --password 时生成随机初始密码，**只在本次 stdout 显示一次**（请立即记录，不落库明文）；
 * - 用户名冲突 / 参数错误均非零退出并给出可理解信息（禁止静默）。
 */
import '../lib/env.js'
import { client } from '../db/client.js'
import { generateInitialPassword } from '../lib/auth/password.js'
import { createUserCredential } from '../services/auth.service.js'

const USERNAME_RE = /^[A-Za-z0-9._-]{2,64}$/

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function fail(message: string): never {
  console.error(`❌ ${message}`)
  process.exit(1)
}

const username = (arg('username') ?? '').trim()
if (!USERNAME_RE.test(username)) {
  fail('缺少或非法的 --username（2–64 位字母/数字/._-，例如 p-001 或 demo01）')
}

const explicitPassword = arg('password')
const password = explicitPassword ?? generateInitialPassword()
const id = arg('id')?.trim() || undefined
const name = arg('name') ?? null

createUserCredential({ id, username, password, name })
  .then(async (user) => {
    console.log(`✅ 账号已开通：${user.username}（用户 ${user.id}${user.name ? ` / ${user.name}` : ''}）`)
    if (!explicitPassword) {
      console.log('   ⚠️ 初始密码（仅本次显示，请立即记录；登录后暂不支持自助改密）：')
      console.log(`   ${password}`)
    }
    await client.end()
    process.exit(0)
  })
  .catch(async (err: unknown) => {
    const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code
    const message =
      code === '23505'
        ? `账号名或用户 id 已存在（${username}${id ? ` / ${id}` : ''}），请换一个 --username`
        : err instanceof Error
          ? err.message
          : String(err)
    console.error(`❌ 开通账号失败：${message}`)
    await client.end().catch(() => {})
    process.exit(1)
  })
