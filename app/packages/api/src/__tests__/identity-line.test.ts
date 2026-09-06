/**
 * M2-T4 · 身份线编排 + safeParse 边界单测。
 * identifyDrug（DI mock，不真调模型）：成功编排 / 多候选透传 / AIUnavailableError 冒泡不吞。
 * 真实 qwen + fetch mock（T4 完成标准）：extractIdentity 剥离用法用量字段（药盒层永不提取用法用量）、
 * extractIdentity/detectLayers 的 safeParse 失败分支（mock 非法模型输出）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { identifyDrug, type DrugMasterCandidate } from '../services/identity/index.js'
import * as qwen from '../lib/ai/qwen.js'
import { AIUnavailableError, type AiClients, type IdentityFields, type ImageInput } from '../lib/ai/types.js'

const IMG: ImageInput = { base64: 'aW1n', mime: 'image/png' }
const ATORVA: DrugMasterCandidate = { id: 'drug-atorvastatin-20', genericName: '阿托伐他汀钙片', specification: '20mg', form: '片剂' }

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
})
afterEach(() => {
  process.env = { ...savedEnv }
  vi.unstubAllGlobals()
})

describe('identifyDrug · 身份线编排（DI mock）', () => {
  it('成功：extractIdentity → matchDrugMaster，返回 identity + unique 匹配', async () => {
    const clients: Pick<AiClients, 'extractIdentity'> = {
      extractIdentity: async (): Promise<IdentityFields> => ({ genericName: '阿托伐他汀钙片', specification: '20mg', form: '片剂' }),
    }
    const out = await identifyDrug(IMG, clients, [ATORVA])
    expect(out.identity.genericName).toBe('阿托伐他汀钙片')
    expect(out.result.status).toBe('unique')
    expect(out.result.match?.id).toBe('drug-atorvastatin-20')
  })

  it('多候选 → ambiguous，候选清单透传（交确认页，不自动裁决）', async () => {
    const clients: Pick<AiClients, 'extractIdentity'> = {
      extractIdentity: async (): Promise<IdentityFields> => ({ genericName: '阿托伐他汀钙片', specification: '20mg', form: '片剂' }),
    }
    const dup: DrugMasterCandidate = { id: 'drug-atorvastatin-20b', genericName: '阿托伐他汀钙片', specification: '20mg', form: '片剂' }
    const out = await identifyDrug(IMG, clients, [ATORVA, dup])
    expect(out.result.status).toBe('ambiguous')
    expect(out.result.candidates).toHaveLength(2)
  })

  it('extractIdentity 抛 AIUnavailableError → identifyDrug 不吞、原样冒泡（上层降级）', async () => {
    const clients: Pick<AiClients, 'extractIdentity'> = {
      extractIdentity: async (): Promise<IdentityFields> => {
        throw new AIUnavailableError('qwen', '模型超时')
      },
    }
    await expect(identifyDrug(IMG, clients, [ATORVA])).rejects.toBeInstanceOf(AIUnavailableError)
  })
})

describe('身份线 safeParse 边界（真实 qwen + fetch mock）', () => {
  it('extractIdentity 剥离用法用量字段：模型即使返回 dose/frequency/usage 也被 zod 剥掉（药盒层永不提取用法用量）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => chatRes({ genericName: '阿托伐他汀钙片', specification: '20mg', dose: '每次1片', frequency: 1, usage: '口服' })),
    )
    const id = await qwen.extractIdentity(IMG)
    expect(id).toEqual({ genericName: '阿托伐他汀钙片', specification: '20mg' })
    expect(id).not.toHaveProperty('dose')
    expect(id).not.toHaveProperty('frequency')
    expect(id).not.toHaveProperty('usage')
  })

  it('extractIdentity 非法输出（缺 genericName）→ AIUnavailableError（safeParse 失败分支，不猜）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes({ specification: '20mg' })))
    await expect(qwen.extractIdentity(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('detectLayers 非法层标签 → AIUnavailableError（safeParse 失败分支，不猜）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes(['不存在的层'])))
    await expect(qwen.detectLayers(IMG)).rejects.toBeInstanceOf(AIUnavailableError)
  })

  it('detectLayers 合法多选 → 正常返回枚举数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatRes(['药盒原装层', '医院标签层'])))
    await expect(qwen.detectLayers(IMG)).resolves.toEqual(['药盒原装层', '医院标签层'])
  })
})
