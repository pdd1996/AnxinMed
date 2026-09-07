/**
 * M2-T9 · 零泄漏断言测试（CI 硬闸门 · PRD §12.2 L3 / 执行总纲 §3.2.4）。
 *
 * 对管线**全路径产物**运行 assertNoPii / findPii，golden case 样张含姓名/电话/病历号/地址时命中数必须 = 0：
 *   1. DB 落库内容：drafts.payload + confirm 四表（sources / drugs / plans / health_profiles）；
 *   2. 日志输出：捕获 console（hono logger + onError）全程断言零 PII；
 *   3. 第三方请求体：fetch mock 捕获真实 AI 客户端组装的请求（qwen/ocr/baichuan），剥离图像 base64 后断言零 PII
 *      —— 其中 Baichuan 兜底请求是唯一的处方文本出口，必须只含 L0 裁剪后的正文（前记 PII 已裁掉）。
 *
 * 样张真相源 = app/fixtures/golden-cases.json（与 make-fixtures.py / T10 共用）：
 * mock OCR 输入 = lines 去掉 redact 行（涂黑后 OCR 读不到），与 PNG 渲染同源，永不漂移。
 *
 * 断言有效性守卫（防闸门 no-op）：
 *   - 样张输入本身必须被 findPii 检出全部四类 PII（证明 fixture 是「脏」的，零泄漏断言才有意义）；
 *   - 若持久化产物混入 patientName 类身份字段，assertNoPii 必抛（证明闸门真能拦住回归）。
 *   （完成标准另要求：临时给白名单 schema 加 patientName 字段应使本测试失败，验证后移除——见交付说明。）
 *
 * 集成走 app.request() + 独立测试库；AI 经 registry 注入**真实客户端**（createAiClients），
 * fetch 全 mock 返回 canned 响应并捕获请求体——编排/脱敏/回链/事务走全真代码，只冻结模型 I/O。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { drugMaster, drafts, drugs, plans, sources, healthProfiles } from '../db/schema.js'
import { createAiClients } from '../lib/ai/index.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { IdentityFields } from '../lib/ai/types.js'
import { assertNoPii, findPii, PiiDetectedError } from '../services/sanitize/index.js'
import { mkOcr } from './helpers/ai-mocks.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── 样张真相源（app/fixtures/golden-cases.json，与渲染器/T10 共用）──
interface Scenario {
  image: string
  layers: string[]
  lines: string[]
  redact?: number[]
  fallback?: Record<string, string>
}
interface GoldenSpec {
  drug: { drugMaster: { id: string; genericName: string; specification: string; form: string }; identity: IdentityFields }
  pii: { name: string; phone: string; medicalRecordNo: string; address: string; doctor: string }
  scenarios: Record<string, Scenario>
}
const SPEC = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../fixtures/golden-cases.json', import.meta.url)), 'utf-8'),
) as GoldenSpec
const PII = SPEC.pii
const NORMAL = SPEC.scenarios['rx-normal']
const REDACTED = SPEC.scenarios['rx-redacted']

/** OCR 可见文本 = lines 去掉 redact 行（涂黑后 OCR 读不到）——与 PNG 渲染同源。 */
function ocrLines(sc: Scenario): string[] {
  const redact = new Set(sc.redact ?? [])
  return sc.lines.filter((_, i) => !redact.has(i))
}
/** 场景兜底响应（去掉 _note 说明键）。 */
function fallbackOf(sc: Scenario): Record<string, string> {
  return Object.fromEntries(Object.entries(sc.fallback ?? {}).filter(([k]) => k !== '_note'))
}

const USER = 'p-001'
const DM = SPEC.drug.drugMaster.id
const IMG_DATAURL = 'data:image/png;base64,QUJD' // 占位图：mock/真实客户端经 fetch mock 不解析像素

