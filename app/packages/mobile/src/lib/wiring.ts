import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getApiBaseUrl,
  resetAuthState,
  setApiBaseUrl,
  setApiNotifier,
  setAuthTokenStorage,
  setExtraHeaders,
  setSpeechAdapter,
  setUnauthorizedHandler,
} from "@anxin/core";
import { toast } from "sonner-native";
import { mobileSpeechAdapter } from "./speech";

/**
 * RN 平台装配（M5-T2 接缝的移动端实现，M5-T4 首次接线）。
 * 与 web 的 `src/lib/wiring.ts` 同构：core 不绑 toast 库、不知道服务器在哪，本端在启动时把实现塞进去。
 * **必须在任何网络请求之前调用**——由 `_layout.tsx` 模块顶层执行保证（渲染期之前）。
 */

/** EXPO_PUBLIC_API_URL 在构建期被内联进包体（Expo 约定），运行时不可改；缺配置必须可见。 */
const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

/** dev 构建可指名 fixtures 回放场景（05e §1-8）：release 不定义即通道不存在。 */
const TEST_SCENARIO = process.env.EXPO_PUBLIC_TEST_SCENARIO ?? "";

export const API_URL_MISSING_HINT =
  "未配置 API 地址：dev 用 `pnpm --filter @anxin/mobile android:dev`（自动探测电脑局域网 IP），" +
  "或手写 packages/mobile/.env.local 的 EXPO_PUBLIC_API_URL 指向服务器";

/** 登录 token 的 AsyncStorage 键（与 web 的 localStorage 同键名，便于运维排查）。 */
export const AUTH_TOKEN_KEY = "anxin-auth-token";

/** 配置是否可用（绝对 http/https 地址）。false 时界面必须显式告知，禁止让请求静默失败。 */
export function isApiConfigured(): boolean {
  return /^https?:\/\//i.test(RAW_API_URL.trim());
}

/** 当前生效的 API 基址（探测页/诊断界面展示；未配置时为核心回落值 "/"）。 */
export function apiBaseUrl(): string {
  return getApiBaseUrl();
}

/**
 * 装配本端接缝：API 基址 + 错误提示出口 + TTS + dev-only 场景头 + 登录态（G7）。
 *
 * 登录态两个接缝与 web 的 `src/lib/wiring.ts` 同构：
 *   · AuthTokenStorage —— token 存 AsyncStorage（读写是异步的，core 侧 await 返回的 Promise）；
 *   · UnauthorizedHandler —— 401 时清本地登录态，AuthGate 看到 anonymous 自动回登录页。
 */
export function wireMobilePlatform(): void {
  setApiBaseUrl(RAW_API_URL);
  setSpeechAdapter(mobileSpeechAdapter);
  if (__DEV__ && TEST_SCENARIO) {
    setExtraHeaders({ "x-test-scenario": TEST_SCENARIO });
  }
  setApiNotifier({
    onError: (message, code) => {
      toast.error(code ? `${message}（${code}）` : message);
    },
  });
  setAuthTokenStorage({
    load: () => AsyncStorage.getItem(AUTH_TOKEN_KEY),
    save: (token) => AsyncStorage.setItem(AUTH_TOKEN_KEY, token),
    clear: () => AsyncStorage.removeItem(AUTH_TOKEN_KEY),
  });
  setUnauthorizedHandler(() => {
    void resetAuthState();
  });
}
