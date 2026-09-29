import type { Entry, ImageStats, IntakeFeedback, QualityIssue } from '../lib/intake'
import { assessQuality, mapIntakeFailure } from '../lib/intake'
import type { intakePrescription } from '../api/client'

/**
 * 录入流程状态机（M5-T2 接缝 #8：从 web 的 IntakeFlow.tsx 组件内部抽出为纯决策模块）。
 *
 * 分工（本任务的核心纪律）：
 *   - core（本文件）＝**决策**：给定「当前状态 + 事件（含 IO 结果）」算出「新状态 + 动作描述列表」；
 *   - 平台层（web 的 IntakeFlow.tsx / mobile 后续同构）＝**执行**：网络请求、FileReader、
 *     canvas 像素统计、navigate 跳转、toast、900ms 阶段文案定时器、内存会话读写。
 * 因此本模块零副作用、零 DOM、可脱离 React 单测（见 flow.test.ts）。
 *
 * run() 的异步编排被拆成两半：「发起 IO」（动作）与「拿到 IO 结果后怎么迁移」（事件分支），
 * 六步流转 upload / quality / processing / mismatch / failure / drafts 全部由这里裁决。
 */

/** 六步流转（与组件内原 Step 联合类型逐字一致）。 */
export type IntakeFlowStep = 'upload' | 'quality' | 'processing' | 'mismatch' | 'failure' | 'drafts'

/** 入口管线成功结果（draftIds + 草稿概要；类型由 hc<AppType> 端到端推导，不复制）。 */
export type IntakeRunResult = Extract<Awaited<ReturnType<typeof intakePrescription>>, { ok: true }>['data']
export type IntakeDraftSummary = IntakeRunResult['drafts'][number]

/** 传输失败的结构化字段（settle() 的失败分支 / 层检测不支持的合成失败同形）。 */
export interface IntakeFailure {
  status: number
  code: string
  message: string
  details?: Record<string, unknown>
}

/** 层检测纠偏的跨入口交接（内存会话 store 里的 pendingImage）。 */
export interface IntakeHandoff {
  dataUrl: string
  fromEntry: Entry
  note: string
}

/** 流程状态：原组件 8 个 useState 的合集（70–77 行）。 */
export interface IntakeFlowState {
  step: IntakeFlowStep
  /** 本次待识别的图片（dataURL/objectURL/fileURI 字符串；null=未选文件）。 */
  image: string | null
  /** 质量预检命中的问题（quality 步渲染用）。 */
  issues: QualityIssue[]
  /** 处理中阶段文案下标（定时器每 900ms 推进，由平台执行、结果作为事件回传）。 */
  stageIdx: number
  feedback: IntakeFeedback | null
  mismatch: { detected: string[]; suggestion: string } | null
  result: IntakeRunResult | null
  /** 跨入口交接带来的说明文案（纠偏卡顶部显示）。 */
  handoffNote: string | null
}

/** 页面常量（本端入口 + 对方入口路径 + 阶段文案条数）——决策的输入，不随事件变。 */
export interface IntakeFlowCtx {
  entry: Entry
  otherEntryPath: string
  stageCount: number
}

/** 平台层要执行的动作描述（不含任何执行逻辑）。 */
export type IntakeFlowAction =
  | { type: 'toast'; message: string }
  | { type: 'compute_stats'; dataUrl: string }
  | { type: 'detect'; entry: Entry; dataUrl: string }
  | { type: 'intake'; entry: Entry; dataUrl: string }
  | { type: 'session_set_images'; draftIds: string[]; dataUrl: string }
  | { type: 'session_set_pending_image'; pending: IntakeHandoff }
  | { type: 'session_clear_pending_image' }
  | { type: 'navigate'; path: string }

