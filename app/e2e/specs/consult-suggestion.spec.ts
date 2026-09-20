/**
 * 确认式建议卡 E2E（M4-T6 · specs/04-T6 完成标准：两条路径 E2E 各一条 golden）。
 *
 * 场景：药箱为空时问「对乙酰氨基酚能一起吃吗」（master 有收录、箱里没有）→
 * 回答（no-source 固定文案）+ add_drug 建议卡 → 双路径各走一遍：
 *   拍照建档 → accept(ocr) → 跳既有 M2 录入线 /intake/drug（confirmStatus=ocr_matched 路径）；
 *   手动建档 → accept(manual) → 跳 /box?manual=1&prefillDrug=… → 既有手动建档弹窗预填药名。
 *
 * ⚠️ 无 fixture 包（同 consult-dataquery 双保险理由）：no-source 路径 0 次 LLM，
 *    若后端 bug 误调 LLM，FixtureAiClients 会因场景包缺失抛 AIUnavailableError → 本测试必失败。
 * ⚠️ 零写入红线：accept 只置 consult_suggestions.status；药箱不变（建档须继续走确认页）。
 */
import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { TEST_URL } from '../lib/test-db.js'
import { API_BASE } from '../lib/ports.js'

const SCENARIO = 'consult-suggestion'
const DM_ID = 'dm-e2e-suggest'
const QUESTION = '对乙酰氨基酚能一起吃吗'

let sql: postgres.Sql

test.beforeAll(async () => {
  sql = postgres(TEST_URL, { max: 1 })
  // 仅落 master（药箱不放该药 → 提问命中可弹卡；无说明书行 → 回答走 no-source 固定文案，0 LLM）
  await sql`
    insert into drug_master (id, generic_name, brand_name, specification, form, curation_status)
    values (${DM_ID}, '对乙酰氨基酚片', '泰诺林', '0.5g', '片剂', 'mock')
    on conflict (id) do nothing`
})

test.afterAll(async () => {
  await sql`delete from consult_suggestions where user_id='p-001'`
  await sql`delete from consult_logs where user_id='p-001'`
  await sql`delete from consult_sessions where user_id='p-001'`
  await sql`delete from drug_master where id = ${DM_ID}`
  await sql?.end()
})

/** 打开咨询页（预置引导已确认）。 */
async function openConsult(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'x-test-scenario': SCENARIO })
  await ctx.addInitScript(() => localStorage.setItem('anxin-onboarded', '1'))
  const page = await ctx.newPage()
  await page.goto('/consult')
  return { ctx, page }
}

test.describe('确认式建议卡 E2E（M4-T6 · 双路径 golden）', () => {
  test('拍照建档路径：卡片透明告知 L0 差异 → accept(ocr) → 跳录入线 + 状态留痕', async ({ browser }) => {
    const { ctx, page } = await openConsult(browser)

    await page.locator('textarea').fill(QUESTION)
    await page.getByRole('button', { name: '发送' }).click()

    // 卡片：加药询问 + L0 门禁差异透明告知（裁决 #4/#7）
    const card = page.getByTestId('consult-suggestion-card')
    await expect(card).toBeVisible()
    await expect(card.getByText(/要把「对乙酰氨基酚片」加入药箱吗/)).toBeVisible()
    await expect(card.getByText(/拍照建档保留完整/)).toBeVisible()
    await expect(card.getByText(/仅可查药品说明书资料（L0）/)).toBeVisible()

    // 零调用红线：no-source 回答路径 0 次 LLM（卡片为确定性规则生成）
    const callsRes = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=${SCENARIO}`)
    const calls = (await callsRes.json()) as { calls: { consultAnswer: number; medicalSearch: number } }
    expect(calls.calls.consultAnswer).toBe(0)
    expect(calls.calls.medicalSearch).toBe(0)

    // accept(ocr) → 跳既有 M2 录入线
    await card.getByRole('button', { name: /拍照建档/ }).click()
    await page.waitForURL('**/intake/drug')

    const [row] = await sql`
      select status, payload from consult_suggestions where user_id='p-001' order by created_at desc limit 1`
    expect(row.status).toBe('accepted')
    expect(JSON.stringify(row.payload)).toContain('对乙酰氨基酚片')

    // 药箱零写入（accept 不建档，须继续走录入线确认页）
    const boxRes = await fetch(`${API_BASE}/api/drugs`)
    const box = (await boxRes.json()) as { items: Array<{ genericName: string }> }
    expect(box.items.some((d) => d.genericName.includes('对乙酰氨基酚'))).toBe(false)

    await ctx.close()
  })

  test('手动建档路径：accept(manual) → 跳药箱手动建档弹窗且药名预填 + 状态留痕', async ({ browser }) => {
    const { ctx, page } = await openConsult(browser)

    // 新一轮提问（新会话，上一测试未 dismiss → 卡片可再弹）
    await page.locator('textarea').fill(QUESTION)
    await page.getByRole('button', { name: '发送' }).click()
    const card = page.getByTestId('consult-suggestion-card')
    await expect(card).toBeVisible()

    // accept(manual) → 跳药箱并打开手动建档弹窗（药名预填，其余字段待用户填写确认）
    await card.getByRole('button', { name: /手动建档/ }).click()
    await page.waitForURL(/\/box\?manual=1&prefillDrug=/)
    const nameInput = page.getByLabel('药名')
    await expect(nameInput).toHaveValue('对乙酰氨基酚片')

    const [row] = await sql`
      select status from consult_suggestions where user_id='p-001' order by created_at desc limit 1`
    expect(row.status).toBe('accepted')

    await ctx.close()
  })
})
