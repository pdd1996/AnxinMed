/**
 * 咨询意图评测 · CLI（M13-T1 · docs/14 §4 T1；specs/16 T1）。
 *
 * 运行：cd app/packages/api && npm run eval:intent
 * 输出：通过/失败/待启用计数 + 混淆矩阵 + 失败清单；有失败时 exit 1（可直接进 CI）。
 *
 * fixture：app/fixtures/consult-intent-eval.json（与 consult-intent-eval.test.ts 同源）。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  IntentEvalFileSchema,
  evaluateIntentCases,
  summarizeIntentConfidence,
} from '../services/consult/intent-eval.js'

const FIXTURE_PATH = fileURLToPath(new URL('../../../../fixtures/consult-intent-eval.json', import.meta.url))

async function main() {
  const raw = JSON.parse(await readFile(FIXTURE_PATH, 'utf8')) as unknown
  const cases = IntentEvalFileSchema.parse(raw)
  const { summary } = evaluateIntentCases(cases)

  console.log(
    `[eval:intent] 用例 ${summary.total}：通过 ${summary.passed} / 失败 ${summary.failed} / 待启用 ${summary.pending}`,
  )
  console.log('[eval:intent] 混淆矩阵（期望 → 实际）：')
  for (const expected of Object.keys(summary.confusion).sort()) {
    const bucket = summary.confusion[expected]
    const parts = Object.keys(bucket)
      .sort()
      .map((actual) => `${actual}×${bucket[actual]}`)
    console.log(`  ${expected} → ${parts.join('，')}`)
  }

  // T6 低置信观测（只报告，不影响退出码）：候选打分覆盖自由文本路由用例（S1 / S2）
  const confidence = summarizeIntentConfidence(cases)
  const pct = (confidence.lowConfidenceRatio * 100).toFixed(1)
  console.log(
    `[eval:intent] 低置信观测：${confidence.lowConfidence}/${confidence.evaluated}（${pct}%）；` +
      `原因 veto:explain×${confidence.reasons['veto:explain']} / veto:advice×${confidence.reasons['veto:advice']} / ` +
      `top-low×${confidence.reasons['top-low']} / margin×${confidence.reasons.margin}`,
  )
  const routeParts = Object.keys(confidence.byExpectedRoute)
    .sort()
    .map((route) => {
      const b = confidence.byExpectedRoute[route]
      return `${route} ${b.lowConfidence}/${b.evaluated}`
    })
  console.log(`[eval:intent] 低置信按路由：${routeParts.join('；')}`)

  if (summary.failures.length > 0) {
    console.error('[eval:intent] 失败用例：')
    for (const f of summary.failures) {
      console.error(`  - ${f.id}「${f.question}」${f.failure ?? ''}`)
    }
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('[eval:intent] 运行失败：', e)
  process.exit(1)
})