// ── HTTP / fetch mock / 日志捕获 ──
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}
function mkRes(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
function chatRes(content: unknown) {
  return mkRes({ choices: [{ message: { content: JSON.stringify(content) } }] })
}
/** 剥离图像 base64（识别输入，合法且永不落库）后剩下的「文本」才是第三方请求体的断言对象。 */
function stripImage(body: string): string {
  return body
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[IMAGE]')
    .replace(/"image"\s*:\s*"[A-Za-z0-9+/=]*"/gi, '"image":"[IMAGE]"')
}
interface Captured {
  url: string
  body: string
}
/** 安装 fetch mock：按 URL 路由 canned 响应（ocr=chat 多行转录/qwen 层检测/qwen 身份/baichuan 兜底），并记录全部请求体。 */
function installFetchMock(sc: Scenario): Captured[] {
  const captured: Captured[] = []
  const ocrContent = mkOcr(ocrLines(sc)).lines.join('\n')
  const fb = fallbackOf(sc)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url)
      const body = typeof init?.body === 'string' ? init.body : ''
      captured.push({ url: u, body })
      if (u.includes('ocr.test')) return mkRes({ choices: [{ message: { content: ocrContent } }] })
      if (u.includes('bc.test')) return chatRes(fb)
      if (u.includes('qwen.test')) {
        const parsed = JSON.parse(body || '{}')
        const first = parsed?.messages?.[0]?.content?.[0]
        const text = first?.type === 'text' ? String(first.text ?? '') : ''
        if (text.includes('层检测')) return chatRes(sc.layers)
        return chatRes(SPEC.drug.identity)
      }
      return mkRes({})
    }),
  )
  return captured
}
/** 捕获 console 全出口（hono logger + onError）；返回还原句柄。 */
function captureConsole(): { logs: string[] } {
  const logs: string[] = []
  const push = (...args: unknown[]) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  vi.spyOn(console, 'log').mockImplementation(push)
  vi.spyOn(console, 'error').mockImplementation(push)
  vi.spyOn(console, 'warn').mockImplementation(push)
  vi.spyOn(console, 'info').mockImplementation(push)
  return { logs }
}
/** 零泄漏断言：产物序列化后 findPii 命中数必须 = 0。 */
function expectClean(label: string, value: unknown) {
  const hits = findPii(JSON.stringify(value ?? null))
  expect(hits, `${label} 检出未脱敏 PII`).toHaveLength(0)
}
/**
 * 患者身份键守卫（键级）：assertNoPii 的值级模式难检「裸姓名值」（姓名无法无锚可靠识别），
 * 故对持久化产物额外断言【不得出现任何患者身份键】（patientName/phone/idCard/address/姓名/电话/病历号/住址…）。
 * 只匹配带引号的精确 JSON 键，排除 drug identity（"identity"/genericName 等药品身份合法）。
 * 完成标准「白名单 schema 加 patientName 字段应使测试失败」即由此键守卫命中。
 */
const PATIENT_IDENTITY_KEY_RE =
  /"(?:patientName|fullName|patient_name|patientId|phone|mobile|idCard|id_card|idNumber|address|姓名|患者姓名|电话|手机|住址|地址|病历号|门诊号|住院号|病案号)"\s*:/
function expectNoPatientKey(label: string, value: unknown) {
  expect(PATIENT_IDENTITY_KEY_RE.test(JSON.stringify(value ?? null)), `${label} 含患者身份键`).toBe(false)
}

const savedEnv = { ...process.env }

