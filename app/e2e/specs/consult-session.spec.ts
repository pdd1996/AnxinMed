/**
 * 会话内续问 E2E（M4-T5 · specs/04-T5 golden）—— 首问建会话 → 续问自动带 sessionId → 同会话两轮。
 *
 * 断言四层（对齐 golden-cases.spec.ts 风格）：
 *   1. UI：同一会话窗口累计两问两答（fixture 回放内容两次渲染）；
 *   2. 结构：consult-session 场景 fixture 恰回放 2 次（consultAnswer === 2，两轮各 1 次 LLM 调用）；
 *   3. DB：两行 consult_logs 同 session_id、turn_no=1/2，会话行 title=首问截断；
 *   4. 回放端点：GET /api/consult/sessions/:id 返回两轮消息（turnNo 升序）。
 *
 * 自建 ocr_matched 药挂 seed 的 dm-t9-hycosan（与 consult-llm.spec.ts 同惯例，资产互不复用，
 * afterAll 清理）。
 */
import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { TEST_URL } from '../lib/test-db.js'
import { API_BASE } from '../lib/ports.js'

const SCENARIO = 'consult-session'
const DRUG_ID = 'drug-e2e-session'

let sql: postgres.Sql

test.beforeAll(async () => {
  sql = postgres(TEST_URL, { max: 1 })
  await sql`
    insert into drugs (id, user_id, generic_name, brand_name, specification, form, drug_master_id, confirm_status)
    values (${DRUG_ID}, 'p-001', '玻璃酸钠滴眼液', '海露', '0.1%', '滴眼液', 'dm-t9-hycosan', 'ocr_matched')
    on conflict (id) do nothing`
})

test.afterAll(async () => {
  await sql`delete from drugs where id = ${DRUG_ID}`
  await sql?.end()
})

test.describe('会话内续问 golden（M4-T5 · fixture 回放）', () => {
  test('首问建会话 → 续问同会话 turn_no 递增 → 列表/回放端点可用（UI+结构+DB）', async ({ browser }) => {
    const ctx = await browser.newContext()
    await ctx.setExtraHTTPHeaders({ 'x-test-scenario': SCENARIO })
    await ctx.addInitScript(() => localStorage.setItem('anxin-onboarded', '1'))
    const page = await ctx.newPage()
    await page.goto(`/consult?drugId=${DRUG_ID}`)

    // 第一轮：快捷问题（首问，无 sessionId → 服务端建会话）
    await page.getByRole('button', { name: '这个药通常用于什么？' }).click()
    const firstAnswer = '当前本地资料库未收录该药品的适应症信息，无法直接回答其通常用途。'
    await expect(page.getByTestId('consult-answer-card').getByText(firstAnswer)).toBeVisible()

    // 第二轮：自由文本续问（前端自动带上首答回传的 sessionId）
    const textarea = page.locator('textarea')
    await textarea.fill('再问一句注意事项')
    await page.getByRole('button', { name: '发送' }).click()
    // 同一 fixture 内容第二次渲染（会话窗口累计两问两答）
    await expect(page.getByTestId('consult-answer-card').getByText(firstAnswer)).toHaveCount(2)
    await expect(page.getByText('再问一句注意事项')).toBeVisible()

    // 结构：fixture 恰回放 2 次（每轮 1 次 LLM 调用，无额外模型调用）
    const callsRes = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=${SCENARIO}`)
    const calls = (await callsRes.json()) as { calls: { consultAnswer: number } }
    expect(calls.calls.consultAnswer).toBe(2)

    // DB：同一会话两轮，turn_no 1→2；会话行 title = 首问截断。
    // 用本测试独有的续问文本锚定会话（其他 spec 也会问「这个药通常用于什么？」且不清理留痕，
    // 按问题文本全局查会串到别的 spec 的行）。
    const [mine] = await sql`
      select session_id from consult_logs
      where user_id='p-001' and question = '再问一句注意事项'
      order by created_at desc limit 1`
    expect(mine.session_id).toBeTruthy()
    const logs = await sql`
      select session_id, turn_no, question from consult_logs
      where session_id = ${mine.session_id}
      order by turn_no asc`
    expect(logs).toHaveLength(2)
    expect(logs[0].session_id).toBe(mine.session_id)
    expect(logs[0].question).toBe('这个药通常用于什么？')
    expect(logs[0].turn_no).toBe(1)
    expect(logs[1].turn_no).toBe(2)

    const [session] = await sql`
      select title from consult_sessions where id = ${logs[0].session_id}`
    expect(session.title).toBe('这个药通常用于什么？')

    // 回放端点：两轮消息按 turnNo 升序
    const detailRes = await fetch(`${API_BASE}/api/consult/sessions/${logs[0].session_id}`)
    const detail = (await detailRes.json()) as {
      ok: boolean
      session: { id: string; title: string }
      messages: Array<{ turnNo: number | null; question: string; status: string }>
    }
    expect(detail.ok).toBe(true)
    expect(detail.session.id).toBe(logs[0].session_id)
    expect(detail.messages).toHaveLength(2)
    expect(detail.messages[0].turnNo).toBe(1)
    expect(detail.messages[0].status).toBe('answered')
    expect(detail.messages[1].turnNo).toBe(2)

    await ctx.close()
  })
})
