/**
 * M2-T2 · L0 cropBody 单测（版面裁剪）。
 * 覆盖：完整裁剪 + 前记后记整块丢弃（隐私）、Rp 涂黑缺失→null、锚点大小写/全角/空格容错、
 *       结束锚点缺失容错、空 OCR、box 几何精确性。
 */
import { describe, it, expect } from 'vitest'
import type { OcrChar, OcrResult } from '../lib/ai/types.js'
import { cropBody } from '../services/sanitize/index.js'

/** 把多行文本渲染成字符级 OCR 结果：每行 y = 行号×30，字符宽 16 高 20，行内按 x 递增。 */
function mkOcr(lines: string[]): OcrResult {
  const chars: OcrChar[] = []
  lines.forEach((line, li) => {
    const y = li * 30
    let x = 10
    for (const ch of line) {
      chars.push({ text: ch, confidence: 0.99, box: { x, y, w: 16, h: 20 } })
      x += 16
    }
  })
  return { chars }
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

describe('L0 cropBody · 版面裁剪', () => {
  it('裁出正文区（药品+用法），box 非退化，anchors 报告正确', () => {
    const r = cropBody(mkOcr(RX))
    expect(r).not.toBeNull()
    expect(r!.bodyText).toContain('苯磺酸氨氯地平片')
    expect(r!.bodyText).toContain('用法：每次1片 每日1次 共7天')
    expect(r!.anchors.startFound).toBe(true)
    expect(r!.anchors.endFound).toBe(true)
    expect(r!.anchors.diagnosisFound).toBe(true)
    expect(r!.chars.length).toBeGreaterThan(0)
  })

  it('前记（患者姓名/电话）与后记（签名）整块丢弃 —— 隐私红线', () => {
    const r = cropBody(mkOcr(RX))!
    // 正文文本绝不含前记身份信息与后记签名
    expect(r.bodyText).not.toContain('张三')
    expect(r.bodyText).not.toContain('13812345678')
    expect(r.bodyText).not.toContain('李医生')
    expect(r.bodyText).not.toContain('签名')
    // 裁出的字符集合里也不含前记字符（几何层面丢弃，非仅文本层面）
    const bodyStr = r.chars.map((c) => c.text).join('')
    expect(bodyStr).not.toContain('张')
    expect(bodyStr).not.toContain('话')
    expect(bodyStr).not.toContain('13812345678')
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

  it('空 OCR（chars=[]）→ null（无锚点，不猜）', () => {
    expect(cropBody({ chars: [] })).toBeNull()
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
  })

  it('结束锚点缺失 → endFound=false，正文延伸到最后一行（不因缺 end 崩溃）', () => {
    const r = cropBody(mkOcr(['Rp', '布洛芬缓释胶囊 300mg × 20粒', '用法：每次1粒 每日2次']))!
    expect(r.anchors.endFound).toBe(false)
    expect(r.anchors.endLine).toBe(-1)
    expect(r.bodyText).toContain('布洛芬缓释胶囊')
    expect(r.bodyText).toContain('用法：每次1粒 每日2次')
  })

  it('box 为正文区字符外接矩形（几何精确）', () => {
    const r = cropBody(mkOcr(RX))!
    // 正文 = 第 4、5 行（0 基），y 分别 120、150，字符高 20 → y=120, h=170-120=50；x 从 10 起
    expect(r.box).toMatchObject({ x: 10, y: 120, h: 50 })
    expect(r.box.w).toBeGreaterThan(0)
  })
})
