import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { validateFile, type Entry } from "@anxin/core";

/**
 * 拍照 / 选图 → 平台无关的 dataURL（M5-T4）。
 *
 * 口径与 web 端 `FileReader.readAsDataURL` 对齐：core 的 `validateFile` 做同一套前置校验
 * （类型白名单 + 15MB），服务端再按 shared 的 dataURL 正则与 bodyLimit 兜一道。
 * 相机**禁用裁剪与编辑**（`allowsEditing: false`）——用户拍什么传什么。
 *
 * 2026-11-19 上传前压缩（「拍药品那么慢」）：手机直出 JPEG 常见 2–4MB，base64 再涨 33%；
 * 拍照录入过去要把同一张原图上传两趟（层检测 + 识别）——真机 4G/弱网下单是上传就十几秒。
 * 现在先按入口把长边压到 ≤2048（处方笺）/≤1600（药盒）再上传：体积通常降到 0.2–0.6MB，
 * 而文字可读性几乎不变——qwen-vl 侧实测 1600 与 3024 长边的 prompt_tokens 几乎相同（端点自己按
 * 上限重采样），因此这一步只省上传/带宽，不牺牲识别质量。
 *
 * 三条纪律：
 *   1. **先文件后压缩**：picker 不再直接产出 base64（避免全尺寸原图 base64 进 JS 内存）；
 *   2. **压缩失败可见地退回旧行为**：压缩链路任一步失败 → 读原文件 base64 照常上传（不静默丢图）；
 *   3. **缓存文件即用即删**：压缩产物是原图内容，属隐私红线，删不掉也不影响上传。
 */

/** 上传前压缩的目标长边（像素）：入口A 处方笺整页小字需要更多细节，入口B 药盒正面大字号够用。 */
const UPLOAD_MAX_EDGE: Record<Entry, number> = { A: 2048, B: 1600 };

/** 压缩后 JPEG 质量：沿用旧 picker 的 0.8（文字边缘不糊与体积的折中）。 */
const UPLOAD_JPEG_QUALITY = 0.8;

/** 原文件不大于此值且尺寸已达标时，跳过重编码（保留原画质，也省一次编解码耗时）。 */
const SKIP_RECOMPRESS_BYTES = 900 * 1024;

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: "images",
  allowsEditing: false,
  cameraType: ImagePicker.CameraType.back,
  // base64 交给 prepareAsset 统一取（先拿文件 URI，避免全尺寸原图 base64 占 JS 内存）
  quality: 1,
  base64: false,
  exif: false,
  allowsMultipleSelection: false,
};

/** base64 → 字节的换算上限（与服务端 15MB 闸门同源，留出 JSON 包裹余量）。 */
const MAX_BYTES = 15 * 1024 * 1024;

export interface Photo {
  /** `data:image/jpeg;base64,...`（上传前已按入口压缩）—— core 的 intakeDrug / intakePrescription 入参形态。 */
  dataUrl: string;
  /**
   * 本机文件 URI —— 质量预检的唯一可用输入（05e §1-2：T6-a 之前这里把它丢掉了，于是预检只能
   * 全尺寸重编一遍原图，那条路 05e §7-2 明令禁止）。指向**原图**，不是压缩产物。
   */
  uri: string;
  name: string;
  /** 实际要上传的 base64 解码后字节数（UI 展示 + validateFile 复核）。 */
  bytes: number;
  /** 原图宽（像素，供质量预检判 too-small；压缩后的边长不改变这项判据）。 */
  width: number;
  height: number;
}

export type PickResult =
  | { ok: true; photo: Photo }
  /** cancelled：用户按返回/取消，不是错误，UI 只回上传步。 */
  | { ok: false; kind: "cancelled" }
  /** 其余一律可见：权限被拒 / 读不出 / 校验不过。message 直接展示给用户。 */
  | { ok: false; kind: "denied" | "failed"; message: string };

/** 压缩结果：dataURL 的 base64 部分 + 实际 mime（压缩成功恒为 jpeg）。 */
interface PreparedImage {
  base64: string;
  mime: string;
}

/** 原文件 → base64（压缩链路失败时的兜底；原生解码，不经过 JS 像素级处理）。 */
async function readOriginalBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}

/**
 * 按入口压缩：长边超限才 resize，再统一转 JPEG q0.8；小图且尺寸达标则原样读（不重编码）。
 * 压缩链路失败 → 返回 null，调用方回退原文件 base64（可见地退回旧行为，不静默丢图）。
 */
