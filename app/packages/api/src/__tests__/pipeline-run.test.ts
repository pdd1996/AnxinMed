/**
 * M2-T6 · 管线 run.ts 编排测试（全 mock AI，内存 ctx，不碰 DB）。
 *
 * 覆盖完成标准：成功路径产出正确草稿；OCR 失败 / 裁剪失败 / 解析不全三条降级路径产出 needsManual 草稿；
 * 入口B payload 无任何用法用量（结构断言）；labelNotice；LAYER_MISMATCH(409) / UNSUPPORTED_OBJECT(422，OCR 未调用)；
 * detectLayers 不可用冒泡（intake 映射 503）；规格冲突不自动选边；L2 脱敏在管线内生效。
 */
import { describe, it, expect } from 'vitest'
import { AIUnavailableError } from '../lib/ai/types.js'
import { ApiError } from '../lib/http.js'
import { detectOnly, runDrug, runPrescription, type PipelineContext } from '../services/pipeline/index.js'
import { IMG, mkOcr, mockClients, newCalls } from './helpers/ai-mocks.js'

const HYCOSAN = {
  id: 'dm-hycosan',
  genericName: '玻璃酸钠滴眼液',
  brandName: '海露',
  specification: '0.1%（10mL:10mg）',
  form: '滴眼液',
  manufacturer: null,
  approvalNumber: null,
}
const LEVO = {
  id: 'dm-levo',
  genericName: '左氧氟沙星滴眼液',
  brandName: null,
  specification: '0.5%（5mL:24.4mg）',
  form: '滴眼液',
  manufacturer: null,
  approvalNumber: null,
}
const IDENTITY = {
  genericName: '玻璃酸钠滴眼液',
  brandName: '海露',
  specification: '0.1%（10mL：10mg）',
  form: '滴眼液',
  manufacturer: 'EUSAN GmbH',
  otcFlag: true,
}

function ctx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    candidates: [HYCOSAN, LEVO],
    rules: [],
    drugNameById: { 'dm-hycosan': '玻璃酸钠滴眼液', 'dm-levo': '左氧氟沙星滴眼液' },
    activeMasterIds: [],
    insertsByMasterId: {
      'dm-hycosan': {
        dosage: { adult: { dosePerUse: { value: 1, unit: '滴' }, maxFrequencyPerDay: { value: 10, unit: '次' } } },
        source: '海露说明书',
        version: 'v1',
      },
    },
    ...overrides,
  }
}

const HEADER = [
  '萧山区第二人民医院（演示合成处方笺）',
  '处方号：RX20260902001',
  '日期：2026-09-02  科室：眼科',
  '姓名：张三 联系电话13800001234',
  '临床诊断：干眼综合征',
]
const RX = [...HEADER, 'Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支', '用法：滴眼 每次1滴 每日4次 共7天', '处方完毕', '医师：（签名）']

