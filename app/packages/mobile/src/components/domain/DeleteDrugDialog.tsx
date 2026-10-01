import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";

/**
 * 删药二次确认（05d §0-2 裁定：web 现状是点一下就删，照搬即违反 PRD §7 原则 7）。
 * 形态对齐 web `profile/HealthInfoCard.tsx:141-155` 的确认分支（标题 + 后果说明 + 取消/确认删除）。
 * 后果文案按服务端真实级联写：`drugs.service.deleteDrug` 会先删该药计划下的服药记录、再删计划、最后删药。
 */
export function DeleteDrugDialog({
  drugName,
  busy,
  onCancel,
  onConfirm,
}: {
  drugName: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={drugName !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除「{drugName ?? ""}」</DialogTitle>
          <DialogDescription>
            <Text className="text-base text-foreground">
              该药的服药计划与计划下的服药记录会一并删除，删除后无法恢复。
            </Text>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row">
          <Button variant="outline" className="min-h-[48px] flex-1" disabled={busy} onPress={onCancel}>
            <Text>取消</Text>
          </Button>
          <Button
            variant="destructive"
            className="min-h-[48px] flex-1"
            disabled={busy || drugName === null}
            onPress={onConfirm}
          >
            <Text>{busy ? "删除中…" : "确认删除"}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
