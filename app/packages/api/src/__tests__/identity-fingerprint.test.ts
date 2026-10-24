/**
 * 资产域身份指纹单测（2026-10-24）。
 * 覆盖：规格/厂家/主批号参与指纹；分包装批号/分包装企业不参与；通用名层稳定；来源文档以文件哈希优先。
 */
import { describe, it, expect } from 'vitest'
import {
  inferProductType,
  makeGenericId,
  makeIdentityKey,
  makeSourceDocumentId,
} from '../db/identity.js'

const base = {
  genericName: '测试片',
  specification: '5mg',
  form: '片剂',
  manufacturer: '甲厂',
  repackager: '乙分装厂',
  approvalNumbers: ['国药准字H00000001', '国药准字H00000002(分包装)'],
}

describe('makeIdentityKey · 产品身份指纹', () => {
  it('分包装批号不参与指纹（同一产品多文号不拆条）', () => {
    const a = makeIdentityKey(base)
    const b = makeIdentityKey({ ...base, approvalNumbers: ['国药准字H00000001'] })
    expect(a).toBe(b)
  })

  it('分包装企业不参与指纹', () => {
    const a = makeIdentityKey(base)
    const b = makeIdentityKey({ ...base, repackager: '另一家分装厂' })
    expect(a).toBe(b)
  })

  it('规格不同 → 指纹不同', () => {
    expect(makeIdentityKey(base)).not.toBe(makeIdentityKey({ ...base, specification: '10mg' }))
  })

  it('厂家不同 → 指纹不同', () => {
    expect(makeIdentityKey(base)).not.toBe(makeIdentityKey({ ...base, manufacturer: '丙厂' }))
  })

  it('空白差异归一化 → 指纹相同', () => {
    const a = makeIdentityKey(base)
    const b = makeIdentityKey({ ...base, genericName: ' 测试 片 ' })
    expect(a).toBe(b)
  })
})

describe('makeGenericId · 通用名层', () => {
  it('同通用名+剂型 → 同 ID（多厂家共用）', () => {
    const a = makeGenericId({ genericName: '测试片', form: '片剂' })
    const b = makeGenericId({ genericName: '测试片', form: '片剂' })
    expect(a).toBe(b)
    expect(a).toMatch(/^dg-[a-f0-9]{16}$/)
  })

  it('剂型不同 → 不同 ID', () => {
    expect(makeGenericId({ genericName: '测试片', form: '片剂' })).not.toBe(
      makeGenericId({ genericName: '测试片', form: '胶囊' }),
    )
  })
})

describe('makeSourceDocumentId · 来源文档', () => {
  it('有文件哈希时优先用文件哈希', () => {
    const a = makeSourceDocumentId({ sourceFileHash: 'a'.repeat(64) }, 'b'.repeat(64))
    const b = makeSourceDocumentId({ sourceFileHash: 'a'.repeat(64) }, 'c'.repeat(64))
    expect(a).toBe(b)
    expect(a).toMatch(/^sd-[a-f0-9]{16}$/)
  })

  it('无文件哈希时退内容哈希', () => {
    const a = makeSourceDocumentId({}, 'b'.repeat(64))
    const b = makeSourceDocumentId({}, 'c'.repeat(64))
    expect(a).not.toBe(b)
  })
})

describe('inferProductType · 产品类型', () => {
  it('中药材（无药品名称段）', () => {
    expect(inferProductType('丁香', '中药材', [])).toBe('中药材')
  })

  it('中成药（国药准字Z）', () => {
    expect(inferProductType('感冒灵颗粒', '颗粒', ['国药准字Z123'])).toBe('中成药')
  })

  it('生物制品（国药准字S）', () => {
    expect(inferProductType('人血白蛋白', '注射液', ['国药准字S123'])).toBe('生物制品')
  })

  it('有批准文号的其余产品 → 化学药', () => {
    expect(inferProductType('测试片', '片剂', ['国药准字H123'])).toBe('化学药')
  })

  it('无批准文号且无法判断 → null（不猜）', () => {
    expect(inferProductType('测试片', '片剂', [])).toBeNull()
  })
})
