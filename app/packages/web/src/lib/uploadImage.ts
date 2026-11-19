import type { Entry } from '@anxin/core'

/**
 * 上传前压缩（2026-11-20）——H5 侧「拍药品那么慢」的真正瓶颈。
 *
 * 背景（实测）：识别本身只要约 3 秒（qwen3-vl-plus 入口B 合并调用 2.70/3.26/3.27s），
 * 而 H5 过去把**原图**直接 dataURL 上传（`FileReader.readAsDataURL`）：手机直出 JPEG 3-6MB，
 * base64 再涨三分之一 → 4-8MB 挤在手机上行，这一段才是十几秒的来源。
 * RN 侧早就按入口压缩（`mobile/lib/photo.ts`），H5 一直没做（09 报告 §T5.2 遗留第 3 条）。
 *
 * 口径与 RN 逐字对齐（改任一侧必须同步另一侧）：
 *   - 目标长边：入口A 处方笺 2048、入口B 药盒 1600（处方笺整页小字要更多细节）；
 *   - JPEG 质量 0.8；原图 ≤900KB 且尺寸已达标 → 不重编码（保留原画质，也省一次编解码）；
 *   - 任何一步失败（无 canvas / 解码失败 / 编码失败）→ **原样上传**，不静默丢图、不拦用户。
 *
 * 与质量预检的分工：预检（imageStats）看**原图**，压缩只发生在**上网络那一刻**——
 * 否则 1600 长边重采样会改变 sharpness 判据，把真实照片又误判成「模糊」。
 */

/** 上传压缩目标长边（像素）：与 mobile/lib/photo.ts 的 UPLOAD_MAX_EDGE 同口径。 */
export const UPLOAD_MAX_EDGE: Record<Entry, number> = { A: 2048, B: 1600 }

/** 压缩后 JPEG 质量：沿用 RN 的 0.8（文字边缘不糊与体积的折中）。 */
export const UPLOAD_JPEG_QUALITY = 0.8

/** 原图不大于此值且尺寸达标时跳过重编码（与 RN 同阈值）。 */
export const SKIP_RECOMPRESS_BYTES = 900 * 1024

/** dataURL 解码后的字节数（base64 每 4 字符 3 字节，末尾 padding 需扣除）；不可解析 → 0。 */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const b64 = dataUrl.slice(comma + 1)
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
}

/** 压缩计划：要画到多大的画布。 */
export interface ShrinkPlan {
  width: number
  height: number
}

/**
 * 纯决策：原图边长 + 字节数 → 画布尺寸；null = 不必重编码（原样上传）。
 * 长边超限才缩放；只超体积不超边长时按原尺寸重编码（同一像素，JPEG 换掉 PNG/高码率）。
 */
export function planUploadShrink(
  width: number,
  height: number,
  bytes: number,
  maxEdge: number,
): ShrinkPlan | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  const longest = Math.max(width, height)
  const needsResize = longest > maxEdge
  const needsReencode = bytes > SKIP_RECOMPRESS_BYTES
  if (!needsResize && !needsReencode) return null
  if (!needsResize) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * 上传前压缩：canvas 重采样 → JPEG q0.8。
 * 返回**可直接上传**的 dataURL；不能压缩时返回入参本身（调用方无需分支）。
 */
export async function shrinkDataUrlForUpload(dataUrl: string, entry: Entry): Promise<string> {
  try {
    // 先探 canvas 能力（jsdom 无 canvas 包时 getContext 为 null）：不能压缩就原样上传，绝不挂住流程。
    const probe = document.createElement('canvas')
    if (!probe.getContext('2d')) return dataUrl
    const img = await loadImage(dataUrl)
    const plan = planUploadShrink(
      img.naturalWidth,
      img.naturalHeight,
      dataUrlBytes(dataUrl),
      UPLOAD_MAX_EDGE[entry],
    )
    if (!plan) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = plan.width
    canvas.height = plan.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, plan.width, plan.height)
    const compressed = canvas.toDataURL('image/jpeg', UPLOAD_JPEG_QUALITY)
    // toDataURL 失败会返回 "data:,"：只接受真正产出 JPEG 且有内容的产物，否则原样上传
    return compressed.startsWith('data:image/jpeg') && dataUrlBytes(compressed) > 0 ? compressed : dataUrl
  } catch {
    return dataUrl // 解码/编码失败 = 退回旧行为（上传原图），不静默丢图
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
}
