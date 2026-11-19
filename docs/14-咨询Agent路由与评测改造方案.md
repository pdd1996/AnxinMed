# 安心用药 · 咨询 Agent 路由与评测改造方案（V0.1 待裁决）

> 版本：V0.1（2026-11-18）
> 状态：**提案；P0、P1、P2-T6/T7 已落地并部署至 staging（2026-11-19）；P3 小模型离线评测已完成（结论：不接线上，见 §11.5 与 [specs/21](./specs/21-咨询Agent-P3-小模型离线意图评测.md)）**。M13 代码/评测/部署收口，后续仅剩试点期指标观察（[specs/22](./specs/22-M13-收口总结与试点观测清单.md)）。
> 来源：用户 2026-11-18 命题——参考知乎文章《我做了一个旅行助手 Agent，聊聊意图识别》（作者 windliang，https://zhuanlan.zhihu.com/p/2076267775065170292），评估并改造当前「安心用药」咨询 Agent。
> 上游真相源：PRD V2.2（06）· 技术方案 V1.1（08，附录 A 意图路由设计）· ADR（07）· docs/10（决策记录）· docs/11（指标口径）· docs/12（Agent 整体架构）· docs/13（模型选型）· specs/04-M4（已收口）。
> 与上游冲突处理：本文不自行裁决，冲突集中在 §9 交用户裁决（执行总纲 §0.2）。
> 一句话：**不重写 Agent，只给现有 S0–S3 技能路由补「可解释轨迹、意图评测集、对象/范围边界、口语路由词表」，并按失败成本重切五层。**

---

## 0. 结论（读这一节就够）

1. **文章的方法论与现架构同向，但不能直接照搬。** 文章最终落到「规则管确定、小模型管模糊、业务代码管执行、Debug/Eval 管迭代」；前三点 M4 已落地且更严格（模型至今不进路由），缺的是第四点——**可观测与可评测**。
2. **现有架构不需要重写。** 真正的差距只有四项：① 意图/守门缺评测集，② 路由缺轨迹，③ 缺对象澄清与范围边界，④ 口语词表与解释类仲裁不足。
3. **实测发现一个应独立先修的安全缺口**：`孩子误服了怎么办` 不触发 L4 急症（当前只覆盖「儿童误服 / 大量误服」字面）。它不应等路由改造，建议作为 P0.5 独立提交（§4 T3a）。
4. **建议顺序**：P0 评测网 + trace（零行为变更）→ P0.5 L4 口语召回 → P1 对象澄清 / 范围层（需裁决）→ P2 候选打分 + 路由视图（零/小行为变更）→ P3 小模型兜底（数据触发，默认不做）。
5. **与上线节奏不冲突**：P0 / P0.5 是纯增量，可与 G1–G5 合规、G11 说明书铺面并行；P1 及以后排在受控试点之后再评估。

---

## 1. 现状基线（2026-11-18）

### 1.1 已实现（本次改造的地基，不动）

| 能力 | 代码落点 | 现状 |
|---|---|---|
| 守门 | `api/src/services/consult/guards.ts`、`patterns.ts` | L4 急症 > L3 拒答 > manual-gate > unverified > no-source > proceed；纯函数、先于一切技能 |
| 技能路由 | `api/src/services/consult/registry.ts` `routeSkill` | S0 守门 → skillId 快路径 → S2 正则（5 意图）→ S1 兜底；解释类词仲裁 `EXPLAIN_INTENT_PATTERN` |
| 数据直答 S2 | `api/src/services/consult/dataquery.ts` | medication-list / adherence / expiry-stock / interaction-check / next-dose，模板直查库，0 次 LLM |
| 说明书问答 S1 | `api/src/services/consult/run.ts`、`sections.ts`、`lib/ai/*` | 按键取一段说明书 + 相互作用 + 慢病交集 + 多药身份快照；单次 LLM；失败走规则拼装 |
| 后处理 | `api/src/services/consult.service.ts` | 过敏确定性覆盖层、citations 注入完整性、剂量过滤、确认式建议卡、consult_logs / risk_events 留痕 |
| 会话 | `consult_sessions` / `consult_logs` | sessionId 回传、续问、历史列表与回放；**prompt 未注入会话历史** |
| 评估 | `consult-golden.test.ts`、`e2e/fixtures/consult-*`、`docs/11` | 不变量 golden + 逐字节 fixture 回放 + 月度人工抽检（**首检待做**）+ 骨架/全链 P95 |
| 明确禁项 | `docs/12` A9、§13；`docs/08` 附录 A.4 | 无 ReAct / RAG / text-to-SQL / LLM 意图分类主路由；`classifyIntent` 仅保留 data-gated 扩展位 |

### 1.2 实测缺口（2026-11-18 路由探测）

探测方式：直接调用 `classifyConsultIntent` / `detectEmergency` / `detectProhibited` 三个纯函数跑 20 条老年口语与边界问法（不含 DB 与完整 HTTP 链路；S1 段落选择按 `SECTION_ROUTES` 正则推断）。原始结果见附录 A。

| 输入 | 当前实际结果 | 期望行为 | 性质 |
|---|---|---|---|
| 孩子误服了怎么办 | 无 L4，走 S1「药物过量段」 | L4 急救卡 | **安全：守门召回漏洞** |
| 这个药吃了犯困正常吗 | S1，取「适应症段」 | 不良反应段 | 段落路由词表不足 |
| 这个药伤肝吗 | S1，取「适应症段」 | 不良反应 / 注意事项段 | 段落路由词表不足 |
| 这个药能喝酒吗 | S1，取「适应症段」 | 相互作用 / 注意事项段 | 段落路由词表不足 |
| 这个还有几片 | S1（无对象药 → no-source 固定话术） | S2 库存，或对象澄清 | 意图漏判 + 缺对象澄清 |
| 药过期了还能吃吗 | S2 效期模板（答「药箱里有几种过期」，安全句仅在有已过期药时出现） | 解释/固定安全文案 | S2 语义偏移（行动类问法） |
| 我漏服了怎么办 | S2 依从性统计（安全提示依赖是否有连续漏服记录） | 解释/固定处理指引 | S2 语义偏移（行动类问法） |
| 我是不是得了糖尿病 | S1，仅靠 prompt 禁止诊断，无输出侧守门 | 固定拒绝 | 范围边界缺失 |
| 帮我写个劳动合同 | S1（有绑定药时白花一次 LLM；无药 → no-source） | out-of-scope 固定文案 | 范围边界缺失 |

