/**
 * 意图路由 T6 · 数据查询咨询 E2E（consult-dataquery · 全真接线，0 次 LLM 调用）。
 *
 * 验证「AI 药师意图路由 + 只读查询工具」的接线（计划 T6 / 完成标准 1）：
 *   不选药 → 数据查询类问题 → 后端 classifyConsultIntent 命中 → runDataQuery 直查库 →
 *   status='data-answered' + toolUsed + DB 来源 citation，全程**不进** run.ts 说明书管线、不调 LLM。
 *
 * 断言四层（对齐 golden-cases.spec.ts 风格）：
 *   1. UI：回答卡出现「数据查询」status 徽章 + toolUsed 小字徽章 + 两支自建药名（medication-list）
 *          / 空数据友好文案（adherence）；
 *   2. 结构（PRD 红线）：`GET /api/_e2e/ai-calls?scenario=consult-dataquery` 的 consultAnswer === 0
 *          （medicalSearch 亦为 0）——数据查询路径绝不触发任何模型调用；
 *   3. DB：直连测试库验证 consult_logs 落一行 status='data-answered' 且 citations 含 DB 来源。
 *
 * ⚠️ 不建 fixture 包的理由（计划 T6 明示「无需则不建，写明理由」）：
 *   数据查询路径 0 次 LLM 调用，`app/e2e/fixtures/consult-dataquery.json` 无内容可回放。
 *   双保险天然成立——若后端 bug 误调 LLM，FixtureAiClients.consultAnswer 会 loadPack('consult-dataquery')，
 *   因场景包缺失直接抛 AIUnavailableError → 请求 500 → 回答卡不渲染 / ai-calls 计数 > 0，本测试必失败。
 *
 * ⚠️ 断言用自建药名而非精确总数：workers=1 串行，consult-dataquery.spec.ts 按字母序先于 golden-cases.spec.ts
 *   执行、且测试库为 globalSetup 全新建（seed 仅 p-001 + drug_master/说明书锚点，无 drugs 行），
 *   故此刻药箱恰为自建 2 支；但精确计数仍隐含执行顺序依赖，药名断言更稳（计划风险矩阵「自建药名断言不依赖顺序」）。
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
import postgres from 'postgres'
import { TEST_URL } from '../lib/test-db.js'
import { API_BASE } from '../lib/ports.js'

/** 场景名 = x-test-scenario 头（FixtureAiClients 按请求回放；此处无录制包，见文件头理由）。 */
const SCENARIO = 'consult-dataquery'
/** 两支确定性药名的自建药（避开 seed/fixture 的「玻璃酸钠滴眼液」及任何真实药品名）。 */
const DRUG_A = 'E2E测试药A'
const DRUG_B = 'E2E测试药B'

