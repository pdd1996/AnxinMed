import type { Entry as IntakeEntry } from "@anxin/core";
import type { Photo } from "@/lib/photo";

export interface PickedIntakePhoto extends Photo {
  entry: IntakeEntry;
}

/**
 * 录入 tab → /intake/flow 的一次性交接：照片 dataURL 太大，不能走路由参数；
 * 放模块内存，flow 页取走即清（与 useIntakeSession 的原图会话同一条「只存在本机内存」口径）。
 */
let pending: PickedIntakePhoto | null = null;

export function setPickedIntakePhoto(photo: PickedIntakePhoto) {
  pending = photo;
}

export function takePickedIntakePhoto(): PickedIntakePhoto | null {
  const photo = pending;
  pending = null;
  return photo;
}
