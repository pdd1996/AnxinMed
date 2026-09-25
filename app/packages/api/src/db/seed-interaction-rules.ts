/**
 * 相互作用规则库 seed —— 只写 interaction_rules，绝不触碰其他表。
 *
 * 导出 seedInteractionRules(db) 供两处复用：① CLI 直接运行对 dev 库执行；② 需要规则库的重建场景。
 * 背景：原 3 条规则（ir-001~003）只存在于 demo/server/mock-data.json（已随 demo/ 目录丢失）与
 *       dev 库本身；2026-09-24 dev 库被清空后，由用户 Navicat 转储（interaction_rules.sql，2026-09-24
 *       21:07 导出）逐字恢复。本文件是该恢复结果的冻结副本，使规则库在仓库内有持久来源、可一键重建。
 * 边界：条目内容为抄录原文（PRD §7.8.1 只许抄录、禁止模型生成），本脚本只做幂等 upsert 冻结数据，
 *       不新增、不改写任何规则内容；新规则仍只能走人工抄录流程后编辑 seed-interaction-rules.json。
 * 数据源 seed-interaction-rules.json（同目录）：id + drugIds + level + note + source；
 *       created_at / updated_at 不入冻结数据，由库默认值与 upsert 维护。
 * 前置：drugIds 引用的 drug_master 行必须已存在（db:import-crawled 建），否则冲突检测会静默失效
 *       （同 seed-demo 的 drugMasterId 陷阱）——缺失即抛错，不静默吞。
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { db as devDb, client } from './client.js'
import { drugMaster, interactionRules } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rulesPath = join(__dirname, 'seed-interaction-rules.json')

interface FrozenRule {
  id: string
  drugIds: string[]
  level: string
  note: string
  source: string
}

/** 与 schema.ts 的 interactionRules.level 枚举一致；冻结数据过守门后再入库，非法值可见失败。 */
const RULE_LEVELS = ['禁忌', '慎用', '需监测', '注意'] as const
type RuleLevel = (typeof RULE_LEVELS)[number]

function asRuleLevel(s: string): RuleLevel {
  const hit = RULE_LEVELS.find((l) => l === s)
  if (!hit) throw new Error(`冻结数据含非法 level「${s}」（允许：${RULE_LEVELS.join('、')}）`)
  return hit
}

/** 把冻结的规则写入 interaction_rules（幂等）。可传入测试库实例；返回写入行数。 */
export async function seedInteractionRules(db: PostgresJsDatabase<any> = devDb): Promise<number> {
  const rules: FrozenRule[] = JSON.parse(readFileSync(rulesPath, 'utf8'))

  const referencedIds = [...new Set(rules.flatMap((r) => r.drugIds))]
  const existing = await db
    .select({ id: drugMaster.id })
    .from(drugMaster)
    .where(inArray(drugMaster.id, referencedIds))
  const missing = referencedIds.filter((id) => !existing.some((row) => row.id === id))
  if (missing.length > 0) {
    throw new Error(`drug_master 缺少被规则引用的药品行：${missing.join('、')}。请先运行 db:import-crawled。`)
  }

  for (const rule of rules) {
    const level = asRuleLevel(rule.level)
    await db
      .insert(interactionRules)
      .values({
        id: rule.id,
        drugIds: rule.drugIds,
        level,
        note: rule.note,
        source: rule.source,
      })
      .onConflictDoUpdate({
        target: interactionRules.id,
        set: {
          drugIds: rule.drugIds,
          level,
          note: rule.note,
          source: rule.source,
          updatedAt: new Date(),
        },
      })
  }
  return rules.length
}

// CLI 入口：仅直接运行本文件（tsx src/db/seed-interaction-rules.ts）时对 dev 库执行
if (process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed-interaction-rules.ts')) {
  seedInteractionRules()
    .then(async (n) => {
      const rows = await devDb.select({ id: interactionRules.id }).from(interactionRules)
      console.log(`\n✅ interaction_rules seed 完成：${n} 条冻结规则写入，表现有 ${rows.length} 行`)
      console.log('   ' + rows.map((r) => r.id).join(', '))
      await client.end()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('❌ interaction_rules seed 失败:', err instanceof Error ? err.message : err)
      await client.end().catch(() => {})
      process.exit(1)
    })
}
