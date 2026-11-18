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
- **T10 全量重验（2026-09-21）**：9 个场景包（录入线 5 + 咨询 4：consult-answered/limited/allergy/session）随全量 E2E 回放全绿——T8 改 prompt（conditions 注入块）不影响包（包内冻结的是模型**输出**而非 prompt）；synthetic 包人工复核无漂移，视为本轮逐字节重录完成。

## 2. 指标口径

| 指标 | 口径 | 目标 / 阈值 | 数据源 | 采集方式 |
|------|------|------------|--------|---------|
| **L4/L3 拦截召回** | 守门口语变体 golden 全过（L4/L3 各 ≥3 变体 × 必拦截） | 100%（golden 全绿即达标） | `consult-golden.test.ts` | 静态保证：每次 CI 跑；新增变体只增不减 |
| **意图漏判率** | 应路由到数据直答（S2）却走了说明书管线（S1）的比例；**分母 = 人工标注抽样集**，非线上全量 | 初期只测不设阈；漏判率稳定偏高时先扩正则/技能，再议 Qwen FC 兜底（08 附录 A.4） | `consult_logs` | 每月抽 30 条人工标注「应路由意图」，对比 `toolUsed` 是否命中；非实时指标 |
| **strip 触发率** | `status='limited'` 的咨询占全部咨询的比例 | 观测指标（无阈值）；异常升高提示 prompt 泄漏剂量话术 | `consult_logs.status` | **首轮实测 2026-09-21（dev 库 T10 收口）：0/29 = 0%**；随月度抽检一起看 |
| **骨架 P95** | 守门 + 取数 + 归一化 + 留痕写库（**不含 LLM**，模型瞬时 mock）的服务端耗时 P95 | ≤ 500ms（裁决 #5） | `npm run perf:consult`（M4-T8 落地；真实 consult 全链 + 瞬时 mock 模型） | **首轮实测 2026-09-21（N=50，本地 dev 库）：P50=10.4ms / P95=17.1ms，达标**；T10 复测收口（全链 P95 主导项为模型延迟，live 实测） |
| **全链 LLM 路径 P95** | 提问 → 回答全链路（含 LLM 调用）P95 | ≤ 15s（百川实测单次最小输出 5.2s + 余量，裁决 #5） | `pnpm --filter @anxin/api perf:consult-live`（真实全链，N≥50 或 ≥600s） | **2026-11-17 live 复测：N=152 / 600s，P50 3810ms / P95 5415ms / P99 6051ms，失败率 0%，达标** |
| **模型单次 P95** | 单次 chat/completions 耗时（不含取数/写库）P95 | 建议 ≤ 4s（docs/13 §4.3 #4：超预算记慢调用、连续超标告警；非硬门槛） | `perf:consult-live` 的 `llmLatencyMs` | **2026-11-17 live：N=152，P50 3772ms / P95 5380ms（超建议值 34.5%）→ 已登记接受，见 §2.2** |
| **建议卡接受率** | accepted / (accepted + dismissed) | T6 落地后补基线（M4 内先落留痕，不设阈） | `consult_suggestions.status`（T6） | 上线后按月聚合 |
| **意图评测集通过率**（M13） | `eval:intent` 通过数 / 总用例 | 100%（2026-11-18：134/134，0 失败、0 待启用）；改动路由词表必须保绿 | `app/fixtures/consult-intent-eval.json` | CI：`pnpm --filter @anxin/api eval:intent` |
| **clarify 率**（M13-P1） | `status='clarify'` / 全部咨询 | 观测（无阈值）；过高说明对象入口不足或澄清信号过宽 | `consult_logs.status` | 上线后按月聚合 |
| **out-of-scope 率**（M13-P1） | `status='out-of-scope'` / 全部咨询 | 观测（无阈值）；用于产品边界与拒答文案评估 | `consult_logs.status` | 上线后按月聚合 |
| **规则路由延迟**（M13） | 骨架 P95（守门 + 意图 + 范围/对象 + 留痕，不含 LLM） | 不劣于既有 ≤500ms 口径；trace 默认关闭零 I/O | `perf:consult` / trace | 每次发布前复测 |

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

### 2.2 已登记偏差：模型单次 P95 超建议值（2026-11-17）

| 项 | 记录 |
|---|---|
| 偏差 | 模型单次 P95 **5380ms**，高于 docs/13 §4.3 #4 建议值 4000ms（+34.5%）；上轮 N=10 模型调用 P95 5278ms、N=20 全链 P95 5225ms，偏差稳定、非抖动 |
| 全链影响 | 全链 P95 **5415ms**，仍远低于 15s 硬门槛；失败率 0%（异常 0 / 降级 0；N=152 / 600s） |
| 稳定性 | 按分钟 P95 4.2–6.0s；前半程 5093ms → 后半程 5433ms（+6.7%），无随时间劣化；152 次全部 HTTP 200、`reasoning_tokens` 0、无 429 |
| 处置 | **登记接受，本轮不调参**：4s 是 docs/13 的建议值（原文要求「记慢调用，连续超标告警」），不是发布硬门槛；全链 15s 硬门槛已达标，不阻塞演示/受控试点 |
| 复评触发 | 任一出现即重评（先收紧 prompt/段落长度，再按 docs/13 §6.1 做 deepseek 对照 A/B，不改默认）：① 全链 P95 > 10s（连续 3 轮）② 模型 P95 > 6s ③ 慢调用（>15s）占比 > 1% ④ 试点用户可感知卡顿投诉 |
| 未覆盖 | 生产侧「慢调用/连续超标告警」尚未实现，归 M12 G10（调用计数 + 预算告警 + 限流） |

## 3. 基线收口计划（T10）

1. 全量回归（`pnpm -r typecheck` + api/web 测试 + E2E）通过后，跑骨架 P95 采样（consult 集成路径计时，≥50 次采样取 P95）；
2. live 环境手动跑全链 P95 采样（需 key；无 key 环境记「待补测」并沿用百川 5.2s 实测做上限推算）——**已补测 2026-11-17（N=152 / 600s），见 §2**；
3. 将两项 P95 实测值与意图漏判首次抽检结果回填本文档 §2 表格，作为 M4 收口基线；
4. 指标随 PRD §15 增补条目一起维护（T10），后续里程碑沿用本口径扩展。
