/**
 * M2-T8 · 录入页组件断言：五个 golden case 场景在 UI 上可达且反馈正确（任务书完成标准，mock 管线响应）。
 *
 * 只 mock 传输层（@/api/client 三函数）与像素统计（computeImageStats，jsdom 无 canvas）；
 * 流程状态机、失败映射、会话 store 交接全走真代码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { IntakeFlow, type IntakeCopy } from './IntakeFlow'
import { useIntakeSession } from '@/stores/intakeSession'
import { SAFETY_NOTE } from '@/lib/intake'

const mocks = vi.hoisted(() => ({
  detectImage: vi.fn(),
  intakePrescription: vi.fn(),
  intakeDrug: vi.fn(),
  computeImageStats: vi.fn(),
}))
vi.mock('@/api/client', () => mocks)
vi.mock('@/lib/intake', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/intake')>()
  return { ...actual, computeImageStats: (...args: unknown[]) => mocks.computeImageStats(...args) }
})

const COPY_A: IntakeCopy = {
  entry: 'A',
  pageTitle: '拍处方笺录入',
  pageLead: 'lead',
  uploadTitle: '上传平铺完整的处方笺照片',
  uploadHint: '覆盖 Rp 至「处方完毕」',
  guidePoints: ['处方笺平铺完整入镜'],
  otherEntryLabel: '拍药品',
  otherEntryPath: '/intake/drug',
}
const COPY_B: IntakeCopy = { ...COPY_A, entry: 'B', pageTitle: '拍药品建档', otherEntryLabel: '拍处方笺', otherEntryPath: '/intake/rx' }

const detectOk = (layers: string[], mismatch: string | null = null) => ({
  ok: true,
  data: { layers, unsupported: false, mismatch },
})
const summary = (over: Record<string, unknown> = {}) => ({
  id: 'd-1',
  type: 'prescription',
  drugName: '玻璃酸钠滴眼液',
  matchStatus: 'unique',
  needsManual: 0,
  labelNotice: false,
  degraded: null,
  ...over,
})
const intakeOk = (drafts: Record<string, unknown>[]) => ({
  ok: true,
  data: { draftIds: drafts.map((d) => d.id as string), drafts },
})

function renderFlow(entry: 'A' | 'B' = 'A') {
  // key 按入口：真实应用里两入口是不同的页面组件（IntakeRx/IntakeDrug），路由切换必然重挂载；
  // 测试直接复用 IntakeFlow 时必须用 key 模拟，否则 React 复用实例、状态与挂载效应都不重置。
  render(
    <MemoryRouter initialEntries={[entry === 'A' ? '/intake/rx' : '/intake/drug']}>
      <Routes>
        <Route path="/intake/rx" element={<IntakeFlow key="A" copy={COPY_A} />} />
        <Route path="/intake/drug" element={<IntakeFlow key="B" copy={COPY_B} />} />
        <Route path="/drafts/:id" element={<p>确认页占位</p>} />
        <Route path="/box" element={<p>药箱页</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function upload() {
  const input = screen.getByLabelText('上传照片') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'rx.png', { type: 'image/png' })] } })
}

beforeEach(() => {
  mocks.detectImage.mockReset()
  mocks.intakePrescription.mockReset()
  mocks.intakeDrug.mockReset()
  mocks.computeImageStats.mockReset()
  mocks.computeImageStats.mockResolvedValue(null) // jsdom 无 canvas → 跳过预检
  useIntakeSession.getState().clear()
  useIntakeSession.getState().setPendingImage(null)
})
afterEach(cleanup)

describe('golden case ① rx-normal：单草稿直接进确认页', () => {
  it('detect 相符 → 跑入口A 管线 → 原图进会话 store → 跳转 /drafts/:id', async () => {
    mocks.detectImage.mockResolvedValue(detectOk(['处方层']))
    mocks.intakePrescription.mockResolvedValue(intakeOk([summary()]))
    renderFlow('A')
    upload()
    expect(await screen.findByText('确认页占位')).toBeTruthy()
    const [dataUrl, entry] = mocks.detectImage.mock.calls[0]
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(entry).toBe('A')
    expect(mocks.intakePrescription).toHaveBeenCalledTimes(1)
    expect(useIntakeSession.getState().imageByDraftId['d-1']).toMatch(/^data:image\/png;base64,/)
  })

  it('golden ② rx-spec-conflict / ③ rx-redacted：单草稿同样直达确认页（冲突与人工补在确认页处理）', async () => {
    mocks.detectImage.mockResolvedValue(detectOk(['处方层']))
    mocks.intakePrescription.mockResolvedValue(intakeOk([summary({ matchStatus: 'conflict', needsManual: 2 })]))
    renderFlow('A')
    upload()
    expect(await screen.findByText('确认页占位')).toBeTruthy()
  })
})

describe('多草稿：一张处方笺拆 N 份 → 列表逐个确认', () => {
  it('2 份草稿 → 列表卡 + 每份徽章（冲突/需人工补）+ 逐个去确认 + 原图共享', async () => {
    mocks.detectImage.mockResolvedValue(detectOk(['处方层']))
    mocks.intakePrescription.mockResolvedValue(
      intakeOk([summary({ id: 'd-1', matchStatus: 'conflict' }), summary({ id: 'd-2', needsManual: 2 })]),
    )
    renderFlow('A')
    upload()
    expect(await screen.findByText(/识别完成：2 份草稿待确认/)).toBeTruthy()
    expect(screen.getByText('冲突待核对')).toBeTruthy()
    expect(screen.getByText('2 项需人工补')).toBeTruthy()
    const session = useIntakeSession.getState().imageByDraftId
    expect(session['d-1']).toBeTruthy()
    expect(session['d-2']).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /去确认/ })[1])
    expect(await screen.findByText('确认页占位')).toBeTruthy()
  })
})

describe('golden case ④ drug-box-labeled：入口B 仅身份线', () => {
  it('走 intakeDrug（不走 prescription），标签提示草稿直达确认页', async () => {
    mocks.detectImage.mockResolvedValue(detectOk(['医院标签层', '药盒原装层']))
    mocks.intakeDrug.mockResolvedValue(intakeOk([summary({ type: 'drug', labelNotice: true })]))
    renderFlow('B')
    upload()
    expect(await screen.findByText('确认页占位')).toBeTruthy()
    expect(mocks.intakeDrug).toHaveBeenCalledTimes(1)
    expect(mocks.intakePrescription).not.toHaveBeenCalled()
  })
})

describe('golden case ⑤ unsupported-loose-pills：不支持对象不进入提取', () => {
  it('detect 判不支持 → 不支持卡 + 统一安全提示 + 手动建档兜底，且不调管线', async () => {
    mocks.detectImage.mockResolvedValue({ ok: true, data: { layers: ['不支持'], unsupported: true, mismatch: null } })
    renderFlow('A')
    upload()
    expect(await screen.findByText('该对象暂不支持')).toBeTruthy()
    expect(screen.getByText(SAFETY_NOTE)).toBeTruthy()
    expect(mocks.intakePrescription).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /手动建档（不经识别）/ }))
    expect(await screen.findByText('药箱页')).toBeTruthy()
  })
})

describe('层检测纠偏：不静默改道', () => {
  it('detect 返回 mismatch → 纠偏卡（建议 + 层标签 + 三动作）；切换入口把原图交接给对方入口直接重跑', async () => {
    const suggestion = '检测到药盒原装层，未检测到处方层。你选择的是「拍处方笺」，是否切换到「拍药品」入口？'
    // 按入口给响应（比按调用次序的 once 队列稳）：A 恒纠偏、B 恒相符
    mocks.detectImage.mockImplementation((_img: string, entry: 'A' | 'B') =>
      Promise.resolve(entry === 'A' ? detectOk(['药盒原装层'], suggestion) : detectOk(['药盒原装层'])),
    )
    mocks.intakeDrug.mockResolvedValue(intakeOk([summary({ type: 'drug' })]))
    renderFlow('A')
    upload()
    expect(await screen.findByText('检测结果与所选入口不符')).toBeTruthy()
    expect(screen.getByText(suggestion)).toBeTruthy()
    expect(screen.getByText('药盒原装层')).toBeTruthy()
    expect(mocks.intakePrescription).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /切换到「拍药品」重跑/ }))
    // 对方入口挂载后自动用交接图重跑（entry=B）
    expect(await screen.findByText('确认页占位')).toBeTruthy()
    expect(mocks.detectImage).toHaveBeenCalledTimes(2)
    expect(mocks.detectImage.mock.calls[1][1]).toBe('B')
    expect(useIntakeSession.getState().pendingImage).toBeNull() // 交接用完即清
  })

  it('服务端 409（detect 与 intake 判定不一致）→ 同样落在纠偏卡而非静默失败', async () => {
    mocks.detectImage.mockResolvedValue(detectOk(['处方层']))
    mocks.intakePrescription.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'LAYER_MISMATCH',
      message: '层检测结果与所选入口不符，请确认或切换入口',
      details: { detected: ['说明书层'], suggestion: '未检测到处方层，请确认拍摄对象。' },
    })
    renderFlow('A')
    upload()
    expect(await screen.findByText(/无法可靠识别|检测结果与所选入口不符/)).toBeTruthy()
    expect(screen.getAllByText(/未检测到处方层/).length).toBeGreaterThan(0)
  })
})

describe('AI 不可用 → 明确降级引导', () => {
  it('503 → 降级卡：手动建档兜底 + 说明照片不必重拍', async () => {
    mocks.detectImage.mockResolvedValue(detectOk(['处方层']))
    mocks.intakePrescription.mockResolvedValue({
      ok: false,
      status: 503,
      code: 'AI_UNAVAILABLE',
      message: '识别服务暂不可用，请稍后重试，或改用「手动建档」录入',
      details: {},
    })
    renderFlow('A')
    upload()
    expect(await screen.findByText('识别服务暂不可用')).toBeTruthy()
    expect(screen.getByText(/不需要重拍/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /手动建档（不经识别）/ }))
    expect(await screen.findByText('药箱页')).toBeTruthy()
  })
})

describe('本地质量预检：具体重拍建议且不拦用户', () => {
  it('过暗照片 → 建议卡（过暗 + 重拍话术）；点「仍要上传」照常跑管线', async () => {
    mocks.computeImageStats.mockResolvedValue({ meanLuma: 30, clippedRatio: 0.01, sharpness: 0.1, width: 1600, height: 1200 })
    mocks.detectImage.mockResolvedValue(detectOk(['处方层']))
    mocks.intakePrescription.mockResolvedValue(intakeOk([summary()]))
    renderFlow('A')
    upload()
    expect(await screen.findByText('照片质量可能影响识别')).toBeTruthy()
    expect(screen.getByText(/环境过暗：到光线充足处重拍/)).toBeTruthy()
    expect(mocks.detectImage).not.toHaveBeenCalled() // 预检阶段不下传
    fireEvent.click(screen.getByRole('button', { name: /仍要上传/ }))
    expect(await screen.findByText('确认页占位')).toBeTruthy()
  })

  it('「重拍 / 换一张」回到上传步且清空图片', async () => {
    mocks.computeImageStats.mockResolvedValue({ meanLuma: 20, clippedRatio: 0.5, sharpness: 0.001, width: 300, height: 300 })
    renderFlow('A')
    upload()
    expect(await screen.findByText('照片质量可能影响识别')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重拍 \/ 换一张/ }))
    expect(await screen.findByText('上传平铺完整的处方笺照片')).toBeTruthy()
    expect(mocks.detectImage).not.toHaveBeenCalled()
  })
})

describe('上传前置校验', () => {
  it('非法类型被拒且不下传（toast 由 sonner 承接，流程停在上传步）', async () => {
    renderFlow('A')
    const input = screen.getByLabelText('上传照片') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4)], 'a.gif', { type: 'image/gif' })] } })
    await waitFor(() => expect(mocks.detectImage).not.toHaveBeenCalled())
    expect(screen.getByText('上传平铺完整的处方笺照片')).toBeTruthy()
  })
})
