import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { decode } from "jpeg-js";
import { statsFromRgba, type ImageStatsProvider } from "@anxin/core";

/**
 * 图片像素统计的 RN 实现（05e §1-3 接缝取①「按源注入」+ §2-T6-b-1）。
 *
 * 为什么要两跳：`expo-image-manipulator@57.0.21` 没有任何 raw pixel 接口（解包读 `build/*.d.ts`
 * 只有 `renderAsync() → ImageRef.saveAsync() → {uri, base64?}`），RN 也没有 canvas。
 * 于是链路＝「原生 resize 到 ≤512 边长 → 小图进缓存 → JS 用 jpeg-js 解码 RGBA → 交 core 出统计值」，
 * 统计数学与 `web/src/lib/imageStats.ts` 逐字同源（两份拷贝，护栏是 core 的手算 fixture，05e §7-1）。
 *
 * 三条硬约束（05e §7-2、§7-5）：
 *   1. **resize-first**：既不把大 dataURL 喂给原生层，也不全尺寸解码（4000×3000 解码后 RGBA ≈46MB）。
 *      这条由 jpeg-js 的 `maxResolutionInMP/maxMemoryUsageInMB` 兜底——闸门在分配内存**之前**判定，
 *      超限直接抛错，我们据此跳过预检，而不是先把内存吃掉。
 *   2. **预检只是建议**：任何一步不可用都返回 null（null ≠「图片有问题」），主流程照走（05e §0-1）。
 *   3. **派生小图即用即删**：它仍是原图内容，属隐私红线，不留在缓存里。
 */

/** 采样网格最长边：与 web 的 `Math.min(1, 512 / max(w, h))` 同口径，否则两端统计值不可比。 */
const LONG_EDGE = 512;

/** 缩放后小图的 JPEG 码率：只为出统计值，取高码率以免二次压缩把梯度（sharpness）压没。 */
const RESIZE_COMPRESS = 0.9;

/** 512×512 = 0.26MP / RGBA 1MB，闸门留一倍余量；真正的全尺寸图会在这里被拦下（约束 1）。 */
const MAX_RESOLUTION_MP = 1;
const MAX_MEMORY_MB = 8;

/** 统计值的日志（spike S2 的计时与内存数字就抄这一行；release 构建不输出）。 */
function logDev(message: string): void {
  if (__DEV__) console.log(`[precheck] ${message}`);
}

export const computeImageStats: ImageStatsProvider = async (_dataUrl, source) => {
  const uri = source?.uri;
  const origWidth = source?.width ?? 0;
  const origHeight = source?.height ?? 0;
  if (!uri || origWidth <= 0 || origHeight <= 0) {
    logDev(`跳过：本机输入不完整（uri=${uri ? "有" : "无"}，原图 ${origWidth}×${origHeight}）`);
    return null;
  }

  const scale = Math.min(1, LONG_EDGE / Math.max(origWidth, origHeight));
  const gridWidth = Math.max(1, Math.round(origWidth * scale));
  const gridHeight = Math.max(1, Math.round(origHeight * scale));
  const startedAt = Date.now();
  let resizedUri: string | null = null;

  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: gridWidth, height: gridHeight });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: RESIZE_COMPRESS });
    resizedUri = saved.uri;
    const resizedAt = Date.now();

    const bytes = await new File(saved.uri).bytes();
    const jpeg = decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: MAX_RESOLUTION_MP,
      maxMemoryUsageInMB: MAX_MEMORY_MB,
    });
    const decodedAt = Date.now();

    // 网格边长取解码结果而非请求值：resize 由原生实现，实际尺寸可能差 1px，统计必须与真实像素对齐
    const stats = statsFromRgba(jpeg.data, jpeg.width, jpeg.height, origWidth, origHeight);
    // JS 侧的实际分配：1 份 RGBA + core 内部 1 份 Float64 luma 网格（skew 门槛看这两个数，不看原图）
    const rgbaKB = Math.round(jpeg.data.length / 1024);
    const lumaKB = Math.round((jpeg.width * jpeg.height * 8) / 1024);
    logDev(
      `resize ${resizedAt - startedAt}ms · 读盘+解码 ${decodedAt - resizedAt}ms · 合计 ${decodedAt - startedAt}ms` +
        `｜网格 ${jpeg.width}×${jpeg.height}（原图 ${origWidth}×${origHeight}）` +
        `｜JS 分配 ≈${rgbaKB}KB RGBA + ${lumaKB}KB luma（缩略 JPEG ${Math.round(bytes.length / 1024)}KB）` +
        `｜meanLuma ${stats.meanLuma.toFixed(1)} clipped ${stats.clippedRatio.toFixed(3)} sharp ${stats.sharpness.toFixed(4)}`,
    );
    return stats;
  } catch (cause) {
    // 预检不可用 ≠ 图片有问题：与 web 侧 canvas 缺失时同口径，跳过建议、主流程照走（约束 2）
    logDev(`本机统计失败，跳过预检：${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  } finally {
    if (resizedUri) {
      try {
        const file = new File(resizedUri);
        if (file.exists) file.delete();
      } catch {
        // 缓存文件已被系统或上一次调用清掉，没有可删的；不因此把预检报成失败（约束 3 已尽力）
      }
    }
  }
};
