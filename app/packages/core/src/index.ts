/**
 * @anxin/core —— 前端逻辑层（M5-T2 · 路线 A：逻辑公用，渲染分家）。
 *
 * 包边界：web（H5 / 医生端）与 mobile（RN 安卓）共用同一份逻辑真相——API 客户端、zustand store、
 * 纯函数与录入流程状态机。禁止 DOM 用途与 react-dom / sonner / react-native import
 * （两道闸门：本包 tsconfig 不装 DOM lib + 根 eslint 的 core 段）；平台触点一律以注入实现交付：
 *   · ApiNotifier —— 各端的错误提示（web=sonner）
 *   · SpeechAdapter —— 各端的 TTS（web=speechSynthesis，mobile=expo-speech）
 *   · createFontScaleStore(storage) —— 各端的持久化后端（web=localStorage，mobile=AsyncStorage）
 *   · ImageStatsProvider —— 各端的图片像素统计（web=canvas，mobile=原生缩放 + jpeg-js 解码，M5-T6b）
 * 类型与 zod 契约继续走 @anxin/shared；本包不复制契约。
 * 平台触点一览（M5-T4 增补 #0）：
 *   · setApiBaseUrl —— API 基址（web=同源相对 '/'，mobile=EXPO_PUBLIC_API_URL 绝对地址）
 */

export * from './api/client'
export * from './stores/fontScale'
export * from './stores/intakeSession'
export * from './stores/reminderQueue'
export * from './lib/intake'
export * from './lib/speech'
export * from './lib/draft'
// 测试夹具（仅测试引用，勿进应用代码）：web 的确认页组件测试沿用。
export * from './lib/draft-fixtures'
export * from './lib/records'
export * from './lib/tasks'
export * from './lib/utils'
export * from './intakeFlow/flow'
