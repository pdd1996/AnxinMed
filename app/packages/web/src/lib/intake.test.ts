/**
 * M2-T8 · 录入页纯逻辑单测：失败分支映射（看得见地失败）/ 质量预检阈值 / 上传前置校验 / 阶段文案。
 */
import { describe, it, expect } from 'vitest'
import { ERR_CODES } from '@anxin/shared'
import {
  assessQuality,
  mapIntakeFailure,
  QUALITY_HINTS,
  RETAKE_CHECKLIST,
  SAFETY_NOTE,
  STAGE_TEXT,
  validateFile,
  type ImageStats,
} from './intake'

const good: ImageStats = { meanLuma: 140, clippedRatio: 0.02, sharpness: 0.09, width: 1600, height: 1200 }

describe('assessQuality · 本地质量预检阈值', () => {
  it('正常照片 → 无问题', () => {
    expect(assessQuality(good)).toEqual([])
  })
  it('过暗 / 反光 / 模糊 / 分辨率过低各自命中，且都有具体重拍建议', () => {
    expect(assessQuality({ ...good, meanLuma: 30 })).toEqual(['too-dark'])
    expect(assessQuality({ ...good, clippedRatio: 0.4 })).toEqual(['glare'])
    expect(assessQuality({ ...good, sharpness: 0.005 })).toEqual(['blurry'])
    expect(assessQuality({ ...good, width: 320, height: 240 })).toEqual(['too-small'])
    for (const issue of assessQuality({ meanLuma: 10, clippedRatio: 0.9, sharpness: 0.001, width: 100, height: 100 })) {
      expect(QUALITY_HINTS[issue].length).toBeGreaterThan(4)
    }
  })
  it('边界值不误报（阈值之上/之下各一档）', () => {
    expect(assessQuality({ ...good, meanLuma: 60 })).toEqual([])
    expect(assessQuality({ ...good, meanLuma: 59 })).toEqual(['too-dark'])
    expect(assessQuality({ ...good, clippedRatio: 0.18 })).toEqual([])
    expect(assessQuality({ ...good, sharpness: 0.02 })).toEqual([])
  })
})

describe('mapIntakeFailure · 失败分支必须可见且可行动', () => {
  it('422 UNSUPPORTED_OBJECT → 不支持卡：安全提示 + 手动建档 + 换入口', () => {
    const fb = mapIntakeFailure({
      status: 422,
      code: ERR_CODES.UNSUPPORTED_OBJECT,
      message: '层检测不支持该对象（如散装药片）。',
      details: { detected: ['不支持'] },
    })
    expect(fb.kind).toBe('unsupported')
    expect(fb.detected).toEqual(['不支持'])
    expect(fb.allowManual).toBe(true)
    expect(fb.allowSwitch).toBe(true)
    expect(fb.hints.join('')).toContain('手动建档')
  })

  it('409 LAYER_MISMATCH → 纠偏卡：body 用服务端 suggestion，不静默改道', () => {
    const suggestion = '检测到处方层。你选择的是「拍药品」，是否切换到「拍处方笺」入口？'
    const fb = mapIntakeFailure({
      status: 409,
      code: ERR_CODES.LAYER_MISMATCH,
      message: suggestion,
      details: { detected: ['处方层'], suggestion },
    })
    expect(fb.kind).toBe('mismatch')
    expect(fb.body).toBe(suggestion)
    expect(fb.detected).toEqual(['处方层'])
    expect(fb.allowManual).toBe(false) // 纠偏不是建档问题，不给手动建档误导
    expect(fb.allowSwitch).toBe(true)
  })

  it('503 AI_UNAVAILABLE → 降级卡：引导手动建档，且说明照片不必重拍', () => {
    const fb = mapIntakeFailure({
      status: 503,
      code: ERR_CODES.AI_UNAVAILABLE,
      message: '识别服务暂不可用，请稍后重试，或改用「手动建档」录入',
    })
    expect(fb.kind).toBe('unavailable')
    expect(fb.allowManual).toBe(true)
    expect(fb.hints.join('')).toContain('不需要重拍')
  })

  it('未知失败 → 通用卡：附完整重拍清单 + 安全提示常量可用', () => {
    const fb = mapIntakeFailure({ status: 500, code: 'INTERNAL', message: '服务器内部错误' })
    expect(fb.kind).toBe('generic')
    expect(fb.hints).toEqual(RETAKE_CHECKLIST)
    expect(SAFETY_NOTE).toContain('请勿根据本次结果服药')
  })

  it('details 缺失/畸形不炸（detected 非数组、suggestion 非字符串）', () => {
    const fb = mapIntakeFailure({ status: 409, code: ERR_CODES.LAYER_MISMATCH, message: 'x', details: { detected: '处方层', suggestion: 42 } })
    expect(fb.detected).toEqual([])
    expect(fb.body).toBe('x')
  })
})

describe('validateFile · 上传前置校验（与服务端口径同源）', () => {
  /** size 用 defineProperty 伪造，避免真分配十几 MB 内存。 */
  function file(type: string, size: number): File {
    const f = new File([new Uint8Array(8)], 'a.png', { type })
    Object.defineProperty(f, 'size', { value: size })
    return f
  }
  it('类型与大小合法 → null', () => {
    expect(validateFile(file('image/png', 1024))).toBeNull()
    expect(validateFile(file('image/jpeg', 1024))).toBeNull()
    expect(validateFile(file('image/webp', 1024))).toBeNull()
  })
  it('非法类型 / 超 15MB → 用户可理解的拒绝原因', () => {
    expect(validateFile(file('image/gif', 1024))).toContain('JPG')
    expect(validateFile(file('application/pdf', 1024))).toContain('JPG')
    expect(validateFile(file('image/png', 16 * 1024 * 1024))).toContain('15MB')
  })
})

describe('STAGE_TEXT · 处理中状态文案', () => {
  it('入口A 五阶段（层检测→识别→解析→匹配→汇合）、入口B 四阶段（无医嘱线）', () => {
    expect(STAGE_TEXT.A).toHaveLength(5)
    expect(STAGE_TEXT.B).toHaveLength(4)
    expect(STAGE_TEXT.A[0]).toContain('层检测')
    expect(STAGE_TEXT.B.join('')).not.toContain('OCR') // 入口B 不走医嘱线
    expect(STAGE_TEXT.B.join('')).toContain('不提取用法用量')
  })
})
