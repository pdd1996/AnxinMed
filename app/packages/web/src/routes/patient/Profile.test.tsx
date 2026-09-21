/**
 * Profile 页组件断言：阿福式健康信息卡——七字段常驻 + 待补充点行即填 +
 * 编辑弹窗（性别 pill）+ 删除二次确认。只 mock 传输层（fetchProfile / client.$patch），
 * 页面与 HealthInfoCard 走真代码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Profile from './Profile'

const mocks = vi.hoisted(() => {
  const patchProfile = vi.fn()
  return {
    fetchProfile: vi.fn(),
    patchProfile,
    unwrap: vi.fn(async (res: { ok: boolean }) => res),
    client: { api: { profile: { $patch: patchProfile } } },
  }
})
vi.mock('@/api/client', () => mocks)

const ITEMS = [
  { id: 'h1', fieldKey: '过敏史', value: '青霉素', sourceMeta: { source: 'self_reported', confirmedAt: '2026-09-01T00:00:00.000Z' } },
  { id: 'h2', fieldKey: '性别', value: '男', sourceMeta: null },
  { id: 'h3', fieldKey: '年龄', value: '68', sourceMeta: null },
  { id: 'h4', fieldKey: '诊断', value: '高血压、2型糖尿病', sourceMeta: { source: 'prescription_confirmed', confirmedAt: '2026-09-10T00:00:00.000Z' } },
]

function renderProfile() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.fetchProfile.mockReset()
  mocks.fetchProfile.mockResolvedValue({ items: ITEMS })
  mocks.patchProfile.mockReset()
  mocks.patchProfile.mockResolvedValue({ ok: true, items: [] })
})
afterEach(cleanup)

describe('Profile 页 · 健康信息卡常驻字段', () => {
  it('七字段全部展示：已填显示值，缺失字段显示「待补充」', async () => {
    renderProfile()
    for (const field of ['性别', '年龄', '出生年月', '过敏史', '特殊状态', '紧急联系人', '诊断']) {
      expect(await screen.findByText(field)).toBeTruthy()
    }
    expect(screen.getByText('青霉素')).toBeTruthy()
    expect(screen.getByText('高血压、2型糖尿病')).toBeTruthy()
    // 已填 4 条（过敏史/性别/年龄/诊断），未填 3 条（出生年月/特殊状态/紧急联系人）
    expect(screen.getAllByText('待补充')).toHaveLength(3)
  })

  it('逐条来源标注（PRD §7.1.2）：用户自述 ×3，处方笺抄录 · 已确认 ×1', async () => {
    renderProfile()
    await screen.findByText('青霉素')
    expect(screen.getAllByText('用户自述')).toHaveLength(3)
    expect(screen.getByText('处方笺抄录 · 已确认')).toBeTruthy()
  })
})

describe('Profile 页 · 补充与编辑弹窗', () => {
  it('点待补充行 → 补充弹窗 → 填值保存 → PATCH 收到 upserts', async () => {
    renderProfile()
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /出生年月/ }))
    expect(await screen.findByText('补充「出生年月」')).toBeTruthy()
    const input = screen.getByLabelText('出生年月（内容）') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1958-06' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(mocks.patchProfile).toHaveBeenCalledWith({
        json: { upserts: [{ fieldKey: '出生年月', value: '1958-06' }] },
      }),
    )
  })

  it('性别字段弹窗渲染男/女大按钮（pill 单选），选「女」保存', async () => {
    renderProfile()
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /性别/ }))
    expect(await screen.findByText('编辑「性别」')).toBeTruthy()
    const male = screen.getByRole('button', { name: '男' }) as HTMLButtonElement
    const female = screen.getByRole('button', { name: '女' }) as HTMLButtonElement
    expect(male.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(female)
    expect(female.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(mocks.patchProfile).toHaveBeenCalledWith({ json: { upserts: [{ fieldKey: '性别', value: '女' }] } }),
    )
  })

  it('编辑已填行：删除需二次确认，确认后 PATCH 收到 deletes', async () => {
    renderProfile()
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /过敏史/ }))
    expect(await screen.findByText('编辑「过敏史」')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    // 二次确认态出现，此时尚未发起删除
    expect(screen.getByText(/确定删除这条健康信息/)).toBeTruthy()
    expect(mocks.patchProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(mocks.patchProfile).toHaveBeenCalledWith({ json: { deletes: ['过敏史'] } }))
  })
})
