/**
 * M5-T2 · 录入流程状态机纯函数单测（core 新增，任务书完成标准：覆盖六步流转）。
 *
 * 断言的是「决策」本身：给定（当前状态 + 事件/IO 结果 + 页面常量）→（新状态 + 动作描述列表）。
 * 六步 = upload / quality / processing / mismatch / failure / drafts；
 * 另覆盖失败映射、mismatch 换入口、单草稿直达 vs 多草稿列表分支、阶段文案推进与跨入口交接。
 */
import { describe, it, expect } from 'vitest'
import { ERR_CODES } from '@anxin/shared'
import {
  initialIntakeFlowState,
  transitionIntakeFlow,
  type IntakeDraftSummary,
  type IntakeFlowCtx,
  type IntakeFlowEvent,
  type IntakeFlowState,
  type IntakeRunResult,
} from './flow'

/** 入口A 页面常量（处方笺五阶段）。 */
const CTX_A: IntakeFlowCtx = { entry: 'A', otherEntryPath: '/intake/drug', stageCount: 5 }
const CTX_B: IntakeFlowCtx = { entry: 'B', otherEntryPath: '/intake/rx', stageCount: 4 }

const DATA_URL = 'data:image/png;base64,AAA'
const GOOD_STATS = { meanLuma: 140, clippedRatio: 0.02, sharpness: 0.09, width: 1600, height: 1200 }

function draft(id: string, over: Partial<IntakeDraftSummary> = {}): IntakeDraftSummary {
  return {
    id,
    type: 'prescription',
    drugName: '玻璃酸钠滴眼液',
    matchStatus: 'unique',
    needsManual: 0,
    labelNotice: false,
    degraded: null,
    ...over,
  }
}

function runResult(ids: string[]): IntakeRunResult {
  return { draftIds: ids, drafts: ids.map((id) => draft(id)) }
}

/** 迁移一步并取出结果（默认从初始态出发，可用 with 叠加中途状态）。 */
function run(event: IntakeFlowEvent, over?: Partial<IntakeFlowState>, ctx: IntakeFlowCtx = CTX_A) {
  const state: IntakeFlowState = { ...initialIntakeFlowState(), ...over }
  return transitionIntakeFlow(state, event, ctx)
}

/** 动作里是否有某类型的动作（可选谓词）。 */
function hasAction(actions: ReturnType<typeof transitionIntakeFlow>['actions'], type: string) {
  return actions.some((a) => a.type === type)
}

describe('六步流转 · upload 步（起点与前置校验）', () => {
  it('初始态是 upload 步、无图、阶段下标 0', () => {
    expect(initialIntakeFlowState()).toMatchObject({ step: 'upload', image: null, stageIdx: 0 })
  })

  it('validateFile 不通过 → 停在 upload 步，只有一条 toast 动作（不进入读取/下传）', () => {
    const { state, actions } = run({ type: 'file_rejected', message: '请上传 JPG、PNG 或 WebP 图片' })
    expect(state.step).toBe('upload')
    expect(actions).toEqual([{ type: 'toast', message: '请上传 JPG、PNG 或 WebP 图片' }])
  })

  it('读文件成功 → 落原图但仍停在 upload 步，动作是本地像素统计（预检不下载）', () => {
    const { state, actions } = run({ type: 'file_read', dataUrl: DATA_URL })
    expect(state.image).toBe(DATA_URL)
    expect(state.step).toBe('upload')
    expect(actions).toEqual([{ type: 'compute_stats', dataUrl: DATA_URL }])
  })
})

describe('六步流转 · quality 步（预检是建议，不拦用户）', () => {
  it('过暗统计 → quality 步 + too-dark，且不发起任何 IO 动作', () => {
    const { state, actions } = run(
      { type: 'stats_checked', stats: { ...GOOD_STATS, meanLuma: 30 } },
      { image: DATA_URL },
    )
    expect(state.step).toBe('quality')
    expect(state.issues).toEqual(['too-dark'])
    expect(actions).toEqual([])
  })

  it('统计不可用（null=本端降级不预检）→ 视为无问题，直接进 processing 并发起层检测', () => {
    const { state, actions } = run({ type: 'stats_checked', stats: null }, { image: DATA_URL })
    expect(state.step).toBe('processing')
    expect(actions).toEqual([{ type: 'detect', entry: 'A', dataUrl: DATA_URL }])
  })

  it('质量卡「仍要上传」→ processing + 层检测（照片照常下传）', () => {
    const { state, actions } = run(
      { type: 'retry' },
      { step: 'quality', image: DATA_URL, issues: ['too-dark'] },
    )
    expect(state.step).toBe('processing')
    expect(actions).toEqual([{ type: 'detect', entry: 'A', dataUrl: DATA_URL }])
  })
})

