/**
 * M3-T1 · 按键取数 + L2 剂量过滤 + 归一化单测（PRD §7.5.3–§7.5.4）。
 *
 * 覆盖：
 * - pickInsertSections × 8（各段落路由：药理/相互作用/不良反应/禁忌/成份/注意事项/储存/医嘱提示/适应症兜底）
 * - normalizeSections × 3（limited 标记 / 兜底文案 / risks 不过滤剂量）
 * - fallbackSectionsFromInsert × 1（Baichuan 不可用降级）
 * - stripDosageAdvice × 3（切除/不误伤/边界）
 * - containsDosageAdvice × 2
 * - insertCitation × 2（三件套齐备/缺失兜底）
 * - webSearchCitation × 1（unverified=true）
 *
 * = 20 case。
 */
import { describe, it, expect } from 'vitest'
import {
  containsDosageAdvice,
  sanitizeText,
  stripDosageAdvice,
} from '../services/consult/sanitize.js'
import {
  fallbackSectionsFromInsert,
  normalizeSections,
  pickInsertSections,
} from '../services/consult/sections.js'
import { insertCitation, webSearchCitation } from '../services/consult/citations.js'
import type { InsertSlice } from '../services/consult/types.js'

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

const mkInsert = (overrides: Partial<InsertSlice> = {}): InsertSlice => ({
  drugId: 'dm-test',
  genericName: '玻璃酸钠滴眼液',
  brandName: '海露',
  specification: '0.1%（10mL:10mg）',
  form: '滴眼液',
  indication: '用于缓解干眼症状',
  components: '玻璃酸钠',
  dosage: { adult: { maxFrequencyPerDay: { value: 10, unit: '次' } } },
  contraindications: ['对玻璃酸钠过敏者禁用'],
  adverseReactions: '偶见眼部刺激感',
  precautions: ['开封后一个月内使用', '避免瓶口接触眼睛'],
  interactions: '尚无明确相互作用资料',
  pharmacology: '玻璃酸钠为天然存在的多糖，具有保湿作用',
  pharmacokinetics: '局部用药，几乎不吸收',
  storage: '密封，避光，不超过25℃保存',
  source: '丁香园用药助手',
  version: '2024-01',
  ...overrides,
})

// ---------------------------------------------------------------------------
// pickInsertSections · 按键取数（PRD §7.5.4）
// ---------------------------------------------------------------------------

describe('pickInsertSections · 按键取数（结构化取数优先于语义检索）', () => {
  const insert = mkInsert()

  it('"这个药是怎么作用的" → 药理毒理段', () => {
    const s = pickInsertSections('这个药是怎么作用的', insert)
    expect(s.key).toBe('pharmacology')
    expect(s.label).toBe('药理毒理段')
    expect(s.text).toContain('玻璃酸钠为天然存在的多糖')
  })

  it('"能和其他药一起吃吗" → 相互作用段', () => {
    const s = pickInsertSections('能和其他药一起吃吗', insert)
    expect(s.key).toBe('interactions')
    expect(s.text).toContain('尚无明确相互作用资料')
  })

  it('"有什么副作用" → 不良反应段', () => {
    const s = pickInsertSections('有什么副作用', insert)
    expect(s.key).toBe('adverse')
    expect(s.text).toContain('偶见眼部刺激感')
  })

  it('"哪些人不能用" → 禁忌段（jsonb 数组窄化为"；"分隔）', () => {
    const s = pickInsertSections('哪些人不能用', insert)
    expect(s.key).toBe('contraindication')
    expect(s.text).toContain('对玻璃酸钠过敏者禁用')
  })

  it('"含有什么成分" → 成份段', () => {
    const s = pickInsertSections('含有什么成分', insert)
    expect(s.key).toBe('components')
    expect(s.text).toContain('玻璃酸钠')
  })

  it('"有什么注意事项" → 注意事项段（jsonb 数组窄化）', () => {
    const s = pickInsertSections('有什么注意事项', insert)
    expect(s.key).toBe('precautions')
    expect(s.text).toContain('开封后一个月内使用')
    expect(s.text).toContain('避免瓶口接触眼睛')
  })

  it('"怎么保存" → 储存说明', () => {
    const s = pickInsertSections('怎么保存', insert)
    expect(s.key).toBe('storage')
    expect(s.text).toContain('密封，避光')
  })

  it('"应该怎么吃" → 医嘱提示（L2 前置防线：拒绝提供具体剂量）', () => {
    const s = pickInsertSections('应该怎么吃', insert)
    expect(s.key).toBe('dosage')
    expect(s.text).toContain('用法用量属于医嘱范畴')
    expect(s.text).toContain('不提供具体剂量')
  })

  it('"这个药通常用于什么" → 兜底适应症段', () => {
    const s = pickInsertSections('这个药通常用于什么', insert)
    expect(s.key).toBe('indication')
    expect(s.text).toContain('用于缓解干眼症状')
  })

  it('说明书字段缺失 → 明确标注"（未收录）"，不编造', () => {
    const sparse = mkInsert({ pharmacology: null, pharmacokinetics: null })
    const s = pickInsertSections('这个药的药理机制是什么', sparse)
    expect(s.text).toContain('药理作用：（未收录）')
    expect(s.text).toContain('药代动力学：（未收录）')
  })
})

