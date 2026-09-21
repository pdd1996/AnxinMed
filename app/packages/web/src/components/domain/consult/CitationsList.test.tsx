/**
 * CitationsList 段落锚点透传测试（M4-T9 · specs/04-T9 完成标准：锚点透传 web 测试）。
 * 组件全走真代码：断言 sectionKey → 中文段落名展示、T4 sectionLabel 兼容、无锚点不渲染段落。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CitationsList } from './CitationsList'
import type { Citation } from '@anxin/shared'

afterEach(cleanup)

function open(citations: Citation[]) {
  render(<CitationsList citations={citations} />)
  fireEvent.click(screen.getByRole('button')) // 展开折叠
}

describe('CitationsList · 段落锚点透传（M4-T9）', () => {
  it('sectionKey → 中文段落名（适应症段）', () => {
    open([{ drugName: '玻璃酸钠滴眼液', source: '丁香园', version: '2024-01', unverified: false, sectionKey: 'indication' }])
    expect(screen.getByText(/来源：/)).toBeTruthy()
    expect(screen.getByText('（适应症段）')).toBeTruthy()
  })

  it('T4 sectionLabel 兼容：禁忌标记照旧渲染（禁忌段）', () => {
    open([
      { drugName: '玻璃酸钠滴眼液', source: '丁香园', version: '2024-01', unverified: false, sectionLabel: '禁忌', sectionKey: 'contraindication' },
    ])
    expect(screen.getByText('（禁忌段）')).toBeTruthy()
  })

  it('无锚点（数据直答/网络检索引用）→ 不渲染段落', () => {
    open([{ drugName: '我的用药数据', source: '本地数据库', version: 'x', unverified: false }])
    expect(screen.queryByText(/段）/)).toBeNull()
  })
})
