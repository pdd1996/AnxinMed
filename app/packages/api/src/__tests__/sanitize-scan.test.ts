/**
 * M2-T2 · L2 sanitizeScan 单测（黑名单兜底）。
 * 覆盖：手机号必中、身份证（含校验位验证）必中、地址必中、6 位数字/药名剂量不误杀、
 *       深遍历整个白名单、身份证优先于手机号、审计只记类型+次数（不记原文）、不改入参。
 */
import { describe, it, expect } from 'vitest'
import { sanitizeScan, scrubValue, isValidIdChecksum } from '../services/sanitize/index.js'

const VALID_ID = '11010519491231002X' // 校验位合法
const BAD_ID = '11010519491231003X' // 篡改末位数据 → 校验位不合法
const PHONE = '13812345678'

describe('L2 sanitizeScan · 黑名单兜底', () => {
  it('正确手机号必中 → [已脱敏] + audit 手机号×1', () => {
    const { value, audit } = sanitizeScan({ contact: PHONE })
    expect(value.contact).toBe('[已脱敏]')
    expect(audit).toEqual({ 手机号: 1 })
  })

  it('带合法校验位身份证必中 → [已脱敏] + audit 身份证号×1，校验位验证通过', () => {
    expect(isValidIdChecksum(VALID_ID)).toBe(true)
    const { value, audit } = sanitizeScan({ id: VALID_ID })
    expect(value.id).toBe('[已脱敏]')
    expect(audit).toEqual({ 身份证号: 1 })
  })

  it('篡改校验位的身份证 → 校验位验证 false，但仍脱敏（宁可误杀）', () => {
    expect(isValidIdChecksum(BAD_ID)).toBe(false)
    const { value, audit } = sanitizeScan({ id: BAD_ID })
    expect(value.id).toBe('[已脱敏]')
    expect(audit).toEqual({ 身份证号: 1 })
  })

  it('地址模式必中 → [已脱敏] + audit 地址×1', () => {
    const { value, audit } = sanitizeScan({ addr: '广东省深圳市南山区科技路1号' })
    expect(value.addr).toBe('[已脱敏]')
    expect(audit).toEqual({ 地址: 1 })
  })

  it('6 位数字 / 药名剂量不误杀（不过度脱敏到药品数据）', () => {
    const { value, audit } = sanitizeScan({
      batch: '100000',
      quantity: '6',
      specification: '5mg',
      drugName: '苯磺酸氨氯地平片',
      usage: '每次1片 每日1次 共7天',
    })
    expect(value).toEqual({
      batch: '100000',
      quantity: '6',
      specification: '5mg',
      drugName: '苯磺酸氨氯地平片',
      usage: '每次1片 每日1次 共7天',
    })
    expect(audit).toEqual({})
  })

  it('非 1[3-9] 前缀的 11 位数字不当作手机号（精确前缀规则）', () => {
    const { value, audit } = sanitizeScan({ n: '12345678901' })
    expect(value.n).toBe('12345678901')
    expect(audit).toEqual({})
  })

  it('深遍历整个白名单：嵌套 items 内的 PII 被扫到，audit 累加，结构保持', () => {
    const input = {
      hospital: '第一人民医院',
      diagnosis: `高血压 电话${PHONE}`,
      items: [
        { drugName: '氨氯地平片', specification: '5mg', quantity: '14片', usage: `联系${VALID_ID}` },
      ],
    }
    const { value, audit } = sanitizeScan(input)
    expect(value.diagnosis).toBe('高血压 电话[已脱敏]')
    expect(value.items[0].usage).toBe('联系[已脱敏]')
    expect(value.items[0].specification).toBe('5mg') // 药品数据不动
    expect(audit).toEqual({ 手机号: 1, 身份证号: 1 })
  })

  it('身份证优先于手机号：18 位 ID 不被切成 11 位手机号（模式顺序）', () => {
    const audit: Record<string, number> = {}
    const out = scrubValue(VALID_ID, audit)
    expect(out).toBe('[已脱敏]')
    expect(audit).toEqual({ 身份证号: 1 })
    expect(audit['手机号']).toBeUndefined()
  })

  it('审计只记类型→次数，绝不含原文；且不修改入参（纯函数）', () => {
    const input = { contact: PHONE, addr: '广东省深圳市南山区科技路1号' }
    const snapshot = JSON.stringify(input)
    const { audit } = sanitizeScan(input)
    const auditJson = JSON.stringify(audit)
    expect(auditJson).not.toContain(PHONE)
    expect(auditJson).not.toContain('南山')
    expect(JSON.stringify(input)).toBe(snapshot) // 入参未被就地修改
  })

  it('isValidIdChecksum 边界：非 18 位 / 非法字符 → false', () => {
    expect(isValidIdChecksum('12345')).toBe(false)
    expect(isValidIdChecksum('')).toBe(false)
    expect(isValidIdChecksum('1101051949123100YY')).toBe(false)
  })
})
