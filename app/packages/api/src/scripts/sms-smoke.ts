/**
 * 短信认证联调冒烟（P1 手机号注册/登录的前置验收 · 手动脚本，不进 CI）。
 *
 * 用法（app/ 下）：
 *   pnpm --filter @anxin/api sms:smoke -- --check 13800138000 --code 000000   # 免费：验 AK/签名/权限/开通
 *   pnpm --filter @anxin/api sms:smoke -- --send 151xxxxxxxx                  # 真实发码（约 0.06 元/条）
 *
 * 说明：
 * - --check 走核验接口（**核验免费**、不发短信）：返回「未通过」即说明 AK/签名/权限/服务开通全部正常
 *   （该号码没发过码属于预期）；若该号码刚发过码且 code 正确则可能返回 PASS。
 * - --send 会真实发一条短信到指定号码（按运营商回执计费，回执失败不计费），只在联调时用。
 * - 任何失败非零退出并打印阿里云错误码 + 排查提示（禁止静默）。
 */
import '../lib/env.js'
import { checkSmsCode, DypnsError, maskPhone, readDypnsConfig, sendSmsCode } from '../lib/sms/dypns.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** 阿里云错误码 → 运维排查提示（仅本地脚本使用）。 */
function hintFor(code: string): string | null {
  switch (code) {
    case 'SignatureDoesNotMatch':
      return 'AccessKey Secret 填错（或含空格）——重新核对 DYPNS_ACCESS_KEY_SECRET'
    case 'InvalidAccessKeyId.NotFound':
      return 'AccessKey ID 不存在——核对 DYPNS_ACCESS_KEY_ID'
    case 'Forbidden.RAM':
    case 'Forbidden':
    case 'NoPermission':
      return 'RAM 用户没有 dypns 权限——给 anxin-sms 授予 dypns:SendSmsVerifyCode / dypns:CheckSmsVerifyCode'
    case 'FUNCTION_NOT_OPENED':
      return '控制台未开通短信认证/融合认证——去 https://dypns.console.aliyun.com/functions 开启'
    case 'MOBILE_NUMBER_ILLEGAL':
      return '手机号格式非法（需 11 位中国大陆号码）'
    case 'BUSINESS_LIMIT_CONTROL':
      return '触发号码天级流控——今天该号码发码次数过多'
    case 'FREQUENCY_FAIL':
      return '触发频控——同号 60 秒内只能发一次'
    case 'SMS_TIMEOUT':
    case 'SMS_NETWORK':
      return '网络/网关异常——确认本机能访问 dypnsapi.aliyuncs.com 后重试'
    default:
      return null
  }
}

const PHONE_RE = /^1[3-9]\d{9}$/

async function main(): Promise<number> {
  const cfg = readDypnsConfig()
  if (!cfg) {
    console.error(
      '❌ 缺少 DYPNS_* 配置（app/packages/api/.env）：需要 DYPNS_ACCESS_KEY_ID / DYPNS_ACCESS_KEY_SECRET / DYPNS_SIGN_NAME / DYPNS_TEMPLATE_LOGIN',
    )
    return 1
  }

  const sendPhone = arg('send')
  const checkPhone = arg('check')
  const code = arg('code') ?? '000000'

  if (!sendPhone && !checkPhone) {
    console.log('用法：')
    console.log('  免费验通：pnpm --filter @anxin/api sms:smoke -- --check 13800138000 --code 000000')
    console.log('  真实发码：pnpm --filter @anxin/api sms:smoke -- --send 151xxxxxxxx')
    console.log(
      `当前配置：签名「${cfg.signName}」/ 登录注册模板 ${cfg.templateLogin}` +
        `${cfg.templateReset ? ` / 重置模板 ${cfg.templateReset}` : ''}`,
    )
    return 0
  }

  try {
    if (sendPhone) {
      if (!PHONE_RE.test(sendPhone)) {
        console.error(`❌ --send 手机号非法：${sendPhone}（需 11 位中国大陆号码）`)
        return 1
      }
      const result = await sendSmsCode(cfg, { phone: sendPhone, outId: `smoke-${Date.now()}` })
      console.log(
        `✅ 已请求发送验证码 → ${maskPhone(sendPhone)}（bizId=${result.bizId || '-'}，requestId=${result.requestId || '-'}）`,
      )
      console.log(`   真实短信按运营商回执计费；请检查手机是否收到、落款是否为「${cfg.signName}」。`)
      return 0
    }

    const phone = checkPhone as string
    if (!PHONE_RE.test(phone)) {
      console.error(`❌ --check 手机号非法：${phone}（需 11 位中国大陆号码）`)
      return 1
    }
    const result = await checkSmsCode(cfg, { phone, code })
    console.log(
      `✅ 核验接口连通（requestId=${result.requestId || '-'}）：VerifyResult = ` +
        `${result.passed ? 'PASS（该码确实有效）' : '未通过（预期：未发过码/码错误）'}`,
    )
    console.log('   AK / 签名 / 权限 / 服务开通均正常。')
    return 0
  } catch (err) {
    if (err instanceof DypnsError) {
      console.error(`❌ 短信认证调用失败：[${err.code}] ${err.message}`)
      const hint = hintFor(err.code)
      if (hint) console.error(`   → ${hint}`)
      return 1
    }
    console.error(`❌ 未预期错误：${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

process.exitCode = await main()
