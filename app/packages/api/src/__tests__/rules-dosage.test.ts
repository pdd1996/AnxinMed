/**
 * M2-T5 · checkDosageRange 单测（说明书范围校验，PRD §8.3）。
 * 覆盖：海露 0.1% golden case（1 滴×4 次/日 ≤ 10 次/日 通过）、频次超标、单次量超标、
 *       无结构化 dosage→none、单位不同不比、等于上限不超、frequency 缺失跳过、basis 溯源、双超标。
 */
import { describe, it, expect } from 'vitest'
import { checkDosageRange, type PackageInsertDosage } from '../services/rules/index.js'

// 海露玻璃酸钠滴眼液 0.1% 说明书（结构化数字，取自 mock-data.json）
const HYCO: PackageInsertDosage = {
  dosage: {
    adult: {
      route: '滴眼',
      usual: '一次 1 滴，一日 3 次，可按需增频',
      frequencyPerDay: 3,
      dosePerUse: { value: 1, unit: '滴' },
      maxFrequencyPerDay: { value: 10, unit: '次', note: '超出需眼科医生指导' },
    },
  },
  source: '海露说明书',
  version: 'v1',
}

describe('checkDosageRange · 说明书范围校验（只标注不阻止）', () => {
  it('海露 golden case：1 滴 × 4 次/日 ≤ 上限 10 次/日 → pass，无超标项', () => {
    const r = checkDosageRange({ dose: { value: 1, unit: '滴' }, frequency: 4 }, HYCO)
    expect(r.status).toBe('pass')
    expect(r.issues).toEqual([])
    expect(r.basis).toBe('海露说明书 · v1')
  })

  it('频次超标（12 次/日 > 上限 10）→ exceed，标注 field/planValue/insertMax/insertNote', () => {
    const r = checkDosageRange({ dose: { value: 1, unit: '滴' }, frequency: 12 }, HYCO)
    expect(r.status).toBe('exceed')
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toEqual({
      field: 'frequency',
      planValue: '12 次/日',
      insertMax: '10 次/日',
      insertNote: '超出需眼科医生指导',
    })
  })

  it('单次用量超标（2 滴 > 常规 1 滴，同单位）→ exceed', () => {
    const r = checkDosageRange({ dose: { value: 2, unit: '滴' }, frequency: 3 }, HYCO)
    expect(r.status).toBe('exceed')
    expect(r.issues[0]).toMatchObject({ field: 'dosePerUse', planValue: '2 滴', insertMax: '1 滴' })
  })

  it('无结构化 dosage（null / 无 adult）→ none + 说明，跳过校验', () => {
    expect(checkDosageRange({ dose: { value: 1, unit: '滴' }, frequency: 99 }, null).status).toBe('none')
    expect(checkDosageRange({ frequency: 99 }, { dosage: null }).status).toBe('none')
    expect(checkDosageRange({ frequency: 99 }, { dosage: { adult: null } }).note).toContain('未收录')
  })

  it('单位不同不猜换算：计划 mg vs 说明书 片 → 不比单次量（只按频次判）', () => {
    const insert: PackageInsertDosage = {
      dosage: { adult: { dosePerUse: { value: 1, unit: '片' }, maxFrequencyPerDay: { value: 3, unit: '次' } } },
      source: 'S',
      version: 'v',
    }
    const r = checkDosageRange({ dose: { value: 500, unit: 'mg' }, frequency: 2 }, insert)
    expect(r.status).toBe('pass')
    expect(r.issues).toEqual([]) // 500mg 与 1片 单位不同，不作比较
  })

  it('频次恰好等于上限（10 == 10）→ 不超标（> 才算超）', () => {
    const r = checkDosageRange({ dose: { value: 1, unit: '滴' }, frequency: 10 }, HYCO)
    expect(r.status).toBe('pass')
  })

  it('frequency 缺失 → 跳过频次检查（不猜）', () => {
    const r = checkDosageRange({ dose: { value: 1, unit: '滴' }, frequency: null }, HYCO)
    expect(r.status).toBe('pass')
    expect(r.issues).toEqual([])
  })

  it('频次 + 单次量双超标 → 两条 issue，仍 exceed（不阻止，交确认页标注）', () => {
    const r = checkDosageRange({ dose: { value: 3, unit: '滴' }, frequency: 20 }, HYCO)
    expect(r.status).toBe('exceed')
    expect(r.issues.map((i) => i.field).sort()).toEqual(['dosePerUse', 'frequency'])
  })

  it('basis 溯源：无 version 时只留 source；均无则 basis 省略', () => {
    expect(checkDosageRange({ frequency: 1 }, { dosage: { adult: {} }, source: '仅来源' }).basis).toBe('仅来源')
    expect(checkDosageRange({ frequency: 1 }, { dosage: { adult: {} } }).basis).toBeUndefined()
  })
})
