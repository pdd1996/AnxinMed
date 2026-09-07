/**
 * M2-T2 · L0 cropBody 单测（版面裁剪，qwen3.5-ocr 行级语义）。
 * 覆盖：完整裁剪 + 前记后记整块丢弃（隐私）、Rp 涂黑缺失→null、锚点大小写/全角/空格容错、
 *       结束锚点缺失容错、空 OCR。
 */
import { describe, it, expect } from 'vitest'
import type { OcrResult } from '../lib/ai/types.js'
import { cropBody } from '../services/sanitize/index.js'

/** 行级 OCR 结果（qwen3.5-ocr 契约：lines 纯文本）。 */
function mkOcr(lines: string[]): OcrResult {
  return { lines }
}

/** 标准合成处方笺：前记(患者信息) + Rp 正文 + 处方完毕 + 后记(签名)。 */
const RX = [
  '第一人民医院',
  '姓名：张三 电话：13812345678',
  '临床诊断：高血压',
  'Rp',
  '苯磺酸氨氯地平片 5mg × 14片',
  '用法：每次1片 每日1次 共7天',
  '处方完毕',
  '医师签名：李医生',
]

describe('L0 cropBody · 版面裁剪（行级）', () => {
  it('裁出正文区（药品+用法两行），anchors 报告正确', () => {
    const r = cropBody(mkOcr(RX))
    expect(r).not.toBeNull()
    expect(r!.lines).toEqual(['苯磺酸氨氯地平片 5mg × 14片', '用法：每次1片 每日1次 共7天'])
    expect(r!.bodyText).toBe('苯磺酸氨氯地平片 5mg × 14片\n用法：每次1片 每日1次 共7天')
    expect(r!.anchors.startFound).toBe(true)
    expect(r!.anchors.endFound).toBe(true)
    expect(r!.anchors.diagnosisFound).toBe(true)
  })

  it('前记（患者姓名/电话）与后记（签名）整块丢弃 —— 隐私红线', () => {
    const r = cropBody(mkOcr(RX))!
    // 正文文本绝不含前记身份信息与后记签名
    expect(r.bodyText).not.toContain('张三')
    expect(r.bodyText).not.toContain('13812345678')
    expect(r.bodyText).not.toContain('李医生')
    expect(r.bodyText).not.toContain('签名')
    // 行级丢弃：正文行集合里也不含前记/后记任何一行（整块丢弃，非仅文本拼接层面）
    const allLines = r.lines.join('\n')
    expect(allLines).not.toContain('张')
    expect(allLines).not.toContain('话')
    expect(allLines).not.toContain('13812345678')
    expect(r.lines.some((l) => l.includes('姓名'))).toBe(false)
  })

  it('临床诊断位于前记 → diagnosisFound=true 但不进入正文（裁掉）', () => {
    const r = cropBody(mkOcr(RX))!
    expect(r.anchors.diagnosisFound).toBe(true)
    expect(r.bodyText).not.toContain('高血压')
    expect(r.anchors.startLine).toBe(3) // Rp 在第 4 行（0 基 3）
    expect(r.anchors.endLine).toBe(6) // 处方完毕在第 7 行（0 基 6）
  })

  it('起始锚点 Rp 被涂黑缺失（golden case rx-redacted 变体）→ 返回 null 走人工补', () => {
    const redacted = RX.filter((l) => l !== 'Rp') // 涂黑后 OCR 未识别出 Rp
    expect(cropBody(mkOcr(redacted))).toBeNull()
  })

  it('空 OCR（lines=[]）→ null（无锚点，不猜）', () => {
    expect(cropBody({ lines: [] })).toBeNull()
  })

  it.each([
    ['大写 RP', 'RP'],
    ['全角 ｒｐ', 'ｒｐ'],
    ['处方符 ℞', '℞'],
    ['带全角冒号 Rp：', 'Rp：'],
    ['带空格 R p', 'R p'],
  ])('起始锚点容错：%s 识别为正文起点', (_label, anchor) => {
    const r = cropBody(mkOcr(['临床诊断：感冒', anchor, '阿莫西林胶囊 0.25g × 12粒', '处方完毕']))
    expect(r).not.toBeNull()
    expect(r!.bodyText).toContain('阿莫西林胶囊')
    expect(r!.lines).toEqual(['阿莫西林胶囊 0.25g × 12粒'])
  })

  it('结束锚点缺失 → endFound=false，正文延伸到最后一行（不因缺 end 崩溃）', () => {
    const r = cropBody(mkOcr(['Rp', '布洛芬缓释胶囊 300mg × 20粒', '用法：每次1粒 每日2次']))!
    expect(r.anchors.endFound).toBe(false)
    expect(r.anchors.endLine).toBe(-1)
    expect(r.bodyText).toContain('布洛芬缓释胶囊')
    expect(r.bodyText).toContain('用法：每次1粒 每日2次')
  })
})
