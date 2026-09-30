import type { RecordStatus } from "@anxin/shared";
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

export interface PendingRecord {
  planId: string;
  time: string;
  status: RecordStatus;
  drugName: string;
}

const ACTION_LABEL: Record<RecordStatus, string> = {
  taken: "已服",
  skipped: "跳过",
  later: "稍后提醒",
};

/**
 * 写记录前的二次确认（照 web `domain/ConfirmRecordDialog.tsx` 的话术，禁另写一套）：
 * 服药记录一旦写入不可修改，同 (计划,日期,时间点) 重复 POST 服务端返 409。
 * `busy` = 请求在途时两钮皆不可点（05d §6 第 5 条：mutation pending 期间禁重复提交）。
 */
export function ConfirmRecordDialog({
  pending,
  busy,
  onClose,
  onConfirm,
}: {
  pending: PendingRecord | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (pending: PendingRecord) => void;
}) {
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认记录</DialogTitle>
          <DialogDescription>
            <Text className="text-base text-foreground">
              将{" "}
              <Text className="font-bold text-foreground">{pending?.drugName}</Text> 在{" "}
              <Text className="font-bold text-foreground">{pending?.time}</Text> 记录为{" "}
              <Text className="font-bold text-foreground">
                {pending ? ACTION_LABEL[pending.status] : ""}
              </Text>
              ？
            </Text>
          </DialogDescription>
        </DialogHeader>
        <Text className="text-sm text-muted-foreground">
          服药记录写入后不可修改，请确认无误。
        </Text>
        <DialogFooter className="flex-row">
          <Button variant="outline" className="min-h-[48px] flex-1" disabled={busy} onPress={onClose}>
            <Text>取消</Text>
          </Button>
          <Button
            className="min-h-[48px] flex-1"
            disabled={busy || pending === null}
            onPress={() => pending && onConfirm(pending)}
          >
            <Text>{busy ? "提交中…" : `确认${pending ? ACTION_LABEL[pending.status] : ""}`}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
