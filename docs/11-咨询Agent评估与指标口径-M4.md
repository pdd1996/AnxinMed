# 咨询 Agent 评估安全网与指标口径（M4-T2）

> 版本：V1.0（2026-09-20）
> 来源：[specs/04-M4-咨询Agent会话化.md](./specs/04-M4-咨询Agent会话化.md) T2（原方案 R7 前置部分）。
> 定位：咨询质量此前零度量（PRD §15 无咨询指标、consult LLM 路径无 E2E fixture）。本文档定义评估安全网的机制与全部指标口径；**基线数字在 T10 收口**（全量回归时随逐字节 fixture 重录一起落）。
> 关联：`docs/09-性能与健壮性报告-M3-T5.md`（录入线性能口径）· `docs/08-技术方案.md` 附录 A（意图路由设计）。

---

## 1. 评估安全网机制

### 1.1 两层网

| 层 | 载体 | 断言对象 | 漂移特性 |
|----|------|---------|---------|
| **不变量 golden** | `app/packages/api/src/__tests__/consult-golden.test.ts`（集成测试） | **契约面**：响应结构、守门行为、citations、降级语义 | 不随 prompt/模型演进漂移——改行为前必须保绿 |
| **逐字节 fixture** | `app/e2e/fixtures/consult-*.json` + E2E 回放（`x-test-scenario` 头 → `FixtureAiClients`） | 模型 I/O 冻结件（`consultAnswer` 原始输出），编排/归一化/落库全走真代码 | 与 prompt 演进绑定：行为任务改 prompt 后**自行重录**并纳入该任务完成标准 |

分层逻辑（先织网再改行为）：T3–T9 任何行为变更，先跑不变量 golden（秒级、确定性），再跑 E2E fixture 回放（接线级）；两层都绿才允许合入。fixture 与不变量的分工=「接线正确性」与「契约不变性」分离，避免逐字节断言阻塞 prompt 迭代。

### 1.2 不变量 golden 覆盖的四类契约面（T2 完成标准）

1. **响应结构**：`POST /api/consult` 响应体 = `{ ok }` 包装 + `ConsultResponseSchema` 全字段（riskLevel/status/answer/sections/citations/notice/l0Notice/blocked/toolUsed）+ `consultLogId`；sections 五段（summary/keyPoints/risks/nextAction/warning）；citations 元素三件套 + unverified；
2. **守门行为**：L4 紧急信号 ≥3 口语变体、L3 拒答 ≥3 口语变体全部拦截并留痕 risk_events；L2 剂量过滤 ≥3 个 LLM 输出变体（strip 切不干净残留 / nextAction 残留 / keyPoints 残留）全部触发 limited + 固定提示；
3. **非拦截回答 citations 三件套非空**：answered（LLM 路径）、data-answered（数据直答）、降级拼装三条非拦截路径逐一路径断言 `drugName/source/version` 非空；
4. **降级语义**：Baichuan 不可用 → 仍 200 + status='answered' + 回答来自说明书段落规则拼装 + notice 明示降级（失败可见不静默）。

### 1.3 consult fixture 场景包（首批录制）

| 场景 | 内容 | 断言的路径 |
|------|------|-----------|
| `consult-answered` | 干净 LLM 输出（无剂量残留）→ answered（L1） | runConsult proceed → ai.consultAnswer → 归一化 → citations 三件套 |
| `consult-limited` | 输出含「每日…10次」剂量残留且不含 strip 关键词 → limited（L2）+ 固定提示 | 输出侧剂量过滤（strip 触发 → 升 L2） |

- 两包 `source: 'synthetic'`（人工审核的合成录制，与录入线 M2-T10 同纪律）；E2E 见 `app/e2e/specs/consult-llm.spec.ts`，断言 UI 渲染 + ai-calls 计数（consultAnswer===1）+ consult_logs 落行。
- **重录纪律**：改 `buildConsultRequest` prompt、换模型、改归一化规则的任务，随任务重录受影响场景包（E2E_AI_MODE=live 录制或人工修订 synthetic 包），重录记录写进该任务交付说明；不重录导致 E2E 红 = 该任务未完成。

## 2. 指标口径