/** 事件：平台层的 IO 结果与用户动作。 */
export type IntakeFlowEvent =
  | { type: 'file_rejected'; message: string }
  | { type: 'file_read'; dataUrl: string }
  /** 像素统计结果（null=本端不预检/不能预检 → 视为无问题，主流程照走）。 */
  | { type: 'stats_checked'; stats: ImageStats | null }
  /** 「仍要上传」/「检测错了 · 按当前入口重试」。 */
  | { type: 'retry' }
  | { type: 'detect_ok'; dataUrl: string; layers: string[]; unsupported: boolean; mismatch: string | null }
  | { type: 'detect_failed'; failure: IntakeFailure }
  | { type: 'intake_ok'; dataUrl: string; result: IntakeRunResult }
  | { type: 'intake_failed'; failure: IntakeFailure }
  /** 「重拍 / 换一张」「重新上传」「再传一张」。 */
  | { type: 'retake' }
  /** 纠偏卡的「切换到另一入口重跑」。 */
  | { type: 'switch_entry' }
  /** 失败卡的「手动建档」兜底。 */
  | { type: 'goto_manual' }
  /** 上传步的平级 tab / 失败卡的「换到另一入口」。 */
  | { type: 'goto_other_entry' }
  /** 草稿列表的「去确认」。 */
  | { type: 'open_draft'; draftId: string }
  /** 阶段文案定时器到点。 */
  | { type: 'stage_tick' }
  /** 挂载时读到的跨入口交接（null=没有，不迁移）。 */
  | { type: 'handoff'; pending: IntakeHandoff | null }

export interface IntakeFlowTransition {
  state: IntakeFlowState
  actions: IntakeFlowAction[]
}

/** 初始态：上传步、无图（对应组件原先 8 个 useState 的初值）。 */
export function initialIntakeFlowState(): IntakeFlowState {
  return {
    step: 'upload',
    image: null,
    issues: [],
    stageIdx: 0,
    feedback: null,
    mismatch: null,
    result: null,
    handoffNote: null,
  }
}

/**
 * 非 processing 步一律把阶段下标归零（原组件的 useEffect 语义：离开 processing 即 setStageIdx(0)）。
 * 单独抽出，避免每个分支重复一遍。
 */
function normalize(state: IntakeFlowState): IntakeFlowState {
  return state.step === 'processing' ? state : { ...state, stageIdx: 0 }
}

/** 进入 processing 并发起层检测（原 run() 的开头 + detectImage 调用）。 */
function startRun(state: IntakeFlowState, ctx: IntakeFlowCtx, dataUrl: string): IntakeFlowTransition {
  return {
    state: { ...state, step: 'processing', stageIdx: 0 },
    actions: [{ type: 'detect', entry: ctx.entry, dataUrl }],
  }
}

/** 失败卡：反馈映射（core 纯函数）+ 落 failure 步（原 applyFailure）。 */
function toFailure(state: IntakeFlowState, failure: IntakeFailure): IntakeFlowTransition {
  return {
    state: normalize({ ...state, step: 'failure', feedback: mapIntakeFailure(failure) }),
    actions: [],
  }
}

/** 回到上传步：本次上下文全部清空（交接图一并清掉）。 */
function backToUpload(): IntakeFlowTransition {
  return {
    state: initialIntakeFlowState(),
    actions: [{ type: 'session_clear_pending_image' }],
  }
}

/**
 * 单步迁移：输入（当前状态 + 事件 + 页面常量）→ 输出（新状态 + 动作列表）。纯函数。
 */