// ---------------------------------------------------------------------------
// L2 剂量过滤（PRD §7.5.3）
// ---------------------------------------------------------------------------

describe('stripDosageAdvice · L2 剂量过滤', () => {
  it('命中剂量模式 → 切除整句', () => {
    const out = stripDosageAdvice('建议一日3次，每次1片。疗程7天。')
    expect(out).not.toContain('一日3次')
    expect(out).not.toContain('每次1片')
    expect(out).toContain('疗程7天')
  })

  it('未命中 → 原样清洗（不误伤）', () => {
    const out = stripDosageAdvice('该药用于缓解症状。')
    expect(out).toBe('该药用于缓解症状。')
  })

  it('边界：空/null → 空串', () => {
    expect(stripDosageAdvice('')).toBe('')
    expect(stripDosageAdvice(null)).toBe('')
    expect(stripDosageAdvice(undefined)).toBe('')
  })

  it('containsDosageAdvice 命中判定', () => {
    expect(containsDosageAdvice('一日3次')).toBe(true)
    expect(containsDosageAdvice('该药用于缓解症状')).toBe(false)
  })

  it('sanitizeText 抹除 Markdown/引用编号', () => {
    expect(sanitizeText('**重要**提示^[1]^')).toBe('重要提示')
    expect(sanitizeText('## 标题')).toBe('标题')
  })
})

// ---------------------------------------------------------------------------
// normalizeSections · LLM 输出归一化
// ---------------------------------------------------------------------------

describe('normalizeSections · LLM 输出归一化', () => {
  it('干净输出 → limited=false，各字段原样', () => {
    const s = normalizeSections({
      summary: '该药用于缓解干眼症状',
      keyPoints: ['保湿作用', '局部用药'],
      risks: ['偶见刺激感'],
      nextAction: '如有疑问请咨询医生',
      warning: '不要自行调整处方',
    })
    expect(s.limited).toBe(false)
    expect(s.summary).toBe('该药用于缓解干眼症状')
    expect(s.keyPoints).toHaveLength(2)
  })

  it('含剂量输出（stripDosageAdvice 切不干净的变体）→ limited=true，nextAction 被替换为固定文案', () => {
    // "每日使用超过10次" 命中 DOSAGE_OUTPUT_PATTERN 的 `每[日天][^，。;；]{0,8}\d+\s*次`，
    // 但 stripDosageAdvice 的切除正则不含"每日"关键词（只有"一日|每天|每次"），所以切不干净 → limited=true
    const s = normalizeSections({
      summary: '每日使用超过10次需咨询医生',
      keyPoints: ['保湿'],
      risks: [],
      nextAction: '按医嘱使用',
      warning: '不要自行调整',
    })
    expect(s.limited).toBe(true)
    expect(s.nextAction).toBe('具体用量和疗程请按医生处方或说明书执行。')
  })

  it('LLM 输出缺项 → 兜底文案填补', () => {
    const s = normalizeSections(null, {
      summaryFallback: '兜底摘要',
      keyPointsFallback: ['兜底要点'],
      risksFallback: ['兜底风险'],
    })
    expect(s.summary).toBe('兜底摘要')
    expect(s.keyPoints).toEqual(['兜底要点'])
    expect(s.risks).toEqual(['兜底风险'])
  })

  it('keyPoints/risks 超过 3 条 → 截断', () => {
    const s = normalizeSections({
      summary: '摘要',
      keyPoints: ['a', 'b', 'c', 'd', 'e'],
      risks: ['x', 'y', 'z', 'w'],
    })
    expect(s.keyPoints).toHaveLength(3)
    expect(s.risks).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// fallbackSectionsFromInsert · Baichuan 不可用降级
// ---------------------------------------------------------------------------

describe('fallbackSectionsFromInsert · Baichuan 不可用降级', () => {
  it('用说明书段落拼装确定性回答（不依赖 LLM）', () => {
    const insert = mkInsert()
    const s = fallbackSectionsFromInsert('这个药通常用于什么', insert)
    expect(s.summary).toContain('用于缓解干眼症状')
    expect(s.keyPoints.length).toBeGreaterThan(0)
    expect(s.limited).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// citations · 引用三件套（PRD §7.5）
// ---------------------------------------------------------------------------

describe('citations · 引用三件套', () => {
  it('insertCitation：三件套齐备（药名 + source + version）', () => {
    const c = insertCitation(mkInsert())
    expect(c).toEqual({
      drugName: '玻璃酸钠滴眼液',
      source: '丁香园用药助手',
      version: '2024-01',
      unverified: false,
    })
  })

  it('insertCitation：source/version 缺失 → "未标注"兜底，不留空', () => {
    const c = insertCitation(mkInsert({ source: null, version: null }))
    expect(c.source).toContain('未标注')
    expect(c.version).toContain('未标注')
  })

  it('webSearchCitation：unverified=true（前端渲染"未经本库核实"徽章）', () => {
    const c = webSearchCitation('测试药', new Date('2026-09-06T12:00:00Z'))
    expect(c.unverified).toBe(true)
    expect(c.source).toContain('网络检索')
    expect(c.version).toContain('2026-09-06')
  })
})
