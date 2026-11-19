/**
 * 30 天临期 / 已过期提醒组件断言（用户已拍板阈值 = 30 天，见 shared EXPIRY_WARNING_DAYS）。
 *
 * 只测呈现层对 shared expiryState 的使用：分桶计数、阈值文案不漂移、today 注入边界、
 * 未录入/非法日期 ≠ 正常（不提示也不冒充正常）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { EXPIRY_WARNING_DAYS } from '@anxin/shared'
import { ExpiryAlert, ExpiryBanner } from './ExpiryAlert'

/** 固定「今天」，避免测试随真实日期漂移：2026-11-19 + 30 天 = 2026-12-19。 */
const TODAY = '2026-11-19'

function drug(id: string, genericName: string, expiry: string | null) {
  return { id, genericName, expiry }
}

afterEach(cleanup)

describe('ExpiryAlert · 药箱顶部汇总卡', () => {
  it('已过期 + 临期混合：计数/30 天文案/明细齐全，正常与未录入不列出（安全提示已按用户要求移除）', () => {
    render(
      <ExpiryAlert
        today={TODAY}
        drugs={[
          drug('d-exp-1', '阿司匹林肠溶片', '2026-11-10'), // 已过期 9 天
          drug('d-exp-2', '二甲双胍片', '2026-10-01'), // 已过期 49 天
          drug('d-near-1', '玻璃酸钠滴眼液', '2026-11-30'), // 剩 11 天
          drug('d-near-2', '辛伐他汀片', TODAY), // 今天到期（0 天，仍属临期）
          drug('d-ok', '维生素C片', '2027-05-01'), // 正常 → 不提示
          drug('d-unknown', '待补效期药', null), // 未录入 → 不算正常，也不提示
        ]}
      />,
    )

    expect(screen.getByText('效期提醒')).toBeTruthy()
    expect(screen.getByText('已过期 2 种')).toBeTruthy()
    expect(screen.getByText(`${EXPIRY_WARNING_DAYS} 天内到期 2 种`)).toBeTruthy()
    // 明细：药名一行、到期日/状态一行；过期在前（过期最久优先），临期在后
    expect(screen.getByText('二甲双胍片')).toBeTruthy()
    expect(screen.getByText('2026-10-01 到期 · 已过期 49 天')).toBeTruthy()
    expect(screen.getByText('阿司匹林肠溶片')).toBeTruthy()
    expect(screen.getByText('2026-11-10 到期 · 已过期 9 天')).toBeTruthy()
    expect(screen.getByText('辛伐他汀片')).toBeTruthy()
    expect(screen.getByText('2026-11-19 到期 · 今天到期')).toBeTruthy()
    expect(screen.getByText('玻璃酸钠滴眼液')).toBeTruthy()
    expect(screen.getByText('2026-11-30 到期 · 剩 11 天')).toBeTruthy()
    // 过期安全提示段已删除（用户 2026-11-19 要求）
    expect(screen.queryByText(/过期药请勿继续服用/)).toBeNull()
    // 正常 / 未录入的药不出现
    expect(screen.queryByText(/维生素C片/)).toBeNull()
    expect(screen.queryByText(/待补效期药/)).toBeNull()
  })

  it('全部正常 / 效期为空 / 非法日期 → 不渲染（含空数组）', () => {
    const allOk = render(
      <ExpiryAlert
        today={TODAY}
        drugs={[
          drug('ok-1', '正常药', '2027-05-01'),
          drug('unknown', '未录入', null),
          drug('bad', '非法日期', '2026-02-31'),
        ]}
      />,
    )
    expect(allOk.container.firstChild).toBeNull()

    const empty = render(<ExpiryAlert today={TODAY} drugs={[]} />)
    expect(empty.container.firstChild).toBeNull()

    const banner = render(
      <MemoryRouter>
        <ExpiryBanner today={TODAY} drugs={[drug('ok-1', '正常药', '2027-05-01'), drug('unknown', '未录入', null)]} />
      </MemoryRouter>,
    )
    expect(banner.container.firstChild).toBeNull()
  })

  it('today 注入边界：第 30 天算临期，第 31 天不算（阈值来自 EXPIRY_WARNING_DAYS）', () => {
    expect(EXPIRY_WARNING_DAYS).toBe(30)

    const day30 = render(
      <ExpiryAlert today={TODAY} drugs={[drug('d30', '第30天到期药', '2026-12-19')]} />,
    )
    expect(screen.getByText('第30天到期药')).toBeTruthy()
    expect(screen.getByText(`2026-12-19 到期 · 剩 ${EXPIRY_WARNING_DAYS} 天`)).toBeTruthy()
    day30.unmount()

    const day31 = render(
      <ExpiryAlert today={TODAY} drugs={[drug('d31', '第31天到期药', '2026-12-20')]} />,
    )
    expect(day31.container.firstChild).toBeNull()
  })

  it('明细超过 6 条 → 只列前 6 条 +「等 N 种」', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      drug(`many-${i}`, `过期药${i + 1}`, `2026-10-${String(i + 1).padStart(2, '0')}`),
    )
    render(<ExpiryAlert today={TODAY} drugs={many} />)
    expect(screen.getByText('已过期 8 种')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('等 2 种')).toBeTruthy()
    expect(screen.queryByText(/过期药7/)).toBeNull()
    expect(screen.queryByText(/过期药8/)).toBeNull()
  })
})

describe('ExpiryBanner · 首页横幅', () => {
  it('混合 → 标题 + 分段计数（30 天来自常量）+ 去药箱链接', () => {
    render(
      <MemoryRouter>
        <ExpiryBanner
          today={TODAY}
          drugs={[
            drug('e-1', '过期药', '2026-11-01'),
            drug('n-1', '临期药', '2026-12-01'),
            drug('ok-1', '正常药', '2027-06-01'),
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('效期提醒')).toBeTruthy()
    expect(screen.getByText('已过期 1 种')).toBeTruthy()
    expect(screen.getByText(`${EXPIRY_WARNING_DAYS} 天内到期 1 种`)).toBeTruthy()
    const link = screen.getByRole('link', { name: /去药箱/ })
    expect(link.getAttribute('href')).toBe('/box')
  })
})
