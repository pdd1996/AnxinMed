/**
 * M11-T2 · 已入库 curated 规则的临床复核单（M12 batch3 后为 50 条）。
 *
 * 输入：seed-interaction-rules.json 的 curated 规则 + drug_master 名称/剂型。
 * 输出：data/m11-reports/药师复核单-{N}条.md / .csv（本地，不入库；N = 当前 curated 条数）。
 *
 * 只做材料整理：不改 seed、不改规则、不写库。药师判定由人工填写。
 */
import '../lib/env.js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inArray } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { drugMaster } from '../db/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const LEVEL_ORDER: Record<string, number> = { 禁忌: 4, 慎用: 3, 需监测: 2, 注意: 1 }

interface SeedRule {
  id: string
  drugIds: string[]
  drugGroups?: string[][]
  level: string
  note: string
  source: string
  status: string
  reviewedBy?: string
}

async function main(): Promise<number> {
  const outDir = join(repoRoot, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join('data', 'm11-reports'))
  mkdirSync(outDir, { recursive: true })

  const seed = JSON.parse(readFileSync(join(__dirname, '..', 'db', 'seed-interaction-rules.json'), 'utf8')) as SeedRule[]
  const curated = seed.filter((r) => r.status === 'curated')
  const ids = [...new Set(curated.flatMap((r) => (r.drugGroups ?? [r.drugIds]).flat()))]
  const rows = await db.select({ id: drugMaster.id, genericName: drugMaster.genericName, form: drugMaster.form }).from(drugMaster).where(inArray(drugMaster.id, ids))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const show = (id: string) => {
    const d = byId.get(id)
    return d ? `${d.genericName}${d.form ? `（${d.form}）` : ''}` : id
  }

  const sorted = [...curated].sort((a, b) => (LEVEL_ORDER[b.level] ?? 0) - (LEVEL_ORDER[a.level] ?? 0) || a.id.localeCompare(b.id))
  const counts = sorted.reduce<Record<string, number>>((acc, r) => {
    acc[r.level] = (acc[r.level] ?? 0) + 1
    return acc
  }, {})

  const groupsOf = (r: SeedRule) =>
    (r.drugGroups ?? [r.drugIds]).map((g, i) => ({ label: `G${i + 1}`, items: g.map(show) }))

  const md: string[] = []
  md.push(`# 相互作用提示临床复核单（${curated.length} 条已入库）`)
  md.push('')
  md.push('> 给药师：不需要看代码。请确认每条提示的**级别**是否合适；如认为覆盖范围有问题，可在备注写明。原文均已逐字校验（quote 来自说明书原文）。')
  md.push('')
  md.push(`工程签核：泮栋栋 · 临床复核人：____________________ · 日期：____________`)
  md.push('')
  md.push(`汇总：禁忌 ${counts['禁忌'] ?? 0} / 慎用 ${counts['慎用'] ?? 0} / 需监测 ${counts['需监测'] ?? 0} / 注意 ${counts['注意'] ?? 0} · 共 ${curated.length} 条`)
  md.push('')
  md.push('判定写法：`同意` / `改为：禁忌|慎用|需监测|注意` / `不收`；备注可写范围/措辞问题。')
  md.push('')

  let n = 0
  for (const r of sorted) {
    n += 1
    const groups = groupsOf(r)
    const pair = groups.map((g) => byNameHead(g.items[0])).join(' × ')
    md.push(`## ${n}. ${pair}（当前 ${r.level}）`)
    md.push('')
    md.push(`- 规则 ID：${r.id}`)
    md.push(`- 原文：${r.note}`)
    groups.forEach((g) => md.push(`- ${g.label}：${g.items.join('、')}`))
    md.push('- 判定：☐ 同意  ☐ 改为：________  ☐ 不收')
    md.push(`- 备注：________________________________________`)
    md.push('')
  }
  md.push('## 复核人')
  md.push('')
  md.push('姓名/资质：____________________　日期：____________')
  writeFileSync(join(outDir, `药师复核单-${curated.length}条.md`), md.join('\n') + '\n')

  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = ['规则ID', '药对', '当前级别', '说明书原文', '覆盖范围', '判定', '改为级别', '备注']
  const csv = ['﻿' + header.map(esc).join(',')]
  for (const r of sorted) {
    const groups = groupsOf(r)
    const pair = groups.map((g) => byNameHead(g.items[0])).join(' × ')
    const scope = groups.map((g) => `${g.label}：${g.items.join('、')}`).join('；')
    csv.push([r.id, pair, r.level, r.note, scope, '', '', ''].map(esc).join(','))
  }
  writeFileSync(join(outDir, `药师复核单-${curated.length}条.csv`), csv.join('\r\n'))

  console.log(`✅ 复核单：${curated.length} 条（禁忌 ${counts['禁忌'] ?? 0} / 慎用 ${counts['慎用'] ?? 0} / 需监测 ${counts['需监测'] ?? 0} / 注意 ${counts['注意'] ?? 0}）`)
  console.log(`   输出：${join(outDir, `药师复核单-${curated.length}条.md`)} / 药师复核单-${curated.length}条.csv`)
  return 0
}

function byNameHead(label: string): string {
  return label.replace(/（[^）]*）$/, '')
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 复核单生成失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
