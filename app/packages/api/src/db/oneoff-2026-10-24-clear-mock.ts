/**
 * 一次性清理 mock/演示数据（2026-10-24）—— 用户域全清 + 演示相互作用规则 + mock 身份及其说明书。
 *
 * 背景：接入真实说明书 PDF 库前，清掉 demo seed 带来的演示患者/记录与 mock 资产。
 * 资产域耦合：9 条 mock 身份挂着 9 条真实 DXY 说明书；删身份必须同时删这些说明书，避免孤儿行。
 *
 * 用法：
 *   tsx src/db/oneoff-2026-10-24-clear-mock.ts            # 只报告将删除的行数
 *   tsx src/db/oneoff-2026-10-24-clear-mock.ts --confirm  # 事务内执行删除
 *
 * 前置：已备份（app/backups/anxin-local-20261024-before-mock-clean.dump）。
 * 保留：6 条真实 DXY 身份/说明书 + 2 条 PDF 身份/说明书。
 */
import 'dotenv/config'
import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, ilike, inArray } from 'drizzle-orm'
import { db, client } from './client.js'
import {
  users, drugs, plans, records, sources, healthProfiles, drafts,
  consultLogs, riskEvents, consultSessions, consultSuggestions, insightAskLogs,
  drugMaster, packageInserts, interactionRules,
} from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const importLogPath = join(repoRoot, 'data', 'import-log.jsonl')

async function counts() {
  const [
    userRows, drugRows, planRows, recordRows, sourceRows, healthRows, draftRows,
    logRows, riskRows, sessionRows, suggestionRows, insightRows,
    ruleRows, insertRows, masterRows,
  ] = await Promise.all([
    db.select({ id: users.id }).from(users),
    db.select({ id: drugs.id }).from(drugs),
    db.select({ id: plans.id }).from(plans),
    db.select({ id: records.id }).from(records),
    db.select({ id: sources.id }).from(sources),
    db.select({ id: healthProfiles.id }).from(healthProfiles),
    db.select({ id: drafts.id }).from(drafts),
    db.select({ id: consultLogs.id }).from(consultLogs),
    db.select({ id: riskEvents.id }).from(riskEvents),
    db.select({ id: consultSessions.id }).from(consultSessions),
    db.select({ id: consultSuggestions.id }).from(consultSuggestions),
    db.select({ id: insightAskLogs.id }).from(insightAskLogs),
    db.select({ id: interactionRules.id }).from(interactionRules),
    db.select({ id: packageInserts.id }).from(packageInserts),
    db.select({ id: drugMaster.id }).from(drugMaster),
  ])
  return {
    users: userRows.length,
    drugs: drugRows.length,
    plans: planRows.length,
    records: recordRows.length,
    sources: sourceRows.length,
    healthProfiles: healthRows.length,
    drafts: draftRows.length,
    consultLogs: logRows.length,
    riskEvents: riskRows.length,
    consultSessions: sessionRows.length,
    consultSuggestions: suggestionRows.length,
    insightAskLogs: insightRows.length,
    interactionRules: ruleRows.length,
    packageInserts: insertRows.length,
    drugMaster: masterRows.length,
  }
}

async function main(): Promise<number> {
  const confirm = process.argv.includes('--confirm')
  const before = await counts()

  const mockMasters = await db
    .select({ id: drugMaster.id })
    .from(drugMaster)
    .where(eq(drugMaster.curationStatus, 'mock'))
  const mockIds = mockMasters.map((r) => r.id)
  const mockInserts = mockIds.length
    ? (await db.select({ id: packageInserts.id }).from(packageInserts).where(inArray(packageInserts.drugId, mockIds))).length
    : 0
  const demoRules = (await db.select({ id: interactionRules.id }).from(interactionRules).where(ilike(interactionRules.source, '%演示%'))).length

  console.log('🧹 待清理范围')
  console.log(`   用户域：users ${before.users} / drugs ${before.drugs} / plans ${before.plans} / records ${before.records}`)
  console.log(`           sources ${before.sources} / health_profiles ${before.healthProfiles} / drafts ${before.drafts}`)
  console.log(`           consult_logs ${before.consultLogs} / risk_events ${before.riskEvents} / sessions ${before.consultSessions} / suggestions ${before.consultSuggestions} / insight_logs ${before.insightAskLogs}`)
  console.log(`   演示相互作用规则：${demoRules}（全部）`)
  console.log(`   mock 身份：${mockIds.length} 条；其名下说明书：${mockInserts} 条`)
  console.log(`   保留资产：drug_master ${before.drugMaster - mockIds.length} / package_inserts ${before.packageInserts - mockInserts}`)

  if (!confirm) {
    console.log('\n未加 --confirm，仅报告；加 --confirm 执行删除。')
    return 0
  }

  const deleted: Record<string, number> = {}
  await db.transaction(async (tx) => {
    deleted.consultSuggestions = (await tx.delete(consultSuggestions).returning({ id: consultSuggestions.id })).length
    deleted.riskEvents = (await tx.delete(riskEvents).returning({ id: riskEvents.id })).length
    deleted.consultLogs = (await tx.delete(consultLogs).returning({ id: consultLogs.id })).length
    deleted.consultSessions = (await tx.delete(consultSessions).returning({ id: consultSessions.id })).length
    deleted.insightAskLogs = (await tx.delete(insightAskLogs).returning({ id: insightAskLogs.id })).length
    deleted.drafts = (await tx.delete(drafts).returning({ id: drafts.id })).length
    deleted.records = (await tx.delete(records).returning({ id: records.id })).length
    deleted.plans = (await tx.delete(plans).returning({ id: plans.id })).length
    deleted.drugs = (await tx.delete(drugs).returning({ id: drugs.id })).length
    deleted.sources = (await tx.delete(sources).returning({ id: sources.id })).length
    deleted.healthProfiles = (await tx.delete(healthProfiles).returning({ id: healthProfiles.id })).length
    deleted.users = (await tx.delete(users).returning({ id: users.id })).length

    deleted.interactionRules = (await tx.delete(interactionRules)
      .where(ilike(interactionRules.source, '%演示%'))
      .returning({ id: interactionRules.id })).length

    if (mockIds.length) {
      deleted.packageInserts = (await tx.delete(packageInserts)
        .where(inArray(packageInserts.drugId, mockIds))
        .returning({ id: packageInserts.id })).length
      deleted.drugMaster = (await tx.delete(drugMaster)
        .where(eq(drugMaster.curationStatus, 'mock'))
        .returning({ id: drugMaster.id })).length
    }
  })

  const after = await counts()
  const runAt = new Date().toISOString()
  appendFileSync(importLogPath, `${JSON.stringify({
    runAt,
    action: 'purged-mock-all',
    reason: '接入真实 PDF 说明书前清理 demo 用户域与 mock 资产',
    deleted,
    before,
    after,
  })}\n`)

  console.log('\n✅ 清理完成')
  console.log(`   删除用户域：users ${deleted.users} / drugs ${deleted.drugs} / plans ${deleted.plans} / records ${deleted.records}`)
  console.log(`   删除规则：${deleted.interactionRules}；mock 身份：${deleted.drugMaster}；其说明书：${deleted.packageInserts}`)
  console.log(`   现存资产：drug_master ${after.drugMaster} / package_inserts ${after.packageInserts} / interaction_rules ${after.interactionRules}`)
  console.log(`   现存用户域：users ${after.users}（其余表应全为 0）`)
  console.log(`   台账：${importLogPath}`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 清理失败（事务已回滚）:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
