/**
 * 健康信息一级页断言（原 Profile 页测试迁移）：七字段常驻 + 待补充点行即填 +
 * 编辑弹窗（性别 pill）与删除二次确认。只 mock 传输层（fetchProfile / client.$patch）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ageFromBirthMonth } from '@anxin/shared'
import HealthInfo from './HealthInfo'

const mocks = vi.hoisted(() => {
  const patchProfile = vi.fn()
  return {
    fetchProfile: vi.fn(),
    patchProfile,
    unwrap: vi.fn(async (res: { ok: boolean }) => res),
    client: { api: { profile: { $patch: patchProfile } } },
  }
})
vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return { ...actual, ...mocks } // M5-T2：只替换传输层函数，core 的其余导出走真代码
})

const ITEMS = [
  { id: 'h1', fieldKey: '过敏史', value: '青霉素', sourceMeta: { source: 'self_reported', confirmedAt: '2026-09-01T00:00:00.000Z' } },
  { id: 'h2', fieldKey: '性别', value: '男', sourceMeta: null },
  { id: 'h3', fieldKey: '年龄', value: '68', sourceMeta: null },
  { id: 'h4', fieldKey: '诊断', value: '高血压、2型糖尿病', sourceMeta: { source: 'prescription_confirmed', confirmedAt: '2026-09-10T00:00:00.000Z' } },
]

/** 出生年月 1958-06（存储形态）+ 一条故意不一致的旧手填年龄：联动后应以出生年月算出的为准。 */
const BIRTH_ITEMS = [
  { id: 'b1', fieldKey: '出生年月', value: '1958-06', sourceMeta: { source: 'self_reported', confirmedAt: '2026-11-01T00:00:00.000Z' } },
  { id: 'b2', fieldKey: '年龄', value: '70', sourceMeta: { source: 'self_reported', confirmedAt: '2026-11-01T00:00:00.000Z' } },
]

function renderHealthInfo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    // MemoryRouter：页头有返回入口（BackLink → /profile），Link 需要路由上下文。
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <HealthInfo />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.fetchProfile.mockReset()
  mocks.fetchProfile.mockResolvedValue({ items: ITEMS })
  mocks.patchProfile.mockReset()
  mocks.patchProfile.mockResolvedValue({ ok: true, items: [] })
})
afterEach(cleanup)

describe('健康信息页 · 字段常驻', () => {
  it('页头有返回「我的」入口（二级页不在底部 tab 的 active 前缀内）', async () => {
    renderHealthInfo()
    expect(screen.getByRole('link', { name: /返回/ }).getAttribute('href')).toBe('/profile')
  })

  it('七字段全部展示：已填显示值，缺失字段显示「待补充」，并给出补充进度', async () => {
    renderHealthInfo()
    for (const field of ['性别', '年龄', '出生年月', '过敏史', '特殊状态', '紧急联系人', '诊断']) {
      expect(await screen.findByText(field)).toBeTruthy()
    }
    expect(screen.getByText('青霉素')).toBeTruthy()
    expect(screen.getByText('高血压、2型糖尿病')).toBeTruthy()
    // 已填 4 条（过敏史/性别/年龄/诊断），未填 3 条（出生年月/特殊状态/紧急联系人）
    expect(screen.getAllByText('待补充')).toHaveLength(3)
    // 进度条：4 / 7 项
    expect(await screen.findByText('4 / 7 项')).toBeTruthy()
  })

  it('逐条来源标注（PRD §7.1.2）：用户自述 ×3，处方笺抄录 · 已确认 ×1', async () => {
    renderHealthInfo()
    await screen.findByText('青霉素')
    expect(screen.getAllByText('用户自述')).toHaveLength(3)
    expect(screen.getByText('处方笺抄录 · 已确认')).toBeTruthy()
  })
})