describe('管线 run.ts · 入口A 成功路径', () => {
  it('合成处方笺 → 1 份草稿，字段全对（药名/规格/用量/频次/途径/疗程/结束日期推算/四类标注）', async () => {
    const clients = mockClients({ layers: ['处方层'], ocr: mkOcr(RX), identity: IDENTITY })
    const drafts = await runPrescription(IMG, clients, ctx())
    expect(drafts).toHaveLength(1)
    const d = drafts[0]
    expect(d.type).toBe('prescription')
    expect(d.degraded).toBeNull()
    expect(d.item?.drugName).toBe('玻璃酸钠滴眼液')
    expect(d.match?.status).toBe('unique')
    expect(d.drugDraft.drugMasterId).toBe('dm-hycosan')
    expect(d.drugDraft.confirmStatus).toBe('transcribed')
    expect(d.planDraft).toMatchObject({
      dose: { value: 1, unit: '滴' },
      frequency: 4,
      route: '滴眼',
      durationDays: 7,
      startDate: '2026-09-02',
      endDate: '2026-09-09',
      cycleType: 'closed',
      sigMissing: [],
    })
    expect(d.planDraft?.tags).toMatchObject({
      dose: 'transcribed',
      frequency: 'transcribed',
      duration: 'transcribed',
      times: 'assist',
      startDate: 'default',
      endDate: 'derived',
    })
    expect(d.dosageRange.status).toBe('pass') // 4 次/日 ≤ 10
    expect(d.needsManual).toEqual([]) // 全字段解析完整
  })

  it('一张处方笺含 2 个条目 → 拆 2 份草稿（PRD §7.2.1），各自匹配到不同库条目；整图身份不串味', async () => {
    const rx2 = [
      ...HEADER,
      'Rp',
      '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支',
      '用法：滴眼 每次1滴 每日4次 共7天',
      '左氧氟沙星滴眼液 0.5%（5mL：24.4mg） ×1支',
      '用法：滴眼 每次1滴 每日3次 共5天',
      '处方完毕',
    ]
    const clients = mockClients({ layers: ['处方层'], ocr: mkOcr(rx2), identity: IDENTITY })
    const drafts = await runPrescription(IMG, clients, ctx())
    expect(drafts).toHaveLength(2)
    expect(drafts[0].drugDraft.drugMasterId).toBe('dm-hycosan')
    expect(drafts[1].drugDraft.drugMasterId).toBe('dm-levo')
    expect(drafts[1].planDraft?.frequency).toBe(3)
    // 串味防护：整图 VLM 身份是海露的，条目2（左氧氟沙星）绝不继承其商品名/厂家
    expect(drafts[0].identity?.brandName).toBe('海露')
    expect(drafts[1].identity?.brandName).toBeUndefined()
    expect(drafts[1].identity?.manufacturer).toBeUndefined()
    expect(drafts[1].drugDraft.brandName).toBeNull() // 库候选 LEVO.brandName=null，非「海露」
    expect(drafts[1].identity?.form).toBe('滴眼液') // 从条目药名推剂型，非继承
  })

  it('L2 脱敏在管线内生效：诊断值内嵌手机号被 [已脱敏] + 审计计数，原文不落 payload', async () => {
    const rxDiagPhone = [
      ...HEADER.slice(0, 3),
      '临床诊断：干眼综合征 联系电话13800001234',
      'Rp',
      '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支',
      '用法：滴眼 每次1滴 每日4次 共7天',
      '处方完毕',
    ]
    const clients = mockClients({ layers: ['处方层'], ocr: mkOcr(rxDiagPhone), identity: IDENTITY })
    const [d] = await runPrescription(IMG, clients, ctx())
    expect(d.whitelist?.diagnosis).toContain('[已脱敏]')
    expect(d.whitelist?.diagnosis).not.toContain('13800001234')
    expect(d.sanitizeAudit?.['手机号']).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(d)).not.toContain('13800001234')
  })

  it('前记身份信息（姓名/电话）不进入 payload（L0 裁剪 + L1 闭合 schema）；诊断（白名单内）保留为健康建议', async () => {
    const clients = mockClients({ layers: ['处方层'], ocr: mkOcr(RX), identity: IDENTITY })
    const [d] = await runPrescription(IMG, clients, ctx())
    const blob = JSON.stringify(d)
    expect(blob).not.toContain('张三')
    expect(blob).not.toContain('13800001234')
    expect(d.whitelist?.diagnosis).toBe('干眼综合征')
    expect(d.healthSuggestions).toEqual([{ field: '诊断', value: '干眼综合征', source: '处方笺抄录' }])
  })
})

