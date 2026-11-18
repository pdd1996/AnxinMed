/**
 * 阿里云短信认证客户端单测（P1）：签名参数、成功/业务失败/超时/非 JSON 的错误归一。
 *
 * 不打真实阿里云网络：stub 全局 fetch，断言请求体（签名存在、关键参数齐全、密钥不出现在请求里）
 * 与返回解析；错误码映射由服务层集成测试再覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DypnsError,
  checkSmsCode,
  maskPhone,
  readDypnsConfig,
  sendSmsCode,
  type DypnsConfig,
} from '../lib/sms/dypns.js'

const CFG: DypnsConfig = {
  accessKeyId: 'test-ak-id',
  accessKeySecret: 'SuperSecretValue12345',
  signName: '恒创联众',
  templateLogin: '100001',
}

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('sendSmsCode', () => {
  it('成功 → 解析 bizId/requestId；请求体含签名与全部发送参数，且不含 AccessKey Secret', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ Code: 'OK', Success: true, RequestId: 'req-1', Model: { BizId: 'biz-1' } }),
    )

    const result = await sendSmsCode(CFG, { phone: '13800138000' })
    expect(result).toEqual({ bizId: 'biz-1', requestId: 'req-1' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://dypnsapi.aliyuncs.com/')
    expect(init.method).toBe('POST')

    const body = String(init.body)
    // 公共参数 + 业务参数
    expect(body).toContain('Action=SendSmsVerifyCode')
    expect(body).toContain('Version=2017-05-25')
    expect(body).toContain('AccessKeyId=test-ak-id')
    expect(body).toContain('PhoneNumber=13800138000')
    expect(body).toContain(`SignName=${encodeURIComponent('恒创联众')}`)
    expect(body).toContain('TemplateCode=100001')
    expect(body).toContain('CodeLength=6')
    expect(body).toContain('CodeType=1')
    expect(body).toContain('ValidTime=300')
    expect(body).toContain('Interval=60')
    // 验证码明文绝不返回（ReturnVerifyCode 固定 false）
    expect(body).toContain('ReturnVerifyCode=false')
    expect(body).toContain(
      `TemplateParam=${encodeURIComponent(JSON.stringify({ code: '##code##', min: '5' }))}`,
    )
    // 签名存在且 Secret 绝不出现在请求体里
    expect(body).toMatch(/Signature=[A-Za-z0-9%+/=]+/)
    expect(body).not.toContain(CFG.accessKeySecret)
  })

  it('阿里云业务错误（如频控）→ 抛 DypnsError 且带原始错误码，文案不含密钥', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { Code: 'isv.BUSINESS_LIMIT_CONTROL', Message: '触发号码天级流控', RequestId: 'req-2' },
        400,
      ),
    )

    await expect(sendSmsCode(CFG, { phone: '13800138000' })).rejects.toMatchObject({
      name: 'DypnsError',
      code: 'isv.BUSINESS_LIMIT_CONTROL',
      message: '触发号码天级流控',
      httpStatus: 400,
    })

    const err = await sendSmsCode(CFG, { phone: '13800138000' }).catch((e: unknown) => e)
    expect((err as Error).message).not.toContain(CFG.accessKeySecret)
  })

  it('超时 → DypnsError(SMS_TIMEOUT)', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await expect(sendSmsCode(CFG, { phone: '13800138000' })).rejects.toMatchObject({
      code: 'SMS_TIMEOUT',
    })
  })

  it('网络异常 → DypnsError(SMS_NETWORK)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(sendSmsCode(CFG, { phone: '13800138000' })).rejects.toMatchObject({
      code: 'SMS_NETWORK',
    })
  })

  it('非 JSON 响应 → DypnsError(SMS_BAD_RESPONSE)，不把异常当成功', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(sendSmsCode(CFG, { phone: '13800138000' })).rejects.toMatchObject({
      code: 'SMS_BAD_RESPONSE',
    })
  })
})

describe('checkSmsCode', () => {
  it('Model.VerifyResult=PASS → passed=true', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        Code: 'OK',
        Success: true,
        RequestId: 'req-3',
        Model: { VerifyResult: 'PASS' },
      }),
    )
    const result = await checkSmsCode(CFG, { phone: '13800138000', code: '123456' })
    expect(result).toEqual({ passed: true, requestId: 'req-3' })
  })

  it('Model.VerifyResult=UNKNOWN → passed=false（接口成功不等于核验通过）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        Code: 'OK',
        Success: true,
        RequestId: 'req-4',
        Model: { VerifyResult: 'UNKNOWN' },
      }),
    )
    const result = await checkSmsCode(CFG, { phone: '13800138000', code: '000000' })
    expect(result).toEqual({ passed: false, requestId: 'req-4' })
  })

  it('isv.ValidateFail（验证码错误/过期/被覆盖）→ passed=false，不算服务异常', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ Code: 'isv.ValidateFail', Message: '验证失败', RequestId: 'req-5' }, 400),
    )
    const result = await checkSmsCode(CFG, { phone: '13800138000', code: '000000' })
    expect(result.passed).toBe(false)
  })

  it('签名/权限类错误 → 照常抛 DypnsError（服务层转 503）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ Code: 'SignatureDoesNotMatch', Message: 'Specified signature is not matched' }, 400),
    )
    await expect(checkSmsCode(CFG, { phone: '13800138000', code: '123456' })).rejects.toBeInstanceOf(
      DypnsError,
    )
  })
})

describe('readDypnsConfig / maskPhone', () => {
  it('四项齐全 → 读取配置；缺任一项 → null（fail-closed 由服务层报 503）', () => {
    vi.stubEnv('DYPNS_ACCESS_KEY_ID', 'ak')
    vi.stubEnv('DYPNS_ACCESS_KEY_SECRET', 'sk')
    vi.stubEnv('DYPNS_SIGN_NAME', '恒创联众')
    vi.stubEnv('DYPNS_TEMPLATE_LOGIN', '100001')
    expect(readDypnsConfig()).toMatchObject({
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      signName: '恒创联众',
      templateLogin: '100001',
    })

    vi.stubEnv('DYPNS_SIGN_NAME', '  ')
    expect(readDypnsConfig()).toBeNull()
  })

  it('maskPhone 只露前三后四，非法号码一律 ***', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
    expect(maskPhone('12345')).toBe('***')
  })
})
