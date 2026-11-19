/**
 * 医患绑定 API（specs/25 · 演示最小闭环）。
 *
 * - 医生端：生成一次性绑定码（10 分钟有效）；
 * - 患者端：查看已绑定医生 / 输入绑定码核销 / 解绑。
 *
 * 错误策略：silent —— 由调用页面就地渲染可理解文案（绑定码错误、权限不足等），
 * 不叠全局 toast；错误仍会抛出，页面必须展示（不静默吞错）。
 */
import { client, unwrap } from './client'

/** 医生端生成绑定码。 */
export async function createDoctorBindCode() {
  const res = await client.api.doctor['bind-code'].$post()
  const data = await unwrap(res, { silent: true })
  return { code: data.code, expiresAt: data.expiresAt, ttlSec: data.ttlSec }
}

/** 患者端「我的医生」列表。 */
export async function fetchMyDoctors() {
  const res = await client.api.bindings.$get()
  const data = await unwrap(res, { silent: true })
  return data.doctors
}

/** 患者端核销绑定码，返回绑定到的医生。 */
export async function redeemBindCode(code: string) {
  const res = await client.api.bindings.redeem.$post({ json: { code } })
  const data = await unwrap(res, { silent: true })
  return data.doctor
}

/** 患者端解绑医生（未绑定 → 404 可见文案）。 */
export async function unbindDoctor(doctorId: string) {
  const res = await client.api.bindings[':doctorId'].$delete({ param: { doctorId } })
  return unwrap(res, { silent: true })
}

export type DoctorBindCodeDto = Awaited<ReturnType<typeof createDoctorBindCode>>
export type BoundDoctorDto = Awaited<ReturnType<typeof fetchMyDoctors>>[number]