describe('六步流转 · processing 步（阶段文案推进）', () => {
  it('定时器每 tick 前进一格，末阶段封顶', () => {
    let state = { ...initialIntakeFlowState(), step: 'processing', image: DATA_URL } as IntakeFlowState
    state = run({ type: 'stage_tick' }, state).state
    expect(state.stageIdx).toBe(1)
    state = run({ type: 'stage_tick' }, { ...state, stageIdx: 4 }).state
    expect(state.stageIdx).toBe(4) // 入口A 共 5 条，下标封顶 4
    const b = run({ type: 'stage_tick' }, { ...state, stageIdx: 3 }, CTX_B).state
    expect(b.stageIdx).toBe(3) // 入口B 只有 4 条
  })

  it('离开 processing（如回到上传步）阶段下标归零', () => {
    const { state } = run({ type: 'retake' }, { step: 'processing', image: DATA_URL, stageIdx: 3 })
    expect(state.step).toBe('upload')
    expect(state.stageIdx).toBe(0)
  })
})

describe('六步流转 · mismatch 步（层检测纠偏，不静默改道）', () => {
  const suggestion = '检测到药盒原装层，未检测到处方层。你选择的是「拍处方笺」，是否切换到「拍药品」入口？'

  it('detect 返回 mismatch → mismatch 步 + 层标签与建议，且不发起管线', () => {
    const { state, actions } = run(
      { type: 'detect_ok', dataUrl: DATA_URL, layers: ['药盒原装层'], unsupported: false, mismatch: suggestion },
      { step: 'processing', image: DATA_URL },
    )
    expect(state.step).toBe('mismatch')
    expect(state.mismatch).toEqual({ detected: ['药盒原装层'], suggestion })
    expect(actions).toEqual([])
  })

  it('「切换到另一入口重跑」→ 原图带说明交接给入口B + 跳转；状态本身不变', () => {
    const { state, actions } = run(
      { type: 'switch_entry' },
      { step: 'mismatch', image: DATA_URL, mismatch: { detected: ['药盒原装层'], suggestion } },
    )
    expect(state.step).toBe('mismatch')
    expect(actions).toEqual([
      { type: 'session_set_pending_image', pending: { dataUrl: DATA_URL, fromEntry: 'A', note: suggestion } },
      { type: 'navigate', path: '/intake/drug' },
    ])
  })

  it('交接说明缺省顺序：mismatch.suggestion 优先于 feedback.body', () => {
    const { actions } = run(
      { type: 'switch_entry' },
      { step: 'failure', image: DATA_URL, feedback: { kind: 'generic', title: 't', body: '识别失败正文', hints: [], detected: [], allowManual: true, allowSwitch: true } },
    )
    const pending = actions[0]
    expect(pending).toEqual({ type: 'session_set_pending_image', pending: { dataUrl: DATA_URL, fromEntry: 'A', note: '识别失败正文' } })
  })

  it('无图时切换入口是空操作（原组件的 if (!image) return）', () => {
    const { actions } = run({ type: 'switch_entry' }, { step: 'mismatch', image: null })
    expect(actions).toEqual([])
  })

  it('「检测错了 · 按当前入口重试」→ 重新发起层检测', () => {
    const { state, actions } = run(
      { type: 'retry' },
      { step: 'mismatch', image: DATA_URL, mismatch: { detected: [], suggestion: 'x' } },
    )
    expect(state.step).toBe('processing')
    expect(actions).toEqual([{ type: 'detect', entry: 'A', dataUrl: DATA_URL }])
  })
})

describe('六步流转 · failure 步（四类失败都看得见、可行动）', () => {
  it('detect 判不支持 → 不支持卡（422 合成失败），不调管线', () => {
    const { state, actions } = run(
      { type: 'detect_ok', dataUrl: DATA_URL, layers: ['不支持'], unsupported: true, mismatch: null },
      { step: 'processing', image: DATA_URL },
    )
    expect(state.step).toBe('failure')
    expect(state.feedback?.kind).toBe('unsupported')
    expect(state.feedback?.detected).toEqual(['不支持'])
    expect(actions).toEqual([])
  })

  it('detect 传输失败 → 失败卡（原 applyFailure）', () => {
    const { state } = run(
      { type: 'detect_failed', failure: { status: 503, code: ERR_CODES.AI_UNAVAILABLE, message: '识别服务暂不可用', details: {} } },
      { step: 'processing', image: DATA_URL },
    )
    expect(state.step).toBe('failure')
    expect(state.feedback?.kind).toBe('unavailable')
  })

  it('管线 409（detect 与 intake 判定不一致）→ 落纠偏型失败卡，body 用服务端 suggestion', () => {
    const { state } = run(
      {
        type: 'intake_failed',
        failure: {
          status: 409,
          code: ERR_CODES.LAYER_MISMATCH,
          message: '层检测结果与所选入口不符，请确认或切换入口',
          details: { detected: ['说明书层'], suggestion: '未检测到处方层，请确认拍摄对象。' },
        },
      },
      { step: 'processing', image: DATA_URL },
    )
    expect(state.step).toBe('failure')
    expect(state.feedback?.kind).toBe('mismatch')
    expect(state.feedback?.body).toBe('未检测到处方层，请确认拍摄对象。')
  })

  it('「重新上传」→ 回到 upload 初态并清交接图', () => {
    const { state, actions } = run(
      { type: 'retake' },
      { step: 'failure', image: DATA_URL, feedback: { kind: 'generic', title: 't', body: 'b', hints: [], detected: [], allowManual: true, allowSwitch: true } },
    )
    expect(state).toEqual(initialIntakeFlowState())
    expect(actions).toEqual([{ type: 'session_clear_pending_image' }])
  })

  it('失败卡的兜底动作：手动建档 / 换到另一入口 → 只产跳移动作', () => {
    expect(run({ type: 'goto_manual' }, { step: 'failure' }).actions).toEqual([{ type: 'navigate', path: '/box?manual=1' }])
    expect(run({ type: 'goto_other_entry' }, { step: 'failure' }).actions).toEqual([{ type: 'navigate', path: '/intake/drug' }])
  })
})