三点结论：

1. **L4 是最高优先级**：`consult-golden.test.ts` 的 L4 变体恰含「孩子大量误服了药片」，因「大量误服」字面而绿；真实口语「孩子误服了」漏。这是「测试集覆盖正则字面量」的典型陷阱。
2. **S1 段落词表写的是规范术语，真实用户说的是症状词**（犯困/伤肝/喝酒），模型只拿到错误段落时只能「资料未覆盖」或硬编。文章说的「输入归一化」，在本项目的正确形态是**段落路由词表 + 意图同义词表**，不是通用 NLP 归一化。
3. **S2 说话的是数据，问话的是行动**（还能吃吗/怎么办）。现有 `EXPLAIN_INTENT_PATTERN` 只仲裁说明书名词，未覆盖「还能吃吗 / 怎么办 / 要不要 / 要紧吗」这类行动与建议词。

### 1.3 文档 / 实现债（本方案顺带处理）

| # | 事项 | 处理 |
|---|---|---|
| E1 | `docs/12` §5 把「会话窗口最近 N=6 轮」列为咨询上下文，但 `ConsultPromptPayload` 无任何 history 字段（会话只存不用） | 列为 P3 评估项，不默认实现；文档表述在裁决后修正（A8） |
| E2 | `docs/11` 意图漏判率「首检待做」，无 per-intent 评测集，月度抽检是盲目随机 | 本方案 P0 建立评测集与低置信定向抽检（T1/T2） |
| E3 | `docs/08` A.4 预留 `AiClients.classifyIntent?`，代码未实现 | 保持预留；P3 先离线评测，不接线上（T8） |
| E4 | 移动端 APK 已出包（G8 受控试点）；新增 `status` 值有旧客户端兼容议题 | 列入裁决 A1，先做客户端未知枚举容错 |

---

## 2. 文章方案取舍（哪些抄、哪些不抄）

| 文章能力 | 本方案判断 | 落点 |
|---|---|---|
| 输入归一化 | **改造后采纳**：字符级归一放守门前；语义归一（同义词/指代）只生成路由视图，绝不改送模型原文 | T7（P2） |
| 旅行范围判断 | **改造为「对象 + 范围」两层**：对象缺失 → clarify；明显越界/诊断请求 → out-of-scope；不确定默认 S1 | T4/T5（P1） |
| 业务意图识别 | 已有；补候选 + 分数 + 理由 + 负向词 + 低置信标记 | T6（P2，先只观测） |
| 规则候选 + 阈值触发小模型 | **暂缓**：先打分只观测；小模型仅离线评测，线上接入由数据裁决 | T8（P3） |
| clarify | **只采纳「对象药缺失」一种**；不泛化追问 | T4（P1） |
| out_of_scope | **采纳保守规则版**；诊断/处方判断另立一类（需裁决 A2） | T5（P1） |
| 多意图 | **不做**：医疗域一轮答两件事易串药，用 chips 拆 | §7 |
| Slot Filling | **不做框架**：对象药由入口绑定，只补对象槽 | T4 |
| 配置化意图词表 | **暂缓**：当前规模测试即规格；规则 >50 条再议 | §7 |
| Embedding / few-shot | **不做在线**；可离线用于挖候选词表，人工复核后入评测集 | §7 |
| Debug 面板 + 本地 trace | **采纳**，但只给开发/运维；患者端零可见 | T2（P0） |
| 意图评测集 / 指标 | **采纳，最高优先** | T1（P0） |
| 「工具 success 才说已写入」 | 已对齐（建议卡只出入口，写入必经确认页） | 不动 |
| 会话历史注入 | **暂缓**：对象药由 UI 绑定，多数追问不依赖历史；注入模型历史回答有 citations 污染风险 | §7、A8 |

---

## 3. 目标架构：按失败成本重切五层

### 3.1 数据流

```
POST /api/consult
  scrub（既有 L3 出口脱敏）
  ① 输入清洗：字符级归一（NFKC / 全半角 / 空白 / 标点）        ← 不做语义替换
  ② 守门：guards（既有，纯函数，永远第一）                      ← 直接依赖正则，不经模型
  ③ 意图候选：语义归一视图（同义词 / 指代补全，仅路由）→ S2 候选 + 解释类仲裁 + 低置信标记
        ├─ S2 命中 → 执行 S2（数据问题不需要对象药）
        └─ 未命中 → ④
  ④ 对象与范围：
        a. 明确越界 / 诊断处方请求 → out-of-scope 固定文案（待裁决 A2）
        b. 缺对象 + S1 类问法 → clarify 固定文案 + 药名选项（待裁决 A3）
        c. 其余 → S1（manual-gate / no-source / proceed 既有逻辑不变）
  ⑤ 执行 + 后处理（既有：过敏覆盖 / citations 校验 / 剂量过滤 / 建议卡 / 留痕）
  trace：记录 ①–④ 判定与 ⑤ 结果（默认关闭，开发/运维可见）
```

**与文章的层序差异（重要）**：文章是「归一化 → 范围 → 意图」，顺序不能照抄。本项目的 S2 数据问题（还有多少药 / 今天吃什么 / 快过期）与咨询对象药无关，若先判「对象缺失」会把数据问题误拦成 clarify。因此**意图候选必须先于对象/范围决策**，这是医疗管家的数据能力决定的。

### 3.2 分层职责

