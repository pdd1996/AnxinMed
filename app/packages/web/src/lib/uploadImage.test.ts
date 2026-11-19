/**
 * H5 上传前压缩（2026-11-20）单测 —— 纯决策 + canvas 编码路径 + 三种「不能压缩就原样上传」的退路。
 *
 * jsdom 没有真 canvas：默认路径（getContext 返回 null）必须**原样返回**，这是测试环境能跑通、
 * 也是老浏览器/隐私模式下的真实行为。成功路径用 fake ctx / fake Image 覆盖。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  dataUrlBytes,
  planUploadShrink,
  shrinkDataUrlForUpload,
  SKIP_RECOMPRESS_BYTES,
  UPLOAD_JPEG_QUALITY,
  UPLOAD_MAX_EDGE,
} from './uploadImage'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const jpeg = (body: string) => `data:image/jpeg;base64,${body}`

/** base64 长度 → 字节数（4 字符 3 字节）。 */
const b64ForBytes = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3))

describe('dataUrlBytes：base64 → 原始字节', () => {
  it('按 4:3 折算并扣除 padding', () => {
    expect(dataUrlBytes(jpeg('AAAA'))).toBe(3) // 4 字符 = 3 字节
    expect(dataUrlBytes(jpeg('AAA='))).toBe(2)
    expect(dataUrlBytes(jpeg('AA=='))).toBe(1)
    expect(dataUrlBytes(jpeg(b64ForBytes(1024)))).toBeGreaterThanOrEqual(1024)
  })

  it('不是 dataURL → 0（不抛）', () => {
    expect(dataUrlBytes('https://example.com/a.jpg')).toBe(0)
    expect(dataUrlBytes('')).toBe(0)
  })
})

describe('planUploadShrink：要缩小就缩，不值得就跳过', () => {
  const big = 5 * 1024 * 1024

  it('长边超限 → 等比缩到目标长边（入口A 2048 / 入口B 1600）', () => {
    expect(planUploadShrink(4000, 3000, big, UPLOAD_MAX_EDGE.B)).toEqual({ width: 1600, height: 1200 })
    expect(planUploadShrink(3000, 4000, big, UPLOAD_MAX_EDGE.A)).toEqual({ width: 1536, height: 2048 })
    expect(UPLOAD_MAX_EDGE).toEqual({ A: 2048, B: 1600 })
  })

  it('尺寸达标但体积超阈值 → 按原尺寸重编码（换掉 PNG/高码率 JPEG）', () => {
    expect(planUploadShrink(1200, 900, big, UPLOAD_MAX_EDGE.B)).toEqual({ width: 1200, height: 900 })
  })

  it('尺寸达标且不超过 900KB → 不重编码（null）', () => {
    expect(planUploadShrink(1200, 900, SKIP_RECOMPRESS_BYTES, UPLOAD_MAX_EDGE.B)).toBeNull()
    expect(planUploadShrink(800, 600, 80 * 1024, UPLOAD_MAX_EDGE.A)).toBeNull()
  })

  it('病态边长（0 / 非数）→ 不碰（null）', () => {
    expect(planUploadShrink(0, 0, big, UPLOAD_MAX_EDGE.B)).toBeNull()
    expect(planUploadShrink(Number.NaN, 100, big, UPLOAD_MAX_EDGE.B)).toBeNull()
  })
})

describe('shrinkDataUrlForUpload：压缩成功与三条退路', () => {
  it('无 canvas（jsdom / 老环境）→ 原样返回，不挂住流程', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const input = jpeg('AAAA')
    expect(await shrinkDataUrlForUpload(input, 'B')).toBe(input)
  })

  it('压缩成功：画到目标尺寸并按 q0.8 出 JPEG', async () => {
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(jpeg('COMPRESSED'))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    stubImage(4000, 3000)

    expect(await shrinkDataUrlForUpload(jpeg(b64ForBytes(5 * 1024 * 1024)), 'B')).toBe(jpeg('COMPRESSED'))
    expect(encode).toHaveBeenCalledWith('image/jpeg', UPLOAD_JPEG_QUALITY)
    // 画布尺寸 = 计划尺寸（入口B 长边 1600）
    expect(encode.mock.contexts.at(-1)).toMatchObject({ width: 1600, height: 1200 })
  })

  it('图片本来就小（尺寸达标 + ≤900KB）→ 不编码，原样返回', async () => {
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    stubImage(1200, 900)

    const input = jpeg('AAAA')
    expect(await shrinkDataUrlForUpload(input, 'B')).toBe(input)
    expect(encode).not.toHaveBeenCalled()
  })

  it('编码失败（toDataURL 回 "data:,"）→ 原样返回，不把空图传上去', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    stubImage(4000, 3000)

    const input = jpeg(b64ForBytes(5 * 1024 * 1024))
    expect(await shrinkDataUrlForUpload(input, 'B')).toBe(input)
  })

  it('解码失败（图片坏了）→ 原样返回', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    stubImage(4000, 3000, { fail: true })

    const input = jpeg('AAAA')
    expect(await shrinkDataUrlForUpload(input, 'A')).toBe(input)
  })
})

/** jsdom 的 Image 不会真的解码：用 fake Image 触发 onload/onerror 并给出原图边长。 */
function stubImage(width: number, height: number, opts: { fail?: boolean } = {}): void {
  class FakeImage {
    naturalWidth = width
    naturalHeight = height
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => (opts.fail ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage)
}
