/**
 * M3-T2 · EmergencyCard 组件断言（spec §T2 完成标准：L4 急救引导卡置顶大按钮）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ConsultSections } from '@anxin/shared'
import { EmergencyCard } from './EmergencyCard'

afterEach(cleanup)

const EMERGENCY_SECTIONS: ConsultSections = {
  summary: '你描述的情况可能需要紧急处理。',
  keyPoints: [],
  risks: ['不要等待 AI 继续判断，也不要自行处理。'],
  nextAction: '请立即拨打当地急救电话或尽快前往急诊，并携带药品包装、说明书和已知服药量。',
  warning: '紧急情况下，AI 不能替代急救或专业医疗评估。',
}

describe('EmergencyCard · L4 急救引导卡（PRD §7.5.1）', () => {
  it('渲染 "紧急风险提示" 标题 + summary + risks + nextAction + warning', () => {
    render(<EmergencyCard sections={EMERGENCY_SECTIONS} />)
    expect(screen.getByText('紧急风险提示')).toBeTruthy()
    expect(screen.getByText('你描述的情况可能需要紧急处理。')).toBeTruthy()
    expect(screen.getByText('不要等待 AI 继续判断，也不要自行处理。')).toBeTruthy()
    expect(screen.getByText(/请立即拨打当地急救电话/)).toBeTruthy()
    expect(screen.getByText(/AI 不能替代急救/)).toBeTruthy()
  })

  it('置顶大按钮 "立即拨打 120"（tel:120 链接，移动端一键拨号）', () => {
    render(<EmergencyCard sections={EMERGENCY_SECTIONS} />)
    const callBtn = screen.getByRole('link', { name: /立即拨打 120/ })
    expect(callBtn).toBeTruthy()
    expect(callBtn.getAttribute('href')).toBe('tel:120')
    // 老年向：大按钮（min-h-14）
    expect(callBtn.className).toContain('min-h-14')
  })

  it('辅助按钮 "查找附近急诊"（外链）', () => {
    render(<EmergencyCard sections={EMERGENCY_SECTIONS} />)
    const mapBtn = screen.getByRole('link', { name: /查找附近急诊/ })
    expect(mapBtn).toBeTruthy()
    expect(mapBtn.getAttribute('target')).toBe('_blank')
  })
})
