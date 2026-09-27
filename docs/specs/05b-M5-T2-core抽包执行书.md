# M5-T2 · 前端逻辑层抽包 @anxin/core · 执行书（05b）

> 本文件是 [05-M5-安卓迁移与服务端上云.md](./05-M5-安卓迁移与服务端上云.md) 任务 T2 的**细化分派稿**，执行对象为外部 AI 编码代理（Qoder）。任务边界、完成标准以 05 任务书为准，本稿与其冲突时**停下来向用户报告**。
>
> 开工前必读：仓库根 `AGENTS.md` → 05 任务书 §T2 → 本文件。本稿给出的文件路径与行号基于 main @ `53cb707` 实测，若你看到的行号对不上（说明上游已变），以文件实际内容为准重新定位。

## 当前基线

- 分支 main @ `53cb707`；mobile 包（T3）已落地；web 包（@anxin/web）是唯一前端消费方，React 19 + Vite + zustand ^5.0.15 + @tanstack/react-query ^5.102.8。
- `app/pnpm-workspace.yaml` 设有 `nodeLinker: hoisted`——**勿改**。
- web 测试现状：**20 个测试文件 / 143 个用例**（vitest + jsdom），`pnpm --filter @anxin/web test` 运行；其中 `components/domain/intake/IntakeFlow.test.tsx`（266 行，13 用例）mock 掉 `@/api/client` 三函数与 `computeImageStats`、状态机走真代码——这是你抽完状态机后单测的现成蓝本。
- 事实：web/src 共 80 文件 10771 行；`lib/`、`stores/`、`api/` 三目录内**零 react-dom / 零 import.meta**，平台触点只有下表列出的几处。

## §1 新包规范（照抄 @anxin/shared 模式）

新建 `app/packages/core`（name `@anxin/core`）：

1. `package.json`：`"exports": { ".": "./src/index.ts" }`——**纯 TS 源码直引，无 build 产物**（workspace 是 `moduleResolution: "Bundler"`）。依赖只放运行时确实需要的：`zustand`、`@tanstack/react-query`、`@anxin/shared: workspace:*`、`hono`（client 的 hc 类型）、`clsx`+`tailwind-merge`（cn 用）——以迁移代码的实际 import 为准，不预放。
2. `tsconfig.json`：仅 `extends ../../tsconfig.base.json` + `include: ["src"]`。**禁止加 DOM lib**——base 的 lib 只有 ES2022，这样 `document`/`Image`/`SpeechSynthesisUtterance`/`File` 直接 TS 报错，就是「core 禁 DOM」的 typecheck 闸门；`setInterval`/`setTimeout` 属 ES 全局，**不误伤**（任务书明确要求按用途检查）。
3. **必须有 `"test": "vitest run"` script**（shared 包因缺它，根 `pnpm -r test` 跑不到它的测试——不要复刻这个缺口）；vitest 配置用 node 环境（core 无 DOM，不需要 jsdom）。
4. eslint：在 `app/eslint.config.js` 新增一段——对 `packages/core/**/*.ts` 禁 `document/window/navigator/localStorage/sessionStorage` 全局与 `sonner/react-dom/react-native` import（`no-restricted-globals` + `no-restricted-imports`）；web 目录既有规则不动。
5. 包入口 `src/index.ts` 桶式导出；测试文件与被测源码同目录放 `*.test.ts`（沿用 web 惯例）。

## §2 接缝分类表（逐文件，行号可定位）

