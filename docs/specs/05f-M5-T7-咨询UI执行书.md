# M5-T7 · 咨询 UI · 执行书（05f）

> 本文件是 [05-M5-安卓迁移与服务端上云.md](./05-M5-安卓迁移与服务端上云.md) 任务 T7 的**细化分派稿**，执行对象为外部 AI 编码代理（Qoder）。冲突以 05 任务书为准，冲突即停并向用户报告。
> 开工前必读：仓库根 `AGENTS.md` → 05 任务书 §T7（`:113-117`）与 §9 → 本文件 → `app/packages/mobile/README.md`（出包/代理/令牌色三坑）→ [T6-真机验收.md §7](../../app/packages/mobile/T6-真机验收.md)（五个开口）→ [T5-真机验收.md](../../app/packages/mobile/T5-真机验收.md) §2.11 末差异清单。
> **当前状态（10-23 起草，只读取证）**：T6-a～T6-e 已交付；T6-f 真机按用户裁定整片跳过（`febe414`，五个开口在 T6 文件 §7）。T7 **未开工**：mobile 零咨询代码、`expo-speech` 未装、无 `consult` 路由、RNTL 未起。按 05e §6 权重 T6-a～e 合计 0.90 且 T6-c 完成，T6 已过达标线，不妨碍 T7。

### 0.2 裁定记录（2026-10-23 用户拍板：全部按 §0.1 建议值执行）

| 决定点 | 裁定 | 执行要点 |
|---|---|---|
| D1 药品选择器 | **A 照 web** | 不做页内选药器；对象药只从药箱「问这个药」深链带入；无对象只答数据类；补无效 drugId 提示 |
| D2 咨询入口 | **A 不改五 tab** | 根 stack `/consult`；今日页加真实入口卡；药箱加「问这个药」；设置页删两条 T7 假占位 |
| D3 会话层与建议卡 | **A 全量对齐 web** | sessionId 续问 + 历史回放 + 开新会话 + add_drug/note_symptom 两类建议卡；零后端改动 |
| D4 TTS | **A 本片做** | `expo-speech`（57.0.3）+ `SpeakButton`（头部 + L4 卡）；rate 0.92；需重出 APK |
| D5 mobile RNTL | **A 起，spike 1 天** | jest-expo 57.0.6 + RNTL 14.1.0 + test-renderer；不通退 B 并登记 |
| D6 AI 降级判据 | **A 按实际 API** | 判据 = `answered` 卡 + notice「咨询模型服务不可用…（降级）」；不改 API/shared/web |

> **2026-10-25 用户重新裁定（覆盖 D2）**：咨询页从根 stack 挪进底部 tab（标签「咨询」），页内自出「AI 药师咨询」标题，栈头返回箭头不再存在；药箱「问这个药」仍走 `/consult?drugId=…`，现在是切 tab 带参。同日导航改为 今日/药箱/录入/咨询/我的，记录/设置收回「我的」。Y1–Y4 旧截图是改造前形态，改造后需复验入口与底距。

---

## 0. 与 05 任务书 / web 现状的口径差（先看，不要自行裁决）

