# M4 咨询 Agent 会话化 · 开发任务书（04）

> 前置：M1–M3 全部完成（acceptance-MVP §16.3 八条全过）。⚠️ `m1-done`/`m2-done`/`m3-done` tags 尚未打，开工 T1 前先补打三个 tag。
> 来源：[docs/10-咨询Agent架构改革方案.md](../10-咨询Agent架构改革方案.md) V0.3（§9 七项裁决 2026-09-20 全按建议批复）——本任务书是其升格产物，方案与任务书冲突时以本任务书为准。
> 退出条件：P0 任务（T1–T6）全部完成 + 不变量 golden 全绿 + T10 的 PRD §16.3 增补条目逐项通过。P1（T7–T9）可独立延期不阻塞验收线。
> 内容：评估安全网、技能注册表、过敏确定性覆盖层、会话层、确认式建议卡（P0）；skillId 快路径、conditions 注入、多药锚点（P1）；验收收尾。
> 执行纪律：沿用 [00-执行总纲](./00-执行总纲.md) §0 执行协议与 §3 全局约定（测试纪律、数据与安全不变式、每任务一 commit `M4-T3: …`）。执行顺序即任务编号顺序（已按「先织安全网再改行为」排列）：T2 安全网先于一切行为任务；T6 依赖 T5 会话表；逐字节 fixture 由各行为任务自行重录并纳入其完成标准。

---

## T1. 契约收编与文档债清偿（原方案 R1，P0）

**做什么**

1. `.qoder/` 意图路由设计说明收编进 [08 技术方案](../08-技术方案.md) 附录「意图路由设计」：4 意图正则白名单、宁漏勿误、解释类词仲裁（EXPLAIN_INTENT_PATTERN）、不做 LLM 分类的依据（百川实测无 FC、单次最小输出 5.2s 延迟不可接受）、Qwen FC 扩展位及启用条件；ADR #17 §六对「consult/intent.ts 纪律」的引用同步指向新附录。
2. 快捷问题契约落 shared：`QuickQuestion[] = { label, question, skillId, intent? }`；web 的 `QUICK_QUESTIONS` / `DATA_QUICK_QUESTIONS` 前端常量改为从 shared 引入渲染（skillId 本任务先落契约，快路径消费在 T7）。
3. 核对升格时已完成的文档修订（勿重复执行）：PRD §7.5/§7.7/§8.4/§16.3 四处「沿用 V1」已改指本任务书附录 A；08 §5/§14 已勘误可选 sessionId/skillId 契约。

**完成标准**：08 附录落盘且 ADR #17 引用同步；web chips 与 shared 契约同源（改文案只动 shared 一处，`Consult.tsx:49-51` 的「改文案必须人工核对正则」警告注释随之删除）；`pnpm -r typecheck` + web/api 既有测试全绿。

## T2. 评估安全网与指标口径（原方案 R7 前置，P0）

**做什么**

1. FixtureAiClients 扩展 consult LLM 场景回放（对齐录入线机制：`x-test-scenario` 头 → `e2e/fixtures/<scenario>.json` 录制包 + aiCallLog 计数）；首批录制 `consult-answered` / `consult-limited` 两场景。
2. **不变量 golden**（断言契约面而非逐字节内容，不随 prompt 演进漂移）：① 响应结构（ConsultResponseSchema 全字段，shared 契约）；② 守门行为（L4/L3/limited 各 ≥3 口语变体）；③ 非拦截回答 citations 三件套非空；④ 降级语义（AI_UNAVAILABLE → 说明书规则拼装 + notice，仍 200）。
3. 指标口径定义落 docs（09 续篇或新报告）：L4/L3 拦截召回 = golden 全过（静态保证）；意图漏判率 = 人工标注抽样集为分母（初期每月抽 30 条 `consult_logs` 人工标注应路由意图，非实时指标）；strip 触发率 = limited 占比；**骨架 P95 ≤ 500ms（守门+取数+归一化，不含 LLM）、全链 LLM 路径 P95 ≤ 15s**（百川实测单次 5.2s + 余量，裁决 #5）；建议卡接受率（T6 后补基线）。

