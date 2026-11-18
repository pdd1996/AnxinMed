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

/**
 * 显示名长度上限（G8 增补 · 个人资料）。中文姓名远短于此；上限只用于防长串撑破
 * 「我的」页头部与医生端患者列表的列宽，不做业务意义解释。
 */
export const DISPLAY_NAME_MAX_LENGTH = 20

/**
 * PATCH /api/auth/me 入参 —— 当前只开放「姓名」一项（头像涉及存储选型，另行立项）。
 *
 * 约束与理由：
 * - trim 后必须非空：清空会让「我的」页与医生端列表退化成无名患者；
 * - 拒绝换行/控制字符：姓名是单行展示文本，可换行会撑破布局（前端不转义也不会执行，故不额外禁符号）；
 * - 上限与 `DISPLAY_NAME_MAX_LENGTH` 同源，前端输入框 maxLength 复用同一常量。
 */
export const UpdateMeRequestSchema = z.object({
  name: z
    // 缺字段时 zod 默认文案是英文 "Required"，会经 vJson 原样进错误响应（「name: Required」）——
    // min(1) 只覆盖「传了但为空」，覆盖不到「压根没传」，故必须单独给 required_error 中文兜底。
    .string({ required_error: '请输入姓名' })
    .trim()
    .min(1, '请输入姓名')
    .max(DISPLAY_NAME_MAX_LENGTH, `姓名最多 ${DISPLAY_NAME_MAX_LENGTH} 个字`)
    // 不用 \u0000-\u001f 正则：eslint no-control-regex 会拦「刻意匹配控制字符」，
    // 逐字符判码点更直白（控制字符都在 BMP，charCodeAt 足够）。
    .refine(
      (value) => !Array.from(value).some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f),
      '姓名不能包含换行或控制字符',
    ),
})
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>

/** 登录/改密失败统一文案：不区分「账号不存在」与「密码错误」（防账号枚举）。 */
export const LOGIN_FAILED_MESSAGE = '账号或密码错误'
/** 限流命中文案（5 次/15 分钟，G7 单实例内存实现）。 */
export const LOGIN_LOCKED_MESSAGE = '登录尝试次数过多，请 15 分钟后再试'
/** 未登录 / token 失效文案。 */
export const AUTH_REQUIRED_MESSAGE = '请先登录'
export const AUTH_INVALID_MESSAGE = '登录已失效，请重新登录'

// ---------------------------------------------------------------------------
// P1 · 手机号验证码登录/注册（阿里云号码认证服务「短信认证」）
//
// 语义：验证码即注册——手机号从未注册时，验码通过后自动建号并发会话；
// 已注册则直接登录。与 G7 账号密码登录并存（老账号不受影响）。
// ---------------------------------------------------------------------------

/** 中国大陆手机号（11 位、1[3-9] 开头）：手机号登录/注册的唯一标识。 */
export const PHONE_PATTERN = /^1[3-9]\d{9}$/
export const PhoneSchema = z.string().trim().regex(PHONE_PATTERN, '请输入 11 位手机号')

/** 发送短信验证码入参（登录/注册共用）。 */
export const SendPhoneCodeRequestSchema = z.object({
  phone: PhoneSchema,
})
export type SendPhoneCodeRequest = z.infer<typeof SendPhoneCodeRequestSchema>

/**
 * 发码成功响应：
 * - cooldownSec 同号重发冷却（前端倒计时）；
 * - expiresInSec 验证码有效期；
 * - signName 短信落款签名（前端提示「短信落款为 XX，属正常」，防老年用户误判诈骗）。
 */
export const SendPhoneCodeResponseSchema = z.object({
  mode: AuthModeSchema,
  cooldownSec: z.number().int().positive(),
  expiresInSec: z.number().int().positive(),
  signName: z.string(),
})
export type SendPhoneCodeResponse = z.infer<typeof SendPhoneCodeResponseSchema>

/** 手机号 + 验证码登录/注册入参。 */
export const PhoneLoginRequestSchema = z.object({
  phone: PhoneSchema,
  code: z.string().trim().regex(/^\d{4,8}$/, '请输入短信验证码（4–8 位数字）'),
})
export type PhoneLoginRequest = z.infer<typeof PhoneLoginRequestSchema>

/** 手机号登录成功响应：比密码登录多 created（本次是否自动注册了新账号）。 */
export const PhoneLoginResponseSchema = LoginResponseSchema.extend({ created: z.boolean() })
export type PhoneLoginResponse = z.infer<typeof PhoneLoginResponseSchema>

/** 验证码错误/过期统一文案（不区分「没发过」与「输错」，防枚举，且提示可重新获取）。 */
export const CODE_INVALID_MESSAGE = '验证码错误或已过期，请重新获取'
/** 短信发送失败（服务商异常/超时/权限配置问题；接口细节只进服务端日志与 details，不吓用户）。 */
export const SMS_SEND_FAILED_MESSAGE = '短信发送失败，请稍后重试'
/** 部署未配置短信认证（缺 DYPNS_* 环境变量）——失败必须可见，不静默降级。 */
export const SMS_NOT_CONFIGURED_MESSAGE = '短信服务未配置，暂不能用手机号登录'
/** 发码频控文案（同号冷却 / 同 IP 小时配额）。 */
export const SMS_TOO_FREQUENT_MESSAGE = '验证码发送太频繁，请稍后再试'