describe('管线 run.ts · 三条降级路径（产出 needsManual 草稿，不炸整体）', () => {
  it('OCR 不可用 → 降级草稿 degraded.code=OCR_FAILED，planDraft=null', async () => {
    const clients = mockClients({ layers: ['处方层'], runOcrError: new AIUnavailableError('ocr', 'down') })
    const drafts = await runPrescription(IMG, clients, ctx())
    expect(drafts).toHaveLength(1)
    expect(drafts[0].degraded?.code).toBe('OCR_FAILED')
    expect(drafts[0].needsManual.length).toBeGreaterThan(0)
    expect(drafts[0].planDraft).toBeNull()
  })

  it('无 Rp 锚点（涂黑/漏识）→ cropBody null → 降级草稿 PARSE_FAILED', async () => {
    const noRp = RX.filter((l) => l !== 'Rp')
    const clients = mockClients({ layers: ['处方层'], ocr: mkOcr(noRp), identity: IDENTITY })
    const drafts = await runPrescription(IMG, clients, ctx())
    expect(drafts[0].degraded?.code).toBe('PARSE_FAILED')
    expect(drafts[0].needsManual).toContain('items')
  })

  it('用法缺失 + 兜底返回幻觉值（正文不可寻）→ 回链拦截，usage 仍 needsManual（绝不预填）', async () => {
    const rxNoSig = [...HEADER, 'Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支', '处方完毕']
    const clients = mockClients({
      layers: ['处方层'],
      ocr: mkOcr(rxNoSig),
      identity: IDENTITY,
      fallback: { 'items[0].usage': '每次2滴 每日5次' }, // 正文无此串 → 回链拦截
    })
    const [d] = await runPrescription(IMG, clients, ctx())
    expect(d.degraded).toBeNull()
    expect(d.backlinkIntercepted).toBeGreaterThanOrEqual(1)
    expect(d.needsManual).toContain('usage')
    expect(d.planDraft?.dose).toBeNull() // 幻觉值未被采用
    expect(d.planDraft?.sigMissing).toEqual(['dose', 'frequency'])
  })

  it('用法缺失 + 兜底模型不可用 → fallbackStatus=unavailable，缺项保留人工补', async () => {
    const rxNoSig = [...HEADER, 'Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支', '处方完毕']
    const clients = mockClients({
      layers: ['处方层'],
      ocr: mkOcr(rxNoSig),
      identity: IDENTITY,
      fallbackError: new AIUnavailableError('baichuan', 'down'),
    })
    const [d] = await runPrescription(IMG, clients, ctx())
    expect(d.degraded).toBeNull()
    expect(d.fallbackStatus).toBe('unavailable')
    expect(d.needsManual).toContain('usage')
  })

  it('处方日期被涂黑（顶层缺项）→ needsManual 含 date，startDate 兜底今天且标 default（不静默）', async () => {
    const rxNoDate = HEADER.filter((l) => !l.startsWith('日期'))
    const clients = mockClients({
      layers: ['处方层'],
      ocr: mkOcr([...rxNoDate, 'Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支', '用法：滴眼 每次1滴 每日4次 共7天', '处方完毕']),
      identity: IDENTITY,
    })
    const [d] = await runPrescription(IMG, clients, ctx())
    expect(d.needsManual).toContain('date') // 顶层缺项对确认页可见
    expect(d.whitelist?.date).toBe('')
    expect(d.planDraft?.tags.startDate).toBe('default') // 兜底值明确标「默认」，非「抄录」
  })
})

describe('管线 run.ts · 入口B（药盒，永不抄录用法用量）', () => {
  it('药盒原装层 → 1 份建档草稿，payload 无任何 dose/frequency/usage（结构断言）', async () => {
    const clients = mockClients({ layers: ['药盒原装层'], identity: IDENTITY })
    const d = await runDrug(IMG, clients, ctx())
    expect(d.type).toBe('drug')
    expect(d.planDraft).toBeNull()
    expect(d.item).toBeUndefined()
    expect(d.whitelist).toBeUndefined()
    expect(d.labelNotice).toBeFalsy()
    expect(d.drugDraft.drugMasterId).toBe('dm-hycosan')
    expect(d.drugDraft.confirmStatus).toBe('ocr_matched')
    const blob = JSON.stringify(d)
    expect(blob).not.toContain('"dose"')
    expect(blob).not.toContain('"frequency"')
    expect(blob).not.toContain('usage')
  })

  it('检测到医院标签层 → labelNotice:true（标签用法不自动抄录），仍无计划草稿', async () => {
    const clients = mockClients({ layers: ['医院标签层', '药盒原装层'], identity: IDENTITY })
    const d = await runDrug(IMG, clients, ctx())
    expect(d.labelNotice).toBe(true)
    expect(d.planDraft).toBeNull()
    expect(JSON.stringify(d)).not.toContain('"frequency"')
  })

  it('身份识别不可用 → 降级：no_match + needsManual，不炸', async () => {
    const clients = mockClients({ layers: ['药盒原装层'], extractIdentityError: new AIUnavailableError('qwen', 'down') })
    const d = await runDrug(IMG, clients, ctx())
    expect(d.degraded?.code).toBe('AI_UNAVAILABLE')
    expect(d.match?.status).toBe('no_match')
    expect(d.drugDraft.confirmStatus).toBe('manual')
    expect(d.needsManual).toContain('genericName')
  })
})