**完成标准**：不变量 golden 全绿且覆盖上述四类契约面；一条 consult LLM 路径 E2E fixture 回放演示；指标口径文档化。基线数字收口在 T10。

## T3. 技能注册表纯重构（原方案 R2a，P0，零行为变更）

**做什么** `SkillRegistry` 纯函数配置表统一四个分支——S0 红线（guardConsult L4/L3）/ S1 说明书问答（runConsult proceed 路径）/ S2 数据直答（classifyConsultIntent → runDataQuery）/ S3 搜索兜底（no-source + ENABLE_MEDICAL_SEARCH）；把现状 service 层的 if-else 编排显式化为「注册表 + 分发」，**不引入任何新行为、不改任何分支判定顺序**。

**完成标准**：既有测试**断言语义不变全绿**（允许改 import 路径与测试文件结构，不允许改任何断言）；注册表自身单测的分支覆盖与既有分支一一对应（含守门优先于意图路由的混合句用例）。

## T4. 过敏确定性覆盖层（原方案 R4a，P0，零 LLM）

**做什么**

1. 纯函数 `allergyOverlay(allergyFields, insert.contraindications)`：命中 → `sections.risks` 追加固定警示条目 + citations 追加禁忌段引用；未命中原样返回。位置在 S1 管线输出后、归一化后附加；**不经模型、不改 riskLevel、不进 risk_events**（提示非拦截，与相互作用注入同构——裁决 #3：allergy 不做模型上下文联想）。
2. health_profiles 过敏字段按 user 只读接入咨询链路（profiles.repo 首次进 consult 链路，白名单只读）。

**完成标准**：纯函数单测（命中/不命中/多过敏词/无档案/禁忌段缺失）；集成测试：档案过敏词 + 对象药禁忌段含该词 → **既有回答内容不变、仅追加警示与引用**；E2E 断言覆盖层零新增 LLM 调用（ai-calls 计数不变）。

## T5. 会话层（原方案 R3，P0）

**做什么**

1. 表变更（迁移纯 SQL 进 git）：新表 `consult_sessions`（`id/user_id/title(首问截断)/created_at/last_active_at`）；`consult_logs` 加列 `session_id/turn_no/intent`（intent 可空 = 说明书管线兜底，对齐 `insight_ask_logs` 漏判留痕口径）。
2. 契约修订（裁决 #1，08 §5/§14 已勘误）：`POST /api/consult` 增**可选** `sessionId?`/`skillId?`（skillId 本任务仅透传落 consult_logs，快路径消费在 T7）；响应增 `sessionId` 首答回传；**不带可选字段 = 行为与 M3 完全一致**。
3. 只读端点：`GET /api/consult/sessions`（列表）、`GET /api/consult/sessions/:id`（按 turnNo 回放 consult_logs）。
4. 前端：消息历史持久化与会话恢复、历史会话列表入口；无 sessionId 路径 = 今天。

**完成标准**：迁移 SQL 进 git；集成测试覆盖 userId 隔离（跨用户不串会话）、首答回传 sessionId、`consult_logs.intent` 断言；web 会话列表/恢复测试；E2E 一条「会话内续问」golden（含该场景 fixture 录制）。

## T6. 确认式建议卡（原方案 R6，P0）

**做什么**

