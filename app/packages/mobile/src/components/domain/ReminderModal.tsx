import { isSpeechSupported, speak, type PlanGroup } from "@anxin/core";
import { Bell } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { TaskSlotChip } from "@/components/domain/task-slot";

/**
 * 页内服药提醒弹窗（照 web `domain/ReminderModal.tsx`）：队首计划到点弹出，
 * 提供 已服 / 稍后 / 跳过 三个出口，另加一条时间点胶囊行供选择具体时点。
 * 播报按钮保留位但当前端未注入 TTS（`setSpeechAdapter` 的 mobile 实现在 M5-T7），
 * 故按能力判disabled——不做强装了却点了没反应的假按钮（05d §6 第 12 条同口径）。
 */
export function ReminderModal({
  group,
  open,
  onClose,
  onRequest,
}: {
  group: PlanGroup;
  open: boolean;
  onClose: () => void;
  onRequest: (time: string, status: "taken" | "skipped" | "later") => void;
}) {
  const primary = useUnstableNativeVariable("--primary");
  const speechReady = isSpeechSupported();
  const nextPending = group.slots.find((slot) => slot.status === "pending");
  const speakText = `服药提醒，${group.drugName}，每次${group.dose.value}${group.dose.unit}，每日${group.frequency}次`;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex-row items-center gap-2 text-xl">
            <Icon as={Bell} size={22} color={primary} />
            该服药了
          </DialogTitle>
          <DialogDescription>
            <Text className="text-base text-muted-foreground">
              {group.drugName} · {group.specification ?? ""} · 每次 {group.dose.value}{" "}
              {group.dose.unit} · 每日 {group.frequency} 次
              {group.route ? ` · ${group.route}` : ""}
            </Text>
          </DialogDescription>
        </DialogHeader>

        <View className="flex-row flex-wrap gap-2">
          {group.slots.map((slot) => (
            <TaskSlotChip
              key={slot.time}
              slot={slot}
              onPress={() => onRequest(slot.time, "taken")}
            />
          ))}
        </View>

        <View className="gap-2">
          <Button
            className="min-h-[52px] w-full"
            disabled={!nextPending}
            onPress={() => nextPending && onRequest(nextPending.time, "taken")}
          >
            <Text>{`确认已服${nextPending ? `（${nextPending.time}）` : ""}`}</Text>
          </Button>
          {/* 播报单独占一行：它带「待接入」四个字，塞进三钮等宽的那一行会被裁掉一行文字
              （10-02 模拟器实测）。语音接入属 M5-T7，接上后文案可缩回「播报」。 */}
          <Button
            variant="outline"
            className="min-h-[48px] w-full"
            disabled={!speechReady}
            accessibilityLabel={speechReady ? "语音播报" : "语音播报将在后续版本接入"}
            onPress={() => speak(speakText)}
          >
            <Text>{speechReady ? "播报" : "播报·待接入"}</Text>
          </Button>
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="min-h-[48px] flex-1"
              disabled={!nextPending}
              onPress={() => nextPending && onRequest(nextPending.time, "later")}
            >
              <Text>稍后</Text>
            </Button>
            <Button
              variant="outline"
              className="min-h-[48px] flex-1"
              disabled={!nextPending}
              onPress={() => nextPending && onRequest(nextPending.time, "skipped")}
            >
              <Text>跳过</Text>
            </Button>
          </View>
        </View>

        <Text className="text-sm text-muted-foreground">
          记录来自你的操作，不代表系统已医学验证实际服药；库存按次扣减。
        </Text>
      </DialogContent>
    </Dialog>
  );
}
