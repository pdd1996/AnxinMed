/**
 * M2-T7 · 确认页组件断言（任务书完成标准：needsManual 字段无法被预填值、冲突清单不自动选择）。
 *
 * 只 mock 传输层（@/api/client 的三个函数），页面/纯逻辑/组件全走真代码：
 * 断言的是「渲染出来的 DOM 到底有没有预填值、有没有替用户选边、闸门是否真的挡住」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIntakeSession } from '@/stores/intakeSession'
import { mkDraft, rxConflictPayload, rxNeedsManualPayload, rxUniquePayload, drugBoxPayload } from '@/lib/draft-fixtures'
import type { DraftPayload } from '@/lib/draft'
import Draft from './Draft'

const mocks = vi.hoisted(() => ({
  fetchDraft: vi.fn(),
  confirmDraft: vi.fn(),
  rejectDraft: vi.fn(),
}))
vi.mock('@/api/client', () => mocks)

// jsdom 缺件：Radix Dialog（信息不符 / 确认结果弹窗）依赖 ResizeObserver 与 scrollIntoView
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = () => {} // jsdom 未实现，Radix Dialog 聚焦时会调用

const CONFIRM_OK = {
  drugId: 'drug-1',
  planId: 'plan-1',
  sourceId: 'src-1',
  status: 'confirmed' as const,
  interactions: { hits: [], coverageNote: null },
  dosageRange: { status: 'pass' as const, issues: [] },
}

function renderDraft(payload: DraftPayload, opts: { id?: string; status?: 'pending' | 'confirmed' | 'rejected' } = {}) {
  const id = opts.id ?? 'draft-1'
  mocks.fetchDraft.mockResolvedValue(mkDraft(payload, { id, status: opts.status }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/drafts/${id}`]}>
        <Routes>
          <Route path="/drafts/:id" element={<Draft />} />
          <Route path="/box" element={<p>药箱页</p>} />
          <Route path="/intake/rx" element={<p>处方笺录入页</p>} />
          <Route path="/intake/drug" element={<p>药品录入页</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { id, queryClient }
}

/** 勾满三项「已核对」+ 使用人（成功路径草稿的放行条件）。 */
async function passGates() {
  for (const label of ['已核对每次用量', '已核对频次', '已核对疗程']) {
    fireEvent.click(await screen.findByLabelText(label))
  }
  fireEvent.click(screen.getByLabelText('我已确认本药的使用人'))
}

beforeEach(() => {
  mocks.confirmDraft.mockReset()
  mocks.rejectDraft.mockReset()
  mocks.fetchDraft.mockReset()
  useIntakeSession.getState().clear()
})
afterEach(cleanup)

