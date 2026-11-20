/**
 * M3-T1 · 按键取数 + L2 剂量过滤 + 归一化单测（PRD §7.5.3–§7.5.4）。
 *
 * 覆盖：
 * - pickInsertSections × 12（各段落路由：药理/相互作用/不良反应/禁忌/成份/孕妇/儿童/老年/过量/注意事项/储存/医嘱提示/适应症兜底）
 * - normalizeSections × 3（limited 标记 / 兜底文案 / risks 不过滤剂量）
 * - fallbackSectionsFromInsert × 1（Baichuan 不可用降级）
 * - stripDosageAdvice × 3（切除/不误伤/边界）
 * - containsDosageAdvice × 2
 * - insertCitation × 2（三件套齐备/缺失兜底）
 *
 * = 19 case。
 */
import { describe, it, expect } from 'vitest'
import {
  containsDosageAdvice,
  sanitizeText,
  stripDosageAdvice,
} from '../services/consult/sanitize.js'
import {
  fallbackSectionsFromInsert,
  hasFrequencyTable,
  isLeafletRequest,
  normalizeSections,
  pickInsertSections,
} from '../services/consult/sections.js'
import { insertCitation } from '../services/consult/citations.js'
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
  sourceSections: null,
  curationStatus: 'reviewed',
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
// 孕妇/儿童/老年/过量（sourceSections 路由）
// ---------------------------------------------------------------------------

describe('pickInsertSections · 孕妇/儿童/老年/过量（sourceSections 路由）', () => {
  const insert = mkInsert({
    sourceSections: {
      '孕妇和哺乳期妇女用药': '孕妇及哺乳期妇女禁用。',
      '儿童用药': '儿童慎用。',
      '老年用药': '老年患者应减量。',
      '药物过量': '立即停药并就医。',
    },
  })

  it('"孕妇能不能用" → 孕妇及哺乳期用药', () => {
    const s = pickInsertSections('孕妇能不能用', insert)
    expect(s.key).toBe('pregnancy')
    expect(s.text).toContain('孕妇及哺乳期妇女禁用')
  })

  it('"哺乳期能吃吗" → 孕妇及哺乳期用药', () => {
    const s = pickInsertSections('哺乳期能吃吗', insert)
    expect(s.key).toBe('pregnancy')
    expect(s.text).toContain('哺乳期妇女禁用')
  })

  it('"儿童能吃吗" → 儿童用药', () => {
    const s = pickInsertSections('儿童能吃吗', insert)
    expect(s.key).toBe('pediatric')
    expect(s.text).toContain('儿童慎用')
  })

  it('"老人能吃吗" → 老年用药', () => {
    const s = pickInsertSections('老人能吃吗', insert)
    expect(s.key).toBe('geriatric')
    expect(s.text).toContain('老年患者应减量')
  })

  it('"药物过量怎么办" → 药物过量', () => {
    const s = pickInsertSections('药物过量怎么办', insert)
    expect(s.key).toBe('overdose')
    expect(s.text).toContain('立即停药并就医')
  })

  it('sourceSections 缺失 → 明确标注"（未收录）"', () => {
    const s = pickInsertSections('孕妇能不能用', mkInsert({ sourceSections: null }))
    expect(s.key).toBe('pregnancy')
    expect(s.text).toContain('（未收录）')
  })
})

// ---------------------------------------------------------------------------
// 口语同义词路由（M13-T3b · docs/14 §4 T3b）
// ---------------------------------------------------------------------------