let sql: postgres.Sql
test.beforeAll(async () => {
  sql = postgres(TEST_URL, { max: 1 })
  // 通过真实 API 建档 2 支药（POST /api/drugs，confirmStatus='manual'）：走 resolveUser(p-001) + drugs.service，
  // 不经任何 AI（createManualDrug 无模型调用），故无需 x-test-scenario 头。
  for (const genericName of [DRUG_A, DRUG_B]) {
    const res = await fetch(`${API_BASE}/api/drugs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ genericName }),
    })
    if (!res.ok) throw new Error(`[e2e] 建档失败 ${genericName}: HTTP ${res.status} ${await res.text()}`)
  }
})
test.afterAll(async () => {
  await sql?.end()
})

/** 打开带 x-test-scenario 头的 /consult 页（预置引导已确认，避免 OnboardingGate 遮挡）。 */
async function openConsult(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'x-test-scenario': SCENARIO })
  await ctx.addInitScript(() => localStorage.setItem('anxin-onboarded', '1'))
  const page = await ctx.newPage()
  await page.goto('/consult')
  return page
}

test.describe('数据查询咨询 E2E（意图路由 · 0 次 LLM）', () => {
  test('medication-list：不选药问「我现在有多少药物」→ data-answered + 含自建药名 + 0 次 LLM（UI+结构+DB）', async ({
    browser,
  }) => {
    const page = await openConsult(browser)

    // 提问（textarea 唯一；发送按钮 aria-label='发送'）
    await page.locator('textarea').fill('我现在有多少药物')
    await page.getByRole('button', { name: '发送' }).click()

    // UI：回答卡（scoped 避开 DrugSelector 中同名药 chip）—— data-answered 徽章 + toolUsed 小字 + 两支自建药名
    const card = page.getByTestId('consult-answer-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('数据查询')).toBeVisible()
    await expect(card.getByText('来源：药箱清单')).toBeVisible()
    await expect(card.getByText(DRUG_A)).toBeVisible()
    await expect(card.getByText(DRUG_B)).toBeVisible()

    // 结构（PRD 红线）：数据查询路径 0 次 LLM 调用（consultAnswer / medicalSearch 均为 0）
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=${SCENARIO}`)
    const body = (await res.json()) as { calls: { consultAnswer: number; medicalSearch: number } }
    expect(body.calls.consultAnswer).toBe(0)
    expect(body.calls.medicalSearch).toBe(0)

    // DB：consult_logs 落一行 status='data-answered' + citations 含 DB 来源（drugName='我的用药数据'）
    const [log] = await sql`select status, citations from consult_logs where user_id='p-001' order by created_at desc limit 1`
    expect(log.status).toBe('data-answered')
    expect(JSON.stringify(log.citations)).toContain('我的用药数据')

    await page.context().close()
  })

  test('adherence：快捷问题「我的依从性怎么样？」→ data-answered 模板渲染（空数据友好文案）', async ({ browser }) => {
    const page = await openConsult(browser)

    // 点击数据查询类快捷问题（始终可点，无需选药）
    await page.getByRole('button', { name: '我的依从性怎么样？' }).click()

    // UI：data-answered 徽章 + adherence toolUsed 小字 + 空数据友好文案（新库无 records → total=0）
    const card = page.getByTestId('consult-answer-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('数据查询')).toBeVisible()
    await expect(card.getByText('来源：依从性统计')).toBeVisible()
    await expect(card.getByText(/还没有服药打卡记录/)).toBeVisible()

    // 结构：adherence 路径同样 0 次 LLM 调用
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=${SCENARIO}`)
    const body = (await res.json()) as { calls: { consultAnswer: number } }
    expect(body.calls.consultAnswer).toBe(0)

    await page.context().close()
  })

  test('M4-T6-fix 回归 · 问「哪些药物快过期了」而只有库存不足 → 先答「没有过期/临期」再附带库存（不答非所问）', async ({
    browser,
  }) => {
    // 自建一支无效期、库存 1 支的药（复现用户实测场景：过期桶空、库存桶有货）
    const createRes = await fetch(`${API_BASE}/api/drugs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ genericName: 'E2E库存不足药', stock: { value: 1, unit: '支' } }),
    })
    if (!createRes.ok) throw new Error(`[e2e] 建档失败: HTTP ${createRes.status}`)
    const created = (await createRes.json()) as { drug: { id: string } }

    const page = await openConsult(browser)
    await page.locator('textarea').fill('我哪些药物快过期了')
    await page.getByRole('button', { name: '发送' }).click()

    const card = page.getByTestId('consult-answer-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('数据查询')).toBeVisible()
    await expect(card.getByText('来源：效期与库存')).toBeVisible()
    // 先答所问（空桶明说），库存以「另外发现」附带——不得只报库存
    await expect(card.getByText(/你的药箱里没有过期或 30 天内到期的药品/)).toBeVisible()
    await expect(card.getByText(/另外发现库存不足：E2E库存不足药（库存剩余 1 支）/)).toBeVisible()

    // 清理自建药，不影响其他用例的药箱状态
    await fetch(`${API_BASE}/api/drugs/${created.drug.id}`, { method: 'DELETE' })

    await page.context().close()
  })

  test('next-dose（M4-T7）：chips 快路径问「今天我要吃哪些药」→ 今日待服安排（时点+已服状态，0 次 LLM）', async ({ browser }) => {
    // 自建药 + 当日生效计划（08:00/20:00）+ 已服 08:00 → 混合态
    const drugRes = await fetch(`${API_BASE}/api/drugs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ genericName: 'E2E今日药' }),
    })
    if (!drugRes.ok) throw new Error(`[e2e] 建药失败: HTTP ${drugRes.status} ${await drugRes.text()}`)
    const drug = (await drugRes.json()) as { drug: { id: string } }
    const today = new Date().toLocaleDateString('sv-SE') // 本地时区 YYYY-MM-DD
    const planRes = await fetch(`${API_BASE}/api/plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        drugId: drug.drug.id,
        dose: { value: 1, unit: '片' },
        frequency: 2,
        times: ['08:00', '20:00'],
        cycleType: 'open',
        startDate: today,
      }),
    })
    if (!planRes.ok) throw new Error(`[e2e] 建计划失败: HTTP ${planRes.status} ${await planRes.text()}`)
    const plan = (await planRes.json()) as { plan: { id: string } }
    await fetch(`${API_BASE}/api/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: plan.plan.id, date: today, time: '08:00', status: 'taken' }),
    })

    const page = await openConsult(browser)
    // chips 快路径：点击即带 skillId=s2-next-dose 直达（跳过正则）
    await page.getByRole('button', { name: '今天我要吃哪些药？' }).click()

    const card = page.getByTestId('consult-answer-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('数据查询')).toBeVisible()
    await expect(card.getByText('来源：今日待服')).toBeVisible()
    await expect(card.getByText(/今天共 2 次服药安排：已完成 1 次、待处理 1 次/)).toBeVisible()
    await expect(card.getByText(/08:00 E2E今日药 · 已服/)).toBeVisible()
    await expect(card.getByText(/20:00 E2E今日药 · 待服/)).toBeVisible()

    // 结构：数据路径 0 次 LLM（快路径同样红线）
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=${SCENARIO}`)
    const body = (await res.json()) as { calls: { consultAnswer: number } }
    expect(body.calls.consultAnswer).toBe(0)

    // DB：intent 落解析后的意图名
    const [log] = await sql`select intent from consult_logs where user_id='p-001' order by created_at desc limit 1`
    expect(log.intent).toBe('next-dose')

    await page.context().close()
  })
})
