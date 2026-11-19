/**
 * M2-T7 · 确认页纯逻辑单测（lib/draft.ts）。
 *
 * 覆盖任务书完成标准的可单测部分：
 *   - needsManual / sigMissing 字段**无法被预填**（红线：绝不预填猜测）；
 *   - 冲突清单**不自动选择**（系统不选边），未选定不得确认；
 *   - 逐项核对闸门（用量/频次/疗程 + 使用人）；
 *   - 四类标注归算（抄录值被改 → user；时间点改建议 → user）；
 *   - 疗程三选一 → cycleType/endDate；
 *   - health 勾选项 ⊆ payload.healthSuggestions（服务端契约，清单外 400）；
 *   - 入口B 无计划（结构上不产出用法用量）；手动建档 / 候选选定两条身份路径。
 */
import { describe, it, expect } from 'vitest'
import { addDaysStr } from '@anxin/shared'
import {
  approvalMatchesCandidate,
  buildConfirm,
  finalTags,
  initialConfirmState,
  isManualMode,
  resolveCycle,
  selectableCandidates,
  sigNeedsManual,
  unmetReasons,
  type DraftPayload,
} from './draft'
import {
  degradedPayload,
  drugBoxPayload,
  rxConflictPayload,
  rxNeedsManualPayload,
  rxUniquePayload,
} from './draft-fixtures'

describe('初始态 · 绝不预填猜测', () => {
  it('usage 缺失（needsManual + sigMissing）→ 用量/频次/时间点全空，并给出原文该行提示所需的缺项标记', () => {
    const s = initialConfirmState(rxNeedsManualPayload)
    expect(s.doseValue).toBe('')
    expect(s.frequency).toBe('')
    expect(s.times).toEqual([])
    expect(sigNeedsManual(rxNeedsManualPayload, 'dose')).toBe(true)
    expect(sigNeedsManual(rxNeedsManualPayload, 'frequency')).toBe(true)
    expect(unmetReasons(rxNeedsManualPayload, s).join('')).toContain('请填写每次用量')
  })

  it('降级草稿（OCR 不可用）→ 手动建档三项全空，走 manual 模式', () => {
    const s = initialConfirmState(degradedPayload)
    expect(s.manual.genericName).toBe('')
    expect(s.manual.specification).toBe('')
    expect(s.manual.form).toBe('')
    expect(isManualMode(degradedPayload, s)).toBe(true)
    expect(unmetReasons(degradedPayload, s).join('')).toContain('手动建档需补全药名 / 规格 / 剂型')
  })

  it('抄录成功路径 → 照抄处方值供核对（用量 1 滴 / 每日 4 次 / 4 个时间点 / 开始日期=处方日期）', () => {
    const s = initialConfirmState(rxUniquePayload)
    expect(s.doseValue).toBe('1')
    expect(s.doseUnit).toBe('滴')
    expect(s.frequency).toBe('4')
    expect(s.times).toEqual(['08:00', '12:00', '16:00', '20:00'])
    expect(s.startDate).toBe('2026-09-02')
    expect(s.route).toBe('滴眼')
  })

  it('健康建议默认**不勾选**（勾选才写入），值预置为建议值供核对', () => {
    const s = initialConfirmState(rxUniquePayload)
    expect(s.healthChecked).toEqual({})
    expect(s.healthValue['诊断']).toBe('干眼综合征')
    expect(buildConfirm(rxUniquePayload, s).health).toEqual([])
  })

  it('「这是给谁用的药」默认未确认（处方草稿的闸门之一）', () => {
    const s = initialConfirmState(rxUniquePayload)
    expect(s.whoConfirmed).toBe(false)
    expect(unmetReasons(rxUniquePayload, s).join('')).toContain('请确认这盒药的使用人')
  })
})