describe('pickInsertSections · 口语同义词（M13-T3b）', () => {
  const insert = mkInsert()

  it('"这个药吃了犯困正常吗" → 不良反应段（犯困）', () => {
    expect(pickInsertSections('这个药吃了犯困正常吗', insert).key).toBe('adverse')
  })

  it('"这个药伤肝吗" → 不良反应段（伤肝）', () => {
    expect(pickInsertSections('这个药伤肝吗', insert).key).toBe('adverse')
  })

  it('"这个药对肝功能有影响吗" → 不良反应段（肝功能）', () => {
    expect(pickInsertSections('这个药对肝功能有影响吗', insert).key).toBe('adverse')
  })

  it('"这个药能喝酒吗" → 相互作用段（喝酒）', () => {
    expect(pickInsertSections('这个药能喝酒吗', insert).key).toBe('interactions')
  })

  it('"这个药能长期吃吗" → 注意事项段（长期）', () => {
    expect(pickInsertSections('这个药能长期吃吗', insert).key).toBe('precautions')
  })

  it('"漏服了怎么办" → 注意事项段（漏服）', () => {
    expect(pickInsertSections('漏服了怎么办', insert).key).toBe('precautions')
  })

  it('"药过期了还能吃吗" → 注意事项段（过期）', () => {
    expect(pickInsertSections('药过期了还能吃吗', insert).key).toBe('precautions')
  })

  it('"这个药饭前吃还是饭后吃" → 医嘱提示（饭前/饭后）', () => {
    expect(pickInsertSections('这个药饭前吃还是饭后吃', insert).key).toBe('dosage')
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
// L0/降级回答的排版简化（2026-11-20 用户要求：优化排版、简化文字）
// ---------------------------------------------------------------------------

describe('fallbackSectionsFromInsert · L0 排版简化', () => {
  const longIndication =
    '1.用于成人和1岁及1岁以上儿童的甲型和乙型流感治疗（磷酸奥司他韦能够有效治疗甲型和乙型流感，但是乙型流\n' +
    '感的临床应用数据尚不多）。患者应在首次出现症状48小时以内使用。2.用于成人和13岁及13岁以上青少年的甲型和乙型流感的预防。'
  const longPrecautions =
    '·1.精神神经性不良事件，流感可能会引起许多神经和行为症状，包括幻觉、谵妄和行为异常，有些病例中，还会引发致命性结果。\n' +
    '·2.接受本品用药的流感患者中，曾出现过导致受伤的谵妄和行为异常等上市后报告（主要来源于日本），有些病例还导致致命性结果。\n' +
    '·3.尚无证据显示磷酸奥司他韦对甲型流感和乙型流感以外的其他疾病有效。\n' +
    '·4.奥司他韦对1岁以下儿童治疗流感的安全性和有效性尚未确定。'

  it('单元素整段注意事项 → 短摘要 + 前 3 条要点 + 原文收进 details', () => {
    const insert = mkInsert({
      indication: longIndication,
      precautions: [longPrecautions],
    })
    const s = fallbackSectionsFromInsert('这个药品说明书有吗', insert)

    // 摘要：去长括注、合并 PDF 折行、截短，且保留关键时间窗
    expect(s.summary).toContain('48小时')
    expect(s.summary).not.toContain('（磷酸奥司他韦')
    expect(s.summary).not.toContain('流 感')
    expect(s.summary.length).toBeLessThanOrEqual(95)

    // 要点：只取前 3 条，每条截到首句/短句，不再是一堵 1000+ 字文字墙
    expect(s.keyPoints).toHaveLength(3)
    expect(s.keyPoints[0]).toContain('精神神经性不良事件')
    expect(s.keyPoints.every((k) => k.length <= 70)).toBe(true)

    // 原文可追溯：适应症原文 + 4 条注意事项逐条
    expect(s.details).toHaveLength(5)
    expect(s.details?.[0]?.title).toBe('适应症段（原文）')
    expect(s.details?.[1]?.title).toBe('注意事项原文 · 第 1 条')
    expect(s.details?.map((d) => d.body).join('')).not.toContain('流 感')
    expect(s.details?.map((d) => d.body).join('')).toContain('对1岁以下儿童治疗流感')
  })

  it('已拆条的注意事项数组 → details 逐条保留，摘要仍短', () => {
    const insert = mkInsert({ precautions: ['开封后一个月内使用', '避免瓶口接触眼睛'] })
    const s = fallbackSectionsFromInsert('这个药通常用于什么', insert)

    expect(s.keyPoints).toEqual(['开封后一个月内使用', '避免瓶口接触眼睛'])
    // 适应症原文 + 2 条注意事项
    expect(s.details).toHaveLength(3)
    expect(s.details?.map((d) => d.body)).toContain('避免瓶口接触眼睛')
  })
})

// ---------------------------------------------------------------------------
// 段内锚定摘录（2026-11-20）：问「伤肝吗」不能拿段首免责句和无关注意事项充数
// ---------------------------------------------------------------------------

describe('fallbackSectionsFromInsert · 段内锚定摘录（伤肝/伤肾/犯困）', () => {
  // 与 DB 实际形态一致：PDF 抽取入库后无换行，器官标签直接粘在上一条正文末尾
  // （真实数据：「…体温过低皮肤：皮疹…多形性红斑消化系统：肝炎、肝功能检查异常心脏：心律失常」）
  const adverseWithLiver =
    '1.临床试验由于本品的临床试验是在各种不同条件下进行的，因此不能直接将本品在临床试验中的不良反应发生率与其它药物进行比较。' +
    '2.上市后经验在本品的批准后使用过程中，已鉴定出以下不良事件。' +
    '全身：脸部或舌部肿胀、变态反应、过敏样反应、体温过低皮肤：皮疹、皮炎、荨麻疹、多形性红斑消化系统：肝炎、肝功能检查异常心脏：心律失常神经：癫痫发作'
  const precautionsWithLiver =
    '·1.精神神经性不良事件，流感可能会引起许多神经和行为症状，包括幻觉、谵妄和行为异常。\n' +
    '·2.尚无证据显示磷酸奥司他韦对甲型流感和乙型流感以外的其他疾病有效。\n' +
    '·3.严重肝功能不全者慎用，需监测肝功能。'

  const olsetamivir = mkInsert({
    genericName: '磷酸奥司他韦胶囊',
    adverseReactions: adverseWithLiver,
    precautions: [precautionsWithLiver],
    contraindications: ['对本品的任何成份过敏者禁用。'],
  })

  it('「这个药伤肝吗」→ 结论取段内「肝炎」原文，不再取「1.临床试验」；要点只留肝相关注意事项', () => {
    const s = fallbackSectionsFromInsert('这个药伤肝吗', olsetamivir)

    expect(s.summary).toContain('肝炎')
    expect(s.summary).toContain('上市后经验')
    expect(s.summary).not.toContain('临床试验')
    expect(s.keyPoints).toEqual(['严重肝功能不全者慎用，需监测肝功能。'])
    expect(s.keyPoints.join('')).not.toContain('精神神经')
    // 原文仍可追溯
    expect(s.details?.[0]?.title).toBe('不良反应段（原文）')
  })

  it('段内确实没有「肾」→ 明说未见，不拿无关段落充数', () => {
    const s = fallbackSectionsFromInsert('这个药伤肾吗', olsetamivir)

    expect(s.summary).toContain('未见')
    expect(s.summary).toContain('肾')
    expect(s.keyPoints).toEqual([])
    expect(s.details?.length).toBeGreaterThan(0)
  })

  it('「犯困」命中段内「嗜睡」+ 相关注意事项', () => {
    const sleepy = mkInsert({
      adverseReactions: '常见不良反应为嗜睡、乏力。',
      precautions: ['·1.服药期间可能出现嗜睡，避免驾车或操作机器。'],
    })
    const s = fallbackSectionsFromInsert('这个药吃了犯困正常吗', sleepy)

    expect(s.summary).toContain('嗜睡')
    expect(s.keyPoints[0]).toContain('避免驾车')
  })

  it('「这个药 肝痛能服用吗」→ 仍取肝相关原文，且下一步先引导就医（不给能不能吃的结论）', () => {
    expect(pickInsertSections('这个药 肝痛能服用吗', olsetamivir).key).toBe('adverse')
    const s = fallbackSectionsFromInsert('这个药 肝痛能服用吗', olsetamivir)

    expect(s.summary).toContain('肝炎')
    expect(s.nextAction).toContain('就医')
    expect(s.nextAction).toContain('未把')
    expect(s.nextAction).not.toContain('具体是否适用')
  })

  it('非症状问句（伤肝吗）→ 下一步仍是通用就医/药师提示', () => {
    const s = fallbackSectionsFromInsert('这个药伤肝吗', olsetamivir)
    expect(s.nextAction).toContain('具体是否适用')
  })

  it('非锚定问题（副作用）→ 行为不变，仍是段首摘要 + 注意事项前 3 条', () => {
    const s = fallbackSectionsFromInsert('有什么副作用', olsetamivir)

    expect(s.summary).toContain('临床试验')
    expect(s.keyPoints[0]).toContain('精神神经性不良事件')
  })

  it('锚定词只在非不良反应段出现（喝酒伤肝）→ 不摘录，保持原段落路由行为', () => {
    const s = fallbackSectionsFromInsert(
      '喝酒伤肝吗',
      mkInsert({ interactions: '本品与酒精同服可能增加肝脏负担。', adverseReactions: adverseWithLiver }),
    )
    // 路由到相互作用段 → 不触发不良反应段的锚定摘录
    expect(s.summary).toContain('酒精')
    expect(s.summary).not.toContain('上市后经验')
  })
})

// ---------------------------------------------------------------------------
// 「说明书」问句 → 分段摘要目录（2026-11-20 用户裁定）
// ---------------------------------------------------------------------------

describe('fallbackSectionsFromInsert · 「说明书」问句', () => {
  const insert = mkInsert({
    genericName: '磷酸奥司他韦胶囊',
    indication: '用于成人和1岁及1岁以上儿童的甲型和乙型流感治疗。',
    adverseReactions: '1.临床试验\n常见恶心、呕吐。\n2.上市后经验\n消化系统：肝炎、肝功能检查异常',
    precautions: ['·1.精神神经性不良事件，可能引起幻觉、谵妄。\n·2.尚无证据显示对流感以外疾病有效。'],
    contraindications: ['对本品的任何成份过敏者禁用。'],
  })

  it('「说明书」→ 分段摘要目录（kind=leaflet-overview），不再落适应症兜底', () => {
    const s = fallbackSectionsFromInsert('说明书', insert)

    expect(s.kind).toBe('leaflet-overview')
    expect(s.summary).toContain('段落摘要')
    expect(s.keyPoints).toHaveLength(5)
    expect(s.keyPoints[0]).toContain('适应症：')
    expect(s.keyPoints[1]).toContain('用法用量：')
    expect(s.keyPoints[2]).toContain('禁忌：')
    expect(s.keyPoints[3]).toContain('注意事项：')
    expect(s.keyPoints[4]).toContain('不良反应：')
    expect(s.nextAction).toContain('查看完整说明书')
  })

  it('「看说明书」同样识别；「说明书里写没写伤肝」不算纯说明书请求', () => {
    expect(isLeafletRequest('看说明书')).toBe(true)
    expect(isLeafletRequest('说明书全文')).toBe(true)
    expect(isLeafletRequest('说明书里写没写伤肝')).toBe(false)
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
      // 2026-11-20：本地引用补核验状态与身份字段（L0 顶部 banner / 来源卡展示）
      reviewStatus: 'reviewed',
      specification: '0.1%（10mL:10mg）',
    })
  })

  it('insertCitation：crawled 说明书 → reviewStatus=crawled（界面标「未经人工核验」）', () => {
    const c = insertCitation(mkInsert({ curationStatus: 'crawled', approvalNumbers: ['国药准字H20213670'] }))
    expect(c.reviewStatus).toBe('crawled')
    expect(c.approvalNumbers).toEqual(['国药准字H20213670'])
  })

  it('insertCitation：source/version 缺失 → "未标注"兜底，不留空', () => {
    const c = insertCitation(mkInsert({ source: null, version: null }))
    expect(c.source).toContain('未标注')
    expect(c.version).toContain('未标注')
  })
})

// ---------------------------------------------------------------------------
// hasFrequencyTable · 表格拉平检测（M6 已知缺陷的 prompt 防线）
// ---------------------------------------------------------------------------

describe('hasFrequencyTable · 频率表特征', () => {
  it('真实拉平片段（度拉糖肽不良反应表）→ true', () => {
    const text =
      '根据对Ⅱ期、Ⅲ期临床研究的评估确认以下不良反应，列于表1（十分常见：≥1/10；常见：≥1/100，＜1/10；' +
      '偶见：≥1/1000，＜1/100；罕见：≥1/10000，＜1/1000）。\n系统器官分类\n十分常见\n常见\n偶见\n罕见\n未知\n' +
      '免疫系统疾病\n过敏反应\n速发过敏反应#\n代谢和营养疾病\n低血糖*\n脱水'
    expect(hasFrequencyTable(text)).toBe(true)
  })

  it('「系统器官分类」+ 频率词（无连续表头）→ true', () => {
    expect(hasFrequencyTable('系统器官分类\n十分常见\n腹泻\n恶心')).toBe(true)
  })

  it('段落式定性描述（无频率分档表头）→ false，不误伤正常文本', () => {
    const text = '临床试验中最常见的不良反应为胃肠道不良反应，包括恶心、呕吐和腹泻，通常为轻度或中度。'
    expect(hasFrequencyTable(text)).toBe(false)
  })

  it('空文本/短文本 → false', () => {
    expect(hasFrequencyTable('')).toBe(false)
    expect(hasFrequencyTable('常见')).toBe(false)
  })
})