| 层 | 回答什么 | 失败方向 | 现状 | 改造 | 允许模型？ |
|---|---|---|---|---|---|
| ① 输入清洗 | 文本机械规范化 | 失败回到原文 | 无 | 新增纯函数 + 测试表 | 否 |
| ② 守门 | 是否急症 / 停药换药调剂量 | 宁可误杀 | 纯正则 | **只补口语变体，架构不动** | **否（永远）** |
| ③ 意图 | S1 还是 S2 / 哪个 S2 | 漏判 → S1（安全） | 首命中短路 + 解释词否决 | 候选 + 分数 + 理由 + 负向词；先只观测 | 否（P3 离线才可评估） |
| ④ 对象 / 范围 | 问哪个药；是否用药域 | 默认放行 | 无 | clarify（仅缺对象）+ 保守范围层 | 否 |
| ⑤ 执行 | 模板还是 LLM | 既有降级 | 已定 | **不动** | S1 既有 |

### 3.3 关键设计约束

1. **守门永远第一且纯规则**：任何模型、任何新层都不得先于或改变 S0 判定（`docs/12` A9 不变，甚至更明确）。
2. **归一化分两层**：字符级归一在守门前（防「胸　痛」「胸 痛」逃逸）；语义归一在守门后，且**只生成路由视图**，送模型的 `question` 保持脱敏原文——否则会改变 LLM 的证据与措辞，破坏逐字节 fixture 与守门一致性。
3. **新层默认放行**：意图不确定 → S1；范围不确定 → 用药域；clarify 只用于「缺对象 + S1 类问法」。宁可漏拦，不可误拦。
4. **clarify 零 LLM、零写库**：固定模板 + 药箱药名选项；老年用户一次只问一个问题。空药箱不 clarify，直接引导去录入。
5. **trace 脱敏**：只含规则 id、分数、枚举、路由结果；不含问题原文、药品名以外的用户数据；默认关闭，关闭时零 I/O。
6. **可回滚**：每个新行为一个 env 开关（`ENABLE_INTENT_ROUTE` 已有；新增 `ENABLE_SCOPE_GATE`、`CONSULT_ROUTE_TRACE`，P3 分类器另设），默认值与上线节奏见 §5.6。

### 3.4 与现有代码的映射

| 新增 / 修改 | 文件 | 性质 |
|---|---|---|
| 字符级归一 + 语义路由视图 | 新增 `api/src/services/consult/normalize.ts` | 纯函数 + 测试表 |
| 对象 / 范围判定 | 新增 `api/src/services/consult/scope.ts`、`clarify.ts` | 纯函数 + 固定文案 |
| 意图候选 | 改 `api/src/services/consult/intent.ts`（保留 `INTENT_ROUTES` 正则与 `EXPLAIN_INTENT_PATTERN` 仲裁） | 先只观测，后决定是否按分数决策 |
| 路由接入 | 改 `api/src/services/consult/registry.ts` `routeSkill`、`consult.service.ts` | 决策顺序保持，新增 trace / 低置信标记 |
| trace | 新增 `api/src/services/consult/trace.ts` | 纯函数 builder + zod schema |
| 评测集 | 新增 `app/fixtures/consult-intent-eval.json` + `api/src/__tests__/consult-intent-eval.test.ts` + `api/src/scripts/eval-consult-intent.ts` | 入 git + CI |
| 契约 | `shared/src/dto.ts` `ConsultStatusSchema` / `ConsultResponseSchema` | **待裁决 A1/A3** |
| 指标 | `docs/11` | 随任务更新 |

---

## 4. 任务分解（拟升格任务书 · 编号 T1–T9）

> 顺序原则沿用 M4：**先织评测网，再改行为**。P0/P0.5 零/低风险可立即做；P1 需 §9 裁决；P2/P3 看数据。

| 任务 | 优先级 | 行为变更 | 依赖 |
|---|---|---|---|
| T1 意图评测集与回归网 | P0 | 无 | — |
| T2 路由轨迹 route trace | P0 | 无 | — |
| T3 路由词表与仲裁修复（T3a L4 口语召回独立先做） | P0 / P0.5 | 有（只增召回 / 纠偏到 S1） | T1 |
| T4 对象澄清 clarify | P1 | 有 | A1/A3、T2 |
| T5 范围层与诊断拒绝 | P1 | 有 | A2、T2 |
| T6 意图候选打分（只观测） | P2 | 无 | T1、T2 |
| T7 语义归一化路由视图 | P2 | 小 | T6、T1 |
| T8 小模型兜底（先离线） | P3 | 数据触发 | T6/T7、T1 |
| T9 文档与指标收口 | 随任务 | 无 | 全部 |

**执行顺序**：T1 → T2 → T3a → T3b/c/d → T4 → T5 → T6 → T7 → T8；T9 每任务同步。

### T1 意图评测集与回归网（P0，零行为变更）

**做什么**

1. 新增 `app/fixtures/consult-intent-eval.json`，首版 120–150 条，字段：`id / question / drugContext(bound | none) / expectedRoute(S0-emergency | S0-refused | S2/<intent> | S1 | clarify | out-of-scope) / expectedStatus / tags / pendingUntil? / note`。
2. 标签配额（附录 B）：守门口语变体、S2 五意图 × 口语变体、解释类近义负例、混合句、缺对象、越界/诊断、标准 chips 问法、错别字/全角。
3. 新增 `api/src/__tests__/consult-intent-eval.test.ts`（route 层纯函数，无 DB）+ `api/src/scripts/eval-consult-intent.ts`（输出混淆矩阵、按 tag 失败清单、低置信分布），加入 `package.json`（`eval:intent`）。
4. 已知缺口不隐藏：T3 修复前允许用例标 `knownGap` 并在报告中单列；T3 完成后清空。
5. 报告落 `data/consult-intent-eval/YYYY-MM-DD-baseline.md`（入 git，与 `data/consult-bakeoff/*.md` 同款）；P1 的 clarify/out-of-scope 用例先 `pendingUntil: "P1"`。