| # | 源文件（web/src/） | 去向 | 接缝与处理 |
|---|---|---|---|
| 1 | `api/client.ts`（276 行，hc 客户端封装） | **整体进 core** | 唯一 web 耦合：`unwrap()` 内 `toast.error`（import sonner）。改为**可注入 reporter**：core 定 `ApiNotifier { onError(message: string, code?: string): void }` + `setApiNotifier()`（默认 no-op 实现）；web 侧装配 sonner 实现（行为与现状逐字一致）。core **禁止 import sonner** |
| 2 | `stores/fontScale.ts`（26 行，zustand persist） | 进 core | persist 未显式传 storage（默认 localStorage）。改**工厂/注入**：core 导出 `createFontScaleStore(storage?: PersistStorage<number>)`，persist key 保留 `'anxin-font-scale'`；web 用 `createJSONStorage(() => localStorage)` 装配。mobile 后续传 AsyncStorage |
| 3 | `stores/intakeSession.ts`（54 行） | 原样进 core | 纯内存（7–9 行注释即约束：绝不 persist、原图即用即弃）。存的是 dataURL string——双端通用，**保持 string 类型即平台无关**，勿过度设计 |
| 4 | `stores/reminderQueue.ts`（26 行） | 原样进 core | 纯 zustand，无持久化 |
| 5 | `lib/intake.ts`（235 行）**拆分** | **纯部分进 core，canvas 部分留 web** | 进 core：`Entry`(11)、`STAGE_TEXT`(14–28)、`SAFETY_NOTE`(31–32)、`FeedbackKind`(36)、`IntakeFeedback`(38–50)、`asStringList`(52–54)、`mapIntakeFailure`(60–115)、`RETAKE_CHECKLIST`(118–123)、`ImageStats`(127–136)、`QualityIssue`(138)、`QUALITY_HINTS`(140–145)、`QUALITY_ISSUE_LABEL`(147–152)、`assessQuality`(158–165)。**留 web**：`computeImageStats`(171–219，canvas 像素统计)+`loadImage`(221–228，`new Image()`)。接缝：core 定 `ImageStatsProvider` 类型 = `(dataUrl: string) => Promise<ImageStats>`，消费方注入；web 传 canvas 实现，**mobile 一期可不实现预检（任务书允许降级，「建议不拦用户」）**。`validateFile`(231–235) 入参是 DOM `File`——改为结构化形状 `{ name: string; type: string; size: number }`（web 的 File 天然满足，mobile 传 expo-image-picker asset） |
| 6 | `lib/draft.ts`(322) / `lib/draft-fixtures.ts`(227) / `lib/records.ts`(72) / `lib/tasks.ts`(73) / `lib/utils.ts`(10) | 进 core | records/tasks 零 import 完全纯；draft.ts 的 type-only `import { DraftPayloadDto } from '@/api/client'` 随 #1 整体进 core 自动消解（改相对路径）；utils 的 `cn()`（clsx+tailwind-merge）平台中立。对应测试 `*.test.ts` 随迁并保持全绿 |
| 7 | `lib/speech.ts`（58 行，window.speechSynthesis） | **core 只定接口，实现留 web** | core：`SpeechAdapter { isSupported(): boolean; speak(text: string, options?: SpeakOptions): void; stopSpeaking(): void }` + `SpeakOptions`（保留 lang 'zh-CN' / **rate 0.92** / pitch / volume / onStart / onEnd 语义）+ no-op 默认实例。web：现 `lib/speech.ts` 改写为 webSpeechAdapter 实现该接口（`SpeakButton.tsx` 等消费方经 core 接口取用）。mobile 后续 expo-speech 实现（T7） |
| 8 | `components/domain/intake/IntakeFlow.tsx`（490 行）**状态机抽取** | **纯决策函数进 core，组件留 web** | 现状：`type Step = 'upload'|'quality'|'processing'|'mismatch'|'failure'|'drafts'`（59 行）、8 个 state（70–77：step/image/issues/stageIdx/feedback/mismatch/result/handoffNote）、`applyFailure`(102–105)、`run`(107–145，**异步编排**：await detectImage → 按结果分支 → await intakePrescription/intakeDrug)、`onFile`(147–170，FileReader→validateFile→computeImageStats→assessQuality)、`backToUpload`(172–181)、`switchEntry`(183–191，setPendingImage+navigate)。抽法：core 导出**纯决策模块**（如 `src/intakeFlow/`）：状态类型 `IntakeFlowState` + 事件/迁移函数——「输入（当前状态+事件+IO 结果）→ 输出（新状态+动作描述列表）」，**网络请求、FileReader、navigate、setInterval(900ms 推进 stageIdx) 等副作用留平台层执行**；`run()` 的异步编排拆解为「决策（收到 IO 结果后如何迁移）」与「执行（发起 IO）」两半，决策部分进 core 可单测。web 的 IntakeFlow.tsx 改为消费（useReducer 或等价），**界面行为零变化** |

注意：zustand + TanStack Query 是 RN 也可用的库，stores 迁移后 core 依赖它们是合法的（任务书原话「zustand/TanStack Query 直通」）；`@anxin/shared` 是 zod 契约包，**不动**。

## §3 web 侧改造

1. `packages/web/package.json` 加 `"@anxin/core": "workspace:*"`；
2. web/src 内原 `@/api/client`、`@/stores/*`、`@/lib/*` 的 import 逐文件改指 `@anxin/core`（web 保留：computeImageStats 的 canvas 实现、speech 的 web 实现、reporter 的 sonner 装配、全部 routes/components）；
3. 迁走的源文件与测试从 web/src **删除**（不留双份真相）；测试随迁到 core，web 剩余测试照常。

## §4 完成标准与验收（逐条自验，命令+结果附交付说明）

1. `cd app && pnpm -r typecheck` 全绿——core 的 typecheck 在无 DOM lib 下零错误（这条同时证明 core 无 DOM）；
2. `pnpm test` 全绿：web 保留测试 + core 迁移测试 + **新增 intake 状态机纯函数单测覆盖六步流转**（upload/quality/processing/mismatch/failure/drafts 的迁移与失败映射、mismatch 换入口、单草稿直达/多草稿列表分支）；
3. `pnpm lint` 全绿（含新增 core 禁 DOM 段）；
4. web 界面行为零变化：人工过一遍 药箱+录入（两个入口）+咨询 页【人工，用户核对】；
5. `git status` 干净；一 commit：`M5-T2: @anxin/core 逻辑层抽包（api/stores/lib/状态机纯函数 + 接缝注入）`，推送 main（失败走 `git -c http.proxy=socks5://127.0.0.1:10808 push origin main`）。

## 预期陷阱（前人踩过，勿重蹈）

- shared 包没有 test script → 根递归测试漏跑它的测试；core 必须带；
- client.ts 的 sonner 耦合若图省事整包搬走，mobile 端（T4）会直接炸——reporter 注入是硬要求；
- validateFile 若保留 DOM `File` 类型，core 的 typecheck 会当场报错（这是闸门在工作，不是环境问题）；
- 状态机抽取时勿把 fetch/navigate 塞进 core——「决策在 core、副作用在平台层」是本任务的核心纪律；
- web 的 143 个用例是你唯一的回归网，任何一个红都先查自己的迁移是不是改了行为。
