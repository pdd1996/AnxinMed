/**
 * 认证契约（G7 最小账号密码登录）——前后端一份真相。
 *
 * 定位：过渡实现（ADR #11 的 Better Auth + 手机号验证码仍为 P1 目标）。
 * 本文件只定义传输契约；密码哈希、session 表与限流归 api 实现，前端不复制任何凭据逻辑。
 *
 * 安全边界：
 * - 登录密码明文只出现在 POST /api/auth/login 请求体（HTTP 传输另见 G7 任务书「已知风险」）；
 * - 对外用户对象绝不包含 password_hash / email / phone（AuthUser 只留展示所需字段）。
 */
import { z } from 'zod'

/** 鉴权模式（服务端 env AUTH_MODE）：demo = 注入演示用户 p-001 的旁路；password = 账号密码登录。 */
export const AUTH_MODES = ['demo', 'password'] as const
export type AuthMode = (typeof AUTH_MODES)[number]
export const AuthModeSchema = z.enum(AUTH_MODES)

/** 登录入参。username 为账号（演示账号可就是 p-001），不是手机号/邮箱。 */
export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, '请输入账号').max(64),
  password: z.string().min(1, '请输入密码').max(128),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

/** 对外用户 DTO（登录态展示用）。 */
export const AuthUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  username: z.string().nullable(),
})
export type AuthUser = z.infer<typeof AuthUserSchema>

/** 登录成功响应：token 明文只出现这一次；DB 只存其 SHA-256。 */
export const LoginResponseSchema = z.object({
  mode: AuthModeSchema,
  token: z.string(),
  user: AuthUserSchema,
})
export type LoginResponse = z.infer<typeof LoginResponseSchema>

/** 当前登录态（前端启动 bootstrap 用；demo 模式也走同一端点，不出现登录页）。 */
export const AuthMeSchema = z.object({
  mode: AuthModeSchema,
  user: AuthUserSchema,
})
export type AuthMe = z.infer<typeof AuthMeSchema>

/** 登录/改密失败统一文案：不区分「账号不存在」与「密码错误」（防账号枚举）。 */
export const LOGIN_FAILED_MESSAGE = '账号或密码错误'
/** 限流命中文案（5 次/15 分钟，G7 单实例内存实现）。 */
export const LOGIN_LOCKED_MESSAGE = '登录尝试次数过多，请 15 分钟后再试'
/** 未登录 / token 失效文案。 */
export const AUTH_REQUIRED_MESSAGE = '请先登录'
export const AUTH_INVALID_MESSAGE = '登录已失效，请重新登录'