describe('冲突清单 · 系统不选边', () => {
  it('规格冲突 → 候选全列出且初始不选中，未选定不得确认', () => {
    const s = initialConfirmState(rxConflictPayload)
    expect(selectableCandidates(rxConflictPayload)).toHaveLength(2)
    expect(s.selectedCandidateId).toBe('')
    expect(unmetReasons(rxConflictPayload, s).join('')).toContain('冲突清单未选定')
  })

  it('用户选定候选后放行，并按候选落库身份（规格/批准文号取候选值）', () => {
    const s = { ...initialConfirmState(rxConflictPayload), selectedCandidateId: 'dm-hycosan-02', whoConfirmed: true }
    expect(unmetReasons(rxConflictPayload, s).join('')).not.toContain('冲突清单未选定')
    const input = buildConfirm(rxConflictPayload, s)
    expect(input.drug.drugMasterId).toBe('dm-hycosan-02')
    expect(input.drug.specification).toBe('0.2%（10mL:20mg）')
    expect(input.drug.confirmStatus).toBe('transcribed')
  })

  it('改走手动建档 → drugMasterId=null、confirmStatus=manual，库存取表单值', () => {
    const s = {
      ...initialConfirmState(rxConflictPayload),
      useManual: true,
      whoConfirmed: true,
      manual: { genericName: '玻璃酸钠滴眼液', specification: '0.1%（10mL：10mg）', form: '滴眼液', stockValue: '2', stockUnit: '支' },
    }
    const input = buildConfirm(rxConflictPayload, s)
    expect(input.drug).toMatchObject({ drugMasterId: null, confirmStatus: 'manual', stock: { value: 2, unit: '支' } })
    // 三项缺一不放行
    const missing = { ...s, manual: { ...s.manual, form: '' } }
    expect(unmetReasons(rxConflictPayload, missing).join('')).toContain('手动建档需补全')
  })
})

describe('逐项核对闸门（无差别，不因置信度高跳过）', () => {
  it('抄录值齐全也须逐项勾「已核对」；勾满 + 确认使用人后放行', () => {
    const s0 = initialConfirmState(rxUniquePayload)
    expect(unmetReasons(rxUniquePayload, s0)).toHaveLength(4) // 用量/频次/疗程三项核对 + 使用人
    const s1 = {
      ...s0,
      whoConfirmed: true,
      checked: { dose: true, frequency: true, duration: true },
    }
    expect(unmetReasons(rxUniquePayload, s1)).toEqual([])
  })

  it('人工补录项（无抄录值）不要求「已核对」勾选，但必须填值', () => {
    const s = { ...initialConfirmState(rxNeedsManualPayload), whoConfirmed: true }
    const reasons = unmetReasons(rxNeedsManualPayload, s)
    expect(reasons.join('')).toContain('请填写频次')
    expect(reasons.join('')).not.toContain('已核对')
    const filled = { ...s, doseValue: '1', frequency: '4', times: ['08:00', '20:00'] }
    expect(unmetReasons(rxNeedsManualPayload, filled)).toEqual([])
  })
})

describe('疗程三选一 → cycleType / endDate', () => {
  const base = { ...initialConfirmState(rxNeedsManualPayload), doseValue: '1', frequency: '4', times: ['08:00'], whoConfirmed: true }

  it('处方抄录了疗程 → 沿用封闭式 + 推算结束日期（未被改写时不看三选一）', () => {
    const s = { ...initialConfirmState(rxUniquePayload), whoConfirmed: true, checked: { dose: true, frequency: true, duration: true } }
    expect(resolveCycle(rxUniquePayload, s)).toEqual({ cycleType: 'closed', endDate: '2026-09-09' })
    expect(buildConfirm(rxUniquePayload, s).plan).toMatchObject({ cycleType: 'closed', endDate: '2026-09-09' })
  })

  it('长期服用 → open 且无结束日期，duration 标「自填」', () => {
    expect(resolveCycle(rxNeedsManualPayload, { ...base, cycle: 'longterm' })).toEqual({ cycleType: 'open', endDate: null })
    expect(finalTags(rxNeedsManualPayload, { ...base, cycle: 'longterm' }).duration).toBe('user')
  })

  it('用完为止 → stock；自定义天数 → closed 且结束日期按开始日期推算', () => {
    expect(resolveCycle(rxNeedsManualPayload, { ...base, cycle: 'until-used' }).cycleType).toBe('stock')
    const custom = resolveCycle(rxNeedsManualPayload, { ...base, cycle: 'custom', customDays: '5', startDate: '2026-09-06' })
    expect(custom).toEqual({ cycleType: 'closed', endDate: addDaysStr('2026-09-06', 5) })
  })

  it('抄录疗程被用户改写（cycleOverride）→ 按三选一落库且 duration 降为「自填」', () => {
    const s = { ...initialConfirmState(rxUniquePayload), cycleOverride: true, cycle: 'longterm' as const }
    expect(resolveCycle(rxUniquePayload, s)).toEqual({ cycleType: 'open', endDate: null })
    expect(finalTags(rxUniquePayload, s).duration).toBe('user')
    expect(finalTags(rxUniquePayload, s).endDate).toBeUndefined()
  })

  it('自定义天数为空 → 不放行', () => {
    expect(unmetReasons(rxNeedsManualPayload, { ...base, cycle: 'custom', customDays: '' }).join('')).toContain(
      '请填写自定义疗程天数',
    )
  })
})