| 指标 | 口径 | 目标 / 阈值 | 数据源 | 采集方式 |
|------|------|------------|--------|---------|
| **L4/L3 拦截召回** | 守门口语变体 golden 全过（L4/L3 各 ≥3 变体 × 必拦截） | 100%（golden 全绿即达标） | `consult-golden.test.ts` | 静态保证：每次 CI 跑；新增变体只增不减 |
| **意图漏判率** | 应路由到数据直答（S2）却走了说明书管线（S1）的比例；**分母 = 人工标注抽样集**，非线上全量 | 初期只测不设阈；漏判率稳定偏高时先扩正则/技能，再议 Qwen FC 兜底（08 附录 A.4） | `consult_logs` | 每月抽 30 条人工标注「应路由意图」，对比 `toolUsed` 是否命中；非实时指标 |
| **strip 触发率** | `status='limited'` 的咨询占全部咨询的比例 | 观测指标（无阈值）；异常升高提示 prompt 泄漏剂量话术 | `consult_logs.status` | SQL 聚合，随月度抽检一起看 |
| **骨架 P95** | 守门 + 取数 + 归一化（**不含 LLM**）的服务端耗时 P95 | ≤ 500ms（裁决 #5） | 请求级计时（复用 `lib/timing.ts` 打点口径） | T10 基线收口：本地集成测试环境采样 |
| **全链 LLM 路径 P95** | 提问 → 回答全链路（含 Baichuan 调用）P95 | ≤ 15s（百川实测单次最小输出 5.2s + 余量，裁决 #5） | 请求级计时 | T10 基线收口：live 环境手动采样（fixture 回放不计时） |
| **建议卡接受率** | accepted / (accepted + dismissed) | T6 落地后补基线（M4 内先落留痕，不设阈） | `consult_suggestions.status`（T6） | 上线后按月聚合 |

### 2.1 意图漏判率抽检 · 操作细则（月度）

1. **导出**：`cd app/packages/api && npm run eval:export-labels -- --month=2026-09 --count=30`（随机抽样当月 `consult_logs`；CSV 带 BOM，Excel 直开不乱码；重定向存 `data/consult-labels/YYYY-MM.csv`）；
2. **标注**：只看 `question`（落库前已脱敏，导出后仍请过目一遍再入库）与 `status`/`tool_used` 两列，`label(应路由意图)` 列填人工判断：`medication-list` / `adherence` / `expiry-stock` / `interaction-check` / `next-dose`（T7 落地后）/ `说明书管线`（非数据查询）；
3. **判定标准**：
   - **漏判** = label 为数据意图 且 `status ≠ 'data-answered'`（走了说明书管线）；
   - **误判** = `status='data-answered'` 但 label = 说明书管线；
   - 2026-09-20（T5）之前的历史行 `tool_used`（intent 列）为空属正常——该列 T5 才落库，路由与否只看 `status`；
   - `status ∈ {emergency, refused, manual-gate}` 的行不参与判定（守门优先于意图路由是验收行为，不是漏判）；
4. **汇总回填**：漏判率 = 漏判数 / 抽样总数，连同误判数与漏判样本 question 原文回填 §2 表格及下方记录区；
5. **裁决链**（08 附录 A.4）：漏判率连续两月 > 20%（经验阈值）→ 先扩正则/技能 → 仍不足再议两级路由 LLM 兜底（正则命中即秒答，仅正则漏判的长尾问 Qwen FC 二次分类，输出过 zod）；**启用由数据裁决，不由感觉裁决**。

**抽检记录**（每次抽检追加一行）

| 月份 | 抽样数 | 漏判数 | 漏判率 | 误判数 | 漏判样本摘要 | 处置 |
|------|-------|--------|--------|--------|-------------|------|
| （首检待做） | | | | | | |

## 3. 基线收口计划（T10）

1. 全量回归（`pnpm -r typecheck` + api/web 测试 + E2E）通过后，跑骨架 P95 采样（consult 集成路径计时，≥50 次采样取 P95）；
2. live 环境手动跑全链 P95 采样（需 key；无 key 环境记「待补测」并沿用百川 5.2s 实测做上限推算）；
3. 将两项 P95 实测值与意图漏判首次抽检结果回填本文档 §2 表格，作为 M4 收口基线；
4. 指标随 PRD §15 增补条目一起维护（T10），后续里程碑沿用本口径扩展。