export function transitionIntakeFlow(
  state: IntakeFlowState,
  event: IntakeFlowEvent,
  ctx: IntakeFlowCtx,
): IntakeFlowTransition {
  switch (event.type) {
    // 上传前置校验结果（validateFile 是 core 纯函数，FileReader 是平台 IO）
    case 'file_rejected':
      return { state: normalize(state), actions: [{ type: 'toast', message: event.message }] }

    case 'file_read':
      // 原组件：setImage 后立刻做本地像素统计，此间仍停在上传步（不提前进 processing）
      return {
        state: normalize({ ...state, image: event.dataUrl }),
        actions: [{ type: 'compute_stats', dataUrl: event.dataUrl }],
      }

    case 'stats_checked': {
      const issues = event.stats ? assessQuality(event.stats) : []
      if (issues.length > 0) {
        // 质量预检是**建议**：进 quality 步等用户决定，不拦用户、不下传
        return { state: normalize({ ...state, issues, step: 'quality' }), actions: [] }
      }
      const dataUrl = state.image
      if (!dataUrl) return { state: normalize(state), actions: [] }
      return startRun(state, ctx, dataUrl)
    }

    case 'retry': {
      const dataUrl = state.image
      if (!dataUrl) return { state: normalize(state), actions: [] }
      return startRun(state, ctx, dataUrl)
    }

    // ── 层检测结果（原 run() 的前半段分支）──
    case 'detect_ok': {
      if (event.unsupported) {
        return toFailure(state, {
          status: 422,
          code: 'UNSUPPORTED_OBJECT',
          message: '层检测判定为不支持的对象（如散装药片），本次不进入提取管线。',
          details: { detected: event.layers },
        })
      }
      if (event.mismatch) {
        return {
          state: normalize({
            ...state,
            mismatch: { detected: event.layers, suggestion: event.mismatch },
            step: 'mismatch',
          }),
          actions: [],
        }
      }
      // 相符 → 仍处 processing，按入口发起管线
      return {
        state: { ...state, step: 'processing', stageIdx: 0 },
        actions: [{ type: 'intake', entry: ctx.entry, dataUrl: event.dataUrl }],
      }
    }

    case 'detect_failed':
      return toFailure(state, event.failure)

    // ── 管线结果（原 run() 的后半段）──
    case 'intake_ok': {
      const draftIds = event.result.draftIds
      const actions: IntakeFlowAction[] = [
        // 原图进内存会话（确认页原文对照用）；交接图用完即清
        { type: 'session_set_images', draftIds, dataUrl: event.dataUrl },
        { type: 'session_clear_pending_image' },
      ]
      if (draftIds.length === 1) {
        // 单草稿直达确认页。状态**照样落 drafts**：留在 processing 的话，安卓端 expo-router
        // 会把这张屏压在草稿页下面继续空转阶段定时器，用户一按返回就是永远转圈
        // ——请求已成功，再不会有任何事件来终结它（05 任务书 T4 禁「转圈不结束」）。
        actions.push({ type: 'navigate', path: `/drafts/${draftIds[0]}` })
      }
      return {
        state: normalize({ ...state, result: event.result, step: 'drafts' }),
        actions,
      }
    }

    case 'intake_failed':
      return toFailure(state, event.failure)

    case 'retake':
      return backToUpload()

    case 'switch_entry': {
      const dataUrl = state.image
      if (!dataUrl) return { state: normalize(state), actions: [] }
      const note = state.mismatch?.suggestion ?? state.feedback?.body ?? ''
      return {
        state: normalize(state),
        actions: [
          { type: 'session_set_pending_image', pending: { dataUrl, fromEntry: ctx.entry, note } },
          { type: 'navigate', path: ctx.otherEntryPath },
        ],
      }
    }

    case 'goto_manual':
      return { state: normalize(state), actions: [{ type: 'navigate', path: '/box?manual=1' }] }

    case 'goto_other_entry':
      return { state: normalize(state), actions: [{ type: 'navigate', path: ctx.otherEntryPath }] }

    case 'open_draft':
      return { state: normalize(state), actions: [{ type: 'navigate', path: `/drafts/${event.draftId}` }] }

    case 'stage_tick':
      // 阶段文案只前进不后退，末阶段封顶
      return {
        state: { ...state, stageIdx: Math.min(state.stageIdx + 1, ctx.stageCount - 1) },
        actions: [],
      }

    case 'handoff': {
      const pending = event.pending
      if (!pending || pending.fromEntry === ctx.entry) return { state: normalize(state), actions: [] }
      // 对方入口留下的原图直接重跑（用户不必重新选文件）：先落图与交接说明，再进 processing
      return {
        state: { ...state, image: pending.dataUrl, handoffNote: pending.note, step: 'processing', stageIdx: 0 },
        actions: [{ type: 'detect', entry: ctx.entry, dataUrl: pending.dataUrl }],
      }
    }
  }
}
