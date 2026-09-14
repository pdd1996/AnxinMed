/**
 * MCP 工具注册（ADR #19）——把 T7 医生端守门端点包成 3 个只读工具，接外部 Agent。
 *
 * 工具面即边界：**没有也不允许有 execute_sql / 任意查询类工具**——
 * 模型（无论外部 Agent 还是本应用内 LLM）能决定的只有「调哪个工具 + 填什么参数」，
 * 参数校验（zod）、意图路由、禁 SQL 边界全部留在 API 层复用，本层只转发。
 * 工具清单由测试钉死（mcp-server.test.ts「工具面红线」），新增工具必须同步改测试。
 *
 * 参数 schema 与 API 层入参契约同形（InsightAskRequestSchema / InsightAdherenceSeriesQuerySchema），
 * 双层校验纵深：MCP 层先拦明显非法值，API 层 safeParse 仍是唯一真相。
 */
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { callApi, ApiToolError, type ApiClientOptions } from './api-client.js'

export const MCP_SERVER_NAME = 'anxin-med'
export const MCP_SERVER_VERSION = '0.1.0'

/** 工具名清单（单一真相：注册与测试断言共用，防手滑改名后测试漂移）。 */
export const TOOL_NAMES = ['doctor_ask', 'queue_overview', 'patient_adherence_series'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

/** 工具结果：JSON 文本内容（外部 Agent/LLM 按 JSON 读数据）。 */
function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

/** 失败结果：isError 标记 + 面向用户文案（不含堆栈/连接细节）。 */
function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}

/**
 * 统一守门包装：ApiToolError 透传用户文案；未知异常细节只进 stderr，
 * 返回通用文案——禁静默吞错（错误对模型可见），也禁细节外泄。
 */
async function guarded(run: () => Promise<Record<string, unknown>>) {
  try {
    return jsonResult(await run())
  } catch (err) {
    if (err instanceof ApiToolError) return errorResult(err.userMessage)
    console.error('[mcp] 工具执行异常', err)
    return errorResult('工具执行失败，请稍后重试')
  }
}

export function createMcpServer(opts: ApiClientOptions): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        '安心用药医生端只读数据服务。数字全部来自安心用药 API 的守门端点（固定问法 0 次 LLM 直查库），' +
        '不提供任意 SQL 查询能力；patientId 为空 = 队列维度，非空 = 患者维度。',
    },
  )

  // ── doctor_ask：医生问答（两级意图路由——固定问法 0 次 LLM 直查库，长尾服务端 LLM 叙述）──
  server.registerTool(
    'doctor_ask',
    {
      title: '医生问答',
      description:
        '向安心用药医生端提问并返回结构化回答。队列表格/分档/风险事件等固定问法直接返回数据库统计；' +
        '长尾问法由服务端 LLM 基于工具统计结果叙述。不提供任意 SQL 查询能力。',
      inputSchema: {
        question: z
          .string()
          .min(1)
          .max(200)
          .describe('医生问题，例如「依从性分布怎么样？」「执行率差的患者有哪些？」'),
        patientId: z
          .string()
          .min(1)
          .optional()
          .describe('患者 id；缺省 = 队列维度问法，传入 = 患者维度问法（如「他最近依从性怎么样？」）'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ question, patientId }) =>
      guarded(() =>
        callApi(
          '/api/insight/ask',
          {
            method: 'POST',
            // patientId 为 undefined 时不出现在请求体（= API 层的 nullish 缺省，队列维度）
            body: patientId === undefined ? { question } : { question, patientId },
          },
          opts,
        ),
      ),
  )

  // ── queue_overview：队列视图（分档统计 + 患者表 + 事件时间线，0 次 LLM 直查库）──
  server.registerTool(
    'queue_overview',
    {
      title: '队列总览',
      description:
        '获取患者队列总览：30 天窗口的依从性分档统计（good/fair/poor/ungraded）、患者列表与风险事件时间线。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => guarded(() => callApi('/api/insight/queue', { method: 'GET' }, opts)),
  )

  // ── patient_adherence_series：患者下钻打卡时序（按日序列 + 按药品聚合 + 窗口合计）──
  server.registerTool(
    'patient_adherence_series',
    {
      title: '患者打卡时序',
      description: '获取指定患者的按日打卡序列（taken/skipped/later/expected）、按药品聚合与窗口依从率。',
      inputSchema: {
        patientId: z.string().min(1).describe('患者 id（users.id）'),
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(30)
          .describe('统计窗口天数，1–90，默认 30'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId, days }) =>
      guarded(() =>
        callApi(
          `/api/insight/patients/${encodeURIComponent(patientId)}/adherence-series?days=${days}`,
          { method: 'GET' },
          opts,
        ),
      ),
  )

  return server
}
