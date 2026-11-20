/**
 * M3-T2 · AnswerCard 组件断言（spec §T2 完成标准：四风险等级 UI 状态全部可达）。
 *
 * 纯 props 驱动（不 mock API）：断言各 riskLevel/status 分支的渲染产物。
 * 风险等级/状态/来源徽章、以及底部 citations 折叠区已按产品新口径移除，
 * 测试改为断言「这些元素不出现、正文仍完整」。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ConsultSections } from '@anxin/shared'
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

describe('AnswerCard · 四风险等级 UI 状态（spec §T2 完成标准）', () => {
  it('L1 answered → 结构化 sections（徽章与 citations 已移除）', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="该药用于缓解干眼症状"
        sections={mkSections()}
        citations={[]}
      />,
    )
    // 风险/状态徽章已移除
    expect(screen.queryByText('低风险')).toBeNull()
    expect(screen.queryByText('可参考说明书')).toBeNull()
    expect(screen.queryByText('已回答')).toBeNull()
    // citations 折叠区已移除
    expect(screen.queryByText(/来源 1 条/)).toBeNull()
    // sections 结构化
    expect(screen.getByText('简明结论')).toBeTruthy()
    expect(screen.getByText('该药用于缓解干眼症状')).toBeTruthy()
    expect(screen.getByText('需要知道')).toBeTruthy()
    expect(screen.getByText('保湿润滑作用')).toBeTruthy()
    expect(screen.getByText('注意风险')).toBeTruthy()
    expect(screen.getByText('偶见眼部刺激感')).toBeTruthy()
    expect(screen.getByText('下一步')).toBeTruthy()
    expect(screen.getByText('如症状持续请咨询眼科医生')).toBeTruthy()
  })

  it('M11-T2：提示卡短摘要 + details 展开原文（逐字 note 不进摘要）', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="data-answered"
        answer="当前在服药品组合检出 1 项相互作用提示。"
        sections={mkSections({
          summary: '当前在服药品组合检出 1 项相互作用提示。',
          keyPoints: ['[禁忌] 华法林钠片 + 阿司匹林肠溶片'],
          details: [{ title: '[禁忌] 华法林钠片 + 阿司匹林肠溶片', body: '禁止同时使用华法林钠片与阿司匹林肠溶片。', source: '测试规则库' }],
        })}
        citations={[]}
      />,
    )
    expect(screen.queryByText('数据查询')).toBeNull()
    expect(screen.getByText('[禁忌] 华法林钠片 + 阿司匹林肠溶片', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('展开原文（1 条）')).toBeTruthy()
    expect(screen.getByText('禁止同时使用华法林钠片与阿司匹林肠溶片。')).toBeTruthy()
    expect(screen.getByText('来源：测试规则库')).toBeTruthy()
  })

  it('L2 limited → notice "已过滤具体剂量建议"（徽章已移除）', () => {
    render(
      <AnswerCard
        riskLevel="L2"
        status="limited"
        answer="已过滤剂量"
        sections={mkSections({ summary: '已过滤具体剂量建议', nextAction: '具体用量和疗程请按医生处方或说明书执行。' })}
        citations={[]}
        notice="已过滤具体剂量建议。用量请按医生处方或说明书执行。"
      />,
    )
    expect(screen.queryByText('提示')).toBeNull()
    expect(screen.queryByText('已过滤剂量')).toBeNull()
    expect(screen.getByText('已过滤具体剂量建议。用量请按医生处方或说明书执行。')).toBeTruthy()
  })

  it('L3 refused → blocked 边框 + sections 固定文案（徽章已移除）', () => {
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
    expect(screen.queryByText('注意')).toBeNull()
    expect(screen.queryByText('已拒答')).toBeNull()
    expect(screen.getByText('请联系开具处方的医生或药师')).toBeTruthy()
  })

  it('manual-gate → 不渲染 l0Notice banner（2026-11-20 用户裁定删除）', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="manual-gate"
        answer="手动建档药仅可查看说明书原文"
        sections={mkSections({ summary: '手动建档药仅可查看说明书原文' })}
        citations={[]}
        l0Notice="该药品为用户手动建档（未经 OCR 确认），AI 个性化咨询不可用，仅可查询药品资料（L0）。"
        blocked
      />,
    )
    expect(screen.queryByText('仅资料查询')).toBeNull()
    expect(screen.queryByText(/未经 OCR 确认/)).toBeNull()
    expect(screen.getByText('手动建档药仅可查看说明书原文')).toBeTruthy()
  })

  // 2026-11-20 排版优化 + 用户裁定删除顶部 banner：L0 卡只保留原文语义标签/折叠/查看入口
  it('L0（manual-gate）→ 无顶部 banner，原文版式 + 展开原文 + 查看入口', () => {
    render(
      <MemoryRouter>
        <AnswerCard
          riskLevel="L1"
          status="manual-gate"
          answer="用于缓解干眼症状"
          sections={mkSections({
            summary: '用于缓解干眼症状',
            keyPoints: ['开封后一个月内使用'],
            risks: ['对玻璃酸钠过敏者禁用'],
            details: [{ title: '适应症段（原文）', body: '用于缓解干眼症状', source: '丁香园用药助手' }],
          })}
          citations={[
            {
              drugName: '玻璃酸钠滴眼液',
              source: '丁香园用药助手',
              version: '2024-01',
              unverified: false,
              reviewStatus: 'crawled',
              specification: '0.1%（10mL:10mg）',
              approvalNumbers: ['国药准字H20240001'],
            },
          ]}
          l0Notice="该药说明书尚未人工核验，暂不能提供个性化解释，仅可查看说明书原文。"
          leafletHref="/leaflet/drug-1"
          blocked
        />
      </MemoryRouter>,
    )
    // 顶部 banner 已删除（未核验/身份/来源只在「查看完整说明书」页展示）
    expect(screen.queryByText(/暂不能提供个性化解释/)).toBeNull()
    expect(screen.queryByText(/核验状态：/)).toBeNull()
    expect(screen.queryByText(/批准文号：/)).toBeNull()
    // 原文语义标题（不再写「简明结论/需要知道/注意风险」）
    expect(screen.getByText('说明书原文')).toBeTruthy()
    expect(screen.getByText('注意事项')).toBeTruthy()
    expect(screen.getByText('禁忌')).toBeTruthy()
    expect(screen.queryByText('简明结论')).toBeNull()
    // 完整原文进折叠区 + 查看入口
    expect(screen.getByText('展开原文（1 条）')).toBeTruthy()
    expect(screen.getByText('适应症段（原文）')).toBeTruthy()
    expect(screen.getByText('查看完整说明书').closest('a')?.getAttribute('href')).toBe('/leaflet/drug-1')
  })

  it('说明书可用性回答（未核验）→ 无顶部 banner；结论里保留核验状态 + 查看入口', () => {
    render(
      <MemoryRouter>
        <AnswerCard
          riskLevel="L1"
          status="answered"
          answer="已收录「玻璃酸钠滴眼液」的说明书原文，但尚未人工核验。"
          sections={mkSections({
            summary: '已收录「玻璃酸钠滴眼液 0.1%」的说明书原文，但尚未人工核验。',
            keyPoints: ['以下内容为说明书原文摘录，仅供查阅，请以药品包装内说明书为准。'],
            risks: ['对玻璃酸钠过敏者禁用。'],
          })}
          citations={[
            {
              drugName: '玻璃酸钠滴眼液',
              source: '说明书 PDF（本地资料库）',
              version: '2024-01',
              unverified: false,
              reviewStatus: 'crawled',
              specification: '0.1%（10mL:10mg）',
              approvalNumbers: ['国药准字H20240001'],
            },
          ]}
          l0Notice="该药说明书尚未人工核验，暂不能提供个性化解释，仅可查看说明书原文。涉及：玻璃酸钠滴眼液。"
          leafletHref="/leaflet/drug-1"
        />
      </MemoryRouter>,
    )
    // 顶部 banner 已删除；核验状态由结论句承担（不再重复身份/来源/批准文号）
    expect(screen.queryByText(/暂不能提供个性化解释/)).toBeNull()
    expect(screen.queryByText(/核验状态：/)).toBeNull()
    expect(screen.getByText(/但尚未人工核验/)).toBeTruthy()
    expect(screen.getByText('查看完整说明书').closest('a')?.getAttribute('href')).toBe('/leaflet/drug-1')
    // 可用性回答不是原文卡：标题仍是「简明结论」（原文卡才用「说明书原文」）
    expect(screen.getByText('简明结论')).toBeTruthy()
    expect(screen.queryByText('说明书原文')).toBeNull()
  })

  it('no-source → notice 兜底提示（状态徽章已移除）', () => {
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
    expect(screen.queryByText('本地未收录')).toBeNull()
    expect(screen.getByText(/医疗搜索兜底/)).toBeTruthy()
  })

  it('ai-unavailable → notice 降级说明（状态徽章已移除）', () => {
    render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="降级回答"
        sections={mkSections({ summary: '降级回答' })}
        citations={[]}
        notice="百川服务不可用，回答由本地说明书库规则拼装（演示降级）。"
      />,
    )
    // status 仍为 answered（降级路径也返回 L1 正常回答）
    expect(screen.queryByText('已回答')).toBeNull()
    expect(screen.getByText(/百川服务不可用/)).toBeTruthy()
  })
})

describe('AnswerCard · 对象澄清（M13-P1）', () => {
  it('clarify → 渲染药名选项；点选回传 drugId（≥44px 触控目标由类名保证）', () => {
    const onPickDrug = vi.fn()
    render(
      <AnswerCard
        riskLevel="L1"
        status="clarify"
        answer="你想问药箱里的哪种药？"
        sections={mkSections({
          summary: '你想问药箱里的哪种药？',
          keyPoints: ['点选下面的药名，我会按该药的说明书回答。'],
          risks: [],
          nextAction: '点选一种药继续提问。',
          warning: '我只基于本地说明书库解释已确认药品的资料。',
        })}
        citations={[]}
        clarifyOptions={[{ drugId: 'drug-1', drugName: '玻璃酸钠滴眼液（海露）' }]}
        onPickDrug={onPickDrug}
      />,
    )
    expect(screen.getByText('选择一种药继续：')).toBeTruthy()
    const option = screen.getByRole('button', { name: '玻璃酸钠滴眼液（海露）' })
    expect(option.className).toContain('min-h-11')
    fireEvent.click(option)
    expect(onPickDrug).toHaveBeenCalledWith('drug-1')
  })
})
