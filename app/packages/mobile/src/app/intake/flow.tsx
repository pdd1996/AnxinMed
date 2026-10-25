import { useRef } from "react";
import IntakeScreen from "@/components/domain/intake/IntakeScreen";
import { takePickedIntakePhoto, type PickedIntakePhoto } from "@/lib/intakeUpload";

/**
 * 录入 tab 选定照片后的全屏流程（根 stack）：质量预检 / 识别 / 失败 / 草稿都在这里，
 * 底部导航不在；返回即回录入 tab 的上传态。照片走一次性内存交接，取走即清。
 */
export default function IntakeFlow() {
  const photoRef = useRef<PickedIntakePhoto | null | undefined>(undefined);
  if (photoRef.current === undefined) {
    photoRef.current = takePickedIntakePhoto();
  }
  const photo = photoRef.current;

  return (
    <IntakeScreen
      entry={photo?.entry ?? "A"}
      initialPhoto={
        photo
          ? {
              dataUrl: photo.dataUrl,
              uri: photo.uri,
              width: photo.width,
              height: photo.height,
            }
          : null
      }
    />
  );
}
