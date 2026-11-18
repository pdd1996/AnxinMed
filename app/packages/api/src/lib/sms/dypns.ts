/**
 * 阿里云号码认证服务「短信认证」客户端（P1 手机号注册/登录 · 零新依赖手写 RPC 签名）。
 *
 * 为什么用它：个人实名即可用、免企业资质/免签名模板报备、验证码生命周期与核验由阿里云托管，
 * 且仅需服务端 API（App/Web 无端侧限制）。见 docs/specs/17-手机号验证码注册登录.md。
 *
 * 文档（API 版本 2017-05-25）：
 * - SendSmsVerifyCode 发送验证码：按运营商回执计费（提交成功但回执失败不计费）；
 * - CheckSmsVerifyCode 核验验证码：**核验免费**；注意 `Code=OK` 只代表接口调用成功，
 *   核验是否通过只看 `Model.VerifyResult === 'PASS'`（官方文档明确，不能混）。
 *
 * 安全纪律（禁止静默吞错 / 禁止泄密）：
 * - AccessKey 只从 env 读，绝不写日志、绝不拼进错误文案；
 * - 不记录验证码明文；阿里云错误码/Message 原样上抛，由路由层转中文可见错误；
 * - 超时、网络、非 JSON、业务失败一律抛 DypnsError（调用方必须处理，不许吞）。
 */
import { createHmac, randomUUID } from 'node:crypto'

const API_VERSION = '2017-05-25'
const DEFAULT_ENDPOINT = 'https://dypnsapi.aliyuncs.com/'
const DEFAULT_TIMEOUT_MS = 10_000

/** 短信认证配置（缺任一项视为未配置；服务层 fail-closed 显式报错，不静默降级）。 */
export interface DypnsConfig {
  accessKeyId: string
  accessKeySecret: string
  /** 赠送签名名称（控制台「签名配置 → 赠送签名配置」；不支持自定义签名）。 */
  signName: string
  /** 登录/注册模板 Code（赠送模板 100001）。 */
  templateLogin: string
  /** 重置密码模板 Code（赠送模板 100003；P1 找回密码用，可暂缺）。 */
  templateReset?: string
  endpoint?: string
  timeoutMs?: number
}

/** 阿里云 RPC 错误（code 为阿里云错误码或本地 SMS_* 码；不含任何密钥/验证码）。 */
export class DypnsError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus?: number,
  ) {
    super(message)
    this.name = 'DypnsError'
  }
}

/**
 * 读 env：缺项返回 null（由调用方决定 503/400 等可见错误）。
 * 演示模式（AUTH_MODE=demo）不经过本客户端，本地无配置也不影响既有测试。
 */
export function readDypnsConfig(): DypnsConfig | null {
  const accessKeyId = (process.env.DYPNS_ACCESS_KEY_ID ?? '').trim()
  const accessKeySecret = (process.env.DYPNS_ACCESS_KEY_SECRET ?? '').trim()
  const signName = (process.env.DYPNS_SIGN_NAME ?? '').trim()
  const templateLogin = (process.env.DYPNS_TEMPLATE_LOGIN ?? '').trim()
  if (!accessKeyId || !accessKeySecret || !signName || !templateLogin) return null

  const timeoutMs = Number(process.env.DYPNS_TIMEOUT_MS ?? '')
  return {
    accessKeyId,
    accessKeySecret,
    signName,
    templateLogin,
    templateReset: (process.env.DYPNS_TEMPLATE_RESET ?? '').trim() || undefined,
    endpoint: (process.env.DYPNS_ENDPOINT ?? '').trim() || undefined,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
  }
}

/** 阿里云 RPC 签名规定的 PercentEncode（比 encodeURIComponent 多转义 !'()*，~ 保留）。 */
function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}

/** 阿里云要求的时间戳：UTC ISO8601、秒级（去掉毫秒）。 */
function timestampUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * 调用一个 Dypnsapi RPC 接口（POST + HMAC-SHA1 签名）。
 * 返回解析后的 JSON（成功响应）；任何异常都转成 DypnsError。
 */
async function callDypnsApi(
  cfg: DypnsConfig,
  action: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const query: Record<string, string> = {
    Format: 'JSON',
    Version: API_VERSION,
    AccessKeyId: cfg.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID(),
    Timestamp: timestampUtc(),
    Action: action,
    ...params,
  }

  // 1. 规范化查询串（key 按字典序，value 做 PercentEncode）。
  const canonicalized = Object.keys(query)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(query[key]!)}`)
    .join('&')

  // 2. StringToSign = POST & %2F & PercentEncode(canonicalized)。
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalized)}`
  const signature = createHmac('sha1', `${cfg.accessKeySecret}&`).update(stringToSign).digest('base64')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let res: Response
  let text: string
  try {
    res = await fetch(cfg.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
        accept: 'application/json',
      },
      body: `${canonicalized}&Signature=${percentEncode(signature)}`,
      signal: ctrl.signal,
    })
    text = await res.text()
  } catch (err) {
    const name = (err as { name?: string }).name
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new DypnsError('SMS_TIMEOUT', '短信服务响应超时，请稍后重试')
    }
    throw new DypnsError('SMS_NETWORK', '短信服务网络异常，请稍后重试')
  } finally {
    clearTimeout(timer)
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new DypnsError('SMS_BAD_RESPONSE', `短信服务返回非 JSON（HTTP ${res.status}）`, res.status)
  }
  const row = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const code = typeof row.Code === 'string' ? row.Code : ''

  // 3. 错误可见：HTTP 非 2xx 或阿里云业务码非 OK 一律抛（Message 原样）。
  if (!res.ok || (code !== '' && code !== 'OK') || row.Success === false) {
    const message =
      typeof row.Message === 'string' && row.Message.trim() !== ''
        ? row.Message
        : `短信服务调用失败（HTTP ${res.status}）`
    throw new DypnsError(code || `HTTP_${res.status}`, message, res.status)
  }
  return row
}