1. 新表 `consult_suggestions`（`id/session_id/consult_log_id/type(add_drug|note_symptom)/payload(jsonb)/status(pending|accepted|dismissed)/acted_at`）。
2. 确定性规则（非 LLM 生成）：`add_drug` = 提问命中 drug_master 通用名/商品名规范化匹配且未在用户药箱（宁漏勿误，精确与规范化匹配，不做模糊联想）；`note_symptom` = 纯引导卡（跳健康信息页，**不落库**，裁决 #4）。
3. 卡片透明告知 + 双路径（裁决 #4/#7）：文案明示「手动建档仅可查说明书资料（L0）；拍照建档保留完整咨询」；`POST /api/consult/suggestions/:id/accept`（body `path: 'ocr'|'manual'`）**只写 consult_suggestions.status 并返回入口目标**——拍照走既有 M2 OCR 录入线（confirmStatus=ocr_matched），手动走既有手动建档预填；实际写库均经既有确认页，**不新增任何写路径、不豁免 manual 门禁**（通用名匹配不定身份，多规格/多厂家）。
4. 频控：每轮 ≤1 卡、每会话 ≤3 卡，dismissed 不复弹；`POST /api/consult/suggestions/:id/dismiss`。

**完成标准**：规则纯函数单测含**不误报案例**（问已入库药不弹卡、泛指词不弹卡）；「无用户确认零写入」集成红线断言（accept 端点不产生 drugs/plans/profiles 任何写入）；卡片 L0 差异告知 UI 断言；两条路径 E2E 各一条 golden；留痕落 consult_suggestions。

## T7. skillId 快路径 + 今日待服意图（原方案 R2b，P1，新行为）

**做什么** chips/深链带 `skillId` 直达对应技能（跳过正则）；自由文本正则路径**逐字不变**；S2 补第 5 意图 `next-dose`（今日待服：计划时点 + 已服状态，直查库 0 次 LLM）。

**完成标准**：skillId 快路径集成测试（正则不命中的自由写法与 skillId 命中走同一路径）；next-dose golden 含边界（无生效计划/今日全服完）；`consult_logs.intent` 集成断言更新；快捷问题 shared 契约补 next-dose 条目。

## T8. conditions 交集注入（原方案 R4b，P1）

**做什么** prompt 注入「用户自述慢病（用户提供、未经医学验证）」块，回答模式硬性约束为**「说明书事实 × 用户事实的交集陈述，禁止推断」**（裁决 #3：仅 conditions；allergy 已走 T4 覆盖层；gender/birthMonth 不注入——老年用药段说明书本有，注入增益小、个体化倾向强）；`buildConsultRequest` 扩展。

**完成标准**：ai-clients 请求体白名单断言更新（新注入块逐字段断言，PII 零泄漏断言扩展）；「注入前后守门/过滤行为一致」专项 golden（注入 conditions 后，L3/L4/limited 行为与不注入时逐例一致）；骨架（不含 LLM）P95 基准附报告（对齐 T2 口径）。

## T9. 多药与段落锚点（原方案 R5，P1）

**做什么**

1. 多药对象全量注入：主药按键段落 + **其余对象药身份快照**（替代 `pickPrimaryDrug` 单药截断；相互作用上下文既有逻辑不变）。
2. citations 升级段落级锚点（`sectionKey`），前端折叠展示透传。
3. 引用注入完整性纯函数：citations 引用的段落/规则 ∈ 本轮实际注入集合（注入集合作为管线产物传给校验）。**明确声明**：citation-washing（回答不忠实于所引段落）为接受的残余风险，不做 NLP 断言检测；缓解 = 既有「只基于给定段落回答」prompt 硬性规则 + T2 golden 抽样复审。

**完成标准**：两药场景集成测试（prompt 断言双药身份）；锚点透传 web 测试；注入完整性纯函数单测（含「引用未注入段落 → 拦截」负例）。

## T10. 验收与 PRD 增补（原方案 R8，P1，收尾）

**做什么** PRD §15 增咨询指标（P95 两档、拦截召回、漏判率抽检口径）、§16.3 增验收条目（会话续问 / 段落锚点 / 建议卡确认门与双路径 / 今日待服 / 过敏覆盖层）；逐字节 fixture 全量重录与指标基线数字收口；全量回归 + 360×740 仿真自验（会话列表、建议卡、多药回答、续问窗口、过敏警示）；附录 A 回写 M4 落地增量。

