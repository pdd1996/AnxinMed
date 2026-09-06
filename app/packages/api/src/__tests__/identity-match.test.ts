/**
 * M2-T4 · matchDrugMaster 单测（药名+规格+剂型三项严格匹配，PRD §8.2）。
 * 覆盖完成标准全部类别：唯一 / 多候选 / 规格冲突 / 剂型冲突 / 批准文号裁决 / 无匹配，
 * 另加：多规格库命中其一、缺规格不猜、缺剂型不阻塞、g↔mg 换算、全角归一、批准文号不阻塞/命中多条、复合规格拆解。
 */
import { describe, it, expect } from 'vitest'
import { matchDrugMaster, parseStrengthTokens, type DrugMasterCandidate } from '../services/identity/index.js'

const AMLO: DrugMasterCandidate = { id: 'drug-amlodipine-5', genericName: '苯磺酸氨氯地平片', specification: '5mg', form: '片剂', approvalNumber: '国药准字H10950224' }
const AMLO_B: DrugMasterCandidate = { id: 'drug-amlodipine-5b', genericName: '苯磺酸氨氯地平片', specification: '5mg', form: '片剂', manufacturer: '乙厂', approvalNumber: '国药准字H20000000' }
const AMLO_C: DrugMasterCandidate = { id: 'drug-amlodipine-5c', genericName: '苯磺酸氨氯地平片', specification: '5mg', form: '片剂', approvalNumber: '国药准字H20000000' }
const ATORVA: DrugMasterCandidate = { id: 'drug-atorvastatin-20', genericName: '阿托伐他汀钙片', specification: '20mg', form: '片剂' }
const HYCO_01: DrugMasterCandidate = { id: 'drug-hycosan-01', genericName: '玻璃酸钠滴眼液', specification: '0.1%（10mL:10mg）', form: '滴眼剂', approvalNumber: '国药准字H20160001' }
const HYCO_02: DrugMasterCandidate = { id: 'drug-hycosan-02', genericName: '玻璃酸钠滴眼液', specification: '0.2%（10mL:20mg）', form: '滴眼剂', approvalNumber: '国药准字H20160002' }
const AMOX: DrugMasterCandidate = { id: 'drug-amox-025', genericName: '阿莫西林胶囊', specification: '0.25g', form: '胶囊' }
const LIB = [AMLO, AMLO_B, ATORVA, HYCO_01, HYCO_02, AMOX]

