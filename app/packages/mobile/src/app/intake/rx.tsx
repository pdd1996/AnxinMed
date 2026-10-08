import IntakeScreen from "@/components/domain/intake/IntakeScreen";

/** 入口A · 拍处方笺（M5-T6a）：医嘱线主导，产出档案 + 计划草稿（对齐 web IntakeRx.tsx）。 */
export default function IntakeRx() {
  return <IntakeScreen entry="A" />;
}
