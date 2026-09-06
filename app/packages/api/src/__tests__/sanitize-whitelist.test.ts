/**
 * M2-T2 · L1 parseWhitelist 单测（白名单解析）。
 * 覆盖：完整解析 + 闭合 schema 自证、身份信息结构性封顶（隐私红线）、缺项 needsManual（不猜）、
 *       多条目、用法缺失、日期多格式归一、全角冒号容错、条目仅在 Rp 区解析、空文本。
 */
import { describe, it, expect } from 'vitest'
import { PrescriptionWhitelist } from '@anxin/shared'
import { parseWhitelist, assertNoPii } from '../services/sanitize/index.js'

const FULL_RX = [
  '第一人民医院',
  '处方号：RX20260305001',
  '科别：心血管内科',
  '2026年3月5日',
  '姓名：张三 电话：13812345678',
  '临床诊断：高血压',
  'Rp',
  '苯磺酸氨氯地平片 5mg × 14片',
  '用法：每次1片 每日1次 共7天',
  '处方完毕',
  '医师签名：李医生',
].join('\n')

describe('L1 parseWhitelist · 白名单解析', () => {
  it('完整处方 → 头部字段与条目全解析，complete=true，输出过闭合 schema', () => {
    const { whitelist, needsManual, complete } = parseWhitelist(FULL_RX)
    expect(whitelist.hospital).toBe('第一人民医院')
    expect(whitelist.prescriptionNo).toBe('RX20260305001')
    expect(whitelist.date).toBe('2026-03-05')
    expect(whitelist.department).toBe('心血管内科')
    expect(whitelist.diagnosis).toBe('高血压')
    expect(whitelist.items).toHaveLength(1)
    expect(whitelist.items[0]).toEqual({
      drugName: '苯磺酸氨氯地平片',
      specification: '5mg',
      quantity: '14片',
      usage: '用法：每次1片 每日1次 共7天',
    })
    expect(needsManual).toEqual([])
    expect(complete).toBe(true)
    // 结构性封顶自证：输出永远落在闭合 schema 内
    expect(PrescriptionWhitelist.safeParse(whitelist).success).toBe(true)
  })

  it('患者姓名/电话出现在原文 → 结构性无法进入白名单（隐私红线）', () => {
    const { whitelist } = parseWhitelist(FULL_RX)
    const json = JSON.stringify(whitelist)
    // 白名单输出零 PII（闭合 schema 无字段可装身份信息）
    expect(() => assertNoPii(json)).not.toThrow()
    expect(json).not.toContain('张三')
    expect(json).not.toContain('13812345678')
    // 对照：原文本身含 PII，assertNoPii 能抓到（证明断言有效，供 T9 复用）
    expect(() => assertNoPii(FULL_RX)).toThrow()
  })

  it('缺医院与日期 → 标 needsManual，不猜、不预填', () => {
    const text = ['科别：内科', '临床诊断：感冒', 'Rp', '阿莫西林胶囊 0.25g × 12粒', '用法：每次2粒 每日3次', '处方完毕'].join('\n')
    const { whitelist, needsManual, complete } = parseWhitelist(text)
    expect(whitelist.hospital).toBe('')
    expect(whitelist.date).toBe('')
    expect(needsManual).toContain('hospital')
    expect(needsManual).toContain('date')
    expect(complete).toBe(false)
  })

  it('多条药品 → 各自条目，用法用量正确归属到上一条目', () => {
    const text = [
      'Rp',
      '苯磺酸氨氯地平片 5mg × 14片',
      '用法：每次1片 每日1次',
      '阿托伐他汀钙片 20mg × 7片',
      '用法：每次1片 每晚1次',
      '处方完毕',
    ].join('\n')
    const { whitelist } = parseWhitelist(text)
    expect(whitelist.items).toHaveLength(2)
    expect(whitelist.items[0].drugName).toBe('苯磺酸氨氯地平片')
    expect(whitelist.items[0].usage).toBe('用法：每次1片 每日1次')
    expect(whitelist.items[1].drugName).toBe('阿托伐他汀钙片')
    expect(whitelist.items[1].usage).toBe('用法：每次1片 每晚1次')
  })

  it('用法用量缺失 → item.usage 留空并标 needsManual（绝不预填猜测）', () => {
    const text = ['Rp', '布洛芬缓释胶囊 300mg × 20粒', '处方完毕'].join('\n')
    const { whitelist, needsManual } = parseWhitelist(text)
    expect(whitelist.items[0].usage).toBe('')
    expect(needsManual).toContain('items[0].usage')
  })

  it.each([
    ['2026年3月5日', '2026-03-05'],
    ['2026/3/5', '2026-03-05'],
    ['2026-03-05', '2026-03-05'],
    ['2026.12.31', '2026-12-31'],
  ])('日期多格式归一：%s → %s', (input, expected) => {
    expect(parseWhitelist(input).whitelist.date).toBe(expected)
  })

  it('全角冒号 + 诊断/科室别名容错', () => {
    const text = ['科室：呼吸内科', '诊断：急性上呼吸道感染', 'Rp', '复方氨酚烷胺片 × 12片', '处方完毕'].join('\n')
    const { whitelist } = parseWhitelist(text)
    expect(whitelist.department).toBe('呼吸内科')
    expect(whitelist.diagnosis).toBe('急性上呼吸道感染')
  })

  it('条目仅在 Rp 正文区解析：前记中的"药名样"文本不混入 items', () => {
    const text = [
      '第一人民医院',
      '既往用药：阿司匹林肠溶片',
      '临床诊断：冠心病',
      'Rp',
      '硫酸氢氯吡格雷片 75mg × 7片',
      '用法：每次1片 每日1次',
      '处方完毕',
    ].join('\n')
    const { whitelist } = parseWhitelist(text)
    expect(whitelist.items).toHaveLength(1)
    expect(whitelist.items[0].drugName).toBe('硫酸氢氯吡格雷片')
    expect(JSON.stringify(whitelist.items)).not.toContain('阿司匹林')
  })

  it('空文本 → 全部字段 needsManual，complete=false，但输出仍落在闭合 schema 内', () => {
    const { whitelist, needsManual, complete } = parseWhitelist('')
    expect(whitelist.items).toEqual([])
    expect(complete).toBe(false)
    expect(needsManual).toEqual(
      expect.arrayContaining(['hospital', 'prescriptionNo', 'date', 'department', 'diagnosis', 'items']),
    )
    expect(PrescriptionWhitelist.safeParse(whitelist).success).toBe(true)
  })
})
