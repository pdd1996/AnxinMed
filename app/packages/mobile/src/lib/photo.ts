import * as ImagePicker from "expo-image-picker";
import { validateFile } from "@anxin/core";

/**
 * 拍照 / 选图 → 平台无关的 dataURL（M5-T4）。
 *
 * 口径与 web 端 `FileReader.readAsDataURL` 对齐：core 的 `validateFile` 做同一套前置校验
 * （类型白名单 + 15MB），服务端再按 shared 的 dataURL 正则与 bodyLimit 兜一道。
 * 相机**禁用裁剪与编辑**（`allowsEditing: false`）——用户拍什么传什么。
 *
 * quality 取 **0.8**：web 端上传的是手机原始直出文件（多数安卓相机 JPEG 已在 0.85 上下），
 * 0.8 是「文字边缘不糊」与「dataURL 体积」的折中；OCR 预检看的是像素梯度，0.8 的色度二次抽样
 * 不足以把字糊掉。此值随 T4 A/B 基线与 H5 链路同批照片对比验证（见 app/e2e/ab-baseline/README.md）。
 */
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: "images",
  allowsEditing: false,
  cameraType: ImagePicker.CameraType.back,
  quality: 0.8,
  base64: true,
  exif: false,
  allowsMultipleSelection: false,
};

/** base64 → 字节的换算上限（与服务端 15MB 闸门同源，留出 JSON 包裹余量）。 */
const MAX_BYTES = 15 * 1024 * 1024;

export interface Photo {
  /** `data:image/jpeg;base64,...` —— core 的 detectImage / intakeDrug 入参形态。 */
  dataUrl: string;
  name: string;
  /** 解码后的字节数（UI 展示 + validateFile 复核）。 */
  bytes: number;
  width: number;
  height: number;
}

export type PickResult =
  | { ok: true; photo: Photo }
  /** cancelled：用户按返回/取消，不是错误，UI 只回上传步。 */
  | { ok: false; kind: "cancelled" }
  /** 其余一律可见：权限被拒 / 读不出 / 校验不过。message 直接展示给用户。 */
  | { ok: false; kind: "denied" | "failed"; message: string };

function toPhoto(asset: ImagePicker.ImagePickerAsset): PickResult {
  const base64 = asset.base64;
  if (!base64) {
    return {
      ok: false,
      kind: "failed",
      message: "照片未能读出（存储权限或系统返回异常）。请重拍，或改选一张已保存的照片。",
    };
  }
  const mime = asset.mimeType ?? "image/jpeg";
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_BYTES) {
    return {
      ok: false,
      kind: "failed",
      message: `照片约 ${Math.round(bytes / 1024 / 1024)}MB，超过 15MB 上限。请靠近一些重拍，让药盒占满画面。`,
    };
  }
  const name = asset.fileName ?? `photo-${Date.now()}.jpg`;
  const problem = validateFile({ name, type: mime, size: bytes });
  if (problem) return { ok: false, kind: "failed", message: problem };
  return {
    ok: true,
    photo: {
      dataUrl: `data:${mime};base64,${base64}`,
      name,
      bytes,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    },
  };
}

function finish(result: ImagePicker.ImagePickerResult): PickResult {
  if (result.canceled) return { ok: false, kind: "cancelled" };
  const asset = result.assets?.[0];
  if (!asset) {
    return { ok: false, kind: "failed", message: "没有拿到照片。请重试，或改从相册选一张已拍好的。" };
  }
  return toPhoto(asset);
}

/** 调后置相机拍照；权限被拒时返回可行动引导（禁静默）。 */
export async function takePhoto(): Promise<PickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return {
      ok: false,
      kind: "denied",
      message:
        "相机权限未开启，无法拍照。请到 系统设置 → 应用管理 → 安心用药 → 权限 → 相机「允许」后重试。",
    };
  }
  return finish(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
}

/**
 * 从相册选一张：A/B 基线要用**同一批**照片分别跑 H5 与 RN 链路，这条路径保证两端上传的是同一文件；
 * 也是相机权限被拒时的兜底入口。
 */
export async function pickFromLibrary(): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      ok: false,
      kind: "denied",
      message:
        "相册权限未开启。可改到 系统设置 → 应用管理 → 安心用药 → 权限 → 照片和视频「允许」，或直接使用拍照。",
    };
  }
  return finish(await ImagePicker.launchImageLibraryAsync({ ...PICKER_OPTIONS, selectionLimit: 1 }));
}
