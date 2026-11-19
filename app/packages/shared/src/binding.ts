/**
 * 医患绑定契约（演示最小闭环 · specs/25）——前后端一份真相。
 *
 * 定位：这是「方案 A：真实鉴权下的最小绑定闭环」，不是完整医患关系系统：
 * - 医生生成一次性 6 位绑定码（10 分钟有效），患者在患者端输入完成授权；
 * - 绑定后医生端只可见被授权的患者（作用域由认证态派生，见 ADR #23）；
 * - 患者可随时解绑，解绑后医生立即失去可见性。
 *
 * 安全边界：
 * - 绑定码只允许数字 6 位、一次性、10 分钟过期；明文只在生成响应出现一次，DB 不存明文之外的额外信息；
 * - 只能由「患者」账号核销，且不能绑定自己（医生账号不能给自己发授权）；
 * - 前端不做任何权限判断，展示与否只依赖服务端返回；越权一律由服务端拒绝（403 / 404）。
 */
import { z } from 'zod'

/** 绑定码长度（6 位数字，便于口述/输入；演示规模下暴力枚举风险由「一次性 + 10 分钟」限制）。 */
export const BIND_CODE_LENGTH = 6

/** 绑定码有效期（秒）：10 分钟。 */
export const BIND_CODE_TTL_SEC = 10 * 60

/** 绑定码格式（6 位数字）。 */
export const BIND_CODE_PATTERN = /^\d{6}$/

/** 医生端生成绑定码的响应：明文只出现这一次。 */
export const BindCodeCreateResponseSchema = z.object({
  code: z.string().length(BIND_CODE_LENGTH),
  /** ISO 时间字符串。 */
  expiresAt: z.string(),
  ttlSec: z.number().int().positive(),
})
export type BindCodeCreateResponse = z.infer<typeof BindCodeCreateResponseSchema>

/** 患者端核销绑定码入参。 */
export const BindRedeemRequestSchema = z.object({
  code: z
    .string({ required_error: '请输入绑定码' })
    .trim()
    .regex(BIND_CODE_PATTERN, `请输入 ${BIND_CODE_LENGTH} 位数字绑定码`),
})
export type BindRedeemRequest = z.infer<typeof BindRedeemRequestSchema>

/** 患者端已绑定的医生（最小字段：展示名 + 绑定时间，不含医生账号等凭据信息）。 */
export const BoundDoctorSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  /** ISO 时间字符串。 */
  boundAt: z.string(),
})
export type BoundDoctor = z.infer<typeof BoundDoctorSchema>

/** 患者端「我的医生」列表响应。 */
export const BindingListResponseSchema = z.object({ doctors: z.array(BoundDoctorSchema) })
export type BindingListResponse = z.infer<typeof BindingListResponseSchema>

/** 核销成功响应（返回绑定到的医生，供患者端即时展示）。 */
export const BindRedeemResponseSchema = z.object({ doctor: BoundDoctorSchema })
export type BindRedeemResponse = z.infer<typeof BindRedeemResponseSchema>

/** 绑定码无效/过期（统一措辞，不区分「没生成过」与「已用过」——避免探测）。 */
export const BIND_CODE_INVALID_MESSAGE = '绑定码无效或已过期，请让医生重新生成'
/** 医生专属接口被非医生账号调用。 */
export const BIND_DOCTOR_ONLY_MESSAGE = '该功能仅对医生账号开放'
/** 绑定码只能由患者账号核销。 */
export const BIND_PATIENT_ONLY_MESSAGE = '请使用患者账号完成绑定'
/** 医生账号不能绑定自己（防止作用域自指）。 */
export const BIND_SELF_MESSAGE = '医生账号不能绑定自己'
/** 同一医生已处于绑定状态。 */
export const BIND_ALREADY_MESSAGE = '该医生已绑定，无需重复绑定'
/** 解绑时未找到绑定关系（幂等：仍返回 200，但文案可见）。 */
export const BIND_NOT_FOUND_MESSAGE = '未找到与该医生的绑定关系'
/** 患者端绑定成功提示。 */
export const BIND_SUCCESS_MESSAGE = '绑定成功，医生可以看到你的用药情况了'
/** 医生未绑定任何患者时的队列空态文案。 */
export const DOCTOR_NO_PATIENTS_MESSAGE = '还没有绑定患者，生成绑定码让患者确认授权'