async function compressForUpload(
  uri: string,
  width: number,
  height: number,
  entry: Entry,
): Promise<PreparedImage | null> {
  const maxEdge = Math.max(width, height);
  const limit = UPLOAD_MAX_EDGE[entry];
  try {
    // 小图 + 尺寸达标：保留原画质（同时省掉一次 native 重编码）
    if (maxEdge <= limit && new File(uri).size <= SKIP_RECOMPRESS_BYTES) return null

    const context = ImageManipulator.manipulate(uri);
    if (maxEdge > limit) {
      const scale = limit / maxEdge;
      context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
    }
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      base64: true,
      format: SaveFormat.JPEG,
      compress: UPLOAD_JPEG_QUALITY,
    });
    if (!saved.base64) return null;
    // 缓存产物是原图内容：即用即删（删不掉不影响上传，预检侧同样口径）
    try {
      const cached = new File(saved.uri);
      if (cached.exists) cached.delete();
    } catch {
      // 缓存文件已被系统清理/无可删的 → 不影响上传
    }
    return { base64: saved.base64, mime: "image/jpeg" };
  } catch {
    return null;
  }
}

/** picker asset → Photo（压缩 → 复核字节数与类型 → dataURL）；压缩失败回退原文件。 */
async function toPhoto(asset: ImagePicker.ImagePickerAsset, entry: Entry): Promise<PickResult> {
  const uri = asset.uri;
  if (!uri) {
    return {
      ok: false,
      kind: "failed",
      message: "照片未能读出（存储权限或系统返回异常）。请重拍，或改选一张已保存的照片。",
    };
  }
  const origWidth = asset.width ?? 0;
  const origHeight = asset.height ?? 0;

  let prepared = await compressForUpload(uri, origWidth, origHeight, entry);
  if (!prepared) {
    try {
      prepared = { base64: await readOriginalBase64(uri), mime: asset.mimeType ?? "image/jpeg" };
    } catch {
      return {
        ok: false,
        kind: "failed",
        message: "照片未能读出（存储权限或系统返回异常）。请重拍，或改选一张已保存的照片。",
      };
    }
  }

  const bytes = Math.floor((prepared.base64.length * 3) / 4);
  if (bytes > MAX_BYTES) {
    return {
      ok: false,
      kind: "failed",
      message: `照片约 ${Math.round(bytes / 1024 / 1024)}MB，超过 15MB 上限。请靠近一些重拍，让药盒占满画面。`,
    };
  }
  const name = (asset.fileName ?? `photo-${Date.now()}.jpg`).replace(/\.(png|webp|heic|heif)$/i, ".jpg");
  const problem = validateFile({ name, type: prepared.mime, size: bytes });
  if (problem) return { ok: false, kind: "failed", message: problem };
  return {
    ok: true,
    photo: {
      dataUrl: `data:${prepared.mime};base64,${prepared.base64}`,
      uri,
      name,
      bytes,
      // 原图边长（不是压缩产物）：too-small 判据看原图，压缩后 ≤2048 会把好照片误判成小图
      width: origWidth,
      height: origHeight,
    },
  };
}

async function finish(result: ImagePicker.ImagePickerResult, entry: Entry): Promise<PickResult> {
  if (result.canceled) return { ok: false, kind: "cancelled" };
  const asset = result.assets?.[0];
  if (!asset) {
    return { ok: false, kind: "failed", message: "没有拿到照片。请重试，或改从相册选一张已拍好的。" };
  }
  return toPhoto(asset, entry);
}

/** 调后置相机拍照；权限被拒时返回可行动引导（禁静默）。 */
export async function takePhoto(entry: Entry): Promise<PickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return {
      ok: false,
      kind: "denied",
      message:
        "相机权限未开启，无法拍照。请到 系统设置 → 应用管理 → 安心用药 → 权限 → 相机「允许」后重试。",
    };
  }
  return finish(await ImagePicker.launchCameraAsync(PICKER_OPTIONS), entry);
}

/**
 * 从相册选一张：A/B 基线要用**同一批**照片分别跑 H5 与 RN 链路，这条路径保证两端上传的是同一文件；
 * 也是相机权限被拒时的兜底入口。
 */
export async function pickFromLibrary(entry: Entry): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      ok: false,
      kind: "denied",
      message:
        "相册权限未开启。可到 系统设置 → 应用管理 → 安心用药 → 权限 → 照片和视频「允许」，或直接使用拍照。",
    };
  }
  return finish(await ImagePicker.launchImageLibraryAsync({ ...PICKER_OPTIONS, selectionLimit: 1 }), entry);
}
