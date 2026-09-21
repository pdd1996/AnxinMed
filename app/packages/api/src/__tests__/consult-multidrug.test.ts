/**
 * 多药注入 + 段落锚点 + 注入完整性测试（M4-T9 · specs/04-T9）。
 *
 * 完成标准对照：
 * - 两药场景集成测试（prompt 断言双药身份：主药段落 + 其余对象药身份快照）；
 * - citations 段落锚点（sectionKey）落响应；
 * - 注入完整性纯函数单测（含「引用未注入段落 → 拦截」负例）；
 * - 覆盖层引用显式锚定禁忌段（不继承主引用锚点）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs, drugMaster, drugs, healthProfiles, packageInserts, riskEvents } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients, ConsultPromptPayload } from '../lib/ai/types.js'
import { mockClients } from './helpers/ai-mocks.js'
import { validateCitationCoverage, type CitationEvidence } from '../services/consult/coverage.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

// ---------------------------------------------------------------------------
// validateCitationCoverage 纯函数（含负例）
// ---------------------------------------------------------------------------

describe('validateCitationCoverage · 注入完整性（纯函数）', () => {
  const evidence: CitationEvidence = {
    sections: [
      { drugName: '玻璃酸钠滴眼液', sectionKey: 'indication' },
      { drugName: '玻璃酸钠滴眼液', sectionKey: 'contraindication' },
    ],
  }

  it('锚点在证据集合内 → ok', () => {
    expect(
      validateCitationCoverage(
        [
          { drugName: '玻璃酸钠滴眼液', source: 's', version: 'v', unverified: false, sectionKey: 'indication' },
          { drugName: '玻璃酸钠滴眼液', source: 's', version: 'v', unverified: false, sectionKey: 'contraindication', sectionLabel: '禁忌' },
        ],
        evidence,
      ),
    ).toEqual({ ok: true })
  })

  it('无锚点引用（三件套整体）→ ok', () => {
    expect(
      validateCitationCoverage([{ drugName: '我的用药数据', source: '本地数据库', version: 'x', unverified: false }], {
        sections: [],
      }),
    ).toEqual({ ok: true })
  })

  it('负例 · 引用未注入段落 → ok:false + violation 指明越界锚点', () => {
    const verdict = validateCitationCoverage(
      [{ drugName: '玻璃酸钠滴眼液', source: 's', version: 'v', unverified: false, sectionKey: 'pharmacology' }],
      evidence,
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.violation).toContain('pharmacology')
    }
  })

  it('负例 · drugName 不匹配（别的药的段落）→ ok:false', () => {
    const verdict = validateCitationCoverage(
      [{ drugName: '另一个药', source: 's', version: 'v', unverified: false, sectionKey: 'indication' }],
      evidence,
    )
    expect(verdict.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 两药场景集成（prompt 断言双药身份 + 锚点落响应 + 覆盖层锚定禁忌段）
// ---------------------------------------------------------------------------

const USER = 'p-001'
const DM_A = 'dm-md-hycosan'
const PI_A = 'pi-md-hycosan'
const DRUG_A = 'drug-md-hycosan'
const DM_B = 'dm-md-asyou'
const PI_B = 'pi-md-asyou'
const DRUG_B = 'drug-md-asyou'

const MOCK_CONSULT = {
  summary: '玻璃酸钠滴眼液用于缓解干眼症状',
  keyPoints: ['保湿润滑'],
  risks: [],
  nextAction: '如症状持续请咨询医生',
  warning: '提示',
}

let captured: ConsultPromptPayload | null = null
let prevClients: AiClients | null = null

function captureClients(): AiClients {
  const base = mockClients({ consult: MOCK_CONSULT })
  return {
    ...base,
    async consultAnswer(p: ConsultPromptPayload) {
      captured = p
      return MOCK_CONSULT
    },
  }
}

async function cleanup() {
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db
    .delete(healthProfiles)
    .where(and(eq(healthProfiles.userId, USER), eq(healthProfiles.fieldKey, '过敏史')))
  await db.delete(drugs).where(inArray(drugs.id, [DRUG_A, DRUG_B]))
  await db.delete(packageInserts).where(inArray(packageInserts.id, [PI_A, PI_B]))
  await db.delete(drugMaster).where(inArray(drugMaster.id, [DM_A, DM_B]))
}

beforeAll(async () => {
  await cleanup()
  await db.insert(drugMaster).values([
    { id: DM_A, genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%（10mL:10mg）', form: '滴眼液' },
    { id: DM_B, genericName: '阿司匹林片', brandName: '拜阿司匹灵', specification: '100mg', form: '片剂' },
  ])
  await db.insert(packageInserts).values([
    {
      id: PI_A,
      drugId: DM_A,
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露',
      specification: '0.1%（10mL:10mg）',
      form: '滴眼液',
      indication: '用于缓解干眼症状',
      contraindications: ['对玻璃酸钠过敏者禁用'],
      adverseReactions: '偶见眼部刺激感',
      source: '演示',
      version: '2024-01',
    },
    {
      id: PI_B,
      drugId: DM_B,
      genericName: '阿司匹林片',
      brandName: '拜阿司匹灵',
      specification: '100mg',
      form: '片剂',
      indication: '用于解热镇痛',
      contraindications: ['对阿司匹林过敏者禁用'],
      adverseReactions: '偶见胃肠道不适',
      source: '演示',
      version: '2024-01',
    },
  ])
  await db.insert(drugs).values([
    {
      id: DRUG_A,
      userId: USER,
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露',
      specification: '0.1%',
      form: '滴眼液',
      drugMasterId: DM_A,
      confirmStatus: 'ocr_matched',
    },
    {
      id: DRUG_B,
      userId: USER,
      genericName: '阿司匹林片',
      brandName: '拜阿司匹灵',
      specification: '100mg',
      form: '片剂',
      drugMasterId: DM_B,
      confirmStatus: 'ocr_matched',
    },
  ])
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await cleanup()
})

beforeEach(async () => {
  captured = null
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db
    .delete(healthProfiles)
    .where(and(eq(healthProfiles.userId, USER), eq(healthProfiles.fieldKey, '过敏史')))
})

describe('两药场景集成（M4-T9）', () => {
  it('双药咨询 → prompt 主药段落 + 其余对象药身份快照；citations 主引用带段落锚点', async () => {
    prevClients = setAiClients(captureClients())

    const res = await req('POST', '/api/consult', {
      question: '这个药通常用于什么？',
      drugIds: [DRUG_A, DRUG_B],
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('answered')

    // prompt 断言双药身份：主药 = 段落来源；其余对象药 = 身份快照（genericName + brandName）
    const p = captured as unknown as ConsultPromptPayload | null
    expect(p).not.toBeNull()
    expect(p!.drug.genericName).toBe('玻璃酸钠滴眼液') // 第一支有 insert 的药为主药
    expect(p!.section.label).toBe('适应症段')
    expect(p!.otherDrugs).toHaveLength(1)
    expect(p!.otherDrugs![0]).toMatchObject({ genericName: '阿司匹林片', brandName: '拜阿司匹灵', specification: '100mg', form: '片剂' })

    // citations 主引用带段落锚点（sectionKey ∈ SECTION_ROUTES keys）
    expect(res.body.citations[0].sectionKey).toBe('indication')
    // 响应通过引用完整性校验（未被剥离——锚点在证据集合内）
    expect(res.body.citations).toHaveLength(1)
  })

  it('档案过敏命中 → 覆盖层引用显式锚定禁忌段（不继承主引用锚点），coverage 校验通过', async () => {
    await db.insert(healthProfiles).values({
      id: 'hp-md-allergy',
      userId: USER,
      fieldKey: '过敏史',
      value: '玻璃酸钠',
    })
    prevClients = setAiClients(captureClients())

    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG_A] })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('answered')
    // 主引用锚定适应症段；覆盖层引用锚定禁忌段（显式覆写，不继承 indication）
    expect(res.body.citations[0].sectionKey).toBe('indication')
    expect(res.body.citations[1]).toMatchObject({ sectionLabel: '禁忌', sectionKey: 'contraindication' })
    expect(res.body.sections.risks.join('')).toContain('过敏警示')
  })
})
