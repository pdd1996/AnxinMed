/**
 * p-001 演示数据 seed（任务书 T9-2）——只写用户域，绝不触碰资产域。
 * 为演示用户 p-001 生成：2 个手动药 + 2 个 active 计划 + 最近 7 天 records（recordPresets 的 rate/tailSkip 逻辑）
 * + 若干 self_reported 健康信息。保证「注册即见今日任务」。
 *
 * 幂等：全部使用 demo- 前缀固定 id；重跑先删 demo- 前缀旧数据再插入，不影响用户自建数据（drug-/plan-/health- 前缀）。
 * 仅 dev 库使用（CLI：pnpm db:seed-demo）；测试库不跑（测试自建数据）。
 */
import 'dotenv/config'
import { like } from 'drizzle-orm'
import { db as devDb, client } from './client.js'
import { users, drugs, plans, records, healthProfiles } from './schema.js'
import { addDaysStr, todayStr } from '@anxin/shared'

/** 确定性字符串哈希（0..INT），保证 records 生成可复现。 */
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

interface Preset {
  planId: string
  drugId: string
  rate: number // 0..1，历史日打勾概率
  tailSkip: number // 最近 N 天（含今天）不生成记录 → 保持 pending
  times: string[]
}

const PRESETS: Preset[] = [
  { planId: 'demo-plan-amlo', drugId: 'demo-drug-amlo', rate: 0.55, tailSkip: 3, times: ['08:00'] },
  { planId: 'demo-plan-metf', drugId: 'demo-drug-metf', rate: 0.7, tailSkip: 1, times: ['08:00', '19:00'] },
]

const HEALTH: { fieldKey: string; value: string }[] = [
  { fieldKey: '性别', value: '男' },
  { fieldKey: '年龄', value: '68' },
  { fieldKey: '诊断', value: '高血压、2型糖尿病' },
]

export async function seedDemoData(db: typeof devDb = devDb): Promise<void> {
  const today = todayStr()
  const now = new Date()

  // 演示用户（幂等 upsert）
  await db
    .insert(users)
    .values({ id: 'p-001', name: '张某某', email: null, phone: null })
    .onConflictDoUpdate({ target: users.id, set: { name: '张某某', updatedAt: now } })

  // 清掉旧 demo 数据（仅 demo- 前缀，不影响用户自建数据）
  await db.delete(records).where(like(records.id, 'demo-rec-%'))
  await db.delete(plans).where(like(plans.id, 'demo-plan-%'))
  await db.delete(drugs).where(like(drugs.id, 'demo-drug-%'))
  await db.delete(healthProfiles).where(like(healthProfiles.id, 'demo-health-%'))

  // 药箱 2 个手动药
  await db.insert(drugs).values([
    {
      id: 'demo-drug-amlo',
      userId: 'p-001',
      genericName: '苯磺酸氨氯地平片',
      brandName: '（演示）',
      specification: '5mg',
      form: '片剂',
      manufacturer: '演示药厂',
      confirmStatus: 'manual',
      stock: { value: 30, unit: '片' },
      openedAt: addDaysStr(today, -20),
      expiry: addDaysStr(today, 200),
      confirmedAt: now,
    },
    {
      id: 'demo-drug-metf',
      userId: 'p-001',
      genericName: '盐酸二甲双胍片',
      brandName: '（演示）',
      specification: '0.5g',
      form: '片剂',
      manufacturer: '演示药厂',
      confirmStatus: 'manual',
      stock: { value: 60, unit: '片' },
      openedAt: addDaysStr(today, -20),
      expiry: addDaysStr(today, 150),
      confirmedAt: now,
    },
  ])

  // 2 个 active 计划
  await db.insert(plans).values([
    {
      id: 'demo-plan-amlo',
      userId: 'p-001',
      drugId: 'demo-drug-amlo',
      dose: { value: 1, unit: '片' },
      frequency: 1,
      times: ['08:00'],
      route: '口服',
      meal: '饭后',
      cycleType: 'open',
      startDate: addDaysStr(today, -30),
      endDate: null,
      status: 'active',
      source: 'manual',
      tags: { dose: 'user', frequency: 'user', times: 'assist', startDate: 'default' },
    },
    {
      id: 'demo-plan-metf',
      userId: 'p-001',
      drugId: 'demo-drug-metf',
      dose: { value: 1, unit: '片' },
      frequency: 2,
      times: ['08:00', '19:00'],
      route: '口服',
      meal: '随餐',
      cycleType: 'open',
      startDate: addDaysStr(today, -30),
      endDate: null,
      status: 'active',
      source: 'manual',
      tags: { dose: 'user', frequency: 'user', times: 'assist', startDate: 'default' },
    },
  ])

  // 最近 7 天 records（rate/tailSkip；今天保持 pending 以便「注册即见今日任务」）
  const recRows: typeof records.$inferInsert[] = []
  for (let offset = 6; offset >= 0; offset--) {
    const date = addDaysStr(today, -offset)
    for (const preset of PRESETS) {
      if (offset < preset.tailSkip) continue // 最近 tailSkip 天不记录 → pending
      for (const time of preset.times) {
        const status = hash(`${preset.planId}|${date}|${time}`) % 100 < preset.rate * 100 ? 'taken' : 'skipped'
        recRows.push({
          id: `demo-rec-${preset.planId}-${date}-${time}`,
          userId: 'p-001',
          planId: preset.planId,
          scheduledDate: date,
          scheduledTime: time,
          status,
          actedAt: now,
        })
      }
    }
  }
  if (recRows.length > 0) await db.insert(records).values(recRows)

  // 健康信息（self_reported）
  for (const [i, entry] of HEALTH.entries()) {
    await db.insert(healthProfiles).values({
      id: `demo-health-${i}`,
      userId: 'p-001',
      fieldKey: entry.fieldKey,
      value: entry.value,
      sourceMeta: { source: 'self_reported', confirmedAt: now.toISOString() },
    })
  }

  console.log(`✅ demo 数据：2 药 + 2 计划 + ${recRows.length} 条 records + ${HEALTH.length} 条健康信息（p-001）`)
}

// CLI 入口：仅直接运行本文件时对 dev 库执行
if (process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed-demo.ts')) {
  seedDemoData()
    .then(async () => {
      await client.end()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('❌ demo seed 失败:', err)
      await client.end().catch(() => {})
      process.exit(1)
    })
}
