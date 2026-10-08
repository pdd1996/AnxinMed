import IntakeScreen from "@/components/domain/intake/IntakeScreen";

/** 入口B · 拍药品（M5-T6a）：身份线主导，所有药盒同一路径，仅建档（对齐 web IntakeDrug.tsx）。 */
export default function IntakeDrug() {
  return <IntakeScreen entry="B" />;
}