**完成标准**：评测集入 git 且每条有期望；CI 跑；现有行为基线冻结并出报告；P1 用例可跳过且不误绿。

### T2 路由轨迹 route trace（P0，零行为变更）

**做什么**

1. 新增 `consult/trace.ts`：zod 定义 + 纯函数 builder，按 §3.1 记录每一层判定、候选与最终结果、`llmCalled`、`routeVersion`。
2. `routeSkill` / 归一 / 对象 / 范围各层输出 trace entry；`CONSULT_ROUTE_TRACE=1` 时写 `.agent-debug/consult-<ts>.json`；根 `.gitignore` 增加 `.agent-debug/`。
3. trace **不含问题原文**（`consult_logs.question` 已有，trace 引 consultLogId 即可）；单测断言零 PII 字段。
4. 默认关闭时零 I/O、零延迟影响（断言）。

**完成标准**：trace schema 单测；开关默认关闭时行为与延迟不变（骨架 P95 复测）；开启时每轮一文件且字段完整；零泄漏断言。

### T3 路由词表与仲裁修复（P0/P0.5，行为变更：只增召回 / 纠偏到 S1）

**T3a（P0.5，独立提交，安全优先）L4 口语召回**

- 扩充 `EMERGENCY_PATTERN`：覆盖「孩子/小孩/宝宝/儿童 + 误服/误吃/吃错/吞了/多吃」「老人误服」等口语结构；保持既有变体只增不减。
- `consult-golden.test.ts` L4 变体 ≥8 条；`consult-guards.test.ts` 补正例 + 负例（如「上次误服过一次，已经没事了」不应误报，具体以产品/医学确认口径为准）。
- 完成标准：新变体全部 L4；历史 L4 用例不回退；误报负例通过。

**T3b SECTION_ROUTES 同义词**

- 不良反应段：犯困 / 嗜睡 / 头晕 / 伤肝 / 肝损 / 肝功能；
- 相互作用段：喝酒 / 饮酒 / 酒精；
- 其余按评测集失败案例补。每条新增词必须有对应用例（沿用 `patterns.ts` 迁移纪律）。

**T3c INTENT_ROUTES 同义词 / 负向词**

- expiry-stock：还剩 / 还有几 / 剩余 / 快吃完（注意与 medication-list 的「还有几种药」区分，加负向约束）；
- 其余按评测集补。

**T3d 解释类 / 行动类仲裁扩展**

- 新增咨询专用 `CONSULT_ADVICE_PATTERN`（落地时调整：**不并入** `EXPLAIN_INTENT_PATTERN`——后者被医生端 `insight/askIntent.ts` 复用，医生问「怎么办」仍应按队列/患者问法走数据路由）：还能(吃|用|喝|贴|服) / 怎么办 / 要不要 / 该不该 / 正常吗 / 要紧吗 / 有没有事 / 严重吗 / 危害 / 后果 / 要补 / 补服 等 → 优先 S1（宁漏勿误）。
- 完成标准：评测集对应用例转绿；既有 `consult-intent-route` 测试语义不变；误路由零新增。

### T4 对象澄清 clarify（P1，需裁决 A1/A3）

**做什么**

- 纯函数判定：无绑定药 + 问法含指代/说明书词（这个药/它/说明书/副作用/用法…）且非 S2 数据问题 → clarify。
- 固定文案（不进模型、不落库、不写 risk_events）：如「你想问药箱里的哪种药？」+ 药名选项（≤6，来自本人药箱）；空药箱走既有「去录入」引导。
- 响应扩展（待 A3）：新增可选 `clarifyOptions: { drugId, drugName }[]`；点选后带 `drugIds` 重新提问。
- web / mobile 渲染 + 无障碍；旧 App 对未知 status 做容错（A1）。

**完成标准**：纯函数单测（有对象/无对象/数据问题不澄清/空药箱/越界不澄清）；集成与 E2E 各一条；`consultAnswer` 调用数 0；指标 clarify 率进 docs/11。

### T5 范围层与诊断拒绝（P1，需裁决 A2）

**做什么**

- 纯函数 `scope.ts`：只识别「明显非用药话题」（股票、写合同、编程、闲聊）与「诊断/处方判断请求」；不确定一律用药域。
- 固定文案 + 「我能做什么」引导；是否进 risk_events 按 A2 裁决。
- 顺序在守门之后、S1 之前；enabled 开关可整体回滚。

**完成标准**：明显越界拒绝；评测集负例（正常用药问题）零误杀；S0 仍优先；E2E 一条；指标 out-of-scope 率。

### T6 意图候选打分（P2，零行为变更）

**做什么**

- `intent.ts` 输出候选 `{ intent, score, reason }`（沿用文章 0–100 尺度与「双词共现更高分」思路），但**决策逻辑不变**：仍按现有短路 + 解释词仲裁，确保 parity。
- trace 携带候选与 `lowConfidence`（top <80 或 top2 差 ≤8 或解释词仲裁触发）；用于定向抽检。
- 完成标准：所有既有 route 测试逐条不变；trace 有候选；低置信占比报告。

### T7 语义归一化路由视图（P2，小行为变更）

**做什么**

- 新增 `normalize.ts`：同义词表（机酒式：还剩→库存、快吃完→快用完、犯困→不良反应 等，仅路由用途）+ 指代补全（「这个/它」+ 已绑定药 → 追加上下文标记）。
- 只喂意图路由与对象判定；**送模型原文不变**。行为变化由 T1 评测集背书，`ENABLE_ROUTE_NORMALIZE` 可回滚。
- 完成标准：评测集 recall 提升且零新增误路由；骨架 P95 不退化；fixture 不需重录（prompt 未变）。

### T8 小模型兜底（P3，数据触发，默认不做）

**做什么**

