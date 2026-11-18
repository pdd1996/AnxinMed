/**
 * 对象澄清 E2E（M13-P1 · specs/18 T4）—— 无绑定药 + 指代词 → clarify 卡 → 点选药名带 drugId 重问。
 *
 * 断言四层（对齐 consult-dataquery.spec.ts 风格）：
 *   1. UI：回答卡出现「你想问药箱里的哪种药？」+ 药名选项按钮；
 *   2. 结构：clarify 路径 0 次 LLM（`GET /api/_e2e/ai-calls` consultAnswer === 0）；
 *   3. 交互：点选药名后第二次 POST /api/consult 的 drugIds = [所选药 id]（clarify 只是入口，不写业务表）；
 *   4. DB：consult_logs 落一行 status='clarify'。
 *
 * 自建一支 manual 药供澄清选项（走 POST /api/drugs，无 AI 调用）；afterAll 清理，避免影响其他 spec 的药箱断言。
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
import postgres from 'postgres'
import { TEST_URL } from '../lib/test-db.js'
import { API_BASE } from '../lib/ports.js'

const SCENARIO = 'consult-clarify'
const DRUG_NAME = 'E2E澄清测试药'

let sql: postgres.Sql
let drugId = ''

test.beforeAll(async () => {
  sql = postgres(TEST_URL, { max: 1 })
  const res = await fetch(`${API_BASE}/api/drugs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ genericName: DRUG_NAME }),
  })
  if (!res.ok) throw new Error(`[e2e] 建档失败: HTTP ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { drug: { id: string } }
  drugId = body.drug.id
})

test.afterAll(async () => {
  if (drugId) await fetch(`${API_BASE}/api/drugs/${drugId}`, { method: 'DELETE' })
  await sql?.end()
})

async function openConsult(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'x-test-scenario': SCENARIO })
  await ctx.addInitScript(() => localStorage.setItem('anxin-onboarded', '1'))
  const page = await ctx.newPage()
  await page.goto('/consult')
  return page
}

test.describe('对象澄清 E2E（M13-P1 · 0 次 LLM）', () => {
  test('无绑定药问「这个药有什么副作用」→ clarify + 药名选项；点选后带 drugId 重问（UI+结构+DB）', async ({
    browser,
  }) => {
    const page = await openConsult(browser)

    // 提问（无对象药：/consult 无 drugId 深链）
    await page.locator('textarea').fill('这个药有什么副作用')
    await page.getByRole('button', { name: '发送' }).click()

    // UI：澄清卡固定追问 + 药名选项按钮
    const card = page.getByTestId('consult-answer-card')
    await expect(card.getByText('你想问药箱里的哪种药？')).toBeVisible()
    const drugOption = page.getByRole('button', { name: DRUG_NAME })
    await expect(drugOption).toBeVisible()

    // 结构：clarify 路径 0 次 LLM
    const callsRes = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=${SCENARIO}`)
    const calls = (await callsRes.json()) as { calls: { consultAnswer: number } }
    expect(calls.calls.consultAnswer).toBe(0)

    // DB：clarify 留痕
    const [log] = await sql`
      select status from consult_logs
      where user_id='p-001' and question like '%这个药有什么副作用%'
      order by created_at desc limit 1`
    expect(log.status).toBe('clarify')

    // 交互：点选药名 → 第二次 POST /api/consult 带所选 drugId（clarify 只是入口）
    const secondReq = page.waitForRequest(
      (req) => req.url().includes('/api/consult') && req.method() === 'POST',
    )
    await drugOption.click()
    const req = await secondReq
    const payload = JSON.parse(req.postData() ?? '{}') as { drugIds?: string[] }
    expect(payload.drugIds).toEqual([drugId])

    // 重问后进入 S1 manual-gate 固定文案（同为 0 次 LLM）
    await expect(page.getByText(/为手动建档（未经 OCR 确认）且本地说明书库未收录/)).toBeVisible()

    await page.context().close()
  })
})