describe('六步流转 · drafts 步（单草稿直达 / 多草稿列表）', () => {
  it('层检测相符 → 仍 processing，按入口发起管线（入口A）', () => {
    const { state, actions } = run(
      { type: 'detect_ok', dataUrl: DATA_URL, layers: ['处方层'], unsupported: false, mismatch: null },
      { step: 'processing', image: DATA_URL },
    )
    expect(state.step).toBe('processing')
    expect(actions).toEqual([{ type: 'intake', entry: 'A', dataUrl: DATA_URL }])
  })

  it('入口B 相符 → 发起入口B 管线', () => {
    const { actions } = run(
      { type: 'detect_ok', dataUrl: DATA_URL, layers: ['药盒原装层'], unsupported: false, mismatch: null },
      { step: 'processing', image: DATA_URL },
      CTX_B,
    )
    expect(actions).toEqual([{ type: 'intake', entry: 'B', dataUrl: DATA_URL }])
  })

  it('单草稿 → 原图进会话 + 清交接 + 直达 /drafts/:id，不落 drafts 步', () => {
    const { state, actions } = run(
      { type: 'intake_ok', dataUrl: DATA_URL, result: runResult(['d-1']) },
      { step: 'processing', image: DATA_URL },
    )
    expect(state.step).toBe('processing')
    expect(state.result).toBeNull()
    expect(actions).toEqual([
      { type: 'session_set_images', draftIds: ['d-1'], dataUrl: DATA_URL },
      { type: 'session_clear_pending_image' },
      { type: 'navigate', path: '/drafts/d-1' },
    ])
  })

  it('多草稿 → drafts 步 + 列表，不跳转；原图按 N 份草稿共享', () => {
    const { state, actions } = run(
      { type: 'intake_ok', dataUrl: DATA_URL, result: runResult(['d-1', 'd-2']) },
      { step: 'processing', image: DATA_URL },
    )
    expect(state.step).toBe('drafts')
    expect(state.result?.drafts.map((d) => d.id)).toEqual(['d-1', 'd-2'])
    expect(hasAction(actions, 'navigate')).toBe(false)
    expect(actions[0]).toEqual({ type: 'session_set_images', draftIds: ['d-1', 'd-2'], dataUrl: DATA_URL })
  })

  it('草稿列表「去确认」第 i 份 → 只跳该份确认页', () => {
    const { state, actions } = run({ type: 'open_draft', draftId: 'd-2' }, { step: 'drafts', result: runResult(['d-1', 'd-2']) })
    expect(state.step).toBe('drafts')
    expect(actions).toEqual([{ type: 'navigate', path: '/drafts/d-2' }])
  })

  it('「再传一张」→ 回上传步（drafts 步同样可复位）', () => {
    const { state } = run({ type: 'retake' }, { step: 'drafts', result: runResult(['d-1']) })
    expect(state).toEqual(initialIntakeFlowState())
  })
})

describe('跨入口交接（挂载时用对方留下的原图直接重跑）', () => {
  const pending = { dataUrl: DATA_URL, fromEntry: 'B' as const, note: '来自拍药品入口' }

  it('对方入口（B）的交接图 → 落图与说明、进 processing、按本入口（A）发起层检测', () => {
    const { state, actions } = run({ type: 'handoff', pending })
    expect(state.image).toBe(DATA_URL)
    expect(state.handoffNote).toBe('来自拍药品入口')
    expect(state.step).toBe('processing')
    expect(actions).toEqual([{ type: 'detect', entry: 'A', dataUrl: DATA_URL }])
  })

  it('本入口自己留下的图（fromEntry 相同）→ 不重跑（避免自交接死循环）', () => {
    const { state, actions } = run({ type: 'handoff', pending: { ...pending, fromEntry: 'A' } })
    expect(state.step).toBe('upload')
    expect(actions).toEqual([])
  })

  it('无交接（正常进入页面）→ 不迁移', () => {
    const { state, actions } = run({ type: 'handoff', pending: null })
    expect(state.step).toBe('upload')
    expect(actions).toEqual([])
  })
})

describe('迁移是纯函数', () => {
  it('不修改传入的状态对象（React 侧 useState 依赖引用变化）', () => {
    const before = { ...initialIntakeFlowState(), image: DATA_URL }
    const frozen = structuredClone(before)
    transitionIntakeFlow(before, { type: 'stats_checked', stats: GOOD_STATS }, CTX_A)
    expect(before).toEqual(frozen)
  })
})
