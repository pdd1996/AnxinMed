/**
 * MCP Server 测试（ADR #19）——InMemoryTransport 进程内直连 + fetch 打桩。
 *
 * 覆盖四类边界（对齐文章「先在本地把边界测出来」清单的 MCP 版）：
 * 1. 工具面红线：tools/list 恰好 3 个只读工具，**不存在 execute_sql / 任意查询类工具**；
 * 2. 转发正确性：method / path / body / query 与既有守门端点契约一致，patientId 缺省不出现在 body；
 * 3. 错误映射：API 4xx 透传用户文案（code + message），网络失败只给通用提示——
 *    isError 可见不静默，且堆栈/连接细节绝不进入工具结果；
 * 4. 参数校验：days 超窗（>90）在进入转发前被拒。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer, TOOL_NAMES } from './server.js'
import { loadConfig } from './config.js'

const BASE = 'http://api.test'

async function connect(): Promise<Client> {
  const server = createMcpServer({ baseUrl: BASE, timeoutMs: 1_000 })
  const client = new Client({ name: 'test-client', version: '0.0.1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

/** fetch 桩：记录调用并按脚本应答；返回 vi.mock 对象供断言。 */
function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const script = responses.shift()
    if (!script) throw new Error('测试脚本耗尽：出现了未预期的多余请求')
    return new Response(JSON.stringify(script.body), {
      status: script.status,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function textOf(result: CallToolResult): string {
  return (result.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
}

beforeEach(() => {
  // 守门包装把未知异常细节写 stderr；测试里静音避免噪音。
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 工具面红线：不存在 SQL 面
// ---------------------------------------------------------------------------

describe('工具面红线（ADR #19）', () => {
  it('tools/list 恰好 3 个只读工具，不含任何 SQL/任意查询类工具', async () => {
    const client = await connect()
    const { tools } = await client.listTools()

    expect([...tools.map((t) => t.name)].sort()).toEqual([...TOOL_NAMES].sort())
    expect(tools.map((t) => t.name)).not.toEqual(expect.arrayContaining([expect.stringMatching(/sql|query|execute/i)]))
    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.annotations?.readOnlyHint).toBe(true)
    }
  })

  it('TOOL_NAMES 常量本身也不含 SQL 类命名（防后续手滑扩面）', () => {
    for (const name of TOOL_NAMES) expect(name).not.toMatch(/sql|execute|raw/i)
  })
})

// ---------------------------------------------------------------------------
// 转发正确性
// ---------------------------------------------------------------------------

describe('doctor_ask', () => {
  it('POST /api/insight/ask 转发 question+patientId，返回结构化数据', async () => {
    const askResponse = {
      ok: true,
      mode: 'data',
      riskLevel: 'L1',
      sections: { summary: '共 8 名患者，good 3 人' },
      toolUsed: 'adherence_distribution',
      citations: ['本地队列数据（演示数据，未经医学审核）'],
    }
    const fetchMock = stubFetch([{ status: 200, body: askResponse }])
    const client = await connect()

    const result = (await client.callTool({
      name: 'doctor_ask',
      arguments: { question: '依从性分布怎么样？', patientId: 'p-001' },
    })) as CallToolResult

    expect(result.isError).toBeUndefined()
    expect(JSON.parse(textOf(result))).toEqual(askResponse)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/api/insight/ask`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ question: '依从性分布怎么样？', patientId: 'p-001' })
  })

  it('patientId 缺省 = 队列维度：请求体不携带 patientId 键', async () => {
    const fetchMock = stubFetch([{ status: 200, body: { ok: true, mode: 'data' } }])
    const client = await connect()

    await client.callTool({ name: 'doctor_ask', arguments: { question: '依从性分布怎么样？' } })

    const [, init] = fetchMock.mock.calls[0]
    expect(Object.keys(JSON.parse(String(init?.body)))).toEqual(['question'])
  })
})

describe('queue_overview', () => {
  it('GET /api/insight/queue 转发，无参数', async () => {
    const fetchMock = stubFetch([{ status: 200, body: { ok: true, total: 8, grades: { good: 3, fair: 2, poor: 2, ungraded: 1 } } }])
    const client = await connect()

    const result = (await client.callTool({ name: 'queue_overview', arguments: {} })) as CallToolResult

    expect(result.isError).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/api/insight/queue`)
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })
})

describe('patient_adherence_series', () => {
  it('GET days 缺省补 30，patientId 进路径并 encodeURIComponent', async () => {
    const fetchMock = stubFetch([{ status: 200, body: { ok: true, patientId: 'p/1', days: 30 } }])
    const client = await connect()

    await client.callTool({ name: 'patient_adherence_series', arguments: { patientId: 'p/1' } })

    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/api/insight/patients/p%2F1/adherence-series?days=30`)
  })

  it('days 超窗（200 > 90）在转发前被拒（isError，且不发起 HTTP 请求）', async () => {
    const fetchMock = stubFetch([])
    const client = await connect()

    // SDK 版本差异：schema 校验失败可能返回 isError 结果或抛 McpError，两种都算拦截成功。
    let blocked = false
    let detail = ''
    try {
      const result = (await client.callTool({
        name: 'patient_adherence_series',
        arguments: { patientId: 'p-001', days: 200 },
      })) as CallToolResult
      if (result.isError) {
        blocked = true
        detail = textOf(result)
      }
    } catch (err) {
      blocked = true
      detail = String((err as Error).message)
    }

    expect(blocked).toBe(true)
    expect(detail + '').toMatch(/days|90/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 错误映射（不静默，也不外泄细节）
// ---------------------------------------------------------------------------

describe('错误映射', () => {
  it('API 4xx：isError 结果透传 code + 用户可读文案，不含堆栈', async () => {
    stubFetch([{ status: 404, body: { ok: false, code: 'NOT_FOUND', message: '未找到该患者，请确认 patientId' } }])
    const client = await connect()

    const result = (await client.callTool({
      name: 'doctor_ask',
      arguments: { question: '他最近依从性怎么样？', patientId: 'no-such' },
    })) as CallToolResult

    expect(result.isError).toBe(true)
    const text = textOf(result)
    expect(text).toContain('NOT_FOUND')
    expect(text).toContain('未找到该患者')
    expect(text).not.toMatch(/at\s+\w+\s+\(|stack/i)
  })

  it('网络失败：isError 通用提示可操作，拒绝细节不进入工具结果', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:8787')
      }),
    )
    const client = await connect()

    const result = (await client.callTool({ name: 'queue_overview', arguments: {} })) as CallToolResult

    expect(result.isError).toBe(true)
    const text = textOf(result)
    expect(text).toContain('无法连接安心用药 API')
    expect(text).not.toContain('ECONNREFUSED')
  })

  it('非 JSON 响应（网关错误页）：按 HTTP 状态映射，不解析外泄', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })),
    )
    const client = await connect()

    const result = (await client.callTool({ name: 'queue_overview', arguments: {} })) as CallToolResult

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('502')
  })
})

// ---------------------------------------------------------------------------
// 配置加载
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  it('默认指向本机 8787，去除尾部斜杠', () => {
    const cfg = loadConfig({ ANXIN_API_BASE_URL: 'http://127.0.0.1:8787/' })
    expect(cfg.baseUrl).toBe('http://127.0.0.1:8787')
    expect(cfg.timeoutMs).toBe(10_000)
    expect(cfg.token).toBeUndefined()
  })

  it('非法 base URL / 超时 fail-fast 抛错（不静默回退）', () => {
    expect(() => loadConfig({ ANXIN_API_BASE_URL: 'ftp://x' })).toThrow(/ANXIN_API_BASE_URL/)
    expect(() => loadConfig({ ANXIN_API_TIMEOUT_MS: '-5' })).toThrow(/ANXIN_API_TIMEOUT_MS/)
  })
})
