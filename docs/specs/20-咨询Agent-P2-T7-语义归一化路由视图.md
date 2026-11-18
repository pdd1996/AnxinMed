# 咨询 Agent P2 · T7 语义归一化路由视图执行书（20）

> 上级方案：[docs/14 §4 T7](../14-咨询Agent路由与评测改造方案.md) · 前置：[specs/19](./19-咨询Agent-P2-T6-候选打分与低置信观测.md)（T6）。
> 里程碑 M13（P2 第二项）。状态：**已落地（2026-11-18），小行为变更、开关可回滚**。

## 1. 目标与边界

把「用户口语」映射到「路由规范词」，提升 S2/clarify 召回，但**只生成路由视图**：

- 送模型的 `question` 保持脱敏原文不变（prompt / fixture / 证据链零改动）；
- 守门（L4/L3）仍在**原始文本**上判定——归一化不得绕过红线；
- 只喂：意图路由（S1/S2 判定 + 候选打分）与对象判定（clarify 指代信号）；
- `ENABLE_ROUTE_NORMALIZE=false` 整体回滚（含字符级，恢复到归一化前逐字节行为）。

## 2. 实现

| 文件 | 改动 |
|---|---|
| `api/src/services/consult/normalize.ts`（新） | `normalizeChars`（NFKC + 全角空格/连续空白折叠）；`ROUTE_NORMALIZE_RULES`（耗尽口语→快用完、剩余量→还剩多少、漏服口语→漏服、清单口语→正在吃哪些药、指代变体→这个药）；`buildRoutingView`（返回 text/changed/applied）；`ENABLE_ROUTE_NORMALIZE` 默认开 |
| `api/src/services/consult/registry.ts` | `resolveSkillRoute` 内部生成路由视图并用于 `analyzeConsultIntent` + 候选打分；守门仍用原始文本；`ROUTE_VERSION` 升 `r2` |
| `api/src/services/consult.service.ts` | 对象判定改用归一化视图（`shouldClarifyObject(normalizeRoutingText(...))`）；范围层保持原文判定 |
| `api/src/services/consult/intent-eval.ts` | P1 层对象判定同步使用归一化视图（与线上一致） |
| `app/fixtures/consult-intent-eval.json` | 新增 10 条 `normalize` 用例（8 条口语 S2 + 2 条指代 clarify），总数 134→144 |
| `api/src/scripts/eval-consult-intent.ts` | 输出「语义归一化：开/关」状态 |
| 测试 | `consult-normalize.test.ts`（10 例：字符级/同义词/幂等/开关关闭/守门优先/对象判定）；eval 测试增「开通过、关失败」用例 |

## 3. 验证（2026-11-18）

| 项 | 归一化开（默认） | 归一化关 |
|---|---|---|
| `eval:intent` | **144/144**（134 条既有 + 10 条 normalize） | **134/144**：恰好 10 条 normalize 用例失败（均实际 S1） |
| 结论 | recall 提升 10 条，**既有 134 条零回归** | 行为可一键回滚到旧路由 |

- 低置信观测（开）：56/96（58.3%）；S1 39/39、S2 17/57（adherence 4/11、expiry-stock 5/17、interaction-check 1/9、medication-list 7/11、next-dose 0/9）。
- API 全量：**70 文件 / 884 用例全绿**；`pnpm --filter @anxin/api typecheck` 通过。
- fixture 未重录（prompt/模型输入未变，零字节改动）。

> 既有测试调整：`consult-fastpath.test.ts` 的对照组原用「帮我看看我现在都吃哪些药哦」断言 S1；T7 后该句被正确归一为清单查询（S2），故对照组改用归一化不改写的「帮我看看我目前的用药情况哦」，保留「同句快路径 vs 自由文本」原意。

## 4. 后续

- T8 小模型离线评测（P3，数据触发）；
- 线上观测：docs/11「语义归一化命中率」（当前 trace 未单独记录归一化命中；离线以评测集为准，运行时字段列入 P3 观测补强）；
- 若某类同义词误伤正常问题，删除对应规则 + 回滚开关，先补评测用例再改。

## 5. 落地记录

| 角色 | commit | 内容 |
|---|---|---|
| 代码 | `8c9b116` | normalize.ts + registry/service/eval 接线 + fixture 10 条 + 测试（含 fastpath 对照组调整） |
| 文档 | 本 commit | 本文 + docs/14 §11.4 + docs/11 指标 + AGENTS |

**偏差**

1. 「字符级归一在守门前」：本轮只把字符级归一放进路由视图（意图/对象），守门仍用原始文本——避免归一化改变 L4/L3 判定与送模型文本；「胸　痛」类守门逃逸仍是已知残余（L4 词表已覆盖常见口语，P3 再评估）。
2. 「指代补全（这个/它 + 已绑定药 → 追加上下文标记）」未实现：路由纯函数层拿不到绑定药上下文；对象判定只需要「无绑定药时识别指代」，已由 clarify 信号 + 指代变体归一覆盖，绑定药场景走 bound 分支无需补全。