describe('管线 run.ts · 入口校验分支（409 / 422 / 503）', () => {
  it('入口A 但检测不到处方层 → 409 LAYER_MISMATCH（detected + suggestion，不静默改道）', async () => {
    const clients = mockClients({ layers: ['药盒原装层'], identity: IDENTITY })
    const err = await runPrescription(IMG, clients, ctx()).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('LAYER_MISMATCH')
    expect(err.details).toMatchObject({ detected: ['药盒原装层'] })
    expect(String(err.details?.suggestion)).toContain('切换到「拍药品」')
  })

  it('入口B 但检测到处方层 → 409 LAYER_MISMATCH（反方向同样不静默改道）', async () => {
    const clients = mockClients({ layers: ['处方层'], identity: IDENTITY })
    const err = await runDrug(IMG, clients, ctx()).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('LAYER_MISMATCH')
    expect(String(err.details?.suggestion)).toContain('切换到「拍处方笺」')
  })

  it('散装药片（不支持）→ 422 UNSUPPORTED_OBJECT，且 OCR 未被调用（入口A/B 一致）', async () => {
    const calls = newCalls()
    const clients = mockClients({ layers: ['不支持'], calls })
    const errA = await runPrescription(IMG, clients, ctx()).catch((e) => e)
    expect(errA).toBeInstanceOf(ApiError)
    expect(errA.status).toBe(422)
    expect(errA.code).toBe('UNSUPPORTED_OBJECT')
    const errB = await runDrug(IMG, clients, ctx()).catch((e) => e)
    expect(errB.status).toBe(422)
    expect(calls.runOcr).toBe(0) // 不支持对象绝不进 OCR
  })

  it('detectLayers 不可用 → AIUnavailableError 冒泡（intake.service 映射 503）', async () => {
    const clients = mockClients({ detectLayersError: new AIUnavailableError('qwen', 'down') })
    await expect(runPrescription(IMG, clients, ctx())).rejects.toBeInstanceOf(AIUnavailableError)
    await expect(runDrug(IMG, clients, ctx())).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('detectOnly 信息性返回 layers + unsupported + 入口建议（不抛 409/422）', async () => {
    const r = await detectOnly(IMG, mockClients({ layers: ['药盒原装层'] }), 'A')
    expect(r.layers).toEqual(['药盒原装层'])
    expect(r.unsupported).toBe(false)
    expect(r.mismatch).toContain('切换到「拍药品」')
    const r2 = await detectOnly(IMG, mockClients({ layers: ['不支持'] }), 'A')
    expect(r2.unsupported).toBe(true)
    expect(r2.mismatch).toBeNull()
  })
})

describe('管线 run.ts · 冲突不自动选边', () => {
  it('规格冲突（库 0.2% vs 处方 0.1%）→ conflict + 冲突清单，drugMasterId=null（系统不选边）', async () => {
    const clients = mockClients({ layers: ['处方层'], ocr: mkOcr(RX), identity: IDENTITY })
    const [d] = await runPrescription(IMG, clients, ctx({ candidates: [{ ...HYCOSAN, specification: '0.2%（10mL:20mg）' }] }))
    expect(d.match?.status).toBe('conflict')
    expect(d.conflicts[0]).toMatchObject({ type: 'spec' })
    expect(d.drugDraft.drugMasterId).toBeNull()
    expect(d.planDraft?.dose).toEqual({ value: 1, unit: '滴' }) // 医嘱仍抄录（冲突只在身份，不影响用法）
  })
})
