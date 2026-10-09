/**
 * M2-T8 · 录入页纯逻辑单测（M5-T2 随迁入 core）：失败分支映射 / 质量预检阈值 / 上传前置校验 / 阶段文案。
 * M5-T6b 增：`statsFromRgba` 的手算像素 fixture——web 那份 canvas 数学按 05e §3 不动，
 * 两份拷贝的一致性没有运行时护栏，只能靠这里把三个统计值钉死（05e §7-1）。
 */
import { describe, it, expect } from 'vitest'
import { ERR_CODES } from '@anxin/shared'
import {
  assessQuality,
  CLIENT_ERR_CODES,
  mapIntakeFailure,
  QUALITY_HINTS,
  RETAKE_CHECKLIST,
  SAFETY_NOTE,
  STAGE_TEXT,
  statsFromRgba,
  validateFile,
  type ImageStats,
  type UploadableFile,
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

  // M5-T4：RN 真机最常见的一类失败——请求根本没到服务器。归到「无法可靠识别」会把用户支去重拍好照片。
  it('传输层失败（status 0 / NETWORK_ERROR / TIMEOUT）→ 「连不上服务器」卡：不催重拍、不给换入口', () => {
    for (const input of [
      { status: 0, code: CLIENT_ERR_CODES.NETWORK_ERROR, message: '网络不可达' },
      { status: 0, code: CLIENT_ERR_CODES.TIMEOUT, message: '请求超时' },
      { status: -1, code: CLIENT_ERR_CODES.NETWORK_ERROR, message: '' },
    ]) {
      const fb = mapIntakeFailure(input)
      expect(fb.kind).toBe('unavailable')
      expect(fb.title).toBe('连不上服务器')
      expect(fb.allowSwitch).toBe(false)
      expect(fb.allowManual).toBe(false)
      expect(fb.hints.join('')).toContain('不需要重拍')
      expect(fb.body).not.toBe('') // 空 message 也要有兜底文案，禁空白卡
    }
  })

  it('传输失败文案不得与「识别失败」的重拍清单混用', () => {
    const fb = mapIntakeFailure({ status: 0, code: CLIENT_ERR_CODES.NETWORK_ERROR, message: '网络不可达' })
    expect(fb.hints).not.toEqual(RETAKE_CHECKLIST)
  })
})

describe('validateFile · 上传前置校验（与服务端口径同源）', () => {
  /** 平台无关形状：web 的 File / RN 的 image-picker asset 都满足它。 */
  function file(type: string, size: number): UploadableFile {
    return { name: 'a.png', type, size }
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

describe('statsFromRgba · 手算像素 fixture（RN 解码后的数学与 web canvas 同源）', () => {
  /** 灰度像素阵 → RGBA 字节（行优先、每像素 4 字节、alpha=255）——canvas 与 jpeg-js 的输出同形。 */
  function rgba(rows: number[][]): { data: Uint8ClampedArray; width: number; height: number } {
    const height = rows.length
    const width = rows[0].length
    const data = new Uint8ClampedArray(width * height * 4)
    rows.forEach((row, y) =>
      row.forEach((gray, x) => {
        const i = (y * width + x) * 4
        data[i] = gray
        data[i + 1] = gray
        data[i + 2] = gray
        data[i + 3] = 255
      }),
    )
    return { data, width, height }
  }

  /** 采样网格 → 统计值；原图边长默认 1000×1000（只有 too-small 一条判原图，其余三条判网格）。 */
  function measure(rows: number[][], orig?: { width: number; height: number }) {
    const grid = rgba(rows)
    return statsFromRgba(grid.data, grid.width, grid.height, orig?.width ?? 1000, orig?.height ?? 1000)
  }

  /** 5×5 斜坡：每列比前一列亮 step，行间相同 ⇒ 梯度只来自水平方向（grad=20·step，edges=40）。 */
  const ramp = (step: number) =>
    Array.from({ length: 5 }, () => [100, 100 + step, 100 + 2 * step, 100 + 3 * step, 100 + 4 * step])

  /** 50 像素（5×10）里前 n 个取 246（luma>245 记截断），其余 120。 */
  function highlight(n: number): number[][] {
    const rows: number[][] = []
    let k = 0
    for (let y = 0; y < 5; y++) {
      const row: number[] = []
      for (let x = 0; x < 10; x++) row.push(k++ < n ? 246 : 120)
      rows.push(row)
    }
    return rows
  }

  const flat = (gray: number) => Array.from({ length: 2 }, () => [gray, gray])

  it('三个统计值钉死在数学本身：luma 权重、>245 记截断、梯度均值 /255', () => {
    // 手算 2×2=[[100,246],[100,100]]：luma 即灰度（权重和为 1）⇒ meanLuma=546/4=136.5；
    // 截断像素 1 个 ⇒ clippedRatio=1/4；梯度=|246-100|(首行水平) + |100-246|(垂直)=292，
    // edges=(4-2)+(4-2)=4 ⇒ sharpness=292/4/255
    const stats = measure([[100, 246], [100, 100]])
    expect(stats.meanLuma).toBe(546 / 4)
    expect(stats.clippedRatio).toBe(1 / 4)
    expect(stats.sharpness).toBe(292 / 4 / 255)
    expect(stats.width).toBe(1000)
    expect(stats.height).toBe(1000)
  })

  it('过暗：均匀亮度 60 不命中、59 命中 too-dark（阈值落在下界不误伤）', () => {
    const ok = measure(flat(60))
    const dark = measure(flat(59))
    expect(ok.meanLuma).toBe(60)
    expect(dark.meanLuma).toBeLessThan(60)
    expect(assessQuality(ok)).not.toContain('too-dark')
    expect(assessQuality(dark)).toContain('too-dark')
  })

  it('反光：50 像素里 9 个截断（占比恰 0.18）不命中、10 个命中 glare；恰 245 不记截断', () => {
    expect(measure(flat(245)).clippedRatio).toBe(0)
    expect(assessQuality(measure(highlight(9)))).toEqual([])
    expect(assessQuality(measure(highlight(10)))).toEqual(['glare'])
  })

  it('模糊：每列 +10 的斜坡判模糊、+11 不判（sharpness 阈值 0.02 两侧各一档）', () => {
    expect(measure(ramp(10)).sharpness).toBeCloseTo(200 / 40 / 255, 10)
    expect(assessQuality(measure(ramp(10)))).toEqual(['blurry'])
    expect(assessQuality(measure(ramp(11)))).toEqual([])
  })

  it('分辨率过低：判的是原图边长，不是缩放后的采样网格（480 不命中 / 479 命中）', () => {
    expect(assessQuality(measure(ramp(11), { width: 480, height: 640 }))).toEqual([])
    expect(assessQuality(measure(ramp(11), { width: 479, height: 640 }))).toEqual(['too-small'])
    expect(assessQuality(measure(ramp(11), { width: 4032, height: 479 }))).toEqual(['too-small'])
  })
})
