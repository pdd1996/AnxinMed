import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Entry as IntakeEntry } from "@anxin/core";
import IntakeScreen from "@/components/domain/intake/IntakeScreen";
import { setPickedIntakePhoto } from "@/lib/intakeUpload";

/**
 * 底部「录入」tab（2026-10-25 导航改造）：本屏只装上一步「选来源 + 拍照/相册」，
 * 选好照片后 push 根 stack 的 /intake/flow 全屏跑预检与识别（底部导航不在）。
 * 药箱的「拍照录入」用 ?entry=B 直接落到药盒档；切另一颗入口原地换，不换路由。
 */
export default function IntakeTab() {
  const router = useRouter();
  const { entry: entryParam } = useLocalSearchParams<{ entry?: string }>();
  const [entry, setEntry] = useState<IntakeEntry>(entryParam === "B" ? "B" : "A");

  useEffect(() => {
    if (entryParam === "A" || entryParam === "B") setEntry(entryParam);
  }, [entryParam]);

  return (
    <IntakeScreen
      entry={entry}
      mode="upload"
      onSwitchEntry={() => setEntry((current) => (current === "A" ? "B" : "A"))}
      onPicked={(photo) => {
        setPickedIntakePhoto({ ...photo, entry });
        router.push("/intake/flow");
      }}
    />
  );
}
