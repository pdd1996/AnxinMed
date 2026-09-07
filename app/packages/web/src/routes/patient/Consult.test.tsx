/**
 * M3-T2 · 咨询页端到端断言（spec §T2 完成标准：四风险等级 UI 状态全部可达）。
 *
 * 只 mock 传输层（@/api/client 的 fetchDrugs + postConsult），页面/组件全走真代码：
 * 断言的是「渲染出来的 DOM 到底有没有按 riskLevel 分派 EmergencyCard / AnswerCard」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DrugDTOType } from '@anxin/shared'
import Consult from './Consult'
import type { ConsultResponseDto } from '@/api/client'

const mocks = vi.hoisted(() => ({
  fetchDrugs: vi.fn(),
  postConsult: vi.fn(),
}))
vi.mock('@/api/client', () => mocks)

// jsdom 缺件：textarea 的 scrollIntoView
Element.prototype.scrollIntoView = () => {}

const DRUG_HYCOSAN: DrugDTOType = {
  id: 'drug-1',
  genericName: '玻璃酸钠滴眼液',
  brandName: '海露',
  specification: '0.1%',
  form: '滴眼液',
  manufacturer: null,
  drugMasterId: 'dm-1',
  confirmStatus: 'ocr_matched',
  stock: null,
  openedAt: null,
  expiry: null,
  sourceId: null,
  confirmedAt: '2026-09-01T00:00:00Z',
}

const DRUG_MANUAL: DrugDTOType = {
  ...DRUG_HYCOSAN,
  id: 'drug-2',
  genericName: '手动建档的测试药',
  drugMasterId: null,
  confirmStatus: 'manual',
}

function renderConsult() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Consult />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { queryClient }
}

beforeEach(() => {
  mocks.fetchDrugs.mockReset()
  mocks.postConsult.mockReset()
  mocks.fetchDrugs.mockResolvedValue([DRUG_HYCOSAN, DRUG_MANUAL])
})
afterEach(cleanup)

describe('Consult 页 · 四风险等级 UI 状态全部可达（spec §T2 完成标准）', () => {
  it('L1 正常回答 → RiskBadge L1 + AnswerCard + citations 折叠', async () => {
    const response: ConsultResponseDto = {
      riskLevel: 'L1',
      status: 'answered',
      answer: '该药用于缓解干眼症状',
      sections: {
        summary: '该药用于缓解干眼症状',
        keyPoints: ['保湿润滑作用'],
        risks: [],
        nextAction: '如症状持续请咨询眼科医生',
        warning: '不要自行调整处方',
      },
      citations: [
        { drugName: '玻璃酸钠滴眼液', source: '丁香园用药助手', version: '2024-01', unverified: false },
      ],
      notice: null,
      l0Notice: null,
      blocked: false,
      consultLogId: 'clog-1',
    }
    mocks.postConsult.mockResolvedValue(response)
    renderConsult()

    // 等药品列表加载
    await screen.findByText('玻璃酸钠滴眼液')
    // 输入问题 + 发送
    const textarea = screen.getByPlaceholderText(/输入关于已确认药品的问题/)
    fireEvent.change(textarea, { target: { value: '这个药通常用于什么？' } })
    fireEvent.click(screen.getByLabelText('发送'))

    // 等 mutation 完成
    await waitFor(() => {
      expect(screen.getByText('低风险')).toBeTruthy() // RiskBadge L1
      expect(screen.getByText('已回答')).toBeTruthy() // status 徽章
      expect(screen.getByText('该药用于缓解干眼症状')).toBeTruthy()
      // citations 折叠（文本被 <strong> 分割，用正则匹配）
      expect(screen.getByText(/来源/)).toBeTruthy()
    })
  })

  it('L4 紧急信号 → EmergencyCard（置顶大按钮 tel:120）', async () => {
    const response: ConsultResponseDto = {
      riskLevel: 'L4',
      status: 'emergency',
      answer: '你描述的情况可能需要紧急处理。',
      sections: {
        summary: '你描述的情况可能需要紧急处理。',
        keyPoints: [],
        risks: ['不要等待 AI 继续判断，也不要自行处理。'],
        nextAction: '请立即拨打当地急救电话或尽快前往急诊。',
        warning: '紧急情况下，AI 不能替代急救或专业医疗评估。',
      },
      citations: [],
      notice: null,
      l0Notice: null,
      blocked: true,
      consultLogId: 'clog-2',
    }
    mocks.postConsult.mockResolvedValue(response)
    renderConsult()

    await screen.findByText('玻璃酸钠滴眼液')
    const textarea = screen.getByPlaceholderText(/输入关于已确认药品的问题/)
    fireEvent.change(textarea, { target: { value: '我胸痛得厉害' } })
    fireEvent.click(screen.getByLabelText('发送'))

    await waitFor(() => {
      expect(screen.getByText('紧急风险提示')).toBeTruthy()
      const callBtn = screen.getByRole('link', { name: /立即拨打 120/ })
      expect(callBtn.getAttribute('href')).toBe('tel:120')
    })
  })

  it('L3 拒答 → RiskBadge L3 + blocked + sections 固定文案', async () => {
    const response: ConsultResponseDto = {
      riskLevel: 'L3',
      status: 'refused',
      answer: '我不能建议你自行增减剂量、停药或换药',
      sections: {
        summary: '我不能建议你自行增减剂量、停药或换药',
        keyPoints: ['用药调整需要结合诊断、检查结果和完整用药情况。'],
        risks: ['自行调整可能导致治疗失败、不良反应或其他风险。'],
        nextAction: '请联系开具处方的医生或药师。',
        warning: '不要根据 AI 回答自行调整处方。',
      },
      citations: [],
      notice: null,
      l0Notice: null,
      blocked: true,
      consultLogId: 'clog-3',
    }
    mocks.postConsult.mockResolvedValue(response)
    renderConsult()

    await screen.findByText('玻璃酸钠滴眼液')
    const textarea = screen.getByPlaceholderText(/输入关于已确认药品的问题/)
    fireEvent.change(textarea, { target: { value: '能不能停药' } })
    fireEvent.click(screen.getByLabelText('发送'))

    await waitFor(() => {
      expect(screen.getByText('注意')).toBeTruthy() // RiskBadge L3
      expect(screen.getByText('已拒答')).toBeTruthy()
      expect(screen.getByText(/请联系开具处方的医生或药师/)).toBeTruthy()
    })
  })

  it('L2 剂量过滤 → RiskBadge L2 + notice "已过滤具体剂量建议"', async () => {
    const response: ConsultResponseDto = {
      riskLevel: 'L2',
      status: 'limited',
      answer: '已过滤剂量',
      sections: {
        summary: '每日使用超过10次需咨询医生',
        keyPoints: ['保湿作用'],
        risks: [],
        nextAction: '具体用量和疗程请按医生处方或说明书执行。',
        warning: '不要自行调整处方',
      },
      citations: [{ drugName: '玻璃酸钠滴眼液', source: '丁香园用药助手', version: '2024-01' }],
      notice: '已过滤具体剂量建议。用量请按医生处方或说明书执行。',
      l0Notice: null,
      blocked: false,
      consultLogId: 'clog-4',
    }
    mocks.postConsult.mockResolvedValue(response)
    renderConsult()

    await screen.findByText('玻璃酸钠滴眼液')
    const textarea = screen.getByPlaceholderText(/输入关于已确认药品的问题/)
    fireEvent.change(textarea, { target: { value: '这个药怎么用' } })
    fireEvent.click(screen.getByLabelText('发送'))

    await waitFor(() => {
      expect(screen.getByText('提示')).toBeTruthy() // RiskBadge L2
      expect(screen.getByText('已过滤剂量')).toBeTruthy() // status 徽章
      expect(screen.getByText(/已过滤具体剂量建议/)).toBeTruthy()
    })
  })
})

describe('Consult 页 · manual 档提示（spec §T2.2）', () => {
  it('选中 manual 档药 → 明确提示 "未经 OCR 确认，AI 个性化咨询不可用"', async () => {
    renderConsult()
    await screen.findByText('玻璃酸钠滴眼液')
    // 点击 manual 档药 chip
    fireEvent.click(screen.getByText('手动建档的测试药'))
    // 提示出现
    await waitFor(() => {
      expect(screen.getByText(/未经 OCR 确认/)).toBeTruthy()
      expect(screen.getByText(/AI 个性化咨询不可用/)).toBeTruthy()
    })
  })
})

describe('Consult 页 · 快捷问题 + 输入框交互', () => {
  it('点击快捷问题 → 触发 postConsult（无需手动输入）', async () => {
    mocks.postConsult.mockResolvedValue({
      riskLevel: 'L1',
      status: 'answered',
      answer: '回答',
      sections: { summary: '回答', keyPoints: [], risks: [], nextAction: '下一步', warning: '提示' },
      citations: [],
      blocked: false,
      consultLogId: 'clog-5',
    })
    renderConsult()
    await screen.findByText('玻璃酸钠滴眼液')
    // 点击快捷问题
    fireEvent.click(screen.getByText('这个药通常用于什么？'))
    await waitFor(() => {
      expect(mocks.postConsult).toHaveBeenCalledWith('这个药通常用于什么？', ['drug-1'])
    })
  })

  it('未选药品（空药箱）时 → 说明书类快捷问题 disabled，数据查询类仍可点（意图路由 T5）', async () => {
    mocks.postConsult.mockResolvedValue({
      riskLevel: 'L1',
      status: 'data-answered',
      answer: '药箱里目前没有药品',
      sections: { summary: '药箱里目前没有药品', keyPoints: [], risks: [], nextAction: '先录入药品', warning: '提示' },
      citations: [],
      blocked: false,
      toolUsed: 'medication-list',
      consultLogId: 'clog-6',
    })
    mocks.fetchDrugs.mockResolvedValue([]) // 空药箱
    renderConsult()
    await waitFor(() => {
      expect(screen.getByText(/药箱为空/)).toBeTruthy()
    })
    // 说明书类快捷问题 disabled（需选药）
    const quickBtn = screen.getByText('这个药通常用于什么？').closest('button')
    expect(quickBtn?.disabled).toBe(true)
    // 数据查询类快捷问题始终可点，点击后 drugIds=[]
    const dataBtn = screen.getByText('我现在有多少药物？').closest('button')
    expect(dataBtn?.disabled).toBe(false)
    fireEvent.click(dataBtn!)
    await waitFor(() => {
      expect(mocks.postConsult).toHaveBeenCalledWith('我现在有多少药物？', [])
    })
    // data-answered 渲染：「数据查询」徽章 + toolUsed 小字徽章
    await waitFor(() => {
      expect(screen.getByText('数据查询')).toBeTruthy()
      expect(screen.getByText('来源：药箱清单')).toBeTruthy()
    })
  })
})
