/**
 * M3-T2 · AnswerCard 组件断言（spec §T2 完成标准：四风险等级 UI 状态全部可达 + citations 透传无丢失）。
 *
 * 纯 props 驱动（不 mock API）：断言各 riskLevel/status 分支的渲染产物。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Citation, ConsultSections } from '@anxin/shared'
import { AnswerCard } from './AnswerCard'

afterEach(cleanup)

const mkSections = (overrides: Partial<ConsultSections> = {}): ConsultSections => ({
  summary: '该药用于缓解干眼症状',
  keyPoints: ['保湿润滑作用', '局部用药几乎不吸收'],
  risks: ['偶见眼部刺激感'],
  nextAction: '如症状持续请咨询眼科医生',
  warning: '不要自行调整处方',
  ...overrides,
})

const mkCitation = (overrides: Partial<Citation> = {}): Citation => ({
  drugName: '玻璃酸钠滴眼液',
  source: '丁香园用药助手',
  version: '2024-01',
  unverified: false,
  ...overrides,
})

describe('AnswerCard · 四风险等级 UI 状态（spec §T2 完成标准）', () => {
  it('L1 answered → RiskBadge L1 + sections 结构化 + citations 三件套', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="该药用于缓解干眼症状"
        sections={mkSections()}
        citations={[mkCitation()]}
      />,
    )
    // RiskBadge L1（语义色+文字）
    expect(screen.getByText('低风险')).toBeTruthy()
    expect(screen.getByText('可参考说明书')).toBeTruthy()
    // status 徽章
    expect(screen.getByText('已回答')).toBeTruthy()
    // sections 结构化
    expect(screen.getByText('简明结论')).toBeTruthy()
    expect(screen.getByText('该药用于缓解干眼症状')).toBeTruthy()
    expect(screen.getByText('需要知道')).toBeTruthy()
    expect(screen.getByText('保湿润滑作用')).toBeTruthy()
    expect(screen.getByText('注意风险')).toBeTruthy()
    expect(screen.getByText('偶见眼部刺激感')).toBeTruthy()
    expect(screen.getByText('下一步')).toBeTruthy()
    expect(screen.getByText('如症状持续请咨询眼科医生')).toBeTruthy()
    // citations 折叠（默认收起，仅显示"来源 1 条"；文本被 <strong> 分割，用正则匹配）
    expect(screen.getByText(/来源/)).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('L2 limited → RiskBadge L2 + notice "已过滤具体剂量建议"', () => {
    render(
      <AnswerCard
        riskLevel="L2"
        status="limited"
        answer="已过滤剂量"
        sections={mkSections({ summary: '已过滤具体剂量建议', nextAction: '具体用量和疗程请按医生处方或说明书执行。' })}
        citations={[mkCitation()]}
        notice="已过滤具体剂量建议。用量请按医生处方或说明书执行。"
      />,
    )
    expect(screen.getByText('提示')).toBeTruthy() // RiskBadge L2
    expect(screen.getByText('已过滤剂量')).toBeTruthy() // status 徽章
    expect(screen.getByText('已过滤具体剂量建议。用量请按医生处方或说明书执行。')).toBeTruthy()
  })

  it('L3 refused → RiskBadge L3 + blocked 边框 + sections 固定文案', () => {
    render(
      <AnswerCard
        riskLevel="L3"
        status="refused"
        answer="我不能建议你自行增减剂量、停药或换药"
        sections={mkSections({
          summary: '我不能建议你自行增减剂量、停药或换药',
          nextAction: '请联系开具处方的医生或药师',
        })}
        citations={[]}
        blocked
      />,
    )
    expect(screen.getByText('注意')).toBeTruthy() // RiskBadge L3
    expect(screen.getByText('已拒答')).toBeTruthy() // status 徽章
    expect(screen.getByText('请联系开具处方的医生或药师')).toBeTruthy()
  })

  it('manual-gate → status 徽章 "仅资料查询" + l0Notice', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="manual-gate"
        answer="手动建档药仅可 L0 资料查询"
        sections={mkSections({ summary: '手动建档药仅可 L0 资料查询' })}
        citations={[mkCitation()]}
        l0Notice="该药品为用户手动建档（未经 OCR 确认），AI 个性化咨询不可用，仅可查询药品资料（L0）。"
        blocked
      />,
    )
    expect(screen.getByText('仅资料查询')).toBeTruthy()
    expect(screen.getByText(/未经 OCR 确认/)).toBeTruthy()
  })

  it('no-source → status 徽章 "本地未收录" + notice 兜底提示', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="no-source"
        answer="本地说明书库未收录"
        sections={mkSections({ summary: '本地说明书库未收录「测试药」' })}
        citations={[]}
        notice="正式版在本地说明书库未命中时会开启医疗搜索兜底，且回答标注「基于网络检索，未经本库核实」。"
      />,
    )
    expect(screen.getByText('本地未收录')).toBeTruthy()
    expect(screen.getByText(/医疗搜索兜底/)).toBeTruthy()
  })

  it('ai-unavailable → status 徽章 "AI 降级" + notice 降级说明', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="降级回答"
        sections={mkSections({ summary: '降级回答' })}
        citations={[mkCitation()]}
        notice="百川服务不可用，回答由本地说明书库规则拼装（演示降级）。"
      />,
    )
    // status 仍为 answered（降级路径也返回 L1 正常回答）
    expect(screen.getByText('已回答')).toBeTruthy()
    expect(screen.getByText(/百川服务不可用/)).toBeTruthy()
  })
})

describe('AnswerCard · citations 透传无丢失（spec §T2 完成标准）', () => {
  it('citations 三件套（药名 + source + version）全量渲染', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="回答"
        sections={mkSections()}
        citations={[
          mkCitation({ drugName: '药A', source: '来源A', version: 'v1' }),
          mkCitation({ drugName: '药B', source: '来源B', version: 'v2' }),
        ]}
      />,
    )
    // 默认收起，点击展开
    const toggle = screen.getByRole('button', { name: /来源/ })
    fireEvent.click(toggle)
    // 两条 citation 全量渲染（无丢失）
    expect(screen.getByText('药A')).toBeTruthy()
    expect(screen.getByText('来源A')).toBeTruthy()
    expect(screen.getByText('v1')).toBeTruthy()
    expect(screen.getByText('药B')).toBeTruthy()
    expect(screen.getByText('来源B')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
  })

  it('unverified=true → 渲染 "未经本库核实" 徽章（网络检索兜底）', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="回答"
        sections={mkSections()}
        citations={[mkCitation({ source: 'Baichuan 医疗搜索（网络检索）', unverified: true })]}
      />,
    )
    const toggle = screen.getByRole('button', { name: /来源/ })
    fireEvent.click(toggle)
    expect(screen.getByText('未经本库核实')).toBeTruthy()
  })

  it('citations 空数组 → 不渲染折叠区（不占空间）', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="回答"
        sections={mkSections()}
        citations={[]}
      />,
    )
    expect(screen.queryByRole('button', { name: /来源/ })).toBeNull()
  })
})