1. 离线脚本 `eval-consult-intent-classifier.ts`：用 `qwen3.8-flash` / `deepseek-flash` 非思考对 T1 评测集分类，与规则结果对比，出报告。
2. 仅当评测 + 线上低置信数据证明规则确有不可接受的缺口时，再设计线上门控：`AiClients.classifyIntent?`，输入仅「脱敏问题 + 候选意图枚举」，输出 zod 校验，`temperature=0`，超时 2s，失败 open 到 S1，仅允许 S1/S2 之间，永不碰 S0，只对低置信样本调用，采纳率留痕。
3. 上线前须过 `docs/08` A.4 与 `docs/12` A9 的裁决。

**完成标准**：离线报告落 docs；线上方案另行评审；未达标不接线上。

### T9 文档与指标收口（随任务）

- `docs/11` 增指标；`docs/08` 附录 A 增补路由层/归一/trace；`docs/12` §5 会话窗表述修正、§13 禁项重申；PRD / specs/04 附录 A 增量条目（不改历史）；`AGENTS.md` 真相源列表加入本文（裁决后）；每个任务附验证命令与结果。

---

## 5. 契约与数据变更

### 5.1 shared 契约（待裁决 A1/A3）

- `ConsultStatusSchema` 新增 `clarify` / `out-of-scope`（**需裁决**）。
- `ConsultResponseSchema` 新增可选 `clarifyOptions?: { drugId, drugName }[]`；未新增状态时可先不扩。
- `ConsultSkillId` / `ConsultQueryIntent` 不变；`QuickQuestion` 不变。
- `ConsultSuggestionSchema` 不变（clarify 不是建议卡，避免混淆「确认式建议」与「补充槽位」）。

### 5.2 数据库

- `consult_logs.status` 是 `varchar`（应用层枚举，无 CHECK），**新增取值不需要 SQL 迁移**；需同步 `schema.ts` 类型注释与 `shared` 契约。
- 可选（裁决 A6）：`consult_logs.route_trace jsonb` 可空，仅存规则 id / 分数 / 枚举；不存问题原文；迁移为纯 SQL 进 git。
- 不新增表；`risk_events` 不新增类型（诊断请求是否进 risk_events 由 A2 定）。

### 5.3 API

- 响应新增字段均为可选、向后兼容；旧客户端应忽略未知字段；**新增 status 值需旧客户端容错**（A1）。
- 无新端点；trace 不经 HTTP 返回（开发期写文件，试点期如需可加受控只读端点）。

### 5.4 前端

- 新增 clarify 卡（药名 chips）与 out-of-scope 卡；文案经老年向可读性检查；触控 ≥44px；不展示技术细节。
- 患者端**不加 Debug 面板**；如作品集需要，另做 env-gated 的 `/dev/consult-trace`（不影响患者路由）。

### 5.5 prompt

- P0–P2 **不改 prompt**，因此无需重录 fixture；S1 仍只基于给定说明书段落回答。
- 若将来注入会话历史或 `route` 提示，单独立项并重录 fixture。

### 5.6 env 开关

| 开关 | 默认 | 用途 |
|---|---|---|
| `ENABLE_INTENT_ROUTE` | 开（既有） | 整体回滚 S2 正则路由 |
| `CONSULT_ROUTE_TRACE` | 关 | 写 `.agent-debug/` |
| `ENABLE_SCOPE_GATE` | P1 上线后开 | 整体回滚范围层 |
| `ENABLE_ROUTE_NORMALIZE` | 开（P2） | 回滚语义归一 |
| P3 分类器开关 | 关 | 未上线前不存在 |

---

## 6. 指标与评估（docs/11 增补）

| 指标 | 口径 | 目标 / 阈值 | 数据源 |
|---|---|---|---|
| 意图评测集通过率 | 期望 route/status 命中 / 总用例 | 守门 100%；S2 精确率 100%（负例零误路由）；S2 召回设基线后逐步收紧 | `eval:intent` |
| per-intent recall / precision | 混淆矩阵按意图 | 首版只测不设阈，两轮后定线 | `eval:intent` |
| L4/L3 拦截召回 | 既有 golden + 新增口语变体 | 100% | `consult-golden` |
| 低置信路由占比 | top<80 或 top2 差 ≤8 | 观测；过高说明规则层需补 | trace / consult_logs |
| clarify 率 | clarify / 总咨询 | 观测；过高说明澄清触发过宽或对象绑定入口不足 | consult_logs |
| out-of-scope 率 | out-of-scope / 总咨询 | 观测；用于产品边界评估 | consult_logs |
| 模型兜底率 | 分类器调用 / 总咨询 | P3 前恒为 0 | trace |
| 骨架 P95 / 全链 P95 | 既有口径 | ≤500ms / ≤15s，不退化 | perf 脚本 |
| 月度抽检 | 30 条/月，**优先低置信样本** + 随机补足 | 漏判/误判数回填 docs/11 | consult_logs |

---

## 7. 明确不做

- LLM 做意图主路由、LLM 判定 scope、LLM 生成澄清问题。
- 泛化 clarify（多轮追问收敛、槽位框架）、多意图合并执行。
- RAG / 向量检索 / embedding few-shot 在线路由（PRD 决策 #15 不变）。
- 患者端 Debug 面板或向用户暴露路由内部信息。
- 配置化意图词表（暂缓，规则 >50 条再议）。
- 会话历史全量注入 prompt（P3 单独评估；本方案不改 prompt）。
- 咨询对话直接写库 / 改计划（既有禁令不变）。
- 为改造而改答案生成方式（P0–P2 不动 prompt 与 schema 归一路径）。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 新增 status 破坏已发布 APK | 先做客户端未知枚举容错（旧版回退到通用卡），API 灰度开关，再发版；受控试点可接受 |
| 范围层误杀正常问题 | 纯规则只拒明显项；不确定默认用药域；评测集负例零误杀；`ENABLE_SCOPE_GATE` 回滚 |
| clarify 打扰老年用户 | 只做对象缺失一种；空药箱不澄清；一次一问；指标观察 clarify 率 |
| 评测集过拟合 / 标注偏见 | 人工为主、合成只做候选且人工复核入 git；每月从 consult_logs 定向补样本；标注记录可追溯 |
| trace 泄漏 PII | 白名单字段 + 零泄漏断言；不存问题原文；默认关闭 |
| L4 扩召回误报 | golden 同时加正/负例；历史误服、假设句单独回归；产品/医学确认口径 |
| 候选打分会改变行为 | T6 只观测、决策不变；决策变更另开任务并以评测背书 |
| 排期与 G1–G5 上线冲突 | P0/P0.5 纯增量可插入；P1 及以后排在受控试点之后；不阻塞合规事项 |