describe('四类标注归算（PRD §7.2.4）', () => {
  const ok = { whoConfirmed: true, checked: { dose: true, frequency: true, duration: true } }

  it('未改动 → 沿用草稿标注（抄录/辅助/默认/推算）', () => {
    expect(finalTags(rxUniquePayload, { ...initialConfirmState(rxUniquePayload), ...ok })).toEqual({
      dose: 'transcribed',
      frequency: 'transcribed',
      duration: 'transcribed',
      times: 'assist',
      startDate: 'default',
      endDate: 'derived',
    })
  })

  it('用户改过的医嘱字段 → 降为「自填」（用量/频次/时间点/开始日期）', () => {
    const s = { ...initialConfirmState(rxUniquePayload), ...ok, doseValue: '2', frequency: '3', times: ['09:00'], startDate: '2026-09-07' }
    const tags = finalTags(rxUniquePayload, s)
    expect(tags).toMatchObject({ dose: 'user', frequency: 'user', times: 'user', startDate: 'user' })
    expect(buildConfirm(rxUniquePayload, s).plan?.tags).toEqual(tags)
  })

  it('人工补录（无抄录值）→ 用量/频次标「自填」', () => {
    const tags = finalTags(rxNeedsManualPayload, { ...initialConfirmState(rxNeedsManualPayload), doseValue: '1', frequency: '4' })
    expect(tags).toMatchObject({ dose: 'user', frequency: 'user' })
  })
})

describe('health 勾选项 ⊆ 建议清单（服务端 400 契约）', () => {
  it('勾选后只提交清单内 fieldKey；改过值则提交改后值（服务端据此标 self_reported）', () => {
    const s = { ...initialConfirmState(rxUniquePayload), healthChecked: { 诊断: true } }
    expect(buildConfirm(rxUniquePayload, s).health).toEqual([{ fieldKey: '诊断', value: '干眼综合征' }])
    const edited = { ...s, healthValue: { 诊断: '干眼（自述）' } }
    expect(buildConfirm(rxUniquePayload, edited).health).toEqual([{ fieldKey: '诊断', value: '干眼（自述）' }])
    const suggested = rxUniquePayload.healthSuggestions.map((x) => x.field)
    for (const h of buildConfirm(rxUniquePayload, edited).health ?? []) expect(suggested).toContain(h.fieldKey)
  })

  it('勾选但值被清空 → 不提交该字段（不落空值）', () => {
    const s = { ...initialConfirmState(rxUniquePayload), healthChecked: { 诊断: true }, healthValue: { 诊断: '   ' } }
    expect(buildConfirm(rxUniquePayload, s).health).toEqual([])
  })

  it('入口B 无健康建议 → health 为空数组', () => {
    expect(buildConfirm(drugBoxPayload, initialConfirmState(drugBoxPayload)).health).toEqual([])
  })
})

describe('入口B（药盒建档）· 结构上无用法用量', () => {
  it('不产出 plan，身份取唯一匹配，且不要求「使用人」勾选（无处方前记语义）', () => {
    const s = initialConfirmState(drugBoxPayload)
    const input = buildConfirm(drugBoxPayload, s)
    expect(input.plan).toBeUndefined()
    expect(input.drug).toMatchObject({ drugMasterId: 'dm-hycosan', confirmStatus: 'ocr_matched' })
    expect(unmetReasons(drugBoxPayload, s)).toEqual([])
  })
})

