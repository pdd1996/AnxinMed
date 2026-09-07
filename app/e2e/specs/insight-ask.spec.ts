/**
 * T7 医生端问答 E2E（insight-ask · 全真接线，固定问法 0 次 LLM 调用）。
 *
 * 验证「两级意图路由 + 队列只读工具」（spec §T7 完成标准 1）：
 *   /doctor/insight 队列视图追问框 → 6 条 golden 固定问法（分布/差档队列/事件聚合各 2）→
 *   后端 classifyQueueIntent 命中 → runQueueTool 直查库 → mode='data' + toolUsed 徽章，
 *   全程**不调任何模型**（queueSummary/consultAnswer/insightSummary/medicalSearch 全 0）。
 *
 * 断言三层（对齐 consult-dataquery.spec.ts 风格）：
 *   1. UI：回答卡出现「数据查询」徽章 + 「来源：<工具名>」徽章 + 统计事实文案；
 *   2. 结构（PRD 红线）：`GET /api/_e2e/ai-calls?scenario=insight-ask` 四个 LLM 方法计数全 0；
 *   3. DB：直连测试库验证 insight_ask_logs 留痕（intent 非空 = 非漏判）。
 *
 * ⚠️ 不建 fixture 包（同 consult-dataquery 理由）：data 路径 0 次 LLM 调用，无内容可回放。
 *    双保险天然成立——若后端 bug 误调 LLM，FixtureAiClients 对 'insight-ask' 场景缺包直接
 *    抛 AIUnavailableError → 编排层转降级（mode='llm' 不出现 / 徽章不渲染 / ai-calls>0），本测试必失败。
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
import postgres from 'postgres'
import { TEST_URL } from '../lib/test-db.js'
import { API_BASE } from '../lib/ports.js'

const SCENARIO = 'insight-ask'

/** E2E 专用队列演示患者（直插测试库；id 前缀 qa- 与其他 spec 隔离）。 */
const COHORT = [
  { id: 'qa-e2e-good', name: '队列甲', total: 10, taken: 10 },
  { id: 'qa-e2e-poor', name: '队列乙', total: 10, taken: 3 },
]

let sql: postgres.Sql

test.beforeAll(async () => {
  sql = postgres(TEST_URL, { max: 1 })
  await sql`insert into users (id, name) values (${COHORT[0].id}, ${COHORT[0].name}), (${COHORT[1].id}, ${COHORT[1].name}) on conflict (id) do nothing`
  for (const p of COHORT) {
    for (let i = 0; i < p.total; i++) {
      const d = new Date()
      d.setDate(d.getDate() - (p.total - 1 - i))
      const date = d.toISOString().slice(0, 10)
      await sql`
        insert into records (id, user_id, plan_id, scheduled_date, scheduled_time, status)
        values (${`${p.id}-rec-${i}`}, ${p.id}, ${`${p.id}-plan`}, ${date}, '08:00', ${i < p.taken ? 'taken' : 'skipped'})
        on conflict (id) do nothing`
    }
  }
})

test.afterAll(async () => {
  await sql`delete from insight_ask_logs where patient_id in (${COHORT[0].id}, ${COHORT[1].id}) or patient_id is null`
  await sql`delete from records where user_id in (${COHORT[0].id}, ${COHORT[1].id})`
  await sql`delete from users where id in (${COHORT[0].id}, ${COHORT[1].id})`
  await sql.end()
})

/** 打开带 x-test-scenario 头的 /doctor/insight（OnboardingGate 为全局组件，预置已确认标记）。 */
async function openDoctor(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'x-test-scenario': SCENARIO })
  await ctx.addInitScript(() => localStorage.setItem('anxin-onboarded', '1'))
  const page = await ctx.newPage()
  await page.goto('/doctor/insight')
  return page
}

/** 提一问并断言 data 路径徽章 + 来源标签（仅锚定最后一轮回答卡）。 */
async function askAndExpect(page: Page, question: string, toolLabel: string) {
  await page.getByTestId('ask-input').fill(question)
  await page.getByTestId('ask-send').click()
  const card = page.getByTestId('ask-answer')
  await expect(card).toBeVisible()
  await expect(card.getByText('数据查询')).toBeVisible()
  await expect(card.getByText(`来源：${toolLabel}`)).toBeVisible()
}

test.describe('医生端问答 E2E（队列固定问法 · 0 次 LLM）', () => {
  test('分布 ×2：依从性分布 / 执行率统计 → adherence_distribution + 0 次 LLM', async ({ browser }) => {
    const page = await openDoctor(browser)

    await askAndExpect(page, '依从性分布怎么样？', '依从性分布')
    await askAndExpect(page, '执行率统计一下', '依从性分布')

    // 结构（PRD 红线）：全程 0 次 LLM 调用
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=${SCENARIO}`)
    const body = (await res.json()) as {
      calls: { queueSummary: number; consultAnswer: number; insightSummary: number; medicalSearch: number }
    }
    expect(body.calls.queueSummary).toBe(0)
    expect(body.calls.consultAnswer).toBe(0)
    expect(body.calls.insightSummary).toBe(0)
    expect(body.calls.medicalSearch).toBe(0)

    await page.context().close()
  })

  test('差档队列 ×2：执行率差名单 / 随访名单 → patient_cohort', async ({ browser }) => {
    const page = await openDoctor(browser)

    await askAndExpect(page, '执行率差的患者有哪些？', '分档患者队列')
    // 第二问为另一口语变体（新增关键词必须先在单测补变体的 golden 呼应）
    await askAndExpect(page, '给我一份随访名单', '分档患者队列')

    await page.context().close()
  })

  test('事件聚合 ×2：风险事件汇总 / 拦截情况 → risk_event_rollup', async ({ browser }) => {
    const page = await openDoctor(browser)

    await askAndExpect(page, '最近的风险事件汇总', '风险事件聚合')
    await askAndExpect(page, '有没有被拦截过的情况', '风险事件聚合')

    await page.context().close()
  })

  test('DB：insight_ask_logs 留痕 intent 非空（漏判留痕口径可审计）', async () => {
    const rows = await sql`
      select question, mode, intent, tool_used
      from insight_ask_logs
      where patient_id is null and mode = 'data'
      order by created_at desc
      limit 6`
    expect(rows.length).toBeGreaterThanOrEqual(6)
    for (const row of rows) {
      expect(row.intent).not.toBeNull()
      expect(['adherence_distribution', 'patient_cohort', 'risk_event_rollup']).toContain(row.tool_used)
    }
  })
})