describe('needsManual 字段无法被预填值', () => {
  it('用法行缺失（sigMissing + needsManual）→ 用量/频次输入框为空，显示原文该行 + 人工补提示，确认被挡住', async () => {
    renderDraft(rxNeedsManualPayload)
    const dose = (await screen.findByLabelText('每次用量')) as HTMLInputElement
    const freq = (await screen.findByLabelText('每日几次')) as HTMLInputElement
    expect(dose.value).toBe('')
    expect(freq.value).toBe('')
    expect(dose.placeholder).toBe('人工补录')
    // 原文该行照实展示（该行缺失就说缺失，不编造）
    expect(screen.getAllByText(/该行缺失或被涂黑/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/系统不预填猜测/).length).toBeGreaterThan(0)
    // 处方日期缺失 → 开始日期为系统默认值，必须显式提示（不静默兜底）
    expect(screen.getByText(/处方日期在原文中缺失或被涂黑/)).toBeTruthy()
    const button = screen.getByRole('button', { name: /确认建档并生效计划/ })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByLabelText('我已确认本药的使用人'))
    expect(mocks.confirmDraft).not.toHaveBeenCalled() // 用量/频次未填 → 仍不放行
  })

  it('人工补录后可提交，且 tags 把用量/频次标为「自填」', async () => {
    const { id } = renderDraft(rxNeedsManualPayload)
    mocks.confirmDraft.mockResolvedValue(CONFIRM_OK)
    fireEvent.change(await screen.findByLabelText('每次用量'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('每日几次'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' })) // 时间点：原文无建议，用户自己加
    fireEvent.click(screen.getByLabelText('我已确认本药的使用人'))
    fireEvent.click(screen.getByRole('button', { name: /确认建档并生效计划/ }))
    await waitFor(() => expect(mocks.confirmDraft).toHaveBeenCalledTimes(1))
    const [calledId, body] = mocks.confirmDraft.mock.calls[0]
    expect(calledId).toBe(id)
    expect(body.plan).toMatchObject({
      dose: { value: 1, unit: '滴' },
      frequency: 4,
      cycleType: 'open',
      tags: { dose: 'user', frequency: 'user', duration: 'user', times: 'user' },
    })
    expect(body.health).toEqual([]) // 未勾选 → 不写入
  })
})

describe('冲突清单不自动选择', () => {
  it('规格冲突 → 候选全部未选中、确认被挡住；用户点选后才放行并按候选落库', async () => {
    renderDraft(rxConflictPayload)
    const radios = (await screen.findAllByRole('radio')) as HTMLInputElement[]
    expect(radios).toHaveLength(2)
    expect(radios.every((r) => !r.checked)).toBe(true) // 系统不选边
    expect(screen.getByText(/冲突清单 —— 系统不选边/)).toBeTruthy()
    const button = screen.getByRole('button', { name: /确认建档并生效计划/ })
    expect(button.hasAttribute('disabled')).toBe(true)

    mocks.confirmDraft.mockResolvedValue(CONFIRM_OK)
    fireEvent.click(radios[1])
    expect(radios[1].checked).toBe(true)
    await passGates()
    fireEvent.click(screen.getByRole('button', { name: /确认建档并生效计划/ }))
    await waitFor(() => expect(mocks.confirmDraft).toHaveBeenCalledTimes(1))
    expect(mocks.confirmDraft.mock.calls[0][1].drug).toMatchObject({
      drugMasterId: 'dm-hycosan-02',
      specification: '0.2%（10mL:20mg）',
    })
  })

  it('「都不符 · 改用手动建档」→ 身份字段留空且必填，drugMasterId=null / confirmStatus=manual', async () => {
    renderDraft(rxConflictPayload)
    fireEvent.click(await screen.findByRole('button', { name: /都不符 · 改用手动建档/ }))
    const name = (await screen.findByLabelText('药名')) as HTMLInputElement
    expect(screen.getByText(/身份线无唯一匹配/)).toBeTruthy()
    fireEvent.change(name, { target: { value: '玻璃酸钠滴眼液' } })
    fireEvent.change(screen.getByLabelText('规格'), { target: { value: '0.1%（10mL：10mg）' } })
    fireEvent.change(screen.getByLabelText('剂型'), { target: { value: '滴眼液' } })
    await passGates()
    mocks.confirmDraft.mockResolvedValue(CONFIRM_OK)
    fireEvent.click(screen.getByRole('button', { name: /确认建档并生效计划/ }))
    await waitFor(() => expect(mocks.confirmDraft).toHaveBeenCalledTimes(1))
    expect(mocks.confirmDraft.mock.calls[0][1].drug).toMatchObject({
      genericName: '玻璃酸钠滴眼液',
      drugMasterId: null,
      confirmStatus: 'manual',
    })
  })
})

describe('唯一闸门：逐项核对 + 使用人 + 提交后跳转', () => {
  it('抄录值齐全也必须逐项勾「已核对」；勾满后提交 → 跳转药箱', async () => {
    renderDraft(rxUniquePayload)
    const button = await screen.findByRole('button', { name: /确认建档并生效计划/ })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/请勾选「已核对」每次用量与处方原文一致/)).toBeTruthy()
    mocks.confirmDraft.mockResolvedValue(CONFIRM_OK)
    await passGates()
    expect(screen.queryByText(/请勾选「已核对」/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /确认建档并生效计划/ }))
    await waitFor(() => expect(mocks.confirmDraft).toHaveBeenCalledTimes(1))
    const body = mocks.confirmDraft.mock.calls[0][1]
    expect(body.plan).toMatchObject({
      dose: { value: 1, unit: '滴' },
      frequency: 4,
      cycleType: 'closed',
      endDate: '2026-09-09',
      tags: { dose: 'transcribed', frequency: 'transcribed', duration: 'transcribed', times: 'assist', startDate: 'default', endDate: 'derived' },
    })
    expect(await screen.findByText('药箱页')).toBeTruthy() // 提交后跳转
    expect(useIntakeSession.getState().imageByDraftId).toEqual({}) // 原图即用即弃
  })

  it('confirm 响应含规则检查发现 → 跳转前弹出结果（只标注不阻止）', async () => {
    renderDraft(rxUniquePayload)
    mocks.confirmDraft.mockResolvedValue({
      ...CONFIRM_OK,
      interactions: {
        hits: [{ level: '禁忌', note: '禁止联用（演示规则）', source: '演示规则库', drugIds: ['dm-x'], drugNames: ['某药'] }],
        coverageNote: null,
      },
      dosageRange: { status: 'exceed', issues: [{ field: 'frequency', planValue: '每日 4 次', insertMax: '每日 3 次', insertNote: '超说明书上限' }] },
    })
    await passGates()
    fireEvent.click(screen.getByRole('button', { name: /确认建档并生效计划/ }))
    expect(await screen.findByText(/已写入药箱/)).toBeTruthy()
    expect(screen.getByText(/最高级别为「禁忌」/)).toBeTruthy()
    expect(screen.getByText(/超说明书上限/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /我已知悉，去药箱/ }))
    expect(await screen.findByText('药箱页')).toBeTruthy()
  })

  it('confirm 后缓存回读到 confirmed → 结果弹窗不被只读态抢先卸载（UI 竞态回归）', async () => {
    const { queryClient } = renderDraft(rxUniquePayload)
    mocks.confirmDraft.mockResolvedValue({
      ...CONFIRM_OK,
      interactions: {
        hits: [{ level: '慎用', note: '联用需评估（演示规则）', source: '演示规则库', drugIds: ['dm-x'], drugNames: ['某药'] }],
        coverageNote: null,
      },
    })
    await passGates()
    fireEvent.click(screen.getByRole('button', { name: /确认建档并生效计划/ }))
    expect(await screen.findByText(/已写入药箱/)).toBeTruthy()
    // 模拟 confirm 后 invalidate 的回读结果落进缓存（线上竞态的触发源）：status 变 confirmed。
    // 用 async act 冲掉 react-query 通知观察者的微任务，保证重渲染真的发生。
    await act(async () => {
      queryClient.setQueryData(['draft', 'draft-1'], mkDraft(rxUniquePayload, { id: 'draft-1', status: 'confirmed' }))
      await new Promise((resolve) => setTimeout(resolve, 0)) // 跨过宏任务边界，让 react-query 的观察者通知落地
    })
    // 弹窗必须仍可见（修复前：本页被换成只读卡，弹窗随之卸载）
    expect(screen.getByText(/最高级别为「慎用」/)).toBeTruthy()
    expect(screen.queryByText(/本草稿已确认/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /我已知悉，去药箱/ }))
    expect(await screen.findByText('药箱页')).toBeTruthy()
  })

  it('健康建议：勾选才提交，且 fieldKey 只能来自建议清单；改过值提交改后值', async () => {
    renderDraft(rxUniquePayload)
    mocks.confirmDraft.mockResolvedValue(CONFIRM_OK)
    fireEvent.click(await screen.findByLabelText('勾选写入诊断'))
    const value = screen.getByLabelText('诊断（写入值）') as HTMLInputElement
    expect(value.value).toBe('干眼综合征')
    fireEvent.change(value, { target: { value: '干眼（我自己写的）' } })
    await passGates()
    fireEvent.click(screen.getByRole('button', { name: /确认建档并生效计划/ }))
    await waitFor(() => expect(mocks.confirmDraft).toHaveBeenCalledTimes(1))
    const health = mocks.confirmDraft.mock.calls[0][1].health
    expect(health).toEqual([{ fieldKey: '诊断', value: '干眼（我自己写的）' }])
    expect(rxUniquePayload.healthSuggestions.map((s) => s.field)).toContain(health[0].fieldKey)
  })

  it('信息不符 → 留痕拒绝并回到重拍 / 手动建档', async () => {
    renderDraft(rxUniquePayload)
    mocks.rejectDraft.mockResolvedValue({ id: 'draft-1', status: 'rejected' })
    fireEvent.click(await screen.findByRole('button', { name: /信息不符/ }))
    fireEvent.click(await screen.findByRole('button', { name: /重新拍摄/ }))
    await waitFor(() => expect(mocks.rejectDraft).toHaveBeenCalledTimes(1))
    expect(mocks.rejectDraft.mock.calls[0][1]).toContain('重新拍摄')
    expect(await screen.findByText('处方笺录入页')).toBeTruthy()
  })
})