beforeAll(async () => {
  // 清理本测试用户残留 + 种 golden case 的 drug_master 候选（DM 规格半角冒号，identity 全角 → 归一化唯一匹配）
  await db.delete(drafts).where(eq(drafts.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(sources).where(eq(sources.userId, USER))
  await db.delete(healthProfiles).where(eq(healthProfiles.userId, USER))
  await db.insert(drugMaster).values({
    id: DM,
    genericName: SPEC.drug.drugMaster.genericName,
    specification: SPEC.drug.drugMaster.specification,
    form: SPEC.drug.drugMaster.form,
  })
})

afterAll(async () => {
  await db.delete(drafts).where(eq(drafts.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(sources).where(eq(sources.userId, USER))
  await db.delete(healthProfiles).where(eq(healthProfiles.userId, USER))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
})

afterEach(() => {
  process.env = { ...savedEnv }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setAiClients(createAiClients()) // 还原注入接缝，避免泄漏到其它用例
})

/** 让真实 AI 客户端走 fetch mock：设置假 env（key 不入库、不真调）。OCR 为 qwen3.5-ocr chat 端点，需 key。 */
function useRealClientsWithFetchMock() {
  process.env.QWEN_BASE_URL = 'http://qwen.test'
  process.env.QWEN_API_KEY = 'qk'
  process.env.BAICHUAN_BASE_URL = 'http://bc.test'
  process.env.BAICHUAN_API_KEY = 'bk'
  process.env.OCR_BASE_URL = 'http://ocr.test'
  process.env.OCR_API_KEY = 'ok'
  setAiClients(createAiClients())
}

describe('零泄漏 · 断言有效性守卫（防闸门 no-op）', () => {
  it('样张输入本身含全部四类 PII（findPii 全检出）——证明 fixture 是脏的、零泄漏断言有意义', () => {
    const inputText = NORMAL.lines.join('\n')
    const types = new Set(findPii(inputText).map((m) => m.type))
    expect(types.has('姓名')).toBe(true)
    expect(types.has('手机号')).toBe(true)
    expect(types.has('病历号')).toBe(true)
    expect(types.has('地址')).toBe(true)
  })

  it('patientName 类身份字段混入持久化产物必被拦（值级 assertNoPii + 键级守卫双重）', () => {
    // 值级：四类 PII 以可检出形态（手机号/病历号/地址/带标签姓名）混入 → assertNoPii 抛
    for (const v of [PII.phone, `病历号：${PII.medicalRecordNo}`, PII.address, `姓名：${PII.name}`]) {
      expect(() => assertNoPii(JSON.stringify({ drugDraft: { genericName: v } }))).toThrow(PiiDetectedError)
    }
    // 键级：patientName 键（裸姓名值，值级模式难检）→ 键守卫命中（完成标准 sabotage 即由此失败）
    const leaked = JSON.stringify({ entry: 'A', whitelist: { hospital: '某医院', patientName: PII.name } })
    expect(PATIENT_IDENTITY_KEY_RE.test(leaked)).toBe(true)
    // 干净白名单（无患者身份键）不误报
    expect(PATIENT_IDENTITY_KEY_RE.test(JSON.stringify({ hospital: '某医院', diagnosis: '干眼综合征' }))).toBe(false)
  })
})

describe('零泄漏 · rx-normal 全路径产物（DB 落库 + 日志）', () => {
  it('intake→confirm 后 drafts.payload 与四表（sources/drugs/plans/health_profiles）全零 PII，日志全零 PII', async () => {
    useRealClientsWithFetchMock()
    const captured = installFetchMock(NORMAL)
    const { logs } = captureConsole()

    // ① 录入：真管线跑 golden case（前记含姓名/电话/病历号/地址）→ 落 drafts
    const intake = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(intake.status).toBe(201)
    expect(intake.body.draftIds).toHaveLength(1)
    const draftId = intake.body.draftIds[0] as string

    // ② 确认：单事务写 sources+drugs+plans+health_profiles（唯一闸门）
    const got = await req('GET', `/api/drafts/${draftId}`)
    expect(got.status).toBe(200)
    const payload = got.body.draft.payload
    // 先验草稿 payload（含脱敏白名单/健康建议/标注）零 PII
    expectClean('drafts.payload', payload)
    expectNoPatientKey('drafts.payload', payload)
    // 诊断内嵌的复诊电话应已被 L2 脱敏为 [已脱敏]（证明 L2 在持久化前生效）
    expect(payload.whitelist.diagnosis).toContain('[已脱敏]')
    expect(payload.whitelist.diagnosis).not.toContain(PII.phone)

    const confirm = await req('POST', `/api/drafts/${draftId}/confirm`, {
      drug: {
        genericName: payload.drugDraft.genericName,
        brandName: payload.drugDraft.brandName,
        specification: payload.drugDraft.specification,
        form: payload.drugDraft.form,
        drugMasterId: payload.drugDraft.drugMasterId,
        confirmStatus: payload.drugDraft.confirmStatus,
      },
      plan: {
        dose: payload.planDraft.dose,
        frequency: payload.planDraft.frequency,
        times: payload.planDraft.times,
        route: payload.planDraft.route,
        cycleType: payload.planDraft.cycleType,
        startDate: payload.planDraft.startDate,
        endDate: payload.planDraft.endDate,
      },
      health: (payload.healthSuggestions ?? []).map((s: any) => ({ fieldKey: s.field, value: s.value })),
    })
    expect(confirm.status).toBe(200)
    expect(confirm.body.status).toBe('confirmed')
    const { drugId, planId, sourceId } = confirm.body

    // ③ DB 落库全量断言：drafts.payload + confirm 四表逐行零 PII
    const draftRows = await db.select().from(drafts).where(eq(drafts.id, draftId))
    expectClean('drafts.payload(落库)', draftRows[0].payload)
    const srcRows = await db.select().from(sources).where(eq(sources.id, sourceId))
    expectClean('sources.whitelistFields', srcRows[0].whitelistFields)
    expectNoPatientKey('sources.whitelistFields', srcRows[0].whitelistFields)
    expectClean('sources.confirmTrace', srcRows[0].confirmTrace)
    expectClean('sources.sanitizeAudit', srcRows[0].sanitizeAudit)
    expectClean('sources.prescriptionNo', srcRows[0].prescriptionNo)
    const drugRows = await db.select().from(drugs).where(eq(drugs.id, drugId))
    expectClean('drugs 行', drugRows[0])
    const planRows = await db.select().from(plans).where(eq(plans.id, planId))
    expectClean('plans 行', planRows[0])
    const healthRows = await db.select().from(healthProfiles).where(eq(healthProfiles.userId, USER))
    for (const h of healthRows) expectClean('health_profiles 行', h)

    // ④ 日志出口断言：hono logger + onError 全程零 PII
    expectClean('日志输出', logs.join('\n'))

    // ⑤ 第三方请求体断言（rx-normal 全字段完整 → 不触发兜底，仅 qwen/ocr 图像请求）：剥离 base64 后零 PII
    expect(captured.length).toBeGreaterThan(0)
    for (const c of captured) expectClean(`第三方请求体 ${c.url}`, stripImage(c.body))
  })
})

describe('零泄漏 · rx-redacted 第三方请求体 + 降级草稿', () => {
  it('发给 Baichuan 的请求体只含 L0 正文（前记 PII 已裁掉）零 PII；降级草稿零 PII；回链拦截不预填', async () => {
    useRealClientsWithFetchMock()
    const captured = installFetchMock(REDACTED)
    const { logs } = captureConsole()

    const intake = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(intake.status).toBe(201)
    const draftId = intake.body.draftIds[0] as string
    const got = await req('GET', `/api/drafts/${draftId}`)
    const payload = got.body.draft.payload

    // 降级草稿零 PII；用法/日期缺失走人工补（needsManual），绝不预填
    expectClean('rx-redacted drafts.payload', payload)
    expectNoPatientKey('rx-redacted drafts.payload', payload)
    expect(payload.needsManual).toContain('usage')
    expect(payload.needsManual).toContain('date')
    expect(payload.planDraft.dose).toBeNull() // 兜底幻觉值被回链拦截，未预填
    expect(payload.backlinkIntercepted).toBeGreaterThanOrEqual(1)

    // 第三方请求体：Baichuan 兜底被触发，其请求体（唯一处方文本出口）剥离 base64 后零 PII
    const bc = captured.filter((c) => c.url.includes('bc.test'))
    expect(bc.length).toBeGreaterThan(0) // 兜底确实被调用（缺项触发）
    for (const c of bc) {
      expectClean('Baichuan 兜底请求体', stripImage(c.body))
      // 且请求体只含裁剪正文的药品行，绝不含前记 PII 原文
      expect(c.body).not.toContain(PII.name)
      expect(c.body).not.toContain(PII.phone)
      expect(c.body).not.toContain(PII.medicalRecordNo)
      expect(c.body).not.toContain(PII.address)
    }
    // 全部第三方请求体（含 qwen/ocr）剥离 base64 后零 PII
    for (const c of captured) expectClean(`第三方请求体 ${c.url}`, stripImage(c.body))

    // 日志出口零 PII
    expectClean('日志输出(rx-redacted)', logs.join('\n'))
  })
})
