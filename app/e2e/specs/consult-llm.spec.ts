/**
 * 咨询 LLM 路径 E2E（M4-T2 · specs/04-T2）—— FixtureAiClients 回放演示（consult-answered / consult-limited）。
 *
 * 与 consult-dataquery.spec.ts（数据路径 0 LLM，无 fixture 包）互补：本文件验证**说明书 LLM 生成路径**
 * 的接线——对象药深链 → 快捷问题 → runConsult proceed → ai.consultAnswer 回放 → 归一化 → 回答卡渲染。
 * 三场景（app/e2e/fixtures/consult-*.json）：
 *   consult-answered / consult-allergy / consult-session —— P0-T3 起source=live（qwen3.8-flash 非思考
 *     真实输出，重录脚本 eval:record-consult-fixtures）；诚实产出「资料未覆盖即说明」文案；
 *   consult-limited —— 保持 synthetic：对抗性「输出含剂量残留」录制，live 构造不可能（prompt 禁剂量），
 *     strip 规则未变，人工复核无漂移。
 *
 * 断言四层（对齐 golden-cases.spec.ts 风格）：
 *   1. UI：回答卡渲染 fixture 的 summary 内容 + status 徽章（已回答 / 已过滤剂量）+ L2 时 notice；
 *   2. 结构（评估安全网）：`GET /api/_e2e/ai-calls?scenario=…` 的 consultAnswer === 1（恰一次模型调用）；
 *   3. DB：consult_logs 落行 status 与 citations（说明书三件套，非 DB/网络来源）。
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
import postgres from 'postgres'
import { TEST_URL } from '../lib/test-db.js'
import { API_BASE } from '../lib/ports.js'

/** 两支确定性药名的自建药（避开 seed/fixture 的真实药品名；与 consult-dataquery 同纪律）。 */
const DRUG_A = 'E2E测试药A'
const DRUG_B = 'E2E测试药B'
/** LLM 咨询对象：SQL 直建的 ocr_matched 药，挂 seed 的 dm-t9-hycosan（pi-e2e-hycosan 有说明书行）。 */
const DRUG_CONSULT = 'drug-e2e-consult'
/** 过敏覆盖层对象药（M4-T4）：独立 master/insert（禁忌含磺胺）+ 档案过敏史，验证覆盖层接线。 */
const DRUG_ALLERGY = 'drug-e2e-allergy'
const DM_ALLERGY = 'dm-e2e-allergy'
const PI_ALLERGY = 'pi-e2e-allergy'

let sql: postgres.Sql

/** 打开带 x-test-scenario 头的 /consult 页（深链带入对象药；预置引导已确认）。 */
async function openConsult(browser: Browser, scenario: string): Promise<Page> {
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'x-test-scenario': scenario })
  await ctx.addInitScript(() => localStorage.setItem('anxin-onboarded', '1'))
  const page = await ctx.newPage()
  await page.goto(`/consult?drugId=${DRUG_CONSULT}`)
  return page
}

