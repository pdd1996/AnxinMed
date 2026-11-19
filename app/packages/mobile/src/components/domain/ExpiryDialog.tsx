import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { DateField } from "./DateField";

export interface ExpiryFormResult {
  /** 有效期（YYYY-MM-DD）；'' = 未录入。 */
  expiry: string;
  /** 开封日期（YYYY-MM-DD）；'' = 未录入。 */
  openedAt: string;
}

/**
 * 编辑时效期弹窗（药箱卡片「编辑效期」入口）。
 *
 * 药盒包装上的具体到期日属于用户域数据：只能由用户对照实物录入，系统不猜、不预填
 * （说明书只有通用保质期，例如「24 个月」，不能替代这盒药的到期日）。
 * 留空 = 未录入（清空即删除该字段）；允许已过期日期（要能录、能纠正）；录错或换新盒随时改。
 * 保存字符串由调用方决定落库形态（空串 → null），与 manual 建档 / 确认页同一口径。
 */
export function ExpiryDialog({
  open,
  initialExpiry,
  initialOpenedAt,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  initialExpiry?: string | null;
  initialOpenedAt?: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (data: ExpiryFormResult) => void;
}) {
  const [expiry, setExpiry] = useState(initialExpiry ?? "");
  const [openedAt, setOpenedAt] = useState(initialOpenedAt ?? "");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="text-xl">编辑效期</DialogTitle>
        </DialogHeader>

        <ScrollView keyboardShouldPersistTaps="handled">
          <View className="gap-4">
            <View className="gap-1">
              <Label className="text-base">有效期至</Label>
              <DateField
                value={expiry}
                onChange={setExpiry}
                labelPrefix="有效期"
                optional
              />
            </View>
            <View className="gap-1">
              <Label className="text-base">开封日期（可选）</Label>
              <DateField
                value={openedAt}
                onChange={setOpenedAt}
                labelPrefix="开封日期"
                optional
              />
            </View>
          </View>
        </ScrollView>

        <DialogFooter className="flex-row">
          <Button
            variant="outline"
            className="min-h-[48px] flex-1"
            disabled={busy}
            onPress={onClose}
          >
            <Text>取消</Text>
          </Button>
          <Button
            className="min-h-[48px] flex-1"
            disabled={busy}
            onPress={() => onSave({ expiry, openedAt })}
          >
            <Text>{busy ? "保存中…" : "保存"}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