describe('健康信息页 · 补充与编辑弹窗', () => {
  it('点待补充行 → 补充弹窗 → 敲年份 + 点月份保存 → PATCH 收到出生年月 + 联动算出的年龄', async () => {
    renderHealthInfo()
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /出生年月/ }))
    expect(await screen.findByRole('heading', { name: '出生年月' })).toBeTruthy()
    // 原生 `<input type="month">` 弹层已退役：年份可敲、月份点大按钮（见 HealthInfoCard 头注释）。
    fireEvent.change(screen.getByLabelText('出生年份'), { target: { value: '1958' } })
    fireEvent.click(screen.getByRole('button', { name: '6月' }))

    // 当前日期决定周岁；用 shared 纯函数算期望值，跨年跑测试也不写死数字。
    const age = ageFromBirthMonth('1958-06')
    expect(age).not.toBeNull()
    // 填全当场回显「1958年6月 · 自动计算 68 岁」，老人据此自证没填错。
    expect(await screen.findByText(`1958年6月 · 自动计算 ${age} 岁`)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(mocks.patchProfile).toHaveBeenCalledWith({
        json: {
          upserts: [
            { fieldKey: '出生年月', value: '1958-06' },
            { fieldKey: '年龄', value: String(age) },
          ],
        },
      }),
    )
  })

  it('出生年月弹窗：12 个月份大按钮可点，年份没填全时保存禁用并提示下一步', async () => {
    renderHealthInfo()
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /出生年月/ }))
    await screen.findByRole('heading', { name: '出生年月' })
    for (let month = 1; month <= 12; month += 1) {
      expect(screen.getByRole('button', { name: `${month}月` })).toBeTruthy()
    }
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('先填出生年份，再点出生月份。')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('出生年份'), { target: { value: '195' } })
    expect(await screen.findByText('年份要填 4 位数字，例如 1958。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('出生年份'), { target: { value: '1958' } })
    expect(await screen.findByText('再点一下出生月份。')).toBeTruthy()
  })

  it('编辑已填出生年月：回填年份且对应月份按钮为选中态', async () => {
    mocks.fetchProfile.mockResolvedValue({ items: BIRTH_ITEMS })
    renderHealthInfo()
    await screen.findByText('按出生年月自动计算')
    // 年龄行的副文案也含「出生年月」，用行首锚定出生年月那一行。
    fireEvent.click(screen.getByRole('button', { name: /^出生年月/ }))
    expect(await screen.findByRole('heading', { name: '出生年月' })).toBeTruthy()
    expect((screen.getByLabelText('出生年份') as HTMLInputElement).value).toBe('1958')
    expect(screen.getByRole('button', { name: '6月' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '1月' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('性别字段弹窗渲染男/女大按钮（pill 单选），选「女」保存', async () => {
    renderHealthInfo()
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /性别/ }))
    expect(await screen.findByRole('heading', { name: '性别' })).toBeTruthy()
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
    renderHealthInfo()
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /过敏史/ }))
    expect(await screen.findByRole('heading', { name: '过敏史' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    // 二次确认态出现，此时尚未发起删除
    expect(screen.getByText(/确定删除这条健康信息/)).toBeTruthy()
    expect(mocks.patchProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(mocks.patchProfile).toHaveBeenCalledWith({ json: { deletes: ['过敏史'] } }))
  })
})

/**
 * 「年龄」与「出生年月」联动（2026-11-19 用户反馈：两栏各填各的）。
 * 口径：有出生年月时年龄是派生只读值；手动改年龄请改出生年月；未填出生年月时年龄仍可手填。
 */
describe('健康信息页 · 年龄与出生年月联动', () => {
  it('有出生年月：年龄行只读展示自动计算值，旧手填值不再显示', async () => {
    mocks.fetchProfile.mockResolvedValue({ items: BIRTH_ITEMS })
    renderHealthInfo()
    const age = ageFromBirthMonth('1958-06')
    expect(age).not.toBeNull()
    expect(await screen.findByText('按出生年月自动计算')).toBeTruthy()
    expect(screen.getByText(String(age))).toBeTruthy()
    expect(screen.queryByText('70')).toBeNull()
  })

  it('出生年月按「1958年6月」展示，不再露出 "1958-06" 存储形态', async () => {
    mocks.fetchProfile.mockResolvedValue({ items: BIRTH_ITEMS })
    renderHealthInfo()
    expect(await screen.findByText('1958年6月')).toBeTruthy()
    expect(screen.queryByText('1958-06')).toBeNull()
  })

  it('点年龄行：说明由出生年月算出，并直达出生年月编辑', async () => {
    mocks.fetchProfile.mockResolvedValue({ items: BIRTH_ITEMS })
    renderHealthInfo()
    // 等数据回来再点：加载中行是「待补充」，点开会进补录而不是派生说明。
    await screen.findByText('按出生年月自动计算')
    const age = ageFromBirthMonth('1958-06')
    fireEvent.click(screen.getByRole('button', { name: /年龄/ }))
    expect(await screen.findByText(new RegExp(`自动算出 ${age} 岁`))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '修改出生年月' }))
    expect(await screen.findByRole('heading', { name: '出生年月' })).toBeTruthy()
  })

  it('未填出生年月：年龄仍可手填（只知年龄的老人有退路）', async () => {
    renderHealthInfo() // 默认 ITEMS 没有出生年月
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /年龄/ }))
    expect(await screen.findByRole('heading', { name: '年龄' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('年龄（内容）'), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(mocks.patchProfile).toHaveBeenCalledWith({ json: { upserts: [{ fieldKey: '年龄', value: '70' }] } }),
    )
  })

  it('未来出生年月：提示且保存按钮禁用（算不出年龄，也不该写库）', async () => {
    renderHealthInfo()
    await screen.findByText('青霉素')
    fireEvent.click(screen.getByRole('button', { name: /出生年月/ }))
    fireEvent.change(screen.getByLabelText('出生年份'), { target: { value: '2999' } })
    fireEvent.click(screen.getByRole('button', { name: '1月' }))
    expect(await screen.findByText(/不能晚于当前月份/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('补充进度：只有出生年月时，派生的年龄也算已补充', async () => {
    mocks.fetchProfile.mockResolvedValue({
      items: [{ id: 'x1', fieldKey: '出生年月', value: '1958-06', sourceMeta: null }],
    })
    renderHealthInfo()
    expect(await screen.findByText('2 / 7 项')).toBeTruthy()
  })
})
