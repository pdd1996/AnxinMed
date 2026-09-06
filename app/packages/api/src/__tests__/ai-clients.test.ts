/**
 * M2-T1 单测：三个 AI 客户端的「请求体组装 + 错误映射」，不真调 API（fetch mock）。
 * 覆盖：请求体只含约定字段；safeParse 失败抛 AIUnavailableError；网络/5xx 重试后冒泡；4xx 不重试；缺 env 配置冒泡。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildDetectLayersRequest,
  buildExtractIdentityRequest,
  buildFallbackParseRequest,
  buildOcrRequest,
} from '../lib/ai/index.js'
import * as qwen from '../lib/ai/qwen.js'
import * as ocr from '../lib/ai/ocr.js'
import * as baichuan from '../lib/ai/baichuan.js'
import { AIUnavailableError, type ImageInput } from '../lib/ai/types.js'

const IMG: ImageInput = { base64: 'aW1n', mime: 'image/png' }

function mkRes(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
function chatRes(content: unknown) {
  return mkRes({ choices: [{ message: { content: JSON.stringify(content) } }] })
}

const savedEnv = { ...process.env }

beforeEach(() => {
  process.env.QWEN_BASE_URL = 'http://qwen.test'
  process.env.QWEN_API_KEY = 'qk'
  process.env.BAICHUAN_BASE_URL = 'http://bc.test'
  process.env.BAICHUAN_API_KEY = 'bk'
  process.env.OCR_BASE_URL = 'http://ocr.test'
})
afterEach(() => {
  process.env = { ...savedEnv }
  vi.unstubAllGlobals()
})

describe('请求体组装（纯函数，只含约定字段）', () => {
  it('qwen 层检测请求体仅含 model/temperature/messages，且带图像 dataUrl', () => {
    const body = buildDetectLayersRequest(IMG)
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'temperature'])
    const content = (body.messages[0] as { content: { type: string; image_url?: { url: string } }[] }).content
    expect(content.some((c) => c.type === 'image_url' && c.image_url!.url.startsWith('data:image/png;base64,'))).toBe(true)
  })

  it('qwen 身份提取请求体不含用法用量字样于图像之外（结构无剂量字段）', () => {
    const body = buildExtractIdentityRequest(IMG)
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'temperature'])
  })

  it('baichuan 兜底请求体只含白名单文本与缺项字段，不含图像', () => {
    const body = buildFallbackParseRequest('Rp 苯磺酸氨氯地平片 5mg×14片', ['frequency'])
    const text = JSON.stringify(body)
    expect(text).toContain('苯磺酸氨氯地平片')
    expect(text).toContain('frequency')
    expect(text).not.toContain('base64')
    expect(text).not.toContain('image_url')
  })

  it('ocr 请求体只含图像 base64/mime', () => {
    expect(buildOcrRequest(IMG)).toEqual({ image: 'aW1n', mime: 'image/png' })
  })
})

describe('qwen 客户端', () => {
  it('detectLayers 成功解析模型输出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes(['处方层', '医院标签层'])))
    await expect(qwen.detectLayers(IMG)).resolves.toEqual(['处方层', '医院标签层'])
  })

  it('detectLayers 模型输出非法 → AIUnavailableError（不猜）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes(['不存在的层'])))
    await expect(qwen.detectLayers(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('extractIdentity 缺 genericName → AIUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes({ specification: '5mg' })))
    await expect(qwen.extractIdentity(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('extractIdentity 成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes({ genericName: '苯磺酸氨氯地平片', specification: '5mg' })))
    await expect(qwen.extractIdentity(IMG)).resolves.toMatchObject({ genericName: '苯磺酸氨氯地平片' })
  })

  it('缺 QWEN_API_KEY → AIUnavailableError', async () => {
    delete process.env.QWEN_API_KEY
    vi.stubGlobal('fetch', vi.fn())
    await expect(qwen.detectLayers(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('ocr 客户端', () => {
  it('runOcr 成功返回字符级置信度+坐标', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mkRes({ chars: [{ text: 'Rp', confidence: 0.99, box: { x: 1, y: 2, w: 3, h: 4 } }] })))
    const r = await ocr.runOcr(IMG)
    expect(r.chars[0]).toMatchObject({ text: 'Rp', confidence: 0.99 })
  })

  it('runOcr 响应缺坐标 → AIUnavailableError（硬要求不放过）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mkRes({ chars: [{ text: 'Rp', confidence: 0.9 }] })))
    await expect(ocr.runOcr(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('缺 OCR_BASE_URL → AIUnavailableError', async () => {
    delete process.env.OCR_BASE_URL
    vi.stubGlobal('fetch', vi.fn())
    await expect(ocr.runOcr(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
  })
})

describe('baichuan 客户端', () => {
  it('fallbackParse 成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes({ frequency: '1' })))
    await expect(baichuan.fallbackParse('Rp ...', ['frequency'])).resolves.toEqual({ frequency: '1' })
  })

  it('fallbackParse 输出非对象 → AIUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes(['x'])))
    await expect(baichuan.fallbackParse('Rp ...', ['frequency'])).rejects.toBeInstanceOf(AIUnavailableError)
  })
})

describe('错误映射与重试（AIUnavailableError 冒泡）', () => {
  it('网络失败重试 1 次后冒泡 AIUnavailableError', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    vi.stubGlobal('fetch', f)
    await expect(qwen.detectLayers(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
    expect(f).toHaveBeenCalledTimes(2) // 1 次 + 1 次重试
  })

  it('5xx 重试 1 次后冒泡', async () => {
    const f = vi.fn(async () => mkRes({}, 500))
    vi.stubGlobal('fetch', f)
    await expect(ocr.runOcr(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('4xx 不重试，直接冒泡', async () => {
    const f = vi.fn(async () => mkRes({}, 404))
    vi.stubGlobal('fetch', f)
    await expect(baichuan.fallbackParse('t', ['f'])).rejects.toBeInstanceOf(AIUnavailableError)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
