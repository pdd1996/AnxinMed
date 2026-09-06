import { hc } from 'hono/client'
import { toast } from 'sonner'
import type { AppType } from '@anxin/api'
import type { DraftConfirm } from '@anxin/shared'

/**
 * hc<AppType> 端到端类型客户端（技术方案 §1）。
 * AppType 为 type-only 导入，构建期擦除，不把 api 运行时代码（serve/db）带进 web（执行总纲 §3.1）。
 * baseUrl '/'：dev 经 vite 代理 /api→8787，prod 由 Hono 同源托管，均用相对路径。
 */
export const client = hc<AppType>('/')

/**
 * 统一拆包 + 错误 toast：res.ok 或 body.ok 为假时，解析 { ok:false, code, message } → toast 报错并抛错。
 * 成功返回精确响应体（hc<AppType> 推导）。禁止静默吞错（执行总纲 §0.5）。
 */
export async function unwrap<T extends { ok: boolean }>(
  res: { ok: boolean; json(): Promise<T> },
): Promise<T> {
  const body = await res.json()
  if (!res.ok || !body.ok) {
    const err = body as unknown as { message?: string; code?: string }
    const message = typeof err.message === 'string' ? err.message : '请求失败，请稍后重试'
    toast.error(message)
    throw new Error(message)
  }
  return body
}

/** 药箱列表：编译期验证 hc<AppType> 端到端推导（client.api.drugs.$get → data.items 精确类型）。T9 用 TanStack Query 调用。 */
export async function fetchDrugs() {
  const res = await client.api.drugs.$get()
  const data = await unwrap(res)
  return data.items
}

/** 今日任务：验证嵌套路径 /api/tasks/today 的类型连通。 */
export async function fetchTodayTasks() {
  const res = await client.api.tasks.today.$get()
  return unwrap(res)
}

/** 计划列表（药箱页用）。 */
export async function fetchPlans() {
  const res = await client.api.plans.$get()
  const data = await unwrap(res)
  return data.items
}

/** 健康信息（我的页用）。 */
export async function fetchProfile() {
  const res = await client.api.profile.$get()
  return unwrap(res)
}

// ── 录入草稿（M2-T7 确认页）──

/** 草稿详情：payload 为 api 侧 DraftPayload，经 hc<AppType> 端到端推导（web 不复制类型，执行总纲 §3.1）。 */
export async function fetchDraft(id: string) {
  const res = await client.api.drafts[':id'].$get({ param: { id } })
  const data = await unwrap(res)
  return data.draft
}

export type DraftDto = Awaited<ReturnType<typeof fetchDraft>>
export type DraftPayloadDto = DraftDto['payload']

/**
 * 草稿确认（录入主线唯一闸门）：服务端单事务原子写 sources+drugs+plans+health_profiles+drafts.status。
 * 响应含对**用户最终确认值**重跑的规则检查（interactions/dosageRange），只标注不阻止，前端负责展示。
 */
export async function confirmDraft(id: string, body: DraftConfirm) {
  const res = await client.api.drafts[':id'].confirm.$post({ param: { id }, json: body })
  return unwrap(res)
}

/** 草稿拒绝（「信息不符」）：status=rejected 留痕。 */
export async function rejectDraft(id: string, reason?: string) {
  const res = await client.api.drafts[':id'].reject.$post({ param: { id }, json: { reason: reason ?? null } })
  return unwrap(res)
}

// ── 录入管线（M2-T8）──

/**
 * 不 toast 的拆包（录入页要自己渲染失败分支，toast 会重复且丢结构化信息）。
 * 失败时保留 status/code/details（409 的 detected/suggestion 等），禁止静默吞错：调用方必须把失败可见化。
 */
export type Settled<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; details: Record<string, unknown> }

export async function settle<T extends { ok: boolean }>(res: {
  ok: boolean
  status: number
  json(): Promise<T>
}): Promise<Settled<Omit<T, 'ok'>>> {
  const body = await res.json()
  if (res.ok && body.ok) {
    const { ok: _ok, ...data } = body
    return { ok: true, data: data as Omit<T, 'ok'> }
  }
  const err = body as unknown as Record<string, unknown>
  return {
    ok: false,
    status: res.status,
    code: typeof err.code === 'string' ? err.code : 'UNKNOWN',
    message: typeof err.message === 'string' ? err.message : '请求失败，请稍后重试',
    details: err,
  }
}

/** POST /api/intake/detect：仅层检测（入口校验，信息性不抛 409/422）。 */
export async function detectImage(image: string, entry?: 'A' | 'B') {
  const res = await client.api.intake.detect.$post({ json: entry ? { image, entry } : { image } })
  return settle(res)
}

/** POST /api/intake/prescription：入口A 全管线 → N 份草稿。 */
export async function intakePrescription(image: string) {
  const res = await client.api.intake.prescription.$post({ json: { image } })
  return settle(res)
}

/** POST /api/intake/drug：入口B 仅身份线 → 1 份建档草稿。 */
export async function intakeDrug(image: string) {
  const res = await client.api.intake.drug.$post({ json: { image } })
  return settle(res)
}