---

## 9. 需用户裁决项（A1–A9）

> **2026-11-18 用户批复：A1–A9 全按建议**（执行书 [specs/18-咨询Agent-P1-对象澄清与范围层.md](./specs/18-咨询Agent-P1-对象澄清与范围层.md)）。下表保留原建议供追溯。

| # | 裁决项 | 选项 | 本方案建议 |
|---|---|---|---|
| A1 | 是否新增 `clarify` / `out-of-scope` 两个咨询状态？ | a. 新增 + 客户端未知枚举容错 + 灰度；b. 复用 `no-source`/`refused` + notice；c. 只在内部用、前端映射 | **a**：语义清晰、可统计、无需 SQL 迁移；先做旧客户端容错。若不愿动契约，退 b（指标会脏） |
| A2 | 诊断 / 处方判断请求的归属？ | a. 新增 `out-of-scope`（产品边界，不进 risk_events）；b. 并入 L3 `refused`（安全拦截，进 risk_events，扩 PRD A3）；c. 先不做 | **a**：与「安全拦截」区分，指标可解释；如希望医生端可见边界请求，选 b |
| A3 | clarify 的范围与响应形态？ | a. 只做对象药缺失 + 新增 `clarifyOptions` 药名选项；b. 只做固定文案指路（零契约变更）；c. 不扩回调，泛化追问 | **a**；空药箱走既有录入引导；不泛化 |
| A4 | 范围层规则强度？ | a. 纯规则、保守、默认放行；b. 规则 + 小模型判 scope | **a**：拒绝/受理不应由模型决定 |
| A5 | L4 口语召回是否独立先行？ | a. 是，P0.5 单独提交，不等 A1–A3；b. 并入 T3 一起 | **a**：安全缺口优先；只增召回、可回滚 |
| A6 | trace 落点？ | a. P0 只写开发 `.agent-debug/` 文件；b. 直接加 `consult_logs.route_trace` 列 | **a**：P0 零迁移；试点确有需要再按 b 加列 |
| A7 | 评测集来源与规模？ | a. 人工为主 + 合成候选人工复核，首版 120–150 条；b. LLM 直接生成 300 条；c. 不做 | **a**：对齐 fixture synthetic 纪律；规模按标签配额 |
| A8 | `docs/12` §5「会话窗口 6 轮」怎么处理？ | a. 修正文档为「M4 未实现，P3 评估」；b. 补实现（加历史注入） | **a**：先消除文档-实现差；实现需单独评估成本/收益/自引用风险 |
| A9 | 排期：P0/P0.5 是否现在插入？ | a. 现在插入，P1 排受控试点后；b. 全部等上线后；c. 全部立即做 | **a** |

裁决后动作：① 将 §4 升格为 `docs/specs/16-M13-咨询Agent路由工程化.md`；② 按 A1–A9 同步 §5/§6/§9 结论；③ 按 P0 顺序开工，每任务一 commit；④ 每任务完成标准逐条自验并附命令与结果。

---

## 10. 与上游文档的同步清单（裁决后执行）

| 文档 | 改动 | 时机 |
|---|---|---|
| `docs/08-技术方案.md` 附录 A | 增补五层路由、归一化两层、候选打分、trace 设计；A.4 保持「模型仅离线评测」表述 | T6/T7 |
| `docs/11-咨询Agent评估与指标口径-M4.md` | 增评测集、低置信、clarify/out-of-scope、模型兜底率指标 | T1 起 |
| `docs/12-安心用药-Agent整体架构.md` | §5 会话窗按 A8 修正；§13 禁项重申；§4 技能注册表补 clarify/scope 非技能说明 | T4/T5 |
| `specs/04-M4-咨询Agent会话化.md` 附录 A | 以新任务书增量回写（不改 M4 历史） | P1 |
| `docs/06-PRD` §7.5 / §16.3 | 咨询状态与可答范围增量（若 A1/A2 通过） | P1 |
| `AGENTS.md` 真相源列表 | 加入本文 / 新任务书 | 裁决后 |

---

## 附录 A · 2026-11-18 路由探测原始结果

方法：一次性 `tsx` 脚本直接 import 纯函数（`classifyConsultIntent` / `detectEmergency` / `detectProhibited`），不连 DB、不走 HTTP；S1 段落选择按 `SECTION_ROUTES` 推断。复现方式：从 `api/src/services/consult/{intent,guards}.ts` 导入后逐条调用；脚本未入库（一次性探测）。

| # | 输入 | emergency | prohibited | intent（null=S1） |
|---|---|---|---|---|
| 1 | 药过期了还能吃吗 | — | — | expiry-stock |
| 2 | 我漏服了怎么办 | — | — | adherence |
| 3 | 这个药快过期了 | — | — | expiry-stock |
| 4 | 我还有多少药 | — | — | medication-list |
| 5 | 这个药吃了犯困正常吗 | — | — | null |
| 6 | 这个药能长期吃吗 | — | — | null |
| 7 | 我是不是得了糖尿病 | — | — | null |
| 8 | 帮我写个劳动合同 | — | — | null |
| 9 | 这个药和他汀一起吃有风险吗 | — | — | null |
| 10 | 今天我要吃哪些药 | — | — | next-dose |
| 11 | 这个还有几片 | — | — | null |
| 12 | 停药后还能吃吗 | — | 停药 | null |
| 13 | 这个药伤肝吗 | — | — | null |
| 14 | 我这两天血糖有点高，要紧吗 | — | — | null |
| 15 | 说明书上说的相互作用是什么意思 | — | — | null |
| 16 | **孩子误服了怎么办** | **—（应为 L4）** | — | null |
| 17 | 这个药能喝酒吗 | — | — | null |
| 18 | 我的依从性怎么样 | — | — | adherence |
| 19 | 这个药一天吃几次 | — | — | null（S1 剂量段） |
| 20 | 阿司匹林和布洛芬能一起吃吗 | — | — | null（S1 相互作用段） |

