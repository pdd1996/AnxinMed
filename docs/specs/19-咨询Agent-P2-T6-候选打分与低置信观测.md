# 咨询 Agent P2 · T6 意图候选打分与低置信观测执行书（19）

> 上级方案：[docs/14 §4 T6](../14-咨询Agent路由与评测改造方案.md) · 前置：[specs/16](./16-咨询Agent路由工程化.md)（P0）/[specs/18](./18-咨询Agent-P1-对象澄清与范围层.md)（P1）。
> 里程碑 M13（P2 首项）。状态：**已落地（2026-11-18），零行为变更**。

## 1. 目标与边界

把路由从「首命中短路」扩展为「候选 + 分数 + 理由 + 低置信标记」，**只观测**：

- 决策逻辑逐字不变：仍由 `analyzeConsultIntent` 的「解释/行动词仲裁 + INTENT_ROUTES 短路」决定；
- 候选分只进 trace 与评测报告，不参与任何分支；
- 用途：把月度 30 条盲抽升级为「优先抽低置信样本」的定向抽检，并为 T8 小模型离线评测提供数据入口。

## 2. 实现

| 文件 | 改动 |
|---|---|
| `api/src/services/consult/intent.ts` | `scoreIntentCandidates`：5 个数据意图全量候选，规则命中基础 55 + 线索词 25/15/5（封顶 100），`reason` 只含标签；`classifyIntentConfidence`：top<80 / top2 差≤8 / 解释或行动类仲裁 → 低置信，带原因（`margin` 优先于 `top-low`，无第二候选归 `top-low`） |
| `api/src/services/consult/registry.ts` | `resolveSkillRoute` 增返回 `intentCandidates` / `lowConfidence` / `lowConfidenceReason`；S0、skillId 快路径、意图开关关闭时为空/`false`；决策路径与步骤不变 |
| `api/src/services/consult/trace.ts` | `ROUTE_TRACE_VERSION=2`，trace 增上述 3 字段；`routeVersion` 保持 `r1`（决策未变） |
| `api/src/services/consult.service.ts` | trace 写入候选与低置信 |
| `api/src/services/consult/intent-eval.ts` | `summarizeIntentConfidence`：统计范围 = 期望 S1 / S2* 的用例，按原因与按期望路由拆分 |
| `api/src/scripts/eval-consult-intent.ts` | `eval:intent` 输出低置信占比 + 原因 + 按路由拆分（只报告，不影响退出码） |

## 3. 验证（2026-11-18）

- `eval:intent`：**134/134 通过（与 T6 前逐条一致，零行为变更）**；
- 低置信观测：**52/88（59.1%）**；原因 `veto:explain×13 / veto:advice×14 / top-low×25 / margin×0`；
- 按路由：S1 **39/39**；S2 合计 13/49（adherence 2/9、expiry-stock 5/13、interaction-check 1/9、medication-list 5/9、next-dose 0/9）；
- API 全量 **69 文件 / 873 用例全绿**；`pnpm --filter @anxin/api typecheck` 通过。

> 读法：低置信包含 S1 正常的「解释/行动类仲裁」路径（39/39 全低置信是预期），不代表规则差；定向抽检优先看 **S2 且原因 top-low** 的 25 条（疑似漏判/词表缺口）。

## 4. 后续

- **T7** 语义归一化路由视图（小行为变更，需评测集背书 + `ENABLE_ROUTE_NORMALIZE` 回滚）；
- **T8** 小模型兜底（P3，数据触发；先离线评测 134 条）；
- 线上指标：docs/11「低置信路由占比」，上线后按月聚合与抽检。

## 5. 落地记录

| 任务 | commit | 内容 |
|---|---|---|
| T6 候选打分与低置信观测 | `32dfddb` | 打分/低置信纯函数；registry + trace v2 + service 接线；eval 报告；10 例打分单测 + 评测汇总测试 |

**偏差**：无。低置信阈值（top<80 / margin≤8）按 docs/14 T6 原样实现，未调参；`margin` 与 `top-low` 的归类顺序在文档口径内做了更可解释的处理（先 margin、无第二候选归 top-low）。
