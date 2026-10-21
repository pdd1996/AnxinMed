/**
 * 「时 / 分」两框的编辑与校验（T6-d 从 PlanModal 抽出，草稿页时间点卡共用）。
 *
 * ⚠️ 框的 `value` 必须是**用户敲出来的原文**，不能是补零后的规范串：受控值一补零回写，
 * 框里恒为两位，`maxLength={2}` 就把后续按键整条吃掉（"08"+"2"="082" 超长 → 连
 * onChangeText 都不触发），而退格删成一位又立刻被补回两位 —— 结果是四框全敲不进数字
 * （10-03 用户真机反馈「编辑时间没法输入数字」）。规范 `HH:MM` 只在保存/校验时拼。
 */
export interface TimeParts {
  hour: string;
  minute: string;
}

/** 时间点合法性：HH:MM，24 小时制，与 web `type="time"` 的取值域一致。 */
export function isHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function joinPart(head: string, tail: string): string {
  return `${head.padStart(2, "0")}:${tail.padStart(2, "0")}`;
}

export function splitTime(time: string): TimeParts {
  const [hour = "", minute = ""] = time.split(":");
  return { hour, minute };
}

/** 单框是否填全且落在取值域内（空框、超 23 时 / 59 分都算非法）。 */
export function isTimePartsValid({ hour, minute }: TimeParts): boolean {
  return (
    /^\d{1,2}$/.test(hour) && /^\d{1,2}$/.test(minute) && isHHMM(joinPart(hour, minute))
  );
}
