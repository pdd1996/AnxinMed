/**
 * M2-T2 · L3 出口约束单测（redactForLog + assertNoPii + findPii）。
 * 覆盖：敏感键整值脱敏、值级模式脱敏、深嵌套、纯函数不改入参、drugName 键不误伤、
 *       assertNoPii 干净不抛/含 PII 抛、错误信息不回显原文、findPii 只报类型+位置、多类型 PII 检出。
 */
import { describe, it, expect } from 'vitest'
import { redactForLog, assertNoPii, findPii, PiiDetectedError } from '../services/sanitize/index.js'

const PHONE = '13812345678'
const VALID_ID = '11010519491231002X'

describe('L3 redactForLog · 日志出口脱敏', () => {
  it('敏感键（patientName/phone/idCard）整值脱敏，不看内容', () => {
    const out = redactForLog({ patientName: '张三', phone: 123, idCard: 'x', note: '普通备注' })
    expect(out.patientName).toBe('[已脱敏]')
    expect(out.phone).toBe('[已脱敏]')
    expect(out.idCard).toBe('[已脱敏]')
    expect(out.note).toBe('普通备注')
  })

  it('值级脱敏：普通键的字符串值含手机号/身份证也被扫掉', () => {
    const out = redactForLog({ diagnosis: `高血压 电话${PHONE}`, raw: VALID_ID })
    expect(out.diagnosis).toBe('高血压 电话[已脱敏]')
    expect(out.raw).toBe('[已脱敏]')
  })

  it('深嵌套（数组/对象）全部脱敏', () => {
    const out = redactForLog({
      items: [{ drugName: '氨氯地平片', trace: `联系${PHONE}` }],
      meta: { inner: { addr: '广东省深圳市南山区科技路1号' } },
    })
    expect(out.items[0].drugName).toBe('氨氯地平片')
    expect(out.items[0].trace).toBe('联系[已脱敏]')
    expect(out.meta.inner.addr).toBe('[已脱敏]')
  })

  it('drugName/genericName 键不被误伤（\\bname\\b 词边界保护药名字段）', () => {
    const out = redactForLog({ drugName: '苯磺酸氨氯地平片', genericName: '氨氯地平' })
    expect(out.drugName).toBe('苯磺酸氨氯地平片')
    expect(out.genericName).toBe('氨氯地平')
  })

  it('纯函数：不修改入参（返回深拷贝）', () => {
    const input = { patientName: '张三', diagnosis: `电话${PHONE}` }
    const snapshot = JSON.stringify(input)
    redactForLog(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('脱敏后的日志对象自身零 PII（可安全落日志）', () => {
    const out = redactForLog({ patientName: '张三', diagnosis: `电话${PHONE} 身份证${VALID_ID}` })
    expect(() => assertNoPii(JSON.stringify(out))).not.toThrow()
  })

  it('不涂改正常临床文案（裸“患者”开头的日志值保持原样）', () => {
    const out = redactForLog({ note: '患者教育不足，依从性差' })
    expect(out.note).toBe('患者教育不足，依从性差')
  })
})

describe('L3 assertNoPii / findPii · 零泄漏断言', () => {
  it('干净文本（药名/剂量/白名单）→ 不抛', () => {
    expect(() =>
      assertNoPii('苯磺酸氨氯地平片 5mg 每次1片 每日1次 共7天 第一人民医院 高血压'),
    ).not.toThrow()
  })

  it('含手机号 → 抛 PiiDetectedError', () => {
    expect(() => assertNoPii(`联系电话${PHONE}`)).toThrow(PiiDetectedError)
  })

  it('错误信息只含类型×次数，绝不回显 PII 原文（错误日志本身不泄漏）', () => {
    try {
      assertNoPii(`联系${PHONE}`)
      throw new Error('应当抛出但未抛')
    } catch (e) {
      expect(e).toBeInstanceOf(PiiDetectedError)
      const msg = (e as Error).message
      expect(msg).toContain('手机号')
      expect(msg).not.toContain(PHONE)
    }
  })

  it('findPii 只报类型+位置，不含原文子串', () => {
    const matches = findPii('姓名：张三 电话：13812345678')
    const types = matches.map((m) => m.type)
    expect(types).toContain('姓名')
    expect(types).toContain('手机号')
    expect(matches.every((m) => typeof m.type === 'string' && typeof m.index === 'number')).toBe(true)
    const json = JSON.stringify(matches)
    expect(json).not.toContain(PHONE)
    expect(json).not.toContain('张三')
  })

  it.each([
    ['身份证号', `身份证${VALID_ID}`],
    ['地址', '住址：广东省深圳市南山区科技路1号'],
    ['病历号', '门诊号：MZ20260001'],
    ['姓名', '患者姓名：李四'],
  ])('检出 %s', (_type, text) => {
    expect(() => assertNoPii(text)).toThrow(PiiDetectedError)
  })

  it('P1① 反例：正常临床文案（裸“患者”开头）不被姓名模式误杀', () => {
    // 回归：旧模式 (?:...|患者|...)[：:\s]* 会把“患者教育不足”当姓名 → 假阳性
    expect(() => assertNoPii('诊断：患者教育不足，建议随访')).not.toThrow()
    expect(() => assertNoPii('患者依从性差')).not.toThrow()
    expect(() => assertNoPii('患者需长期服药')).not.toThrow()
    // 带标签的真姓名仍须检出
    expect(() => assertNoPii('姓名：张三')).toThrow(PiiDetectedError)
  })

  it('findPii 计数正确（多个手机号 → 2 次命中）', () => {
    const matches = findPii(`${PHONE} 和 13987654321`)
    expect(matches.filter((m) => m.type === '手机号')).toHaveLength(2)
  })
})
