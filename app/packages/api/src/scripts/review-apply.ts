/**
 * 说明书人工核对 · 应用 decisions（M6-T9）。
 *
 * 校验通过后在一个事务里升 reviewed、写 reviewed_by/at/meta、段修正与审计日志。
 * 任一条校验失败 → 整批不落库（all-or-nothing）；已 reviewed 的行按幂等跳过。
 *
 * 用法（cd app/packages/api）：
 *   npm run db:review-apply -- --decisions ../../data/review-batches/batch-01-decisions.json --dry-run
 *   npm run db:review-apply -- --decisions ... [--reviewer 覆盖]
 */
import '../lib/env.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { client } from '../db/client.js'
import { ReviewDecisionsSchema } from '../services/review/decisions.js'
import { applyDecisions } from '../services/review/apply.js'

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main(): Promise<number> {
  const decisionsPath = arg('--decisions')
  if (!decisionsPath) {
    console.error('❌ 缺少 --decisions <path>')
    return 1
  }
  const dryRun = process.argv.includes('--dry-run')

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolve(decisionsPath), 'utf8'))
  } catch (err) {
    console.error('❌ decisions 读取/解析失败：', (err as Error).message)
    return 1
  }
  const parsed = ReviewDecisionsSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('❌ decisions 校验失败：')
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
    return 1
  }
  const decisions = parsed.data
  const override = arg('--reviewer')
  if (override && override.trim() !== decisions.reviewer) {
    console.error(`❌ --reviewer(${override}) 与 decisions.reviewer(${decisions.reviewer}) 不一致`)
    return 1
  }
  const reviewer = (override ?? decisions.reviewer).trim()

  const result = await applyDecisions(decisions, reviewer, { dryRun })
  if (result.errors.length) {
    console.error(`❌ ${result.errors.length} 条校验失败，整批未落库：`)
    for (const err of result.errors) console.error(`   - ${err}`)
    return 1
  }

  console.log(`📋 批次 ${decisions.batchId} · 核对人 ${reviewer} · ${result.plans.length} 条${dryRun ? ' · dry-run' : ''}`)
  for (const plan of result.plans) {
    const corr = plan.corrections.length ? ` / 修正 ${plan.corrections.map((c) => c.field).join(',')}` : ''
    console.log(`  ${plan.drugId.padEnd(56)} ${plan.action}${plan.note ? `（${plan.note}）` : ''}${corr}`)
  }
  console.log(`\n通过 ${result.counts.promote} / 退回 ${result.counts.reject} / 跳过 ${result.counts.skip}`)
  if (dryRun) {
    console.log('🔍 dry-run 结束，未落库')
    return 0
  }
  console.log(`✅ 已落库：升 reviewed ${result.counts.promote} / 退回 ${result.counts.reject} / 跳过 ${result.counts.skip}`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 应用失败（事务已回滚）:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
