import type { QueryClient } from "@tanstack/react-query";
import {
  fetchDrugs,
  fetchPlans,
  type ReminderPlanInput,
  type ReminderNotificationSpec,
} from "@anxin/core";
import { planReminderNotifications } from "@anxin/core";
import { syncReminderNotifications, type ReminderSyncOutcome } from "./notifications";

type Plans = Awaited<ReturnType<typeof fetchPlans>>;
type Drugs = Awaited<ReturnType<typeof fetchDrugs>>;

/** API 的计划 + 药箱 → 排定纯函数的输入（药名缺失时用「药品」兜底，不伪造具体药名）。 */
export function toReminderPlanInputs(plans: Plans, drugs: Drugs): ReminderPlanInput[] {
  const drugNames = new Map(drugs.map((drug) => [drug.id, drug.genericName]));
  return plans.map((plan) => ({
    planId: plan.id,
    drugName: drugNames.get(plan.drugId) ?? "药品",
    dose: plan.dose,
    times: plan.times,
    status: plan.status,
    startDate: plan.startDate,
    endDate: plan.endDate ?? null,
  }));
}

export function planFromServer(plans: Plans, drugs: Drugs): ReminderNotificationSpec[] {
  return planReminderNotifications(toReminderPlanInputs(plans, drugs));
}

/**
 * 从服务端取最新计划与药箱，重排本地提醒。
 * 走 QueryClient 的 fetchQuery：与药箱页共用缓存（staleTime 内不重复请求），
 * 失败时保留既有闹钟不动——网络问题不该把用户的提醒清空。
 */
export async function syncRemindersFromServer(
  queryClient: QueryClient,
  options: { force?: boolean } = {},
): Promise<ReminderSyncOutcome> {
  const [plans, drugs] = await Promise.all([
    queryClient.fetchQuery({ queryKey: ["plans"], queryFn: fetchPlans }),
    queryClient.fetchQuery({ queryKey: ["drugs"], queryFn: fetchDrugs }),
  ]);
  return syncReminderNotifications(planFromServer(plans, drugs), options);
}
