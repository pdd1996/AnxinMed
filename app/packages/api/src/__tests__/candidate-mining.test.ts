/** M9-T2 · 规则候选挖掘纯函数单测。 */
import { describe, it, expect } from 'vitest'
import {
  aliasesForDrug,
  buildAliasIndex,
  classifySentence,
  expandQuoteToSentence,
  findMentions,
  mineCandidates,
  splitSentences,
  suggestLevel,
  verifyCandidates,
  type MasterDrug,
  type SourceManual,
} from '../services/rules/candidate-mining.js'

const DRUGS: MasterDrug[] = [
  { id: 'dm-simvastatin', genericName: '辛伐他汀片', brandName: '舒降之', form: '片' },
  { id: 'dm-amlodipine', genericName: '苯磺酸氨氯地平片', brandName: '络活喜', form: '片' },
  { id: 'dm-atorvastatin', genericName: '阿托伐他汀钙片', brandName: '立普妥', form: '片' },
  { id: 'dm-atorvastatin-2', genericName: '阿托伐他汀钙片', brandName: null, form: '片' },
]

function manual(overrides: Partial<SourceManual> = {}): SourceManual {
  return {
    insertId: 'pi-amlo',
    drugId: 'dm-amlodipine',
    genericName: '苯磺酸氨氯地平片',
    version: 'nmpa-test',
    sections: {
      药物相互作用:
        '合用氨氯地平不改变阿托伐他汀、地高辛、乙醇（酒精）的暴露量。辛伐他汀：多剂量 10 mg 氨氯地平与 80 mg 辛伐他汀合用时，辛伐他汀的暴露量比单独使用辛伐他汀增加了 77%。',
    },
    ...overrides,
  }
}

describe('candidate-mining · 药名归一与命中最长匹配', () => {
  it('去剂型/盐基生成别名', () => {
    expect(aliasesForDrug({ id: 'x', genericName: '盐酸二甲双胍片', brandName: '格华止', form: '片' })).toEqual(
      expect.arrayContaining(['盐酸二甲双胍片', '盐酸二甲双胍', '二甲双胍', '格华止']),
    )
    expect(aliasesForDrug({ id: 'x', genericName: '阿托伐他汀钙片', brandName: null, form: '片' })).toEqual(
      expect.arrayContaining(['阿托伐他汀钙片', '阿托伐他汀']),
    )
  })

  it('句内最长匹配且不重复吃子串', () => {
    const index = buildAliasIndex(DRUGS)
    const hits = findMentions('禁止与阿托伐他汀钙片联合使用。', index)
    expect(hits.some((h) => h.drugId === 'dm-atorvastatin')).toBe(true)
    // 不应把「阿托伐他汀」再拆出子串命中
    expect(hits.filter((h) => h.alias.includes('他汀')).length).toBeGreaterThanOrEqual(1)
  })

  it('切句保留标点；PDF 换行合并不切半句', () => {
    expect(splitSentences('甲。乙；丙\n丁')).toEqual(['甲。', '乙；', '丙丁'])
    expect(splitSentences('应慎用胺\n碘酮，因为存在心动过缓。')).toEqual(['应慎用胺碘酮，因为存在心动过缓。'])
  })

  it('引文扩展到完整句（OCR 换行截断修复）', () => {
    const text = '在接受β受体阻滞剂(如普萘洛尔)或钙通道拮抗剂(如维拉帕米、地尔硫卓)治疗的患者中，应慎用胺\n碘酮，因为存在发生心动过缓、窦性停搏和AV阻滯的可能性；在重度心动过缓患者中可继续应用。'
    const expanded = expandQuoteToSentence(text, '应慎用胺')
    expect(expanded).toContain('应慎用胺碘酮')
    expect(expanded).toContain('可能性')
    expect(expanded?.endsWith('；')).toBe(true)
    expect(expandQuoteToSentence(text, '不存在的引文')).toBeNull()
  })
})

describe('candidate-mining · 分类与分级建议', () => {
  it('无影响句 / 风险句 / 未分类句', () => {
    expect(classifySentence('合用不改变阿托伐他汀暴露量。').kind).toBe('no-effect')
    expect(classifySentence('禁止与辛伐他汀合用。').kind).toBe('risk')
    expect(classifySentence('本品为白色片。').kind).toBe('none')
  })

  it('四级建议映射', () => {
    expect(suggestLevel('禁止合用。')).toBe('禁忌')
    expect(suggestLevel('应慎用。')).toBe('慎用')
    expect(suggestLevel('应监测血药浓度。')).toBe('需监测')
    expect(suggestLevel('合用需注意。')).toBe('需监测') // 「注意」词表归需监测，避免低报
    expect(suggestLevel('合用需关注。')).toBe('注意')
  })
})