**完成标准**：增补条目逐项通过并附证据；`pnpm -r typecheck` + 全部测试 + E2E 绿；打 tag `m4-done`。

---

## 附录 A · 咨询细则（重锚版）

> 本附录替代 PRD §7.5 / §7.7 / §8.4 / §16.3 四处对 V1（docs/01，已佚——PRD 头注称「V1 保留作历史参考」，但该文件不在仓库，git 全历史亦无）的断链引用。PRD 四处已改指本附录（2026-09-20，裁决 #2）。基线 = M3 已验收实现（acceptance-MVP §16.3 八条全过）；M4 扩展项随任务落地后由 T10 回写本附录。

**A1 能力定位**（原「V1 §7.6 能力定位」位）
患者端 AI 药师助手 = 药品信息解释 + 风险提示 + 药箱数据查询。不诊断、不开方、不换药、不停药、不调剂量（PRD §1.1/§1.3/§3.2 上游不变）；不预测个体疗效（PRD §7.5 V2 增补）。咨询对象 = 已确认药品（drugId 直查说明书）；药箱数据查询无需对象药。总定位：用药安全工具的咨询入口，宁可无法识别、不可编造（PRD §1.3）。

**A2 可答范围**
1. 说明书按键段落解释（结构化取数优先，禁 RAG/全文/向量检索，PRD 决策 #15）：适应证/成分/不良反应/禁忌/注意事项/药理毒理/保存等按问题类型路由取段；剂量段返回「医嘱范畴不提供数字」固定提示；
2. 药箱数据查询（0 次 LLM 直查库）：用药清单 / 依从性 / 效期库存 / 相互作用检查（M4 增：今日待服）；
3. no-source 兜底：医疗搜索（默认关，`ENABLE_MEDICAL_SEARCH`），必标「基于网络检索，未经本库核实」，仅一般性资料解释，不做个体化建议。

**A3 拒答与拦截**（守门 L1–L4，纯函数，混合句守门优先于意图路由）
- **L4 紧急信号**（胸痛/呼吸困难/昏迷/抽搐/儿童误服/自杀等）：停止常规流程 → 急救引导（前端 EmergencyCard 置顶大按钮 tel:120）→ 留痕 risk_events；
- **L3 拒答**（停药/换药/剂量调整类问法）：拒答 + 引导开方医生 + 留痕；
- **L2 剂量过滤**：输出侧具体剂量/频次数字被切除 + 固定提示语，status=limited；
- **manual 档门禁**：仅 L0 资料查询（说明书规则拼装，不调 LLM），不可个体化解释——M4 建议卡加药**不豁免**（裁决 #7：通用名匹配不定身份）；
- 语音与文字同等检测（咨询输入均为文字，TTS 播报不改变守门行为）。

**A4 回答结构**
NormalizedSections 五段：summary / keyPoints（≤3）/ risks（≤3）/ nextAction / warning（+ limited 标记）；随答携带 citations（药名 + source + version 三件套；M4 T9 起含段落锚点 sectionKey）、riskLevel（L1–L4）、status（answered/limited/refused/emergency/manual-gate/no-source/ai-unavailable/data-answered）、notice / l0Notice、toolUsed。LLM 原始输出必过 zod safeParse + 归一化（Markdown 清洗、剂量句切除、缺项兜底）。

**A5 上下文确认**
citations 与 toolUsed 透传前端折叠展示，用户可展开核对 AI 依据的说明书来源（source/version）与数据工具；发送第三方模型的内容仅含说明书资料与白名单用户信息（衔接 PRD §12.2 脱敏出口约束）；健康信息上下文一律标「用户提供、未经医学验证」。M4 起：conditions 注入块受 ai-clients 请求体白名单断言约束（T8），过敏经确定性覆盖层附加警示而非模型联想（T4）。
