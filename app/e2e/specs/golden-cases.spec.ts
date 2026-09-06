/**
 * M2-T10 · golden case E2E（Playwright · fixture 回放）。
 *
 * 五个场景（PRD §16.1，场景名 = x-test-scenario 头）走**全真接线**：上传样张 → 层检测 → 编排 →
 * 草稿 → 确认页 → 单事务落库；模型 I/O 由 FixtureAiClients 回放 app/e2e/fixtures/<scenario>.json 冻结。
 *
 * 断言四层（不只看 UI）：
 *   1. UI：冲突清单可见 / needsManual 输入框恒空 / 标签提示 / 「不支持」文案 / 确认后跳转；
 *   2. DB：直连测试库验证确认事务落库（drugs/plans/sources/health_profiles + drafts.status=confirmed）；
 *   3. 结构（PRD 红线）：drug-box payload 无任何用法用量字段；rx-redacted 人工补字段值为空（防预填/标签抄录）；
 *   4. unsupported-loose-pills：fixture 客户端调用日志断言 OCR 未被调用。
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { TEST_URL } from '../lib/test-db.js'
import { API_BASE } from '../lib/ports.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SPEC = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/golden-cases.json', import.meta.url)), 'utf-8')) as {
  scenarios: Record<string, { image: string; entry: 'A' | 'B' }>
}
const png = (scenario: string) => fileURLToPath(new URL(`../../fixtures/${SPEC.scenarios[scenario].image}`, import.meta.url))
const entryPath = (scenario: string) => (SPEC.scenarios[scenario].entry === 'A' ? '/intake/rx' : '/intake/drug')

let sql: postgres.Sql
test.beforeAll(() => {
  sql = postgres(TEST_URL, { max: 1 })
})
test.afterAll(async () => {
  await sql?.end()
})

/** 打开带 x-test-scenario 头的上下文（FixtureAiClients 按请求回放对应场景）。 */
async function openScenario(browser: Browser, scenario: string): Promise<Page> {
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'x-test-scenario': scenario })
  // 预置首次引导已确认（OnboardingGate 读 localStorage），否则引导页遮挡录入页
  await ctx.addInitScript(() => localStorage.setItem('anxin-onboarded', '1'))
  return ctx.newPage()
}
/** 合成样张为纯白底打印体，会触发 T8 本地质量预检（反光/模糊告警）→ 点「仍要上传」走真实用户流程继续。 */
async function passQualityGate(page: Page) {
  const force = page.getByRole('button', { name: /仍要上传/ })
  // 质量卡是异步渲染（computeImageStats）：先短等待其出现，避免与 isVisible 即时判断竞态导致漏点
  await force.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  if (await force.isVisible().catch(() => false)) await force.click()
}
/** 上传样张并等待进入确认页（单草稿直达 /drafts/:id）。 */
async function uploadToDraft(page: Page, scenario: string) {
  await page.goto(entryPath(scenario))
  await page.setInputFiles('input[type="file"]', png(scenario))
  await passQualityGate(page)
  await page.waitForURL(/\/drafts\//, { timeout: 30_000 })
}
/** 唯一闸门逐项核对：勾满用量/频次/疗程「已核对」+ 确认使用人（处方草稿放行条件，PRD §7.2.5）。 */
async function passConfirmGates(page: Page) {
  for (const label of ['已核对每次用量', '已核对频次', '已核对疗程', '我已确认本药的使用人']) {
    await page.getByLabel(label).check()
  }
}
/** 读该用户最新一份草稿 payload（结构断言用）。 */
async function latestPayload(): Promise<any> {
  const [row] = await sql`select payload from drafts where user_id='p-001' order by created_at desc limit 1`
  return row.payload
}

test.describe('golden case E2E（fixture 回放）', () => {
  test('rx-normal：草稿字段全对 → 确认 → 药箱+计划生效（UI+DB）', async ({ browser }) => {
    const page = await openScenario(browser, 'rx-normal')
    await uploadToDraft(page, 'rx-normal')

    // UI：确认页展示唯一匹配身份与抄录医嘱，确认按钮为「生效计划」形态
    await expect(page.getByText('玻璃酸钠滴眼液').first()).toBeVisible()
    const confirmBtn = page.getByRole('button', { name: /确认建档并生效计划/ })
    await expect(confirmBtn).toBeVisible()
    // 唯一闸门：逐项勾「已核对」+ 确认使用人后才放行
    await passConfirmGates(page)
    // 健康建议勾选才写入（PRD §7.1.2）：勾上「诊断」以验证 health_profiles 落库
    await page.getByLabel('勾选写入诊断').check()
    await expect(confirmBtn).toBeEnabled()

    // 结构（确认前 payload）：字段全对（药名/规格/用量/频次/途径/疗程/结束日期推算/唯一匹配）
    const payload = await latestPayload()
    expect(payload.match.status).toBe('unique')
    expect(payload.drugDraft.drugMasterId).toBe('dm-t9-hycosan')
    expect(payload.drugDraft.confirmStatus).toBe('transcribed')
    expect(payload.planDraft).toMatchObject({
      dose: { value: 1, unit: '滴' },
      frequency: 4,
      route: '滴眼',
      durationDays: 7,
      cycleType: 'closed',
    })
    expect(payload.planDraft.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/) // 结束日期推算（derived）
    expect(payload.dosageRange.status).toBe('pass') // 4 次/日 ≤ 说明书 10

    // 确认 → 跳转药箱
    await confirmBtn.click()
    await page.waitForURL(/\/box/, { timeout: 30_000 })

    // DB：单事务落库四表 + 状态翻转
    const [draft] = await sql`select status from drafts where user_id='p-001' order by created_at desc limit 1`
    expect(draft.status).toBe('confirmed')
    const [src] = await sql`select * from sources where user_id='p-001' order by created_at desc limit 1`
    expect(src.type).toBe('prescription')
    const [drug] = await sql`select * from drugs where source_id=${src.id}`
    expect(drug.generic_name).toBe('玻璃酸钠滴眼液')
    expect(drug.confirm_status).toBe('transcribed')
    expect(drug.drug_master_id).toBe('dm-t9-hycosan')
    const [plan] = await sql`select * from plans where source_id=${src.id}`
    expect(plan.frequency).toBe(4)
    expect(plan.status).toBe('active')
    expect(plan.source).toBe('prescription')
    const health = await sql`select * from health_profiles where user_id='p-001' and field_key='诊断'`
    expect(health.length).toBeGreaterThanOrEqual(1)
    await page.context().close()
  })

  test('rx-spec-conflict：规格冲突 → 冲突清单可见且不自动选边（UI+结构）', async ({ browser }) => {
    const page = await openScenario(browser, 'rx-spec-conflict')
    await uploadToDraft(page, 'rx-spec-conflict')

    // UI：冲突清单 + 规格冲突徽章 + 「系统不选边」提示
    await expect(page.getByText(/冲突清单/).first()).toBeVisible()
    await expect(page.getByText('规格冲突').first()).toBeVisible()
    await expect(page.getByText(/系统不选边/)).toBeVisible()

    // 结构：conflict + drugMasterId=null（不自动裁决）
    const payload = await latestPayload()
    expect(payload.match.status).toBe('conflict')
    expect(payload.drugDraft.drugMasterId).toBeNull()
    expect(payload.conflicts[0].type).toBe('spec')
    await page.context().close()
  })

  test('rx-redacted：涂黑字段按缺失走人工补，无猜测预填（UI+结构）', async ({ browser }) => {
    const page = await openScenario(browser, 'rx-redacted')
    await uploadToDraft(page, 'rx-redacted')

    // UI：人工补清单可见 + 用量/频次输入框恒空（placeholder 人工补录）
    await expect(page.getByText(/未能从原文抽出/)).toBeVisible()
    await expect(page.getByText(/系统不预填猜测/).first()).toBeVisible()
    const manualInputs = page.getByPlaceholder('人工补录')
    expect(await manualInputs.count()).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < (await manualInputs.count()); i++) {
      await expect(manualInputs.nth(i)).toHaveValue('')
    }

    // 结构：needsManual 含 usage/date；planDraft.dose 空（兜底幻觉值被回链拦截，未预填）
    const payload = await latestPayload()
    expect(payload.needsManual).toContain('usage')
    expect(payload.needsManual).toContain('date')
    expect(payload.planDraft.dose).toBeNull()
    expect(payload.backlinkIntercepted).toBeGreaterThanOrEqual(1)
    await page.context().close()
  })

  test('drug-box-labeled：标签用法不自动抄录，payload 无任何用法用量（UI+结构）', async ({ browser }) => {
    const page = await openScenario(browser, 'drug-box-labeled')
    await uploadToDraft(page, 'drug-box-labeled')

    // UI：标签提示
    await expect(page.getByText(/检测到医院标签层：标签用法不会被自动抄录/)).toBeVisible()

    // 结构（PRD 红线）：payload 不存在任何 dose/frequency/usage 字段
    const payload = await latestPayload()
    expect(payload.type).toBe('drug')
    expect(payload.labelNotice).toBe(true)
    expect(payload.planDraft).toBeNull()
    const blob = JSON.stringify(payload)
    expect(blob).not.toContain('"dose"')
    expect(blob).not.toContain('"frequency"')
    expect(blob).not.toContain('usage')
    await page.context().close()
  })

  test('unsupported-loose-pills：明确「不支持」提示 + OCR 未被调用（UI+调用日志）', async ({ browser }) => {
    const page = await openScenario(browser, 'unsupported-loose-pills')
    await page.goto(entryPath('unsupported-loose-pills'))
    await page.setInputFiles('input[type="file"]', png('unsupported-loose-pills'))
    await passQualityGate(page)

    // UI：不支持卡 + 统一安全提示 + 可行动作
    await expect(page.getByText('该对象暂不支持')).toBeVisible()
    await expect(page.getByText(/请勿根据本次结果服药/)).toBeVisible()
    await expect(page.getByRole('button', { name: /手动建档/ }).first()).toBeVisible()

    // 调用日志：层检测已跑、OCR 绝未被调用（结构红线）
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=unsupported-loose-pills`)
    const body = (await res.json()) as { calls: { detectLayers: number; runOcr: number } }
    expect(body.calls.detectLayers).toBeGreaterThanOrEqual(1)
    expect(body.calls.runOcr).toBe(0)
    await page.context().close()
  })
})
