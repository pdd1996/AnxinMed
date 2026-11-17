/**
 * 相互作用规则库 seed（M8-T1 正式化版）——只写 interaction_rules，绝不触碰其他表。
 *
 * 边界（PRD §7.8.1）：规则内容只能抄录，禁止模型推理生成。本脚本在入库前执行
 * `services/rules/rule-curation` 守门：
 * - status='demo'：演示条目，source 必须自报「演示」，UI 必须标注；
 * - status='curated'：note ⊆ quote ⊆ 所引说明书段落（逐字），所引说明书行必须 reviewed，
 *   且必须有 source_type / source_ref / reviewed_by；
 * - 药品 ID 必须存在；同药对不得重复。
 *
 * 用法（cd app）：
 *   pnpm --filter @anxin/api db:seed-interaction-rules -- --check   # 只校验不写库
 *   pnpm --filter @anxin/api db:seed-interaction-rules              # 校验通过后幂等 upsert
 *
 * 前置：drugIds 引用的 drug_master 行必须已存在（db:import-crawled 建），sourceRef 引用的
 *       说明书行必须已入库；缺失即抛错，不静默吞。
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { db as devDb, client } from './client.js'
import { drugMaster, interactionRules, packageInserts } from './schema.js'
import {
  RuleCurationInputSchema,
  RuleSourceRefSchema,
  summarizeRules,
  validateRules,
  type ManualSnapshot,
  type RuleCurationContext,
  type RuleCurationInput,
} from '../services/rules/rule-curation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rulesPath = join(__dirname, 'seed-interaction-rules.json')

interface LoadedSeed {
  rules: RuleCurationInput[]
  context: RuleCurationContext
}

async function loadSeed(db: PostgresJsDatabase<any>): Promise<LoadedSeed> {
  const raw: unknown = JSON.parse(readFileSync(rulesPath, 'utf8'))
  if (!Array.isArray(raw)) throw new Error('seed-interaction-rules.json 顶层必须是数组')

  const rules: RuleCurationInput[] = raw.map((item, i) => {
    const parsed = RuleCurationInputSchema.safeParse(item)
    if (!parsed.success) {
      throw new Error(
        `冻结数据第 ${i + 1} 条校验失败：${parsed.error.issues.map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`).join('; ')}`,
      )
    }
    return parsed.data
  })

  // 来源引用里的说明书行（curated 才需要；格式错误交给守门报错，不在这里抛）
  const insertIds = new Set<string>()
  for (const rule of rules) {
    if (rule.status !== 'curated' || rule.sourceType !== 'manual-interaction' || !rule.sourceRef) continue
    try {
      const ref = RuleSourceRefSchema.safeParse(JSON.parse(rule.sourceRef))
      if (ref.success) insertIds.add(ref.data.insertId)
    } catch {
      // 非法 JSON：不收集来源行，validateRule 会给出可读错误
    }
  }

  const masters = await db.select({ id: drugMaster.id }).from(drugMaster)
  const manualsByInsertId: Record<string, ManualSnapshot> = {}
  if (insertIds.size > 0) {
    const rows = await db
      .select({
        id: packageInserts.id,
        drugId: packageInserts.drugId,
        curationStatus: packageInserts.curationStatus,
        sourceSections: packageInserts.sourceSections,
      })
      .from(packageInserts)
      .where(inArray(packageInserts.id, [...insertIds]))
    for (const row of rows) {
      manualsByInsertId[row.id] = {
        insertId: row.id,
        drugId: row.drugId,
        curationStatus: row.curationStatus,
        sections: row.sourceSections ?? {},
      }
    }
  }

  const existingRows = await db
    .select({ id: interactionRules.id, drugIds: interactionRules.drugIds, drugGroups: interactionRules.drugGroups, status: interactionRules.status })
    .from(interactionRules)
  const existingRules = existingRows.map((r) => ({
    id: r.id,
    drugIds: (r.drugIds as string[] | null) ?? [],
    drugGroups: (r.drugGroups as string[][] | null) ?? null,
    status: r.status,
  }))

  return {
    rules,
    context: {
      existingDrugMasterIds: masters.map((m) => m.id),
      manualsByInsertId,
      existingRules,
    },
  }
}

/** 校验冻结数据；返回规则数。--check 与 apply 共用。 */
export async function checkInteractionRules(
  db: PostgresJsDatabase<any> = devDb,
): Promise<{ rules: RuleCurationInput[]; errors: string[]; warnings: string[] }> {
  const { rules, context } = await loadSeed(db)
  const result = validateRules(rules, context)
  return { rules, errors: result.errors, warnings: result.warnings }
}

/** 把冻结的规则写入 interaction_rules（幂等）。可传入测试库实例；返回写入行数。 */
export async function seedInteractionRules(db: PostgresJsDatabase<any> = devDb): Promise<number> {
  const { rules, errors, warnings } = await checkInteractionRules(db)
  for (const w of warnings) console.warn(`⚠️  ${w}`)
  if (errors.length > 0) {
    throw new Error(`规则守门未通过（${errors.length} 条）：\n- ${errors.join('\n- ')}`)
  }

  for (const rule of rules) {
    const reviewedAt = rule.reviewedAt ? new Date(rule.reviewedAt) : null
    const values = {
      id: rule.id,
      drugIds: rule.drugIds,
      drugGroups: rule.drugGroups ?? null,
      level: rule.level,
      note: rule.note,
      source: rule.source,
      status: rule.status,
      sourceType: rule.sourceType ?? null,
      sourceRef: rule.sourceRef ?? null,
      quote: rule.quote ?? null,
      reviewedBy: rule.reviewedBy ?? null,
      reviewedAt: Number.isNaN(reviewedAt?.getTime()) ? null : reviewedAt,
    }
    await db
      .insert(interactionRules)
      .values(values)
      .onConflictDoUpdate({
        target: interactionRules.id,
        set: { ...values, updatedAt: new Date() },
      })
  }
  return rules.length
}

// CLI 入口：仅直接运行本文件（tsx src/db/seed-interaction-rules.ts）时对 dev 库执行
if (process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed-interaction-rules.ts')) {
  const checkOnly = process.argv.includes('--check')
  ;(async () => {
    const check = await checkInteractionRules()
    const summary = summarizeRules(check.rules)
    const rows = await devDb.select({ id: interactionRules.id, status: interactionRules.status }).from(interactionRules)
    for (const w of check.warnings) console.warn(`⚠️  ${w}`)
    if (check.errors.length > 0) {
      console.error(`\n❌ 规则守门未通过 ${check.errors.length} 条：\n- ${check.errors.join('\n- ')}`)
      await client.end()
      process.exit(1)
    }
    if (checkOnly) {
      console.log(`\n🔍 规则守门检查：${check.rules.length} 条（demo ${summary.demo} / curated ${summary.curated} / retired ${summary.retired}）`)
      console.log(`   库内现有 ${rows.length} 行；✅ 全部通过（未写库）`)
      await client.end()
      process.exit(0)
    }
    const n = await seedInteractionRules()
    console.log(`\n✅ interaction_rules seed 完成：${n} 条（demo ${summary.demo} / curated ${summary.curated} / retired ${summary.retired}）`)
    console.log('   库内现有：' + rows.map((r) => `${r.id}(${r.status})`).join(', '))
    await client.end()
    process.exit(0)
  })().catch(async (err) => {
    console.error('❌ interaction_rules seed 失败:', err instanceof Error ? err.message : err)
    await client.end().catch(() => {})
    process.exit(1)
  })
}
