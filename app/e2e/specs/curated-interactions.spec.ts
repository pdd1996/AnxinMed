/**
 * M11-T1 · 已入库 curated 规则的真实 UI 验证（模拟患者 p-001）。
 *
 * 直接向测试库插入 5 条 curated 规则 + 10 支在服药品/计划，打开 /consult 问
 * 「这些药一起吃有冲突吗」→ 后端意图路由 interaction-check → 数据直答。
 *
 * 断言：数据查询卡出现 5 项提示、禁忌/慎用/需监测三级可见、具体药名可见、0 次 LLM。
 * 只读规则来自 seed-interaction-rules.json（与生产 seed 同一份）。
 */
import { test, expect, type Browser } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { TEST_URL } from '../lib/test-db.js'
import { API_BASE } from '../lib/ports.js'

const SCENARIO = 'curated-interactions'
const RULE_IDS = ['m10-cand-02', 'm10-cand-04', 'm10-cand-07', 'm10-cand-14', 'm10-cand-20']

interface SeedRule {
  id: string
  drugIds: string[]
  drugGroups: string[][]
  level: string
  note: string
  source: string
}

const PRODUCTS: Array<{ masterId: string; name: string; form: string }> = [
  { masterId: 'drug-kelameisu-huanshi-pian-0p5g', name: '克拉霉素缓释片', form: '缓释片' },
  { masterId: 'drug-qiushuixianjian-pian-1mg', name: '秋水仙碱片', form: '片' },
  { masterId: 'drug-yansuan-paluoxiting-pian-20mg-h20133084', name: '盐酸帕罗西汀片', form: '片' },
  { masterId: 'drug-linaizuoan-putaotang-zhusheye-300ml', name: '利奈唑胺葡萄糖注射液', form: '注射液' },
  { masterId: 'drug-amlodipine-5', name: '苯磺酸氨氯地平片', form: '片' },
  { masterId: 'drug-takemosi-jiaonang-1mg', name: '他克莫司胶囊', form: '胶囊' },
  { masterId: 'drug-buluofen-pian-0p1', name: '布洛芬片', form: '片' },
  { masterId: 'drug-zhusheyong-jia-an-dieling-0p1g', name: '注射用甲氨蝶呤', form: '注射用' },
  { masterId: 'drug-yansuan-fuxiting-jiaonang-20mg', name: '盐酸氟西汀胶囊', form: '胶囊' },
  { masterId: 'drug-huafalinna-pian-2p5mg', name: '华法林钠片', form: '片' },
]

let sql: postgres.Sql

test.beforeAll(async () => {
  sql = postgres(TEST_URL, { max: 1 })
  // 清掉前序 spec 留给 p-001 的临时药（本 spec 自己造场景；golden-cases 在其后，afterAll 会再清）
  await sql`delete from plans where user_id = 'p-001'`
  await sql`delete from drugs where user_id = 'p-001'`
  await sql`delete from interaction_rules where id = any(${RULE_IDS})`

  const seedPath = fileURLToPath(new URL('../../packages/api/src/db/seed-interaction-rules.json', import.meta.url))
  const all = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedRule[]
  const rules = all.filter((r) => RULE_IDS.includes(r.id))
  if (rules.length !== RULE_IDS.length) throw new Error('seed 中缺少 M10 规则')

  for (const r of rules) {
    await sql.unsafe(
      `insert into interaction_rules (id, drug_ids, drug_groups, level, note, source, status)
       values ($1, $2::jsonb, $3::jsonb, $4, $5, $6, 'curated')
       on conflict (id) do nothing`,
      [r.id, JSON.stringify(r.drugIds), JSON.stringify(r.drugGroups), r.level, r.note, r.source],
    )
  }

  for (const [i, p] of PRODUCTS.entries()) {
    await sql.unsafe(
      `insert into drug_master (id, generic_name, specification, form, curation_status)
       values ($1, $2, '—', $3, 'mock') on conflict (id) do nothing`,
      [p.masterId, p.name, p.form],
    )
    const drugId = `sim-ui-drug-${i + 1}`
    await sql.unsafe(
      `insert into drugs (id, user_id, generic_name, form, drug_master_id, confirm_status)
       values ($1, 'p-001', $2, $3, $4, 'transcribed') on conflict (id) do nothing`,
      [drugId, p.name, p.form, p.masterId],
    )
    await sql.unsafe(
      `insert into plans (id, user_id, drug_id, dose, frequency, times, cycle_type, start_date, status, source)
       values ($1, 'p-001', $2, '{"value":1,"unit":"片"}'::jsonb, 1, '["08:00"]'::jsonb, 'open', '2026-01-01', 'active', 'manual')
       on conflict (id) do nothing`,
      [`sim-ui-plan-${i + 1}`, drugId],
    )
  }
})

test.afterAll(async () => {
  if (sql) {
    await sql`delete from plans where user_id = 'p-001'`
    await sql`delete from drugs where user_id = 'p-001'`
    await sql`delete from interaction_rules where id = any(${RULE_IDS})`
    await sql.end()
  }
})

async function openConsult(browser: Browser) {
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'x-test-scenario': SCENARIO })
  await ctx.addInitScript(() => localStorage.setItem('anxin-onboarded', '1'))
  const page = await ctx.newPage()
  await page.goto('/consult')
  return page
}

test.describe('curated 规则真实咨询 UI（模拟患者 · 0 次 LLM）', () => {
  test('问「这些药一起吃有冲突吗」→ 数据查询卡展示 5 项提示（禁忌/慎用/需监测）+ 0 LLM', async ({ browser }) => {
    const page = await openConsult(browser)
    await page.locator('textarea').fill('这些药一起吃有冲突吗')
    await page.getByRole('button', { name: '发送' }).click()

    const card = page.getByTestId('consult-answer-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('当前在服药品组合检出 5 项相互作用提示。')).toBeVisible()

    // 三级提示 + 具体药名（note 很长，只断言前缀与药名，避免把整段说明书原文写死）
    await expect(card.getByText(/\[禁忌\].*克拉霉素缓释片 \+ 秋水仙碱片/).first()).toBeVisible()
    await expect(card.getByText(/\[禁忌\].*盐酸帕罗西汀片 \+ 利奈唑胺葡萄糖注射液/).first()).toBeVisible()
    await expect(card.getByText(/\[慎用\].*苯磺酸氨氯地平片 \+ 他克莫司胶囊/).first()).toBeVisible()
    await expect(card.getByText(/\[慎用\].*布洛芬片 \+ 注射用甲氨蝶呤/).first()).toBeVisible()
    await expect(card.getByText(/\[需监测\].*盐酸氟西汀胶囊 \+ 华法林钠片/).first()).toBeVisible()
    await expect(card.getByText('存在相互作用提示时请勿自行停药或换药，请携带用药清单咨询医生或药师。')).toBeVisible()

    // M11-T2：摘要只放级别/药名/来源；逐字原文在「展开原文」里
    await card.getByText('展开原文（5 条）').click()
    await expect(card.getByText('禁止同时使用克拉霉素和秋水仙碱。')).toBeVisible()

    // 结构：0 次 LLM（数据直答不调模型）
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=${SCENARIO}`)
    const body = (await res.json()) as { calls: { consultAnswer: number } }
    expect(body.calls.consultAnswer).toBe(0)

    mkdirSync('../../data/m11-reports', { recursive: true })
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: '../../data/m11-reports/curated-interactions-ui.png', fullPage: false })
    await page.context().close()
  })
})