describe('原文对照与入口B', () => {
  it('会话内有原图 → 按 cropBox 几何裁剪渲染 + 低置信字符红框叠加', async () => {
    const url = 'data:image/png;base64,AAAA'
    useIntakeSession.getState().setSession(['draft-1'], url)
    renderDraft(rxUniquePayload)
    const img = (await screen.findByAltText('处方正文裁剪图')) as HTMLImageElement
    expect(img.getAttribute('src')).toBe(url)
    expect(img.style.width).toBe('900px') // cropBox.w
    expect(img.style.height).toBe('260px') // cropBox.h
    expect(screen.getAllByTitle(/识别置信度/)).toHaveLength(2) // 低置信字符标红
    expect(screen.getByText(/低置信字符 2 个/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '放大原文图' })).toBeTruthy()
  })

  it('会话内无原图（刷新/直接打开链接）→ 明确降级为文字原文对照，不静默', async () => {
    renderDraft(rxUniquePayload)
    expect(await screen.findByText(/本次会话已无原图/)).toBeTruthy()
    expect(screen.queryByAltText('处方正文裁剪图')).toBeNull()
    expect(screen.getByText('滴眼 每次1滴 每日4次 共7天')).toBeTruthy() // 用法原文行仍在
  })

  it('入口B 药盒草稿 → 无任何用法用量输入，显示标签不抄录提示，确认后跳药箱建计划', async () => {
    renderDraft(drugBoxPayload)
    expect(await screen.findByText(/标签用法不会被自动抄录/)).toBeTruthy()
    expect(screen.queryByLabelText('每次用量')).toBeNull()
    expect(screen.queryByLabelText('每日几次')).toBeNull()
    expect(screen.queryByLabelText('我已确认本药的使用人')).toBeNull() // 无处方前记语义 → 不弹使用人核对
    mocks.confirmDraft.mockResolvedValue({ ...CONFIRM_OK, planId: null })
    fireEvent.click(screen.getByRole('button', { name: /确认建档（计划稍后手动创建）/ }))
    await waitFor(() => expect(mocks.confirmDraft).toHaveBeenCalledTimes(1))
    expect(mocks.confirmDraft.mock.calls[0][1].plan).toBeUndefined()
    expect(await screen.findByText('药箱页')).toBeTruthy()
  })

  it('已确认的草稿 → 只读态，不再渲染确认按钮（防重复操作）', async () => {
    renderDraft(rxUniquePayload, { status: 'confirmed' })
    expect(await screen.findByText(/本草稿已确认/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /确认建档/ })).toBeNull()
  })
})
