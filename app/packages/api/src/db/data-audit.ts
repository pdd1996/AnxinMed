/**
 * 资产域三库数据来源审计 —— 一眼分清「真实数据」与「mock 演示数据」
 *
 * 用法：
 *   pnpm run db:audit                # 只读报告：三库逐行标注来源 + 汇总
 *   pnpm run db:audit --purge-mock   # 列出可清理的演示行；加 --confirm 才真正删除
 *
 * 判定依据是行内自带的来源信息（source / dataSource 列），不靠猜：
 * - package_inserts.source 含「丁香园」→ 真实（DXY 抄录：爬虫草稿或人工首单）
 * - package_inserts.source 含「本地演示 / 本地 Mock」→ 演示（demo 虚构内容，未经整理流程）
 * - drug_master.dataSource 含「丁香园」→ 真实（爬虫建档）；含 demo 路径 → 演示档案（demo seed 带入）
 * - interaction_rules.source 含「演示」→ 演示抄录（正式条目待人工抄录，PRD §7.8.1 禁止模型生成）
 *
 * 清理语义：只删「演示内容 且 同药已有真实说明书行」的 package_inserts 行；
 * drug_master 演示档案不删——它被真实说明书行按 drugId 引用，身份字段升级走人工核对闸门；
 * interaction_rules 演示条目不删——替换只能靠人工抄录真条目。
 * 注意：重跑 db:seed 会重新导入演示行；需要纯净库时 seed 后再执行一次 --purge-mock --confirm。
 */
import 'dotenv/config'
import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inArray } from 'drizzle-orm'
import { db, client } from './client.js'
import { drugMaster, packageInserts, interactionRules } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const importLogPath = join(repoRoot, 'data', 'import-log.jsonl')

interface Prov {
  label: string
  real: boolean
}

function insertProv(r: { source: string | null }): Prov {
  const s = r.source ?? ''
  if (s.includes('丁香园')) return { label: '真实·DXY抄录   ', real: true }
  if (s.includes('本地演示') || s.includes('本地 Mock')) return { label: '演示·虚构内容', real: false }
  return { label: '⚠️未知来源    ', real: false }
}

function masterProv(r: { dataSource: string | null }): Prov {
  const s = r.dataSource ?? ''
  if (s.includes('丁香园')) return { label: '真实·爬虫建档', real: true }
  if (s.includes('demo/')) return { label: '演示·demo档案', real: false }
  return { label: '⚠️未知来源   ', real: false }
}

function ruleProv(r: { source: string }): Prov {
  return r.source.includes('演示')
    ? { label: '演示·演示抄录', real: false }
    : { label: '真实·人工抄录', real: true }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const purge = args.includes('--purge-mock')
  const confirmed = args.includes('--confirm')

  const [masters, inserts, rules] = await Promise.all([
    db.select().from(drugMaster),
    db.select().from(packageInserts),
    db.select().from(interactionRules),
  ])

  console.log('🔍 资产域三库数据来源审计（真实 vs 演示 mock）\n')

  // ── package_inserts ──
  const realDrugIds = new Set(inserts.filter((r) => insertProv(r).real).map((r) => r.drugId))
  const purgeable = inserts.filter((r) => !insertProv(r).real && realDrugIds.has(r.drugId))

  console.log(`── package_inserts（${inserts.length} 行）──`)
  for (const r of inserts) {
    const p = insertProv(r)
    const notes: string[] = []
    if (p.real && r.curationStatus === 'mock') notes.push('内容真实（人工首单），状态列 mock 为 seed 遗留标记')
    if (!p.real && realDrugIds.has(r.drugId)) notes.push('同药已有真实行 → 可清理')
    if (!p.real && !realDrugIds.has(r.drugId)) notes.push('无真实替代行，暂保留')
    console.log(
      `  [${p.label}] ${r.id.padEnd(48)} ${r.drugId} @ ${r.version ?? '—'}${notes.length ? '  ← ' + notes.join('；') : ''}`,
    )
  }

  // ── drug_master ──
  console.log(`\n── drug_master（${masters.length} 行）──`)
  for (const r of masters) {
    const p = masterProv(r)
    const notes: string[] = []
    if ((r.brandName ?? '').includes('演示')) notes.push('商品名含「演示」占位标记')
    if (!p.real) notes.push('身份字段升级走人工核对闸门，不自动改')
    console.log(
      `  [${p.label}] ${r.id.padEnd(30)} ${r.genericName}${notes.length ? '  ← ' + notes.join('；') : ''}`,
    )
  }

  // ── interaction_rules ──
  console.log(`\n── interaction_rules（${rules.length} 行）──`)
  for (const r of rules) {
    const p = ruleProv(r)
    const note = p.real ? '' : '  ← 正式条目待人工抄录替换（禁止模型生成，PRD §7.8.1）'
    console.log(`  [${p.label}] ${r.id}  ${JSON.stringify(r.drugIds)}${note}`)
  }

  // ── 汇总 ──
  const insReal = inserts.filter((r) => insertProv(r).real).length
  const masReal = masters.filter((r) => masterProv(r).real).length
  const rulReal = rules.filter((r) => ruleProv(r).real).length
  console.log(
    `\n汇总：package_inserts 真实 ${insReal}/${inserts.length} · ` +
      `drug_master 真实 ${masReal}/${masters.length} · ` +
      `interaction_rules 真实 ${rulReal}/${rules.length}`,
  )
  console.log('提示：db:seed 会重新导入演示行；需要纯净库时 seed 后再跑一次 --purge-mock --confirm。')

  // ── 清理（可选）──
  if (purge) {
    if (purgeable.length === 0) {
      console.log('\n🧹 无可清理的演示行（演示行均有真实替代才可清理）。')
      return 0
    }
    if (!confirmed) {
      console.log(`\n🧹 待清理 ${purgeable.length} 行演示说明书（均有真实 DXY 替代行）：`)
      purgeable.forEach((r) => console.log(`   将删除 ${r.id}（${r.drugId} @ ${r.version}）`))
      console.log('   确认执行：pnpm run db:audit --purge-mock --confirm')
      return 0
    }
    await db.delete(packageInserts).where(inArray(packageInserts.id, purgeable.map((r) => r.id)))
    const runAt = new Date().toISOString()
    for (const r of purgeable) {
      appendFileSync(
        importLogPath,
        `${JSON.stringify({
          runAt,
          drugId: r.drugId,
          version: r.version,
          packageInsert: { action: 'purged-mock', reason: '演示虚构内容，同药已有真实 DXY 抄录行' },
          drugMaster: { action: 'untouched' },
        })}\n`,
      )
    }
    console.log(`\n🧹 已删除 ${purgeable.length} 行演示说明书，动作已记入台账：${importLogPath}`)
  }
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 审计失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