证据边界：只反映正则逻辑，不代表完整 HTTP 链路（manual-gate / unverified / no-source / DB 状态会影响最终 status）；S2 模板的具体文案依赖用户药箱数据。「过期/漏服」模板本身含安全提示句（expiry 模板有「过期药品请勿继续服用」，依赖确有已过期药；adherence 模板的高危提示依赖连续漏服记录），问题在答非所问，不在无安全文案。

## 附录 B · 评测集标签配额（首版 120–150 条）

| 标签 | 条数 | 覆盖 |
|---|---|---|
| `guard_L4` | 10–12 | 胸痛/呼吸困难/昏迷/抽搐/呕血/黑便/自杀/儿童误服（含孩子、小孩、宝宝误吃）/大量误服 |
| `guard_L3` | 8–10 | 停药/换药/调剂量各口语变体 |
| `s2_medication-list` | 8 | chips 原文 + 口语 + 近义 |
| `s2_adherence` | 8 | chips 原文 + 口语 |
| `s2_expiry-stock` | 10 | 过期/临期/还剩/快用完/快吃完/还有几片 |
| `s2_interaction-check` | 8 | 双词共现 + 上下文约束 |
| `s2_next-dose` | 8 | chips 原文 + 「今天还吃哪些」变体 |
| `s1_explain` | 20 | 说明书各段落问法（含犯困/伤肝/喝酒等新词） |
| `s1_negative` | 15 | 解释类词与 S2 词重叠（「这个药有副作用吗，我还有多少药」等） |
| `mixed_guard` | 6 | 守门 + 数据意图混合句 |
| `missing_object` | 8 | 无绑定药 + 指代/说明书问法（P1 后转绿） |
| `out_of_scope` | 8 | 股票/写合同/闲聊/诊断请求（P1 后转绿） |
| `standard_chips` | 6 | 五条数据 chips + 一条说明书 chips |

合成规则：LLM 只做候选生成，全部人工复核后入 git（对齐 fixtures synthetic 纪律）；每条注明 `source: hand | synthetic-reviewed`。

---

## 11. 落地记录

### 11.1 P0（2026-11-18，用户「开工」后执行）

| 任务 | commit | 内容 |
|---|---|---|
| T0 方案 + 执行书 | `8c93595` | 本文 V0.1 + [specs/16-咨询Agent路由工程化.md](./specs/16-咨询Agent路由工程化.md) |
| T3 路由词表与仲裁 | `d755fcf` | L4 口语召回、SECTION_ROUTES 同义词、INTENT_ROUTES 同义词、咨询专用行动词仲裁 + 单测 |
| T2 路由轨迹 | `bb4ccd7` | `resolveSkillRoute`（决策不变）+ `trace.ts` + service 接线（默认关闭）+ `.agent-debug/` gitignore + 单测 |
| T1 评测集 | `409824f` | `consult-intent-eval.json`（134 条）+ `intent-eval.ts` + `eval:intent` + CI 测试 |

**验证（2026-11-18，本机）**

- `pnpm --filter @anxin/api typecheck`：通过；
- 纯函数测试子集（无 DB）：6 文件 / 171 用例全绿；
- `pnpm --filter @anxin/api eval:intent`：用例 134，通过 118 / 失败 0 / 待启用 16（P1 的 clarify / out-of-scope）；
- `npx eslint`（改动文件）：0 error（1 条既有 warning 与本轮无关）。

**限制**：本机无 PostgreSQL（localhost:5432 未监听），`pnpm --filter @anxin/api test` 的 globalSetup 因 ECONNREFUSED 无法执行——集成 / E2E 需在具备 PG 的环境复跑；纯函数子集已用临时 vitest 配置（不加载 globalSetup）验证。

**实施偏差（相对 §4）**

1. 行动词仲裁独立为 `CONSULT_ADVICE_PATTERN`，不并入 `EXPLAIN_INTENT_PATTERN`（避免改变医生端 askIntent 行为，见 T3d）。
2. commit 顺序为 T3 → T2 → T1 而非任务编号顺序：T1 评测模块依赖 T2 的 `resolveSkillRoute`，T2 依赖 T3 的 `analyzeConsultIntent`；按依赖提交可保证每个 commit 独立可绿。
3. T3a（L4 口语召回）与 T3b（SECTION_ROUTES）同在 `patterns.ts`，未拆独立 commit；回滚可按 hunk 处理（如产品要求）。
4. L4 扩召回后，裸「误服」会命中历史陈述（「上次误服过」）；按安全优先接受，已用单测固化该取舍，产品 / 医学如要求收敛另开任务。
5. 新增 status（clarify / out-of-scope）未实施，A1/A2 仍待裁决；评测集中 16 条 P1 用例已先行声明期望并 `pendingUntil` 跳过。

**后续更新**：2026-11-18 PostgreSQL 就绪后复跑全量 API 测试（62 文件 / 772 用例）全绿，P0 的「集成/E2E 未跑」限制解除（E2E 仍待单独执行）。

### 11.2 P1 对象澄清与范围层（2026-11-18，A1–A9 批复后执行）

| 任务 | commit | 内容 |
|---|---|---|
| T1–T3 契约/纯函数/接线 | `a0f0a7c` | `ConsultStatusSchema` + `clarify`/`out-of-scope` + `clarifyOptions`；`scope.ts`/`clarify.ts` 纯函数；service「范围 → 对象 → S1」接线；两个 kill switch；纯函数 + 集成测试；评测 16 条 P1 用例转绿 |
| T4 Web/Mobile UI | `76932a9` | AnswerCard 药名选项（≥44px）；点选后带所选 drugId 重发原问题；旧客户端未知 status 走通用卡 |