describe('效期线（用户对照药盒录入，管线不产出、不预填）', () => {
  it('初始态恒为空串（有效期/开封日期都不预填猜测）', () => {
    for (const payload of [rxUniquePayload, drugBoxPayload, degradedPayload]) {
      const s = initialConfirmState(payload)
      expect(s.expiry).toBe('')
      expect(s.openedAt).toBe('')
    }
  })

  it('录入后进入 confirm 入参（唯一匹配路径与手动建档路径都带）', () => {
    const s = { ...initialConfirmState(rxUniquePayload), expiry: '2027-03-01', openedAt: '2026-11-01' }
    expect(buildConfirm(rxUniquePayload, s).drug).toMatchObject({
      expiry: '2027-03-01',
      openedAt: '2026-11-01',
    })
    const manual = {
      ...initialConfirmState(degradedPayload),
      manual: { genericName: '测试药', specification: '5mg', form: '片剂', stockValue: '1', stockUnit: '片' },
      expiry: '2020-01-01', // 已过期也允许录（用于过期提示）
      openedAt: '',
    }
    expect(buildConfirm(degradedPayload, manual).drug).toMatchObject({ expiry: '2020-01-01', openedAt: null })
  })

  it('留空 → null（不是空串，空串会被服务端 zod 日期校验拒绝）', () => {
    const s = initialConfirmState(rxUniquePayload)
    expect(buildConfirm(rxUniquePayload, s).drug).toMatchObject({ expiry: null, openedAt: null })
  })
})

describe('批准文号选填（2026-11-19：仅辅助候选定位，不做官方校验、不落库）', () => {
  /** 多规格合并库条目（现场真实脏数据形态）：80mg/240mg 合一行，两个批准文号。 */
  const MERGED_CANDIDATE = {
    id: 'dm-alishatan-merged',
    genericName: '阿利沙坦酯片',
    brandName: '信立坦',
    specification: '80mg，240mg',
    form: '片',
    manufacturer: '深圳信立泰药业股份有限公司',
    approvalNumber: '国药准字H20138001',
    approvalNumbers: ['国药准字H20138001', '国药准字H20138002'],
    multiSpec: true,
  }
  const MULTI_PAYLOAD = {
    ...rxConflictPayload,
    identity: { genericName: '阿利沙坦酯片', specification: '240mg×7片', form: '片' },
    match: { status: 'ambiguous', candidates: [MERGED_CANDIDATE], note: '多规格合并，请按实物规格选择' },
    conflicts: [
      {
        type: 'multi' as const,
        note: '多规格合并，请按实物规格选择',
        candidates: [MERGED_CANDIDATE],
      },
    ],
    drugDraft: { ...rxConflictPayload.drugDraft, drugMasterId: null },
  } satisfies DraftPayload

  it('初始态 approvalInput 恒为空串（不预填、不猜）', () => {
    expect(initialConfirmState(MULTI_PAYLOAD).approvalInput).toBe('')
  })

  it('命中判定：全号/只填编号后缀/只填 8 位数字/全角数字都算命中；别的号不命中；过短输入不命中', () => {
    const c = selectableCandidates(MULTI_PAYLOAD)[0]!
    expect(approvalMatchesCandidate(c, '国药准字H20138002')).toBe(true) // 240mg 的号
    expect(approvalMatchesCandidate(c, 'H20138002')).toBe(true) // 只填编号后缀
    expect(approvalMatchesCandidate(c, '20138002')).toBe(true) // 只填数字——界面就按这个教用户（字母不用填）
    expect(approvalMatchesCandidate(c, 'ｈ２０１３８００２')).toBe(true) // 全角
    expect(approvalMatchesCandidate(c, '国药准字H99999999')).toBe(false)
    expect(approvalMatchesCandidate(c, 'H2013')).toBe(false) // 过短不作命中依据
    expect(approvalMatchesCandidate(c, '   ')).toBe(false)
  })

  it('选定多规格合并候选 → 药箱规格取识别抄录值（不把「80mg，240mg」写进用户档案）', () => {
    const s = { ...initialConfirmState(MULTI_PAYLOAD), selectedCandidateId: 'dm-alishatan-merged', whoConfirmed: true }
    const input = buildConfirm(MULTI_PAYLOAD, s)
    expect(input.drug.drugMasterId).toBe('dm-alishatan-merged')
    expect(input.drug.specification).toBe('240mg×7片')
  })

  it('普通（单规格）候选仍取候选规格，行为不变', () => {
    const s = { ...initialConfirmState(rxConflictPayload), selectedCandidateId: 'dm-hycosan-02', whoConfirmed: true }
    expect(buildConfirm(rxConflictPayload, s).drug.specification).toBe('0.2%（10mL:20mg）')
  })
})
