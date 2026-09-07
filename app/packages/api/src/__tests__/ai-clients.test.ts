/**
 * M2-T1 单测：三个 AI 客户端的「请求体组装 + 错误映射」，不真调 API（fetch mock）。
 * 覆盖：请求体只含约定字段；safeParse 失败抛 AIUnavailableError；网络/5xx 重试（退避后）后冒泡；
 * 4xx 不重试；缺 env 配置冒泡。OCR 为 qwen3.5-ocr chat 形态（行级转录）。
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
  process.env.OCR_API_KEY = 'ok'
  delete process.env.OCR_MODEL // 默认模型名断言不受外部环境污染
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

describe('ocr 客户端（qwen3.5-ocr 行级转录）', () => {
  it('buildOcrRequest 为 OpenAI chat 形态：含转录 prompt + image_url dataURL，顶层无 Paddle 的 image/mime 字段', () => {
    const body = buildOcrRequest(IMG)
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'temperature'])
    expect(body.model).toBe('qwen3.5-ocr') // 默认模型名
    expect(body.temperature).toBe(0)
    const msg = body.messages[0] as {
      role: string
      content: { type: string; text?: string; image_url?: { url: string } }[]
    }
    expect(msg.role).toBe('user')
    expect(msg.content.some((c) => c.type === 'text' && c.text!.includes('逐行转录'))).toBe(true)
    expect(msg.content.some((c) => c.type === 'image_url' && c.image_url!.url === 'data:image/png;base64,aW1n')).toBe(true)
    // 旧 Paddle 形态字段彻底退役
    expect('image' in body).toBe(false)
    expect('mime' in body).toBe(false)
  })

  it('OCR_MODEL 环境变量可覆盖默认模型名', () => {
    process.env.OCR_MODEL = 'qwen3.5-ocr-custom'
    expect(buildOcrRequest(IMG).model).toBe('qwen3.5-ocr-custom')
  })

  it('多行 content → lines 正确规整（去代码栅栏、逐行 trim、去空行，行序保持）', async () => {
    const content = '```\nRp\n  玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支  \n\n\n用法：滴眼 每次1滴 每日4次 共7天\n```'
    vi.stubGlobal('fetch', vi.fn(async () => mkRes({ choices: [{ message: { content } }] })))
    const r = await ocr.runOcr(IMG)
    expect(r.lines).toEqual(['Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支', '用法：滴眼 每次1滴 每日4次 共7天'])
  })

  it('content 首尾带空白时栅栏仍被剥离（先 trim 再 strip，无 ``` 残留行）', async () => {
    const content = '  \n```\nRp\n玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支\n```  \n'
    vi.stubGlobal('fetch', vi.fn(async () => mkRes({ choices: [{ message: { content } }] })))
    const r = await ocr.runOcr(IMG)
    expect(r.lines).toEqual(['Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支'])
    expect(r.lines.some((l) => l.includes('```'))).toBe(false) // 无栅栏残留行
  })

  it('content 为空字符串 → AIUnavailableError（extractChatContent 拦截，不猜）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mkRes({ choices: [{ message: { content: '' } }] })))
    await expect(ocr.runOcr(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('content 全空白 → 规整后空转录 safeParse 失败 → AIUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mkRes({ choices: [{ message: { content: ' \n\n  \t' } }] })))
    await expect(ocr.runOcr(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('缺 OCR_BASE_URL 或 OCR_API_KEY → AIUnavailableError（不发请求）', async () => {
    vi.stubGlobal('fetch', vi.fn())
    delete process.env.OCR_BASE_URL
    await expect(ocr.runOcr(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
    process.env.OCR_BASE_URL = 'http://ocr.test'
    delete process.env.OCR_API_KEY
    await expect(ocr.runOcr(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('5xx → 退避 500ms+抖动后重试 1 次，仍失败冒泡 AIUnavailableError（新路径）', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0) // 抖动固定 0 → 退避恰 500ms
    try {
      const f = vi.fn(async () => mkRes({}, 500))
      vi.stubGlobal('fetch', f)
      const p = expect(ocr.runOcr(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
      await vi.advanceTimersByTimeAsync(499)
      expect(f).toHaveBeenCalledTimes(1) // 退避未满 500ms，不发第二次
      await vi.advanceTimersByTimeAsync(1)
      expect(f).toHaveBeenCalledTimes(2) // 500ms 到点，第二次 fetch 才发生
      await p
    } finally {
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
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

  it('4xx 不重试，直接冒泡', async () => {
    const f = vi.fn(async () => mkRes({}, 404))
    vi.stubGlobal('fetch', f)
    await expect(baichuan.fallbackParse('t', ['f'])).rejects.toBeInstanceOf(AIUnavailableError)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