**验证（2026-11-18，PostgreSQL 就绪后）**

- `pnpm --filter @anxin/api test`：**67 文件 / 844 用例全绿**（含 P1 新增 50 用例；P0 全量回归亦复跑通过）；
- `pnpm --filter @anxin/api eval:intent`：**134 / 134 通过，0 失败、0 待启用**（clarify 8 + out-of-scope 8 已计入混淆矩阵）；
- `pnpm --filter @anxin/web test`：18 文件 / 119 用例全绿；`pnpm --filter @anxin/mobile test`：6 套件 / 38 用例全绿；
- `pnpm --filter @anxin/{api,web,mobile,core,shared} typecheck`：通过。

**实施说明**

1. 范围层保守白名单（诊断/看报告 + 明显非用药），不确定默认放行；诊断请求归 out-of-scope、不进 risk_events（A2）。
2. clarify 只做对象缺失，且仅在药箱非空时触发；空药箱回退 no-source（A3）。
3. `ENABLE_SCOPE_GATE` / `ENABLE_OBJECT_CLARIFY` 两个 kill switch（默认开），各自集成用例覆盖回滚。
4. 旧客户端兼容（A1）：请求新增可选 `consultStatusVersion`——旧 APK 不带 → 服务端把 `clarify`/`out-of-scope` 降级映射为 `no-source`（固定 sections 可正常渲染；G8 版 `STATUS_META[status]` 查表遇未知 status 会渲染崩溃，故必须服务端降级）；新 Web/Mobile 经 core 自动带 `2` 原样收到新状态。`consult_logs`/trace 仍记真实状态，指标不变。兼容层合入后 E2E 全量复跑 21/21 绿。**2026-11-18 staging 部署 + 三种验收通过**：API 新旧状态映射、H5 clarify/out-of-scope、模拟器 G8 旧包两问无白屏（见 specs/18 §6.4）。
5. E2E：2026-11-18 全量 Playwright **21 条**（新增 consult-clarify golden）；其中 3 条失败为 `consult-llm.spec.ts` 里 G8 移除状态徽章后未同步的过期断言（与 P1 无关），修复后 **21/21 全绿**。

### 11.3 P2-T6 意图候选打分（2026-11-18，零行为变更）

| 任务 | commit | 内容 |
|---|---|---|
| T6 候选打分 + 低置信观测 | `32dfddb` | `intent.ts` 候选打分/低置信纯函数；`resolveSkillRoute` 增观测字段；trace v2；service 接线；`eval:intent` 低置信报告；10 例单测 + 评测汇总测试（见 [specs/19](./specs/19-咨询Agent-P2-T6-候选打分与低置信观测.md)） |

**验证**：`eval:intent` 134/134（逐条与 T6 前一致，决策零变更）；低置信 52/88（59.1%，S1 39/39 + S2 13/49；原因 explain×13/advice×14/top-low×25/margin×0）；API 69 文件 / 873 用例全绿；`typecheck` 通过。

> 说明：低置信包含 S1 正常的解释/行动类仲裁路径，故 S1 全部低置信属预期；定向抽检优先看 **S2 且 top-low** 的 25 条。

### 11.4 P2-T7 语义归一化路由视图（2026-11-18，小行为变更）

| 任务 | commit | 内容 |
|---|---|---|
| T7 归一化路由视图 | `8c9b116` | `normalize.ts`（字符级 + 同义词 + 指代变体，仅路由/对象判定）；registry 意图与候选打分改用路由视图；service/eval 对象判定同步；`ENABLE_ROUTE_NORMALIZE` 回滚；新增 10 条评测用例（见 [specs/20](./specs/20-咨询Agent-P2-T7-语义归一化路由视图.md)） |

**验证**：`eval:intent` 归一化开 **144/144**；关 **134/144**（恰好 10 条 normalize 用例失败）→ recall 提升且既有 134 条零回归；API **71 文件 / 889 用例全绿**、E2E **22/22 全绿**、`typecheck` 通过；fixture 未重录（模型输入不变）。

> 行为变化说明：自由文本如「我现在都吃哪些药」由 S1 变为 S2/medication-list（归一化预期收益）；`consult-fastpath` 对照组已改用归一化不改写的问法，保留「同句快路径 vs 自由文本」测试原意。

### 11.5 P3 小模型意图分类离线评测（2026-11-18，结论：不接线上）

| 角色 | commit | 内容 |
|---|---|---|
| 离线脚本 | `68da461` | `eval-consult-intent-classifier.ts`：96 条自由文本路由用例 × qwen3.8-flash / deepseek-flash 非思考分类，对照规则基线（见 [specs/21](./specs/21-咨询Agent-P3-小模型离线意图评测.md)） |

**结果**：规则基线 100%；qwen **90.6%**（S2 49/49 全对，危险方向 S1→S2 **9** 条）；deepseek **93.8%**（S2 49/49，危险方向 **6** 条）；两模型 P50 0.5–0.7s、0 调用失败。

**结论**：**不接线上**——规则无召回缺口，且小模型存在 6–9 条「解释题误判为数据模板」的危险方向错误（多为「还能吃吗/要紧吗/怎么办」类仲裁语义）。保留离线脚本用于月度能力监控与词表缺口挖掘；未来若线上低置信样本证明规则漏判，须先满足 dangerous=0、S2 recall ≥ 规则基线、仅低置信调用且失败 open 到 S1，并过 docs/08 A.4 / docs/12 A9 裁决。

**偏差**：① 字符级归一未进守门（守门仍原始文本，避免改变 L4/L3 与送模型文本；「胸　痛」类逃逸列为已知残余）；② 指代补全（这个/它 + 绑定药）未实现——路由层拿不到绑定药，clarify 信号与指代变体归一已覆盖无绑定药场景。

