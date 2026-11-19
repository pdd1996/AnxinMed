/**
 * specs/25 演示准备脚本：开通「医生 + 患者」两个真实账号，并预绑定演示患者。
 *
 * 用途：方案 A 的绑定演示需要两个身份（demo 模式固定注入 p-001，做不到双身份），
 *      本脚本把本机演示库切成 password 模式可用的账号组合：
 *   - 医生账号：id=doctor-demo / role=doctor / 可生成绑定码、查看授权患者；
 *   - 患者账号：p-001（复用 seed 演示数据，179 条打卡 / 5 个药）；
 *   - 预绑定：p-101…p-107（有打卡数据的演示患者）→ 医生端队列一进去就有内容；
 *   - 保留 p-001 不绑定 → 现场演示「医生生成码 → 患者输入 → 患者出现在队列」。
 *
 * 用法（在 app/ 下）：
 *   pnpm --filter @anxin/api demo:setup-doctor
 *   pnpm --filter @anxin/api demo:setup-doctor -- --doctor-password '自定义密码' --bind-patients p-101,p-102
 *
 * 幂等：账号已存在则更新凭据；绑定关系已存在则刷新为 active（seed 来源）。
 * ⚠️ 仅用于本机演示库；账号/密码属演示凭据，不写入生产。
 */
import '../lib/env.js'
import { client } from '../db/client.js'
import { createUserCredential } from '../services/auth.service.js'
import { seedLink } from '../services/binding.service.js'

const DEFAULT_DOCTOR_USERNAME = 'doctor-demo'
const DEFAULT_DOCTOR_PASSWORD = 'AnxinDemo2026'
const DEFAULT_PATIENT_USERNAME = 'p-001'
const DEFAULT_PATIENT_PASSWORD = 'AnxinDemo2026'
const DEFAULT_BIND_PATIENTS = 'p-101,p-102,p-103,p-104,p-105,p-106,p-107'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1]?.trim() : undefined
}

function fail(message: string): never {
  console.error(`❌ ${message}`)
  process.exit(1)
}

const doctorUsername = arg('doctor-username') ?? DEFAULT_DOCTOR_USERNAME
const doctorPassword = arg('doctor-password') ?? DEFAULT_DOCTOR_PASSWORD
const patientUsername = arg('patient-username') ?? DEFAULT_PATIENT_USERNAME
const patientPassword = arg('patient-password') ?? DEFAULT_PATIENT_PASSWORD
const bindPatients = (arg('bind-patients') ?? DEFAULT_BIND_PATIENTS)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (doctorPassword.length < 8) fail('医生密码至少 8 位（shared PASSWORD_MIN_LENGTH）')
if (patientPassword.length < 8) fail('患者密码至少 8 位（shared PASSWORD_MIN_LENGTH）')

const DOCTOR_USER_ID = 'doctor-demo'

async function main(): Promise<void> {
  // 1. 医生账号（role='doctor'）
  const doctor = await createUserCredential({
    id: DOCTOR_USER_ID,
    username: doctorUsername,
    password: doctorPassword,
    name: '演示医生',
    role: 'doctor',
  })

  // 2. 患者账号：给 seed 的 p-001 开通凭据（数据不变）
  const patient = await createUserCredential({
    id: 'p-001',
    username: patientUsername,
    password: patientPassword,
    name: '张某某',
    role: 'patient',
  })

  // 3. 预绑定演示患者（医生端队列一进去就有内容；p-001 留空用于现场绑定演示）
  for (const patientId of bindPatients) {
    if (patientId === patient.id) continue
    await seedLink(doctor.id, patientId)
  }

  console.log('✅ 演示账号就绪（仅本机演示库）：')
  console.log(`   医生：${doctor.username} / ${doctorPassword}（role=${doctor.role}，id=${doctor.id}）`)
  console.log(`   患者：${patient.username} / ${patientPassword}（id=${patient.id}，seed 演示数据）`)
  console.log(`   医生已预绑定患者：${bindPatients.join(', ') || '（无）'}`)
  console.log(`   患者 ${patient.id} 未绑定 → 现场演示「医生生成绑定码 → 患者输入 → 队列出现该患者」`)
  console.log('')
  console.log('下一步（本机 password 模式启动）：')
  console.log('   cd app; $env:AUTH_MODE="password"; pnpm dev   # 或分别起 api / web')
  console.log('   患者端 http://localhost:5173/login → p-001 登录；医生端 http://localhost:5173/doctor/insight')
}

main()
  .then(async () => {
    await client.end()
    process.exit(0)
  })
  .catch(async (err: unknown) => {
    const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code
    const message = code === '23505' ? '账号名冲突，请换 --doctor-username / --patient-username' : err instanceof Error ? err.message : String(err)
    console.error(`❌ 演示账号准备失败：${message}`)
    await client.end().catch(() => {})
    process.exit(1)
  })
