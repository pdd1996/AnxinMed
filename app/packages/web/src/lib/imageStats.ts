import type { ImageStats, ImageStatsProvider } from '@anxin/core'

/**
 * 图片像素统计的 web 实现（M5-T2 接缝 #5：core 定 ImageStatsProvider 接口，canvas 留本端）。
 * 本地做（不下传、不依赖模型），只为产出「重拍建议」的输入。
 */

/**
 * dataURL → 像素统计（缩到 ≤512 边长再统计，成本可忽略）。
 * 环境不支持 canvas（如 jsdom 未装 canvas 包）→ 返回 null，调用方跳过预检（不报错、不阻塞）。
 */
export const computeImageStats: ImageStatsProvider = async (dataUrl: string): Promise<ImageStats | null> => {
  try {
    // 先探 canvas 能力（jsdom 无 canvas 包时 getContext 为 null）：不支持则跳过预检，
    // 避免再走图片解码（无资源加载器时 onload 永不触发，会挂死调用方）。
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const img = await loadImage(dataUrl)
    const scale = Math.min(1, 512 / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))
    canvas.width = width
    canvas.height = height
    ctx.drawImage(img, 0, 0, width, height)
    const { data } = ctx.getImageData(0, 0, width, height)

    const luma = new Float64Array(width * height)
    let sum = 0
    let clipped = 0
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const v = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      luma[p] = v
      sum += v
      if (v > 245) clipped++
    }
    const total = width * height
    let grad = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        grad += Math.abs(luma[y * width + x + 1] - luma[y * width + x])
      }
    }
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width; x++) {
        grad += Math.abs(luma[(y + 1) * width + x] - luma[y * width + x])
      }
    }
    const edges = total - width + (total - height)
    return {
      meanLuma: sum / total,
      clippedRatio: clipped / total,
      sharpness: edges > 0 ? grad / edges / 255 : 0,
      width: img.width,
      height: img.height,
    }
  } catch {
    return null // 预检不可用 ≠ 图片有问题：跳过建议，主流程照走
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
