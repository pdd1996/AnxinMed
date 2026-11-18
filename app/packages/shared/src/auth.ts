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
  /**
   * 该账号是否已设置密码（P1 增补）。
   * 手机号验证码注册的账号初始无密码；「我的 → 个人资料」据此显示「设置密码 / 修改密码」。
   * 可选：兼容既有测试夹具/旧响应（缺省按「未设置」处理）。
   */
  hasPassword: z.boolean().optional(),
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

// ---------------------------------------------------------------------------
// P1 增补 · 登录后设置 / 修改密码（手机号账号补密码，老账号改密码）
//
// 语义：手机号验证码注册的账号默认无密码；登录态下可补设密码（账号名自动取手机号），
// 之后「手机号 + 密码」也可以登录。已有密码的账号改密必须校验当前密码。
// 会话：改密/设密成功即撤销该账号其他设备的会话，保留当前这台（见 specs/17 §2 D12）。
// ---------------------------------------------------------------------------

/** 密码长度区间（与服务端 hashPassword 输入上限一致；scrypt 无 72 字节限制，这里按输入体验取 72）。 */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 72
export const PASSWORD_MIN_LENGTH_MESSAGE = `密码至少 ${PASSWORD_MIN_LENGTH} 位`
export const PASSWORD_MAX_LENGTH_MESSAGE = `密码最多 ${PASSWORD_MAX_LENGTH} 位`

/**
 * 设置/修改密码入参：
 * - 无密码账号（手机号注册）：只传 password（登录态已证明手机号归属，无需旧密码）；
 * - 已有密码账号：必须传 oldPassword，服务端 scrypt 校验。
 * 是否必填 oldPassword 由服务端按账号状态裁决（契约只做格式约束）。
 */
export const PasswordSetRequestSchema = z.object({
  oldPassword: z.string().min(1, '请输入当前密码').max(128).optional(),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE)
    .max(PASSWORD_MAX_LENGTH, PASSWORD_MAX_LENGTH_MESSAGE),
})
export type PasswordSetRequest = z.infer<typeof PasswordSetRequestSchema>

/** 设置/修改密码成功：与 GET /me 同形（前端可整块替换登录态，hasPassword 随之更新）。 */
export const PasswordSetResponseSchema = AuthMeSchema
export type PasswordSetResponse = z.infer<typeof PasswordSetResponseSchema>

/** 当前密码不正确文案（400 AUTH_PASSWORD_INVALID，故意不用 401：401 会触发前端统一清登录态）。 */
export const PASSWORD_INVALID_MESSAGE = '当前密码不正确'
/** 无手机号也无账号名的账号（如 seed 演示用户）不支持自助设密，只能管理员 CLI 处理。 */
export const PASSWORD_NOT_SUPPORTED_MESSAGE = '该账号暂不支持设置密码，请联系管理员'
/** 手机号账号补密码时用户名冲突（极端情况：管理员建过同号账号名）。 */
export const PASSWORD_USERNAME_CONFLICT_MESSAGE = '该手机号对应的账号名已被占用，请联系管理员'

// ---------------------------------------------------------------------------
// P1 增补 · 未登录「忘记密码」自助找回（短信认证 100003 重置密码模板）
//
// 语义：手机号 + 重置验证码 + 新密码 → 阿里云核验 PASS 后重置密码、**撤销该账号全部旧会话**、
// 直接发新会话（重置成功即登录，不用再回登录页输一遍）。
//
// 防枚举：发码接口对「未注册手机号」也返回同一成功形态，但**不发短信**——
// 响应里不加入任何能反推账号存在性的差异（signName 是全局配置，不属于差异）。
// ---------------------------------------------------------------------------

/** 重置密码 · 发送验证码入参（与登录发码同形）。 */
export const PasswordResetCodeRequestSchema = z.object({ phone: PhoneSchema })
export type PasswordResetCodeRequest = z.infer<typeof PasswordResetCodeRequestSchema>

/** 重置密码 · 发码响应（与登录发码同形；未注册手机号也返回此形态，不暴露账号存在性）。 */
export const PasswordResetCodeResponseSchema = z.object({
  mode: AuthModeSchema,
  cooldownSec: z.number().int().positive(),
  expiresInSec: z.number().int().positive(),
  signName: z.string(),
})
export type PasswordResetCodeResponse = z.infer<typeof PasswordResetCodeResponseSchema>

/** 重置密码入参：手机号 + 重置验证码 + 新密码（长度复用密码契约）。 */
export const PasswordResetRequestSchema = z.object({
  phone: PhoneSchema,
  code: z.string().trim().regex(/^\d{4,8}$/, '请输入短信验证码（4–8 位数字）'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE)
    .max(PASSWORD_MAX_LENGTH, PASSWORD_MAX_LENGTH_MESSAGE),
})
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>

/** 重置成功响应：与登录同形（重置即登录，发新 token）。 */
export const PasswordResetResponseSchema = LoginResponseSchema
export type PasswordResetResponse = z.infer<typeof PasswordResetResponseSchema>

/** 忘记密码入口说明（发码后统一提示，不区分账号是否存在）。 */
export const PASSWORD_RESET_SENT_HINT = '如该手机号已注册，验证码已发送'
