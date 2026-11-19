/**
 * `ui/dialog` 的 jest 手动替身（仅在显式 `jest.mock("@/components/ui/dialog")` 的用例里生效）。
 *
 * 真身会拉起 `@rn-primitives/dialog` → reanimated / keyboard-controller / react-native-screens，
 * 在 jest 环境里初始化原生 worklets 很重；组件测试只关心「弹窗里渲染了什么、点了哪个钮」，
 * 用 View/Text 直出即可。真机外观由 T5-真机验收覆盖。
 */
import type { ReactNode } from "react";
import { Text, View } from "react-native";

function Pass({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export const Dialog = Pass;
export const DialogContent = Pass;
export const DialogHeader = Pass;
export const DialogFooter = Pass;

export function DialogTitle({ children }: { children?: ReactNode }) {
  return <Text>{children}</Text>;
}

export function DialogDescription({ children }: { children?: ReactNode }) {
  return <View>{children}</View>;
}
