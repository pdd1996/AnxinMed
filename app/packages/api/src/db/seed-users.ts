/**
 * 用户 seed（M1-T5）—— 只写 users 表，绝不触碰资产域（drug_master / package_inserts / interaction_rules）。
 *
 * 背景：drug-crawler 工作流已把库内药品 ID 全量改为 drug-*（15 行）并从 data/crawled 导入；
 *       demo/server/mock-data.json 的药品仍是旧 mock-*（已过时），故 db:seed 的资产部分不可再跑（会污染）。
 *       患者（p-*）未受药品改名影响，mock-data.json 的 patients 仍是有效的用户来源。
 * 范围：8 名患者 → users（id + name；email/phone 为 null，mock-data 无此数据，不编造）。
 *       health_profiles / plans / records 的 p-001 演示数据留 M1-T9。
 *
 * 运行：pnpm --filter @anxin/api db:seed-users（幂等，可重复）
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, client } from './client.js'
import { users } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// src/db → 上溯 5 级到工作区根目录
const mockDataPath = join(__dirname, '..', '..', '..', '..', '..', 'demo', 'server', 'mock-data.json')

async function seedUsers() {
  console.log('📖 读取 mock-data.json 的 patients …')
  const raw = readFileSync(mockDataPath, 'utf8')
  const data = JSON.parse(raw)
  const patients: any[] = data.patients ?? []

  console.log(`👤 导入用户（${patients.length} 名）…`)
  for (const p of patients) {
    await db
      .insert(users)
      .values({ id: p.id, name: p.name ?? null, email: null, phone: null })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: p.name ?? null, updatedAt: new Date() },
      })
  }

  const rows = await db.select({ id: users.id }).from(users)
  console.log(`\n✅ users seed 完成：${rows.length} 行`)
  console.log('   ' + rows.map((r) => r.id).join(', '))
}

seedUsers()
  .then(async () => { await client.end(); process.exit(0) })
  .catch(async (err) => {
    console.error('❌ users seed 失败:', err)
    await client.end().catch(() => {})
    process.exit(1)
  })