/** 发送验证码入参（默认 6 位数字、300 秒有效、60 秒重发间隔，全部显式下发不依赖控制台默认）。 */
export interface SendSmsCodeInput {
  /** 中国大陆手机号（11 位；由契约层校验后传入）。 */
  phone: string
  /** 模板 Code；默认登录/注册模板（100001）。 */
  templateCode?: string
  /** 验证码位数 4–8，默认 6（适老化：6 位兼顾安全与输入成本）。 */
  codeLength?: number
  /** 有效期（秒），默认 300。 */
  validTimeSec?: number
  /** 同号重发间隔（秒），默认 60。 */
  intervalSec?: number
  /** 外部流水号（排查用，不含个人信息）。 */
  outId?: string
}

export interface SendSmsCodeResult {
  /** 阿里云业务 ID（排查发送记录用）。 */
  bizId: string
  requestId: string
}

/**
 * 发送验证码。成功返回 bizId；失败抛 DypnsError（含频控/号码非法/权限等错误码）。
 * 注意：`ReturnVerifyCode` 固定 false —— 验证码明文绝不返回给调用方/日志。
 */
export async function sendSmsCode(cfg: DypnsConfig, input: SendSmsCodeInput): Promise<SendSmsCodeResult> {
  const validTimeSec = input.validTimeSec ?? 300
  const min = Math.max(1, Math.round(validTimeSec / 60))
  const payload = await callDypnsApi(cfg, 'SendSmsVerifyCode', {
    PhoneNumber: input.phone,
    CountryCode: '86',
    SignName: cfg.signName,
    TemplateCode: input.templateCode ?? cfg.templateLogin,
    // ##code## = 由阿里云生成并托管校验；min 与 ValidTime 保持一致。
    TemplateParam: JSON.stringify({ code: '##code##', min: String(min) }),
    CodeType: '1', // 纯数字
    CodeLength: String(input.codeLength ?? 6),
    ValidTime: String(validTimeSec),
    Interval: String(input.intervalSec ?? 60),
    ReturnVerifyCode: 'false',
    ...(input.outId ? { OutId: input.outId } : {}),
  })

  const model = (payload.Model && typeof payload.Model === 'object' ? payload.Model : {}) as Record<
    string,
    unknown
  >
  return {
    bizId: typeof model.BizId === 'string' ? model.BizId : '',
    requestId: typeof payload.RequestId === 'string' ? payload.RequestId : '',
  }
}

export interface CheckSmsCodeInput {
  phone: string
  code: string
}

export interface CheckSmsCodeResult {
  /** 核验是否通过（只看 Model.VerifyResult === 'PASS'，不看 Code/Success）。 */
  passed: boolean
  requestId: string
}

/**
 * 核验验证码（免费）。验证码错误/过期/被覆盖时阿里云返回 `isv.ValidateFail`（业务失败），
 * 统一转成 { passed: false } 不算异常；只有接口调用本身失败（签名/权限/网络/频控）才抛 DypnsError。
 */
export async function checkSmsCode(
  cfg: DypnsConfig,
  input: CheckSmsCodeInput,
): Promise<CheckSmsCodeResult> {
  let payload: Record<string, unknown>
  try {
    payload = await callDypnsApi(cfg, 'CheckSmsVerifyCode', {
      PhoneNumber: input.phone,
      CountryCode: '86',
      VerifyCode: input.code,
    })
  } catch (err) {
    // 官方返回码：isv.ValidateFail = 验证码错误/已过期/已被覆盖（见 API返回码文档）。
    if (err instanceof DypnsError && err.code === 'isv.ValidateFail') {
      return { passed: false, requestId: '' }
    }
    throw err
  }
  const model = (payload.Model && typeof payload.Model === 'object' ? payload.Model : {}) as Record<
    string,
    unknown
  >
  return {
    passed: model.VerifyResult === 'PASS',
    requestId: typeof payload.RequestId === 'string' ? payload.RequestId : '',
  }
}

/** 手机号脱敏（只用于日志/展示：138****1234）。 */
export function maskPhone(phone: string): string {
  return /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***'
}
