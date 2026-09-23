/**
 * 咨询 fixture live 重录脚本（P0-T3 · docs/11 §1.3 重录纪律）——换咨询文本模型（百川 → qwen3.8-flash 非思考）后，
 * 用真实模型输出重录受影响的咨询 fixture 包，E2E 回放内容与现网模型行为保持一致。
 *
 * 重录范围（docs/13 §5.2 #6）：
 *   - consult-answered / consult-allergy / consult-session：live 重录（本脚本）；
 *   - consult-limited：**保持 synthetic**——该包是「输出含剂量残留」的对抗性录制，prompt 硬性禁剂量后
 *     真实模型不会产出该形态，live 重录在构造上不可能；strip 规则未变，人工复核无漂移即可。
 *
 * 前提：QWEN_API_KEY 可用（客户端走 qwen3.8-flash 非思考，与生产 CONSULT_PROVIDER=qwen 同契约）。
 * payload 构造复用生产 pickInsertSections + 与 runConsult 同构的上下文（说明书段落/相互作用文本/conditions），
 * E2E 测试库（anxin_medication_test）缺失时自动建库 + 迁移 + 补种 dm-t9-hycosan / pi-e2e-allergy 等行。
 *
 * 运行：cd app/packages/api && npm run eval:record-consult-fixtures
 */
import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { consultAnswer as qwenConsultAnswer } from '../lib/ai/qwen-text.js'
import { pickInsertSections } from '../services/consult/sections.js'
import type { ConsultPromptPayload } from '../lib/ai/types.js'
import type { InsertSlice } from '../services/consult/types.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES_DIR = fileURLToPath(new URL('../../../../e2e/fixtures', import.meta.url))
const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** 与 e2e/lib/test-db.ts 同源：读 DATABASE_URL 仅换库名（不硬编码凭据）。 */
const devUrl = process.env.DATABASE_URL
if (!devUrl) throw new Error('DATABASE_URL 未设置（app/packages/api/.env 缺失）')
const [base, qs] = devUrl.split('?')
const i = base.lastIndexOf('/')
const TEST_URL = base.slice(0, i + 1) + 'anxin_medication_test' + (qs ? `?${qs}` : '')
const ADMIN_URL = base.slice(0, i + 1) + 'postgres'

async function ensureDb(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1 })
  try {
    const exists = await admin`select 1 from pg_database where datname = 'anxin_medication_test'`
    if (exists.length === 0) {
      await admin.unsafe(`create database anxin_medication_test`)
      console.log('[record] 创建测试库 anxin_medication_test')
    }
  } finally {
    await admin.end()
  }
  const client = postgres(TEST_URL, { max: 1 })
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  // 与 e2e/global-setup.ts、consult-llm.spec.ts beforeAll 同款种子（幂等）
  await client.unsafe(
    `insert into drug_master (id, generic_name, specification, form, curation_status)
     values ('dm-t9-hycosan', '玻璃酸钠滴眼液', '0.1%（10mL:10mg）', '滴眼液', 'mock')
     on conflict (id) do nothing`,
  )
  await client.unsafe(
    `insert into package_inserts (id, drug_id, generic_name, dosage, source, version)
     values ('pi-e2e-hycosan', 'dm-t9-hycosan', '玻璃酸钠滴眼液',
       '{"adult":{"dosePerUse":{"value":1,"unit":"滴"},"maxFrequencyPerDay":{"value":10,"unit":"次"}}}'::jsonb,
       '海露说明书', 'v1')
     on conflict (id) do nothing`,
  )
  await client.unsafe(
    `insert into drug_master (id, generic_name, specification, form, curation_status)
     values ('dm-e2e-allergy', '磺胺嘧啶片', '0.5g', '片剂', 'mock')
     on conflict (id) do nothing`,
  )
  await client.unsafe(
    `insert into package_inserts (id, drug_id, generic_name, specification, form, indication, contraindications, source, version)
     values ('pi-e2e-allergy', 'dm-e2e-allergy', '磺胺嘧啶片', '0.5g', '片剂',
       '用于敏感菌引起的感染治疗',
       '["对磺胺类药物过敏者禁用","孕妇及哺乳期妇女禁用"]'::jsonb,
       '丁香园用药助手（演示抄录）', '2024-01')
     on conflict (id) do nothing`,
  )
  await client.end()
  console.log('[record] 测试库就绪（迁移 + 种子幂等）')
}

