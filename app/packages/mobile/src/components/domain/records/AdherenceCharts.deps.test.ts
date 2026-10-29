import { describe, expect, it } from "@jest/globals";
import { BarChart } from "react-native-gifted-charts";

/**
 * 依赖自检：react-native-gifted-charts 把 react-native-linear-gradient / expo-linear-gradient
 * 标成 optional peer，但源码在 import 期就 require，「没装」等于 App 启动即崩。
 * 这条用例用静态 import 守住那个坑（10-27 实装时正是它先炸的）——缺包时本套件会整条加载失败。
 */
describe("react-native-gifted-charts 依赖自检", () => {
  it("库可导入且导出 BarChart", () => {
    expect(typeof BarChart).toBe("function");
  });
});