describe('candidate-mining · mineCandidates', () => {
  it('只保留风险句；无影响句跳过；source 自身提及排除', () => {
    const index = buildAliasIndex(DRUGS)
    const { candidates, stats } = mineCandidates([manual()], index)
    expect(stats.manualsWithSection).toBe(1)
    expect(stats.skippedNoEffect).toBeGreaterThanOrEqual(1)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].quote).toContain('辛伐他汀的暴露量')
    expect(candidates[0].level).toBe('注意')
    expect(candidates[0].candidateDrugIds).toContain('dm-simvastatin')
    expect(candidates[0].candidateDrugIds).not.toContain('dm-amlodipine')
    expect(candidates[0].aliasKind).toBe('stripped') // 原文只说「辛伐他汀」，归一命中
  })

  it('同通用名多产品 → 候选 IDs 多个、ambiguous=true', () => {
    const index = buildAliasIndex(DRUGS)
    const m = manual({ sections: { 药物相互作用: '禁止与阿托伐他汀联用。' } })
    const { candidates } = mineCandidates([m], index)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].candidateDrugIds.sort()).toEqual(['dm-atorvastatin', 'dm-atorvastatin-2'])
    expect(candidates[0].ambiguous).toBe(true)
  })

  it('无相互作用段 → 跳过；逐字自检通过', () => {
    const index = buildAliasIndex(DRUGS)
    const noSection = manual({ insertId: 'pi-x', sections: { 注意事项: '禁止与辛伐他汀合用。' } })
    const { candidates } = mineCandidates([noSection], index)
    expect(candidates).toEqual([])

    const good = mineCandidates([manual()], index).candidates
    expect(verifyCandidates(good, [manual()])).toEqual([])
  })

  it('表格行跳过（管道残留多药并列）', () => {
    const index = buildAliasIndex(DRUGS)
    const tableManual = manual({ sections: { 药物相互作用: '｜ 辛伐他汀 ｜ 禁止合用 ｜' } })
    const { candidates, stats } = mineCandidates([tableManual], index)
    expect(candidates).toEqual([])
    expect(stats.skippedTable).toBeGreaterThan(0)
  })

  it('同活性成分不同剂型不算 foreign（孟鲁司特钠颗粒 vs 片）', () => {
    const drugs: MasterDrug[] = [
      { id: 'dm-mont-granule', genericName: '孟鲁司特钠颗粒', brandName: null, form: '颗粒' },
      { id: 'dm-mont-tablet', genericName: '孟鲁司特钠片', brandName: null, form: '片' },
    ]
    const index = buildAliasIndex(drugs)
    const m: SourceManual = {
      insertId: 'pi-mont',
      drugId: 'dm-mont-granule',
      genericName: '孟鲁司特钠颗粒',
      version: 'nmpa-test',
      sections: { 药物相互作用: '禁止与孟鲁司特钠片合用。' },
    }
    const { candidates, stats } = mineCandidates([m], index)
    expect(candidates).toEqual([])
    expect(stats.skippedSelfOnly).toBeGreaterThan(0)
  })

  it('复方自身成分不算 foreign（氨氯地平阿托伐他汀 → 阿托伐他汀）', () => {
    const drugs: MasterDrug[] = [
      { id: 'dm-combo', genericName: '氨氯地平阿托伐他汀钙片', brandName: null, form: '片' },
      { id: 'dm-atorva', genericName: '阿托伐他汀钙片', brandName: null, form: '片' },
    ]
    const index = buildAliasIndex(drugs)
    const m: SourceManual = {
      insertId: 'pi-combo',
      drugId: 'dm-combo',
      genericName: '氨氯地平阿托伐他汀钙片',
      version: 'nmpa-test',
      sections: { 药物相互作用: '禁止与阿托伐他汀合用。' },
    }
    const { candidates, stats } = mineCandidates([m], index)
    expect(candidates).toEqual([])
    expect(stats.skippedSelfOnly).toBeGreaterThan(0)
  })

  it('「凝血酶原时间」不误配凝血酶散', () => {
    const index = buildAliasIndex([{ id: 'dm-thrombin', genericName: '凝血酶散', brandName: null, form: '散' }])
    const m: SourceManual = {
      insertId: 'pi-x',
      drugId: 'dm-other',
      genericName: '华法林钠片',
      version: 'nmpa-test',
      sections: { 药物相互作用: '合用时应严密监测凝血酶原时间。' },
    }
    const { candidates } = mineCandidates([m], index)
    expect(candidates).toEqual([])
  })

  it('quote 被篡改 → 逐字自检报错', () => {
    const index = buildAliasIndex(DRUGS)
    const { candidates } = mineCandidates([manual()], index)
    const tampered = [{ ...candidates[0], quote: `${candidates[0].quote}（改写）` }]
    expect(verifyCandidates(tampered, [manual()]).length).toBeGreaterThan(0)
  })
})