test.beforeAll(async () => {
  sql = postgres(TEST_URL, { max: 1 })
  // 通过 API 建档 2 支对照药（保持与 consult-dataquery 相同的药箱状态预期，避免断言歧义）
  for (const genericName of [DRUG_A, DRUG_B]) {
    const res = await fetch(`${API_BASE}/api/drugs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ genericName }),
    })
    if (!res.ok) throw new Error(`[e2e] 建档失败 ${genericName}: HTTP ${res.status} ${await res.text()}`)
  }
  // LLM 咨询对象：直建 ocr_matched 药挂 dm-t9-hycosan（OCR 确认状态无法经手动 API 产生，SQL 直建为 E2E 惯例）
  await sql`
    insert into drugs (id, user_id, generic_name, brand_name, specification, form, drug_master_id, confirm_status)
    values (${DRUG_CONSULT}, 'p-001', '玻璃酸钠滴眼液', '海露', '0.1%', '滴眼液', 'dm-t9-hycosan', 'ocr_matched')
    on conflict (id) do nothing`
  // 过敏覆盖层资产（M4-T4）：master/insert（禁忌含磺胺）+ ocr_matched 药；过敏史档案行在用例内建/清
  await sql`
    insert into drug_master (id, generic_name, specification, form, curation_status)
    values (${DM_ALLERGY}, '磺胺嘧啶片', '0.5g', '片剂', 'mock')
    on conflict (id) do nothing`
  await sql`
    insert into package_inserts (id, drug_id, generic_name, specification, form, indication, contraindications, source, version)
    values (${PI_ALLERGY}, ${DM_ALLERGY}, '磺胺嘧啶片', '0.5g', '片剂',
      '用于敏感菌引起的感染治疗',
      '["对磺胺类药物过敏者禁用","孕妇及哺乳期妇女禁用"]'::jsonb,
      '丁香园用药助手（演示抄录）', '2024-01')
    on conflict (id) do nothing`
  await sql`
    insert into drugs (id, user_id, generic_name, specification, form, drug_master_id, confirm_status)
    values (${DRUG_ALLERGY}, 'p-001', '磺胺嘧啶片', '0.5g', '片剂', ${DM_ALLERGY}, 'ocr_matched')
    on conflict (id) do nothing`
})

test.afterAll(async () => {
  await sql`delete from drugs where id in (${DRUG_CONSULT}, ${DRUG_ALLERGY})`
  await sql`delete from package_inserts where id = ${PI_ALLERGY}`
  await sql`delete from drug_master where id = ${DM_ALLERGY}`
  await sql`delete from health_profiles where user_id = 'p-001' and field_key = '过敏史'`
  await sql?.end()
})

test.describe('咨询 LLM 路径 E2E（fixture 回放 · specs/04-T2）', () => {
  test('consult-answered：说明书问题 → answered + fixture 内容渲染 + 恰 1 次 LLM 调用', async ({ browser }) => {
    const page = await openConsult(browser, 'consult-answered')

    // 深链对象药 + 快捷问题（S1 说明书类 chip）
    await page.getByRole('button', { name: '这个药通常用于什么？' }).click()

    // UI：回答卡渲染 fixture 录制的 summary + 「已回答」徽章
    const card = page.getByTestId('consult-answer-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('已回答')).toBeVisible()
    await expect(card.getByText('当前本地资料库未收录该药品的适应症信息，无法直接回答其通常用途。')).toBeVisible()

    // 结构（评估安全网）：consult LLM 恰被调用 1 次
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=consult-answered`)
    const body = (await res.json()) as { calls: { consultAnswer: number } }
    expect(body.calls.consultAnswer).toBe(1)

    // DB：consult_logs 落行 status='answered'，citations 为说明书三件套（drugName=玻璃酸钠滴眼液）
    const [log] = await sql`
      select status, citations from consult_logs
      where user_id='p-001' and question like '%通常用于什么%'
      order by created_at desc limit 1`
    expect(log.status).toBe('answered')
    expect(JSON.stringify(log.citations)).toContain('玻璃酸钠滴眼液')

    await page.context().close()
  })

  test('consult-limited：输出含剂量残留 → limited（L2）+ 已过滤剂量提示 + 恰 1 次 LLM 调用', async ({
    browser,
  }) => {
    const page = await openConsult(browser, 'consult-limited')

    await page.getByRole('button', { name: '常见不良反应有哪些？' }).click()

    // UI：L2 徽章「已过滤剂量」+ notice 固定提示 + 剂量句被切除后的 nextAction 兜底文案
    const card = page.getByTestId('consult-answer-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('已过滤剂量')).toBeVisible()
    await expect(card.getByText('已过滤具体剂量建议。用量请按医生处方或说明书执行。')).toBeVisible()

    // 结构：consult LLM 恰被调用 1 次（过滤发生在输出侧，不减少也不增加模型调用）
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=consult-limited`)
    const body = (await res.json()) as { calls: { consultAnswer: number } }
    expect(body.calls.consultAnswer).toBe(1)

    // DB：status='limited' 落行（strip 触发率指标的原始数据源）
    const [log] = await sql`
      select status from consult_logs
      where user_id='p-001' and question like '%不良反应%'
      order by created_at desc limit 1`
    expect(log.status).toBe('limited')

    await page.context().close()
  })

  test('consult-allergy：档案过敏史 ∩ 禁忌段命中 → 回答附加过敏警示 + 禁忌段引用，LLM 调用数不变（specs/04-T4）', async ({
    browser,
  }) => {
    // 档案过敏史（M4-T4 白名单只读字段）：用例内建、afterAll 清
    await sql`
      insert into health_profiles (id, user_id, field_key, value)
      values ('hp-e2e-allergy', 'p-001', '过敏史', '对磺胺过敏')
      on conflict (id) do nothing`

    const page = await openConsult(browser, 'consult-allergy')
    await page.goto(`/consult?drugId=${DRUG_ALLERGY}`)
    await page.getByRole('button', { name: '这个药通常用于什么？' }).click()

    // UI：fixture 回答正常渲染 + risks 追加过敏警示条目（确定性固定文案，非 LLM 生成）
    const card = page.getByTestId('consult-answer-card')
    await expect(card).toBeVisible()
    await expect(card.getByText('已回答')).toBeVisible()
    await expect(card.getByText('该药主要用于治疗由敏感细菌引起的各类感染。')).toBeVisible()
    await expect(card.getByText(/过敏警示：你的档案过敏信息（磺胺）与该药禁忌相关/)).toBeVisible()

    // 结构：LLM 恰 1 次（回答本身）——覆盖层零新增模型调用（ai-calls 计数不变）
    const res = await fetch(`${API_BASE}/api/_e2e/ai-calls?scenario=consult-allergy`)
    const body = (await res.json()) as { calls: { consultAnswer: number } }
    expect(body.calls.consultAnswer).toBe(1)

    // DB：citations 含禁忌段引用（sectionLabel=禁忌），快照含警示
    const [log] = await sql`
      select citations, sections_snapshot from consult_logs
      where user_id='p-001' and question like '%通常用于什么%'
      order by created_at desc limit 1`
    expect(JSON.stringify(log.citations)).toContain('禁忌')
    expect(JSON.stringify(log.sections_snapshot)).toContain('过敏警示')

    await page.context().close()
  })
})