/** 读回说明书行并转 InsertSlice（与 consult.service toInsertSlice 同构；缺列 null）。 */
async function loadInsert(sqlClient: ReturnType<typeof postgres>, id: string): Promise<InsertSlice> {
  const rows = await sqlClient`
    select id, drug_id as "drugId", generic_name as "genericName", brand_name as "brandName",
           specification, form, indication, components, dosage, contraindications,
           adverse_reactions as "adverseReactions", precautions, interactions, pharmacology,
           pharmacokinetics, storage, source, version
    from package_inserts where id = ${id}`
  const r = rows[0]
  if (!r) throw new Error(`insert 行不存在：${id}`)
  return {
    drugId: String(r.drugId),
    genericName: String(r.genericName),
    brandName: (r.brandName as string) ?? null,
    specification: (r.specification as string) ?? null,
    form: (r.form as string) ?? null,
    indication: (r.indication as string) ?? null,
    components: (r.components as string) ?? null,
    dosage: r.dosage as unknown,
    contraindications: r.contraindications as unknown,
    adverseReactions: (r.adverseReactions as string) ?? null,
    precautions: r.precautions as unknown,
    interactions: (r.interactions as string) ?? null,
    pharmacology: (r.pharmacology as string) ?? null,
    pharmacokinetics: (r.pharmacokinetics as string) ?? null,
    storage: (r.storage as string) ?? null,
    source: String(r.source ?? ''),
    version: (r.version as string) ?? null,
  }
}

/** 与 run.ts renderInteractionsForPrompt 的「无命中」分支同文案（对照场景无规则库注入）。 */
const NO_INTERACTION_TEXT = '生效计划集合中未见已知相互作用（规则库覆盖有限，未覆盖不表示无风险）。'

interface ScenarioSpec {
  pack: string
  drug: ConsultPromptPayload['drug']
  question: string
}

async function main(): Promise<void> {
  await ensureDb()
  const sql = postgres(TEST_URL, { max: 1 })

  const hycosanInsert = await loadInsert(sql, 'pi-e2e-hycosan')
  const allergyInsert = await loadInsert(sql, 'pi-e2e-allergy')

  const scenarios: ScenarioSpec[] = [
    {
      pack: 'consult-answered',
      drug: { genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%', form: '滴眼液', isManual: false },
      question: '这个药通常用于什么？',
    },
    {
      pack: 'consult-allergy',
      drug: { genericName: '磺胺嘧啶片', brandName: null, specification: '0.5g', form: '片剂', isManual: false },
      question: '这个药通常用于什么？',
    },
    {
      pack: 'consult-session',
      drug: { genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%', form: '滴眼液', isManual: false },
      question: '这个药通常用于什么？',
    },
  ]

  for (const sc of scenarios) {
    const insert = sc.pack === 'consult-allergy' ? allergyInsert : hycosanInsert
    const section = pickInsertSections(sc.question, insert)
    const payload: ConsultPromptPayload = {
      question: sc.question,
      drug: sc.drug,
      section: { label: section.label, version: insert.version, text: section.text },
      interactionsText: NO_INTERACTION_TEXT,
    }
    const t0 = Date.now()
    const raw = await qwenConsultAnswer(payload)
    const ms = Date.now() - t0

    const packPath = `${FIXTURES_DIR}/${sc.pack}.json`
    if (!existsSync(packPath)) throw new Error(`包不存在：${packPath}`)
    const pack = JSON.parse(readFileSync(packPath, 'utf-8')) as Record<string, unknown>
    const oldSummary = (pack.consultAnswer as { summary?: string } | undefined)?.summary
    pack.consultAnswer = raw
    pack.source = 'live'
    writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n')
    console.log(`[record] ${sc.pack}: ${ms}ms（section=${section.key}）\n  旧 summary: ${oldSummary}\n  新 summary: ${raw.summary}`)
  }

  console.log(
    '[record] consult-limited 保持 synthetic（对抗性剂量残留录制，live 构造不可能；strip 规则未变，人工复核无漂移）',
  )
  await sql.end()
}

main().catch((e) => {
  console.error('[record] 失败：', e)
  process.exit(1)
})
