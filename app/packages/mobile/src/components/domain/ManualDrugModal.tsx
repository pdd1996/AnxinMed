import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { DOSE_UNITS } from "@anxin/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export interface ManualDrugForm {
  genericName: string;
  specification: string;
  form: string;
  stock: number;
  stockUnit: string;
}

/**
 * 手动建档（M5-T5c，照 web `domain/ManualDrugModal.tsx`）：识别失败时的兜底路径，
 * 药名 / 规格 / 剂型 三项必填，`confirmStatus` 由服务端固定为 manual（客户端不传、也改不动），
 * 落成「手动建档 · 未经 OCR 确认」徽章 → AI 个性化咨询不可用（manual 门禁不豁免）。
 * 单位选择与 PlanModal 同形（web 的 `<select>` 在 RN 无对应控件，改 chip 单选）。
 */
export function ManualDrugModal({
  open,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (data: ManualDrugForm) => void;
}) {
  const [genericName, setGenericName] = useState("");
  const [specification, setSpecification] = useState("");
  const [formValue, setFormValue] = useState("");
  const [stock, setStock] = useState("1");
  const [stockUnit, setStockUnit] = useState<string>("片");

  const valid =
    genericName.trim().length > 0 && specification.trim().length > 0 && formValue.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="text-xl">手动建档</DialogTitle>
          <DialogDescription>
            <Text className="text-base text-muted-foreground">
              识别失败时的兜底路径：直接填写药名 / 规格 / 剂型。该药品将标注「未经 OCR 确认」，AI
              个性化咨询不可用，仅可做资料查询。
            </Text>
          </DialogDescription>
        </DialogHeader>

        <ScrollView keyboardShouldPersistTaps="handled">
          <View className="gap-4">
            <View className="gap-1">
              <Label className="text-base">药名（通用名）</Label>
              <Input
                className="min-h-[48px]"
                value={genericName}
                onChangeText={setGenericName}
                placeholder="如：玻璃酸钠滴眼液"
              />
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1 gap-1">
                <Label className="text-base">剂型</Label>
                <Input
                  className="min-h-[48px]"
                  value={formValue}
                  onChangeText={setFormValue}
                  placeholder="如：滴眼液"
                />
              </View>
              <View className="flex-1 gap-1">
                <Label className="text-base">规格</Label>
                <Input
                  className="min-h-[48px]"
                  value={specification}
                  onChangeText={setSpecification}
                  placeholder="如：0.1%（10mL）"
                />
              </View>
            </View>
            <View className="gap-1">
              <Label className="text-base">库存</Label>
              <Input
                className="min-h-[48px]"
                value={stock}
                keyboardType="number-pad"
                maxLength={5}
                onChangeText={setStock}
                accessibilityLabel="库存数量"
              />
              <View className="mt-1 flex-row flex-wrap gap-2">
                {DOSE_UNITS.map((unit) => (
                  <Pressable
                    key={unit}
                    accessibilityRole="button"
                    accessibilityState={{ selected: stockUnit === unit }}
                    onPress={() => setStockUnit(unit)}
                    className={cn(
                      "min-h-[44px] items-center justify-center rounded-full px-4",
                      stockUnit === unit
                        ? "border-2 border-primary bg-secondary"
                        : "border border-input bg-background",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-base",
                        stockUnit === unit
                          ? "font-bold text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {unit}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>

        <Button
          className="min-h-[52px] w-full"
          disabled={!valid || busy}
          onPress={() =>
            onSave({
              genericName: genericName.trim(),
              specification: specification.trim(),
              form: formValue.trim(),
              stock: Number(stock) || 0,
              stockUnit,
            })
          }
        >
          <Text>{busy ? "提交中…" : "确认手动建档"}</Text>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
