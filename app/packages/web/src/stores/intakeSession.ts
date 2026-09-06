import { create } from 'zustand'

/**
 * 录入会话 store（M2-T7）—— 上传原图 dataURL 的**内存**暂存，供确认页做「原文截图 ↔ 结构化字段」对照。
 *
 * 为什么只在内存：服务端不存图片字节（payload.bodyImageRef 恒 null，只存 cropBox 几何 + 低置信字符坐标，
 * 见 api services/pipeline/types.ts「M2 仅存引用/几何，不存字节」）；而处方笺原图含前记身份信息，
 * 脱敏红线要求即用即弃 —— 故本 store **绝不接 persist 中间件**，也不写 localStorage/sessionStorage，
 * 刷新即失（确认页取不到图时降级为文字原文对照，见 OriginalPanel）。
 *
 * 写入方：录入页（T8）拿到 intake 响应的 draftIds 后调用 setSession（N 份草稿共用同一张原图）。
 * 读取方：确认页按 draftId 取图；确认/拒绝后 clear 该草稿，不留残余。
 */
interface IntakeSessionState {
  /** draftId → 原图 dataURL。 */
  imageByDraftId: Record<string, string>
  /** 录入页写入：本次上传产出的全部草稿 id 共享同一张原图。 */
  setSession: (draftIds: string[], imageDataUrl: string) => void
  /** 清理：传 draftIds 只清这几份；不传清空整个会话。 */
  clear: (draftIds?: string[]) => void
  /**
   * 层检测纠偏的跨入口交接（M2-T8）：在 /intake/rx 检测到「实为药盒」时，把原图交给 /intake/drug
   * 直接重跑，用户不必重新选文件。同样只在内存，切换完成或放弃即清。
   */
  pendingImage: { dataUrl: string; fromEntry: 'A' | 'B'; note: string } | null
  setPendingImage: (pending: { dataUrl: string; fromEntry: 'A' | 'B'; note: string } | null) => void
}

export const useIntakeSession = create<IntakeSessionState>()((set) => ({
  imageByDraftId: {},
  setSession: (draftIds, imageDataUrl) =>
    set((state) => {
      const next = { ...state.imageByDraftId }
      for (const id of draftIds ?? []) {
        if (id) next[id] = imageDataUrl
      }
      return { imageByDraftId: next }
    }),
  clear: (draftIds) =>
    set((state) => {
      if (!draftIds) return { imageByDraftId: {} }
      const next = { ...state.imageByDraftId }
      for (const id of draftIds) delete next[id]
      return { imageByDraftId: next }
    }),
  pendingImage: null,
  setPendingImage: (pending) => set({ pendingImage: pending }),
}))

/** 非响应式读取（测试与提交后清理用）：组件内请用 useIntakeSession 选择器。 */
export function sessionImage(draftId?: string): string | undefined {
  if (!draftId) return undefined
  return useIntakeSession.getState().imageByDraftId[draftId]
}