1. **05:115 写的「药品选择器」在 web 已不存在。** web 咨询页明确「对象药是会话上下文而非页面控件，本页无任何选药 UI」（[Consult.tsx:32-33](../../app/packages/web/src/routes/patient/Consult.tsx#L32-L33)），对象药只从药箱「问这个药」深链 `/consult?drugId=…` 带入（[Box.tsx:238](../../app/packages/web/src/routes/patient/Box.tsx#L238)）；无对象时只答药箱数据类问题（[Consult.tsx:114-119](../../app/packages/web/src/routes/patient/Consult.tsx#L114-L119)）。mobile 药箱在 T5 就刻意没放这颗按钮（[box.tsx:54](../../app/packages/mobile/src/app/(patient)/box.tsx#L54)）。
   **处置**：→ D1。若选「照 web」，T7 必须补药箱「问这个药」，而不是造选择器；若坚持 05 原文，就要新造一套 web 没有的选药状态机，并与「UI 对齐 web」的完成标准冲突。

2. **`AI_UNAVAILABLE` 在 API 侧没有 `status='ai-unavailable'` 这条路径。** 枚举值确实在 shared/schema/AnswerCard 里（`shared/src/dto.ts:136`、`api/src/db/schema.ts:287`、web `AnswerCard.tsx:35`），但服务端遇 AI 不可用时是**降级拼装 + 一条 notice**，最终 `status` 仍是 `answered`（[run.ts:266-274](../../app/packages/api/src/services/consult/run.ts#L266-L274)、[run.ts:285-297](../../app/packages/api/src/services/consult/run.ts#L285-L297)）：
   > 「咨询模型服务不可用，回答由本地说明书库规则拼装（降级）。」
   05:117 的「`AI_UNAVAILABLE` 降级可见」若拿状态徽章「AI 降级」当判据，**屏幕上永远按不出来**。
   **处置**：→ D6。建议判据改成「answered 卡 + 这句 notice 可见」，T7 **不改 API**（动它会连动 shared/web，超出本片）。

3. **mobile 五个 tab 里没有咨询位，入口形态 T7 才能定。** T5 裁定五槽是「今日/药箱/记录/我的/设置」，并写「AI 咨询留位到 T7」（[05d §0.1-3](./05d-M5-T5-主线界面移植执行书.md#L22)）；现状：今日页只有 SOON 占位「AI 用药咨询 · M5-T7」（[index.tsx:63-66](../../app/packages/mobile/src/app/(patient)/index.tsx#L63-L66)），药箱无咨询按钮，设置页有两条 T7 占位（[settings.tsx:18-19](../../app/packages/mobile/src/app/(patient)/settings.tsx#L18-L19)）。
   **处置**：→ D2。建议不改五 tab，走根 stack `/consult` + 今日页真实入口卡 + 药箱「问这个药」深链；「AI 用药咨询相关设置」在 web 并不存在，T7 应删掉这条假占位，而不是补一个没有内容的设置页。

4. **05 T7 没列会话层与建议卡，但 web 已实现，且「UI 对齐 web」是完成标准。** web 有 M4-T5 会话续问/历史回放/开新会话（[Consult.tsx:99-165](../../app/packages/web/src/routes/patient/Consult.tsx#L99-L165)、`:211-233`）与 M4-T6 确认式建议卡（`:104-105`、`:300-301`，组件 [SuggestionCard.tsx](../../app/packages/web/src/components/domain/consult/SuggestionCard.tsx)）。只做单轮问答等于交付一个「比 web 少一半」的咨询页。
   **处置**：→ D3。建议全量对齐；建议卡的两个入口目标 mobile 都已具备（`/intake/drug` 或 `/box?manual=1&prefillDrug=…`，[consult.service.ts:449-450](../../app/packages/api/src/services/consult.service.ts#L449-L450)；Box 的 `?manual=`/`?prefillDrug=` 已接，[box.tsx:75-83](../../app/packages/mobile/src/app/(patient)/box.tsx#L75-L83)）。

5. **TTS 接缝已就位，但 mobile 侧是空的。** core 只定接口与降级语义，默认 rate 0.92（[speech.ts:26](../../app/packages/core/src/lib/speech.ts#L26)、`:41-50`）；web 适配器在 `web/src/lib/speech.ts`，mobile 没有 `expo-speech` 依赖（`mobile/package.json` 零命中），也没有 `SpeakButton`。expo SDK 57 对应的版本是 **expo-speech 57.0.3**（10-23 `npm view expo-speech dist-tags` → `sdk-57: 57.0.3`）。
   **处置**：→ D4。新原生依赖意味着必须重出 APK（README「新增原生模块」段）；不 prebuild 也能自动链接，但 Gradle 解析要吃 v2rayN（`README:175`、`:182`）。

6. **web 冻结，不能为了「一份真相」去抽公共函数。** `buildSpeakText`、`STATUS_META`、`TOOL_LABELS`、`SECTION_KEY_LABELS` 目前都住在 web 组件里；把它们挪进 core 再让 web 改 import，属于动 web，违反 05 §0 与 AGENTS 硬性边界。
   **处置**：mobile 侧按 web 逐字复制这四张小表/函数，文件头注明「对照物路径 + web 冻结」，差异只允许平台适配；关账时登记为「刻意重复」。

7. **mobile 至今零测试，05e 的 D3-A 没有落点。** 05 §测试策略要求「新增 mobile RNTL 关键组件测试」，05e §0.1 选了 A 起，但六片验收一条都没挂它（[05e:221-222](./05e-M5-T6-录入双入口完整化执行书.md#L221-L222)），`packages/mobile` 现在无任何 `*.test.*`、无 test script。
   **处置**：→ D5。咨询页有八条状态分支（L1/L2/L3/L4/manual-gate/no-source/data-answered/AI 降级），全押在模拟器手点是高成本；建议本片起 RNTL 并只测「stub 掉平台层后的 core 消费面」，先做 1 天 spike，不通就退 B 并如实登记。

8. **fixtures 回放通道能覆盖大部分咨询分支，但覆盖不了全部。** `app/e2e/fixtures/consult-answered.json` / `consult-limited.json` 有 `consultAnswer` 录制（`consult-session.json` / `consult-allergy.json` 也在）；dev 构建用 `EXPO_PUBLIC_TEST_SCENARIO` 注入 `x-test-scenario`（README「dev 构建的 fixtures 回放场景头」）。**没有场景头时 FixtureAiClients 会抛 AIUnavailableError**（[fixtures.ts:56](../../app/packages/api/src/lib/ai/fixtures.ts#L56)）——这正好是第 2 条降级路径的现成入口。
   但 L4/L3（守门固定文案）、S2 数据查询（0 次 LLM）、manual-gate、no-source **不需要 LLM**，可直接打真接口；no-source 要求「非 manual 且本地无说明书」的药，需先在本机库里取证有没有这种行，没有就临时插一条（只动本机库）。

9. **咨询写库副作用比录入更「留痕」。** 每轮都写 `consult_logs`，L4/L3/manual-gate 另写 `risk_events`，`add_drug` 建议卡写 `suggestions`（`note_symptom` 不落库）；**这些没有删除接口**。T6 遗留的 SSH 主机键问题（T6 §7-2）还挡着直接进公网库清理。
   **处置**：fixtures 矩阵与造数据**只打本机 API + 本机演示库**；真机验收打公网时只走正常提问，不跑造数据矩阵；产生的日志留在演示库并如实登记。

10. **mobile 没有 `Textarea` 组件，也没有现成的聊天屏范式。** 输入区用 `TextInput multiline`；键盘避让已有两套先例（草稿页 RN `KeyboardAvoidingView`，弹窗 keyboard-controller），本片按键盘控制器方案做，并在大字号档实测「输入框不被键盘盖住」。自动滚到底、错误卡常驻是 mobile 侧新增行为，登记进差异表。

### 0.1 决定点（拍板后回写 §0.2，不留口头结论）

| # | 问题 | 选项 | 建议 | 影响面 |
|---|---|---|---|---|
| **D1** | 「药品选择器」怎么落 | **A** 照 web：无选药器，药箱「问这个药」深链带入对象；无对象只答数据类／**B** 页内做选药器 | **A**（05:117 同时要求「UI 对齐 web」，A 是唯一不冲突的读法） | A：补药箱一颗按钮 + 无效 drugId 提示；B：新造 web 已删除的 UI 与状态，返工风险高 |
| **D2** | 咨询入口放哪 | **A** 根 stack `/consult`；今日页加真实入口卡；药箱加「问这个药」；五 tab 不动／**B** 加第六 tab 或替换现有 tab | **A**（T5 五槽是用户拍板；咨询是「从药/从今日进入的任务」，不是并列主 tab） | A：纯 mobile；B：改 T5 裁定，需重验五 tab 布局与手感 |
| **D3** | 会话层与建议卡做不做 | **A** 全量对齐 web（会话续问 + 历史回放 + 开新会话 + 两类建议卡）／**B** 只做单轮问答，登记缺口 | **A**（05:117 完成标准是「UI 对齐 web」；端点全现成，无后端改动） | A：约 +1 屏面板 + 1 张卡组件；B：交付即残缺，T7 不能关账 |
| **D4** | TTS 是否本片做 | **A** 按 05 做 expo-speech + SpeakButton（需重出 APK）／**B** 推到 T8 | **A**（05:115 点名 T7；core 接缝已留好） | A：新原生依赖 → 出包要代理；真机听感只能用户判 |
| **D5** | 是否在本片起 mobile RNTL | **A** 起：jest-expo 57.0.6 + RNTL 14.1.0 + test-renderer，spike 1 天／**B** 不起，靠模拟器 uiautomator + 真机栏 | **A**（八条状态分支，组件测试比手点稳；同时清 05e D3 的欠账） | A：+devDep 组，不动 APK；spike 不通退 B 并登记 |
| **D6** | 「AI_UNAVAILABLE 降级可见」的判据 | **A** 按实际 API：answered 卡 + notice「咨询模型服务不可用…（降级）」／**B** 改 API 产出 `ai-unavailable` 状态 | **A**（B 要动 api + shared + web，且 web 冻结） | A：判据改口，写进本文件与 T7 验收单；B：超出 T7 边界，需另立案 |

---

## 1. 前置条件（开工前逐条核实，不满足即停）

1. **T7 不等 T6-f**：T6 达标线已过（a～e 0.90 且 T6-c 完成）。但 T6-f 的五个开口仍挂着（T6 §7），其中「`/api/drafts` 无列表接口」「SSH 主机键变了」「代跑边界待裁定」与本片无交集；若用户后续补跑 T6-f 发现入口/回答区回归，按发现的问题另开修复片，不在本片预防性改。
2. **mobile 现状复核**（行号会漂，动手前重跑 `grep`）：
   - 无 `consult` 路由；根 stack 只有 `(patient)` / `intake/rx` / `intake/drug` / `drafts/[id]` / `probe`（[`_layout.tsx:39-43`](../../app/packages/mobile/src/app/_layout.tsx#L39-L43)）；
   - 今日页第三张入口卡不存在，SOON 里挂着「AI 用药咨询 · M5-T7」（[index.tsx:63-66](../../app/packages/mobile/src/app/(patient)/index.tsx#L63-L66)）；
   - 药箱动作行只有编辑/暂停/恢复/结束/删除（[box.tsx:377-419](../../app/packages/mobile/src/app/(patient)/box.tsx#L377-L419)），无「问这个药」；
   - 设置页两条 T7 占位（[settings.tsx:18-19](../../app/packages/mobile/src/app/(patient)/settings.tsx#L18-L19)）；
   - `package.json` 无 `expo-speech`、无 test script、无 RNTL/jest devDep。
3. **依赖**：`npx expo install expo-speech`（预期 57.0.3）→ 原生模块，必须重出包；不 prebuild 时自动链接，若报 `Cannot find module`/原生链接错误再按 README「prebuild 三补丁」处理。
4. **本机联调环境**：PostgreSQL 5432 → 本机 API 8787（`AI_MODE=fixtures`，指向本机演示库）→ Metro 8081 → 模拟器 `emulator-5554`。真机验收用 release 包指火山，不依赖本机 API。
5. **fixtures 场景**：`consult-answered` / `consult-limited` 已存在；S1 问答用它们，S0/S2/manual/no-source 不用场景头。**无场景头 = AI 降级**，作为 D6-A 的取证路径。
6. **RNTL（仅 D5-A）**：jest-expo 57.0.6、@testing-library/react-native 14.1.0、test-renderer 1.3.1；只进 devDependencies，不进出包产物。spike 判据：能在 1 天内跑起「渲染 consult 页 + stub core 传输层 + 断言 L1 卡」这一条；跑不起来就退 D5-B，不硬扛。
7. **服务端零改动**：T7 不动 `api/`、`shared/`、`core/`、`web/`。若实现中发现契约缺口（例如 mobile 需要 web 没有的字段），停下来报告，不自行加字段。

---

## 2. 范围分片（每片一个 commit、一条独立验收，顺序即依赖序）

### T7-a 路由、入口与页面骨架（含异常可见）

**做什么**
1. 新建 `src/app/consult.tsx`，根 stack 注册 `<Stack.Screen name="consult" options={{ title: "AI 药师咨询" }} />`；深链 `anxin://consult?drugId=…` 可直接落到本页。
2. 入口三处：
   - 今日页 `ENTRIES` 加第三张真实卡「AI 药师咨询」（图标建议 `Bot`，描述写「问说明书、查药箱数据；不诊断不开方」），删 SOON 里的咨询占位（T8 那条保留）；
   - 药箱每张药卡的动作行加「问这个药」（`CardAction`，`Bot` 图标），`router.push({ pathname: "/consult", params: { drugId: drug.id } })`；
   - 设置页删「语音播报」「AI 用药咨询相关设置」两条 T7 占位（web 无对应设置；TTS 是咨询页内按钮，不是设置项）。
3. 页面骨架：`ScrollView` 消息区 + 底部输入区（快捷问题横滑条 + `TextInput multiline` + 发送键）；空会话问候语（空药箱 / 有对象药 / 无效 drugId / 无对象药四种，文案照 web `Consult.tsx:245-270`）；manual 档横幅（照 `:235-241`）；pending「AI 正在思考…」；**传输失败常驻错误卡 + 重试**（不允许只在 toast 里闪一下）。
4. `lib/net.ts` 增加一个面向「会抛错的 core 请求」的包装（名称自定，如 `guardRequest`）：超时 + 网络异常收敛成中文消息，成功原样返回；consult 的发送/会话列表/会话详情都经它。**不改** intake 现有 `callTransport` 语义。
5. 自动滚到底：新消息/新卡出现后 `scrollToEnd`；大字号档不截断。

**完成标准**：三处入口都能进咨询页；有/无 drugId、无效 drugId 三种落点文案正确；断网时出中文错误卡且可重试；`typecheck` / `expo export` 绿。

### T7-b 回答区四件套与八条状态分支

**做什么**
1. mobile 侧新增四个域组件，逐个对照 web 重写渲染层（禁止搬 `div`/`<a>`/`aria-*`）：
   - `components/domain/consult/AnswerCard.tsx`：RiskBadge + status 徽章 + `toolUsed` 来源徽章 + sections 五段 + notice/l0Notice + CitationsList；
   - `components/domain/consult/EmergencyCard.tsx`：L4 标题/摘要/风险列表 + **大按钮「立即拨打 120」**（`Linking.openURL('tel:120')`）+ 「查找附近急诊」（外链地图）+ 本卡专属播报；
   - `components/domain/consult/CitationsList.tsx`：默认折叠「来源 N 条」，展开后药名 + source + 版本 + 段落名；`unverified` 徽章；
   - `components/domain/consult/SuggestionCard.tsx`：`add_drug` 双路径（拍照建档 → `/intake/drug`；手动建档 → `/box?manual=1&prefillDrug=…`）+ 忽略（`dismissSuggestion`）；`note_symptom` 去「健康信息」(`/profile`)，忽略纯前端收起。
2. 复制 web 的 `STATUS_META` / `TOOL_LABELS` / `SECTION_KEY_LABELS` / `buildSpeakText` 到 mobile（文件头注明对照物与 web 冻结），不改 web、不动 core。
3. **令牌色纪律**：web 的 `bg-risk-lN/10|/15`、`border-risk-lN/30`、`bg-muted/20`、`text-foreground/80` 一律换成 mobile 已有的实色令牌（`bg-risk-lN-tint`、`border-risk-lN`、`bg-muted` 等）或元素级 opacity；图标颜色走 `useUnstableNativeVariable`；禁拼 `text-risk-${level}`。
4. L4 卡在消息流里渲染（与 web 同构），不新造「置顶吸顶」；「置顶」按 web 语义 = 卡内 120 大按钮在卡顶部。

**完成标准**：模拟器逐条诱出并截图八种分支——L1 answered（fixture）、L2 limited（fixture）、L3 refused（问「我可以停药吗」）、L4 emergency（问「我胸痛怎么办」）、manual-gate（手动建档药）、no-source（非 manual 且无说明书的药）、data-answered（问「我现在有多少药物」）、AI 降级（fixtures 无场景头）；citations 折叠可开合；L4 的 120 按钮在屏且**不实际拨号**；大字号档不溢出。

### T7-c 会话层、输入区与建议卡接线

**做什么**
1. 聊天状态：`messages`（user/assistant 对）、`sessionId`、`suggestion`；首问响应回传 `sessionId`，续问自动带入；「开新会话」清空本地态并 invalidate `['consult-sessions']`。
2. 快捷问题：数据类五条恒显；说明书类四条仅在有对象药时渲染（`shared` 的 `CONSULT_DATA_QUICK_QUESTIONS` / `CONSULT_INSERT_QUICK_QUESTIONS`）；点按即发，带 `skillId`。
3. 历史会话面板：打开时才 `fetchConsultSessions`；空态「还没有历史会话。」；点选 `fetchConsultSession` → 按 web `logToChatMessages` 映射回放（`sectionsSnapshot` 为摘要、`suggestion=null`）；面板内错误可见。
4. 建议卡：只保留最新一轮；accept 后按服务端 `target` 跳转（`/intake/drug` 或 `/box?...`）；dismiss 后消失；开新会话即清。
5. 发送失败：错误卡常驻 + 可重试；pending 时发送键与 chips 禁用；输入法弹起时输入区可见（keyboard-controller / `KeyboardAvoidingView` 实测）。

**完成标准**：同一会话连续两问，第二问 `sessionId` 续接；历史列表 → 回放 → 续问接续该会话；开新会话后回到首问形态；建议卡两条路径各点通一次（拍照建档只验到录入页拉起，不拍照；手动建档验到药箱弹窗预填）；键盘不遮输入。

### T7-d TTS 接缝与出包

**做什么**
1. `src/lib/speech.ts` 实现 `SpeechAdapter`：`expo-speech` 的 `Speech.speak` / `Speech.stop`；参数从 `DEFAULT_SPEAK_OPTIONS` 取（`lang: 'zh-CN'`、`rate: 0.92`、pitch/volume 1），回调映射 `onStart`/`onDone`/`onStopped`/`onError` → core 的 `onStart`/`onEnd`；每次播报前先 stop，避免叠音。
2. `wireMobilePlatform()` 里 `setSpeechAdapter(mobileSpeechAdapter)`（先于渲染）。
3. `components/domain/voice/SpeakButton.tsx`：照 web 的播放/停止切换、3 秒看门狗、卸载停止、无文本/不支持置灰 + 提示；图标 `Volume2`/`VolumeX`，触控目标 ≥44px。
4. 播报入口两处：咨询页头部「播放最新回答」、L4 急救卡「播报急救指引」；播报文本用 mobile 版 `buildSpeakText`。
5. `npx expo install expo-speech` → `pnpm --filter @anxin/mobile android:release` 重出包（v2rayN 在线）；核包确认 `expo-speech` 进产物。

**完成标准**：模拟器点播报不崩、按钮在播放/停止间切换、离开页面即停；真机由用户听中文语音与语速（rate 0.92），确认「能听清、不叠音」；release 包装机成功。

### T7-e 自验、差异表与关账记账

**做什么**
1. 服务端回归（**不动代码**）：`pnpm --filter @anxin/api test` 全绿，重点 `consult-*.test.ts` 与 `consult-golden.test.ts`；`pnpm -r typecheck` / `pnpm lint` 零红。
2. 模拟器 fixtures 矩阵：按 §2-T7-b 八条分支逐条截图（`.qoder/verify-shots/t7-*`，不入库），证据写进新建的 `app/packages/mobile/T7-真机验收.md`（格式照 T5/T6：§0 状态表 / 分片 / 真机栏 / 交回什么；装机事实带 Host）。
3. 与 web 的差异清单：刻意不同（无侧栏、stack 头 + 页内工具栏、自动滚底、常驻错误卡、实色令牌、单按钮发送）与未接项（无）分开记；对照物给 web 文件行号。
4. 更新文档：`mobile/README.md`「页面与里程碑边界」段加 consult；`05d §6` 第 17 条里「咨询」相关去向如有变化同步；**不改 05 任务书原文**，关账结论写在本文件与验收单。
5. 数据副作用：记录本机库新增的 consult_logs/risk_events/suggestions 条数；公网演示库只登记、不清理（SSH 主机键问题未解）。

**完成标准**：八条分支证据齐；API 回归全绿；差异表逐条有结论；T7 验收单状态行收口；用户真机栏（TTS 听感、手感、大字号）有结论。

---

## 3. 明确不做（做即返工）

- **web 患者端任何改动**（H5 冻结；本片对 web 只允许读作对照物）。
- **API / shared / core 改动**（T7 零后端改动；`consult` 端点、会话、建议卡全部现成）。
- 页内药品选择器（D1-A 时）· 语音输入（2026-09-20 已整体移除）· 服务端推送 / 系统通知（T8）· 图表 / Maestro（T9）· 医生端 · iOS · 模型迁移 · 修改守门文案或降级策略 · 把「AI 降级」做成新状态（D6-B 不选则不碰）。
- **不要**为了「看起来像 web」搬 `lg:` 侧栏、`hover:`、`aria-*`、`<a target>`；不要给 L4 做自动拨号。

---

## 4. 分工

| 事项 | 谁 | 通过标准 |
|---|---|---|
| D1–D6 拍板并回写 §0.2 | **用户** | 不留口头结论；代理不得先按建议值开工 |
| T7-a～T7-e 编码 + typecheck/test/lint + 出包 + 模拟器自验 | Qoder | 每片交付说明附**实际执行**的命令与返回，不写「预期通过」 |
| 真机 TTS 听感、大字号手感、L4 卡触达（不真拨 120） | 【用户操作】 | 逐条 🟢 / 差异说明，截图或录屏对上 |
| 模拟器 fixtures 矩阵、接口面比对、产物自检 | Qoder | **不许推给用户**；做不到写明卡在哪一步 |

---

## 5. 两条栏：只能【用户本人】的 vs 代理可自验的

> 判据纪律同 05e §5：写屏幕判据前先回读组件；「两侧口径是否一致」的判定优先走接口侧；真机拍照/相册一律用户本人（本片不涉及拍照）。

### 表 1 · 只能【用户本人操作】

| # | 要做的事 | 操作口令 | 屏幕上按得出的判据 |
|---|---|---|---|
| Y1 | 真机咨询主流程 | 今日页 → 「AI 药师咨询」→ 点一条数据快捷问题 → 再问一条说明书问题（从药箱「问这个药」进入） | 回答卡出、风险徽章/来源可读；无白屏无静默 |
| Y2 | 真机 TTS 听感 | 咨询页头部播报 → 再点一次停止；L4 卡播报（**不要真拨 120**） | 中文能听清、语速偏慢、不叠音；停止键立即生效；离开页面不再念 |
| Y3 | 大字号 + 深色手感 | 设置切大字 → 咨询页走一轮 | 输入区不被键盘盖住；长回答可读；按钮 ≥44px 手感；L4 卡不溢出 |
| Y4 | L4 触达 | 问「我胸痛怎么办？」 | 急救卡出现、120 大按钮在首屏可达（**只验存在，不拨号**） |

### 表 2 · 代理可自验（不占用户时间）

- **八条状态分支**：fixtures/守门/本机造数（见 §2-T7-b），逐条截图；
- **会话层**：两问续接、历史回放、开新会话（接口侧看 `sessionId`/turn 数，屏幕看消息条数）；
- **失败可见**：断网/500/404 会话失效各一条，断言中文卡与重试；
- **产物**：`typecheck`、`lint`、`expo export`、release APK 与核包（`expo-speech` 探针、双 ABI、地址）；
- **回归**：`pnpm --filter @anxin/api test`（consult 全套 + golden）、`pnpm -r typecheck`。

---

## 6. 工期、权重与止损

05 表列 **1–2 周**（AI + 真机）。分片权重：**T7-a 0.15 / T7-b 0.25 / T7-c 0.20 / T7-d 0.20 / T7-e 0.20**。达标线：权重和 ≥0.5 **且 T7-b 完成**（回答区是咨询页的命脉）；不足则按 05 §9 先砍 T9 图表、再砍语音（T7 本身不在砍序里，TTS 若要砍只能用户改任务书）。

每片一 commit，格式沿用：`M5-T7a: 咨询路由、今日/药箱入口与页面骨架（RN）`；里程碑整体完成才打 `m5-done`（在 T9 之后）。

---

## 7. 已知风险（提前登记，翻车不算意外）

1. **新原生依赖 → 出包链路**：`expo-speech` 走 Gradle 解析；v2rayN 必须在线（`gradle.properties` 钉 `socks 127.0.0.1:10808`）；`expo prebuild` 会先删 `android/`（被占用报 EBUSY），能不用就不用；用 prebuild 则重打三个镜像补丁（README「本机工具链」段）。
2. **RNTL spike 可能不通**：RN 0.86 + React 19 + jest-expo 57 的组合没有仓库先例；时间盒 1 天，不通退 D5-B 并登记「05 §测试策略的 mobile RNTL 仍未起」。
3. **令牌色 alpha 静默丢失**：`bg-risk-l3/10` 这类类整条不落产物（README「令牌色带透明度」段）；照抄 web 样式必踩。图标颜色必须显式给。
4. **键盘与滚动**：edge-to-edge 下 RN 自带 `KeyboardAvoidingView` 在安卓可能失效（T5-f 已踩过）；输入区必须用 keyboard-controller 或实测有效方案；自动滚底用 `onContentSizeChange`，不要用 `inverted`（老人读屏与顺序会乱）。
5. **typed routes 生成物**：新增 `/consult` 后 `.expo/types/router.d.ts` 需重新生成；跨机 pull 后 typecheck 红不一定是代码错（README「跨机 pull」段），按起 metro + 打 bundle 重生成，别删 `.expo` 关闸门。
6. **fixtures 场景头是全局注入**：dev 构建设了 `EXPO_PUBLIC_TEST_SCENARIO` 后，所有请求都带同一个头；换场景要重启 metro；release 包不注入（降级路径要单开一次无场景头的 dev 构建）。
7. **L4 的 `tel:120`**：模拟器点按会拉起拨号盘，自动化只验存在、不点；真机验收同样不真拨。
8. **数据污染**：consult 写 `consult_logs`（每轮）+ `risk_events`（L4/L3/manual）+ `suggestions`；没有删除接口。矩阵只打本机库；公网演示库只登记不清理（SSH 主机键未解决）。
9. **TTS 无中文语音包**：模拟器可能听不到中文；`expo-speech` 无同步「能力查询」，本片 `isSupported()` 在 Android 返回 true、以 `onError` 复位兜底。真机听感归用户；若真机也无中文包，按「播报是增强」降级，登记不阻断。
10. **大字号溢出**：咨询页信息密度高，20px 根字号下长药名、citation 三件套、L4 卡按钮都可能折行；按 T5 §2.13 的口径逐屏量，不靠目测。
11. **T6-f 遗留**：入口/回答区如果与 T6-f 未跑的真机项重叠（例如「问这个药」按钮、手动建档），发现回归另开修复片；本片不替 T6-f 做预防性改动。

---

## 8. 交回什么 / 关账动作

- 每片一段：做了什么（带 `file:line`）、**实际执行**的验证命令与返回、本片独立验收逐条 🟢/差异、未完成清单；
- §0 十条口径差逐条给「按裁定执行 / 遇到新事实要改口」的结论；D1–D6 回填 §0.2；
- 表 1 由用户给结论、表 2 由代理给证据；不通过先把实际屏幕/输出贴回来；
- 关账时：新建 `app/packages/mobile/T7-真机验收.md` 并收口 §0 状态行；`mobile/README.md` 页面边界段更新；`05d §6` 与 `T5-真机验收.md` 里指向 T7 的占位/去向同步；**T7 完成不等于 m5-done**（在 T9 之后）。
