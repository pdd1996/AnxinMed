/**
 * 用户 seed —— 只写 users 表，绝不触碰资产域（drug_master / package_inserts / interaction_rules）。
 *
 * 导出 seedUsers(db) 供两处复用：① CLI 直接运行对 dev 库执行；② 测试 globalSetup 对测试库执行。
 * 背景：drug-crawler 工作流已把 dev 库药品改为 drug-*，seed.ts 的资产部分（读 mock-* 的 mock-data.json）
 *       不可再对 dev 库跑（会污染）；但患者（p-*）未受改名影响，patients 仍是有效的用户来源。
 * 范围：8 名患者 → users（id + name；email/phone 为 null，mock-data 无此数据，不编造）。
 *       health_profiles / plans / records 的 p-001 演示数据留 M1-T9。
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { db as devDb, client } from './client.js'
import { users } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// src/db → 上溯 5 级到工作区根目录
const mockDataPath = join(__dirname, '..', '..', '..', '..', '..', 'demo', 'server', 'mock-data.json')

/** 把 mock-data.json 的 patients 写入 users（幂等）。可传入测试库实例；返回写入行数。 */
export async function seedUsers(db: PostgresJsDatabase<any> = devDb): Promise<number> {
  const raw = readFileSync(mockDataPath, 'utf8')
  const patients: any[] = JSON.parse(raw).patients ?? []
  for (const p of patients) {
    await db
      .insert(users)
      .values({ id: p.id, name: p.name ?? null, email: null, phone: null })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: p.name ?? null, updatedAt: new Date() },
      })
  }
  return patients.length
}

// CLI 入口：仅直接运行本文件（tsx src/db/seed-users.ts）时对 dev 库执行
if (process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed-users.ts')) {
  console.log('📖 读取 mock-data.json 的 patients …')
  seedUsers()
    .then(async (n) => {
      const rows = await devDb.select({ id: users.id }).from(users)
      console.log(`\n✅ users seed 完成：${n} 名写入，users 表现有 ${rows.length} 行`)
      console.log('   ' + rows.map((r) => r.id).join(', '))
      await client.end()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('❌ users seed 失败:', err)
      await client.end().catch(() => {})
      process.exit(1)
    })
}