describe('matchDrugMaster · 三项严格匹配', () => {
  it('唯一匹配：药名+规格+剂型全中单一候选 → unique', () => {
    const r = matchDrugMaster({ genericName: '阿托伐他汀钙片', specification: '20mg', form: '片剂' }, LIB)
    expect(r.status).toBe('unique')
    expect(r.match?.id).toBe('drug-atorvastatin-20')
  })

  it('多候选（同名同规格同剂型不同厂）→ ambiguous，列出候选，系统不选边', () => {
    const r = matchDrugMaster({ genericName: '苯磺酸氨氯地平片', specification: '5mg', form: '片剂' }, LIB)
    expect(r.status).toBe('ambiguous')
    expect(r.candidates?.map((c) => c.id).sort()).toEqual(['drug-amlodipine-5', 'drug-amlodipine-5b'])
    expect(r.match).toBeUndefined()
  })

  it('规格冲突（库仅 0.2% vs 提取 0.1%）→ conflict，带冲突详情（rx-spec-conflict golden case）', () => {
    const r = matchDrugMaster({ genericName: '玻璃酸钠滴眼液', specification: '0.1%', form: '滴眼剂' }, [HYCO_02])
    expect(r.status).toBe('conflict')
    expect(r.conflict?.field).toBe('specification')
    expect(r.conflict?.extracted).toBe('0.1%')
    expect(r.conflict?.library).toContain('0.2%')
    expect(r.conflict?.note).toContain('0.2%')
    expect(r.conflict?.note).toContain('0.1%')
    expect(r.candidates).toEqual([HYCO_02])
  })

  it('剂型冲突（药名命中，提取滴眼剂 vs 库片剂）→ conflict(form)', () => {
    const r = matchDrugMaster({ genericName: '苯磺酸氨氯地平片', specification: '5mg', form: '滴眼剂' }, [AMLO])
    expect(r.status).toBe('conflict')
    expect(r.conflict?.field).toBe('form')
    expect(r.conflict?.extracted).toBe('滴眼剂')
    expect(r.conflict?.library).toBe('片剂')
  })

  it('批准文号平局裁决：多候选 + 提取到批准文号命中其一 → unique + resolutionNote', () => {
    const r = matchDrugMaster(
      { genericName: '苯磺酸氨氯地平片', specification: '5mg', form: '片剂', approvalNumber: '国药准字H20000000' },
      [AMLO, AMLO_B],
    )
    expect(r.status).toBe('unique')
    expect(r.match?.id).toBe('drug-amlodipine-5b')
    expect(r.resolutionNote).toContain('国药准字H20000000')
  })

  it('批准文号不阻塞：多候选但批准文号谁都不命中 → ambiguous（不硬选）', () => {
    const r = matchDrugMaster(
      { genericName: '苯磺酸氨氯地平片', specification: '5mg', form: '片剂', approvalNumber: '国药准字H99999999' },
      [AMLO, AMLO_B],
    )
    expect(r.status).toBe('ambiguous')
    expect(r.candidates?.map((c) => c.id).sort()).toEqual(['drug-amlodipine-5', 'drug-amlodipine-5b'])
  })

  it('无匹配：药名全不中 → no_match', () => {
    const r = matchDrugMaster({ genericName: '复方磺胺甲噁唑片', specification: '0.48g', form: '片剂' }, LIB)
    expect(r.status).toBe('no_match')
    expect(r.match).toBeUndefined()
    expect(r.candidates).toBeUndefined()
  })

  it('多规格库 + 提取规格命中其一 → unique（海露 0.1%/0.2% 库，提取 0.1%）', () => {
    const r = matchDrugMaster({ genericName: '玻璃酸钠滴眼液', specification: '0.1%', form: '滴眼剂' }, [HYCO_01, HYCO_02])
    expect(r.status).toBe('unique')
    expect(r.match?.id).toBe('drug-hycosan-01')
  })

  it('缺规格 → 无法确证唯一，列候选交核对（不猜、不自动选）', () => {
    const r = matchDrugMaster({ genericName: '玻璃酸钠滴眼液', form: '滴眼剂' }, [HYCO_01, HYCO_02])
    expect(r.status).toBe('ambiguous')
    expect(r.candidates?.map((c) => c.id).sort()).toEqual(['drug-hycosan-01', 'drug-hycosan-02'])
  })

  it('缺剂型 → 不阻塞（formMatches 对缺失剂型放行），按药名+规格唯一匹配', () => {
    const r = matchDrugMaster({ genericName: '阿托伐他汀钙片', specification: '20mg' }, LIB)
    expect(r.status).toBe('unique')
    expect(r.match?.id).toBe('drug-atorvastatin-20')
  })

  it('规格单位换算 g↔mg：提取 250mg 命中库 0.25g → unique', () => {
    const r = matchDrugMaster({ genericName: '阿莫西林胶囊', specification: '250mg', form: '胶囊' }, [AMOX])
    expect(r.status).toBe('unique')
    expect(r.match?.id).toBe('drug-amox-025')
  })

  it('规格全角归一：提取全角 ２０ｍｇ 命中库半角 20mg → unique', () => {
    const r = matchDrugMaster({ genericName: '阿托伐他汀钙片', specification: '２０ｍｇ', form: '片剂' }, [ATORVA])
    expect(r.status).toBe('unique')
    expect(r.match?.id).toBe('drug-atorvastatin-20')
  })

  it('批准文号命中多条（库内重复文号）→ 仍 ambiguous，不硬选', () => {
    const r = matchDrugMaster(
      { genericName: '苯磺酸氨氯地平片', specification: '5mg', form: '片剂', approvalNumber: '国药准字H20000000' },
      [AMLO_B, AMLO_C],
    )
    expect(r.status).toBe('ambiguous')
    expect(r.candidates?.map((c) => c.id).sort()).toEqual(['drug-amlodipine-5b', 'drug-amlodipine-5c'])
  })

  it('parseStrengthTokens 拆解复合规格：0.1%（10mL:10mg）→ pct[0.1] + mg[10]，mL 不作为 potency', () => {
    expect(parseStrengthTokens('0.1%（10mL:10mg）')).toEqual({ pct: [0.1], mg: [10] })
    expect(parseStrengthTokens('0.25g')).toEqual({ pct: [], mg: [250] })
    expect(parseStrengthTokens('')).toEqual({ pct: [], mg: [] })
  })
})
