# 咨询 Agent 路由工程化 · P0 执行书（16）

> 来源：[docs/14-咨询Agent路由与评测改造方案.md](../14-咨询Agent路由与评测改造方案.md) V0.1 §4 T1–T3；用户 2026-11-18「开工」。
> 状态：**P0 先行执行**。P1+（T4 对象澄清 / T5 范围层 / T6 候选打分 / T7 路由视图 / T8 小模型兜底）及 docs/14 §9 A1–A9 裁决项**不在本任务书**，待裁决后另立。
> 里程碑编号：暂记 M13（待用户裁决，commit 前缀沿用 `M13-T*`）。
> 上游真相源：PRD V2.2（06）· 技术方案 V1.1（08，附录 A）· ADR（07）· docs/10–13 · specs/04-M4（已收口）。
> 执行纪律：**不改 prompt、不改 shared 契约、不改 PRD / docs/08 / docs/11 / docs/12**；只新增纯函数、测试、fixture、开发期 trace；每任务一 commit。既有测试断言若因「行为纠偏」必须改，须在交付说明里逐条给出理由与评测依据。

---

## 0. 范围与顺序

| 任务 | 优先级 | 行为变更 | 依赖 |
|---|---|---|---|
| T1 意图评测集与回归网 | P0 | 无 | — |
| T2 路由轨迹 route trace | P0 | 无（默认关闭） | — |
| T3a L4 口语召回（独立提交） | P0.5 | 只增召回 | T1 |
| T3b SECTION_ROUTES 同义词 | P0 | 段落路由纠偏 | T1 |
| T3c INTENT_ROUTES 同义词 | P0 | 只增召回 | T1 |
| T3d 咨询专用行动词仲裁 | P0 | 纠偏到 S1（更有约束的路径） | T1 |

执行顺序：T1 → T2 → T3a → T3b → T3c → T3d。T1/T2 先织网；T3a 安全缺口优先。

**明确不做（本任务书外）**：clarify / out-of-scope / 候选打分 / 语义归一化 / 小模型分类 / shared status 扩展 / 会话历史注入。这些全部等 docs/14 §9 裁决。

---

## T1 · 意图评测集与回归网（P0，零行为变更）

**做什么**

1. 新增 `app/fixtures/consult-intent-eval.json`，首版 120–150 条，字段：
   `id / question / drugContext(bound|none) / expectedRoute / expectedSection? / tags[] / pendingUntil? / note?`。
2. 评测层支持：route 级（`resolveSkillRoute` 纯函数）+ S1 段落级（`pickInsertSections` 用探针说明书切片）。
   期望路由取值：`S0/emergency`、`S0/refused`、`S2/<intent>`、`S1`；P1 用例 `clarify` / `out-of-scope` 标 `pendingUntil: "P1"` 跳过。
3. 新增 `api/src/services/consult/intent-eval.ts`（fixture schema + 评测纯函数 + 混淆矩阵）与 `api/src/scripts/eval-consult-intent.ts`（`pnpm --filter @anxin/api eval:intent`）。
4. 新增 `api/src/__tests__/consult-intent-eval.test.ts`（CI 回归）；已知缺口在 T3 前允许单列，T3 完成后必须清零。

**完成标准**：fixture 入 git 且每条有期望；`eval:intent` 输出通过/失败/待启用/混淆矩阵并以非 0 退出码反映失败；评测测试全绿；用例标签覆盖 docs/14 附录 B 配额。

---

## T2 · 路由轨迹 route trace（P0，零行为变更）

**做什么**

1. 新增 `api/src/services/consult/trace.ts`：zod schema + `writeRouteTrace`（`CONSULT_ROUTE_TRACE=1` 才写；`CONSULT_ROUTE_TRACE_DIR` 可覆盖目录，默认 `.agent-debug`）。
2. 新增 `resolveSkillRoute(input)`：返回 `{ decision, steps }`，`routeSkill` 改为薄包装（既有测试语义不变）；trace 记录守门命中、skillId 快路径、意图命中/仲裁/开关关闭、最终路由。
3. `consult.service.ts` 在落库后写 trace（含 `consultLogId`、最终 status、是否 LLM 路径）；写失败 `console.error` 可见但不阻塞主回答。
4. trace **不含问题原文**；根 `.gitignore` 增加 `.agent-debug/`。

**完成标准**：默认关闭时零 I/O 且骨架 P95 不退化；开启时每轮一文件、schema 校验通过；零 PII 断言（trace JSON 不含 question 原文）；`writeRouteTrace` 失败路径单测。

---

## T3a · L4 口语召回（P0.5，独立提交，安全优先）

**做什么**

- 扩充 `EMERGENCY_PATTERN`：`孩子/小孩/宝宝/儿童/婴儿/幼儿/老人/老年人 + 误服/误吃/吃错/吞了/吞下/多吃`；裸 `误服/误吃/吃错药`；`药物过量/过量服药/超量服药`。
- 既有变体只增不减（`儿童误服`/`大量误服` 的命中词保持原样）。
- `consult-golden.test.ts` L4 变体扩到 ≥8 条；`consult-guards.test.ts` 补正例。
- 已知取舍：裸「误服」会命中历史陈述（如「上次误服过一次」）→ 按安全优先接受，产品/医学如要求收敛另开任务。

**完成标准**：新增口语变体全部 L4；历史 L4 用例不回退；不误伤正常咨询（「这个药通常用于什么」等既有负例仍 null）。

---

## T3b · SECTION_ROUTES 同义词（P0）

**做什么**：`patterns.ts` 段落词表按 docs/14 §4 T3b 增补，至少：

- adverse：`犯困 / 嗜睡 / 伤肝 / 肝损 / 肝功能 / 伤肾 / 肾损 / 肾功能`
- interactions：`喝酒 / 饮酒 / 酒精`
- precautions：`长期 / 漏服 / 过期`
- dosage：`饭前 / 饭后 / 空腹 / 随餐`

**完成标准**：`consult-sections.test.ts` 每条新增词有对应用例；既有 12 条段落用例不回退；评测集 `expectedSection` 相应用例转绿。

---

## T3c · INTENT_ROUTES 同义词（P0）

**做什么**：`expiry-stock` 增补 `还有几(片|颗|粒|支|盒) / 还剩几(片|颗|粒|支|盒) / 快吃完 / 剩多少`；保持 `这个药还有多少` 这类歧义句仍走 S1。

**完成标准**：`consult-intent.test.ts` 补变体；既有正例/负例语义不回退；评测集 S2 用例转绿。

---

## T3d · 咨询专用行动词仲裁（P0）

**做什么**：新增 `CONSULT_ADVICE_PATTERN`（**不并入** `EXPLAIN_INTENT_PATTERN`——后者被医生端 `insight/askIntent.ts` 复用，医生问「怎么办」仍应按队列/患者问法处理），覆盖：

`还能(吃|用|喝|贴|服) / 能不能(吃|用|喝|贴|服) / 怎么办 / 要不要 / 该不该 / 正常吗 / 要紧吗 / 有没有事 / 严重吗 / 危害 / 后果 / 要补 / 补服 / 补吃`

命中 → 咨询意图返回 null（走 S1）。同时新增 `analyzeConsultIntent` 暴露仲裁原因（explain/advice）供 T2 trace 使用。

**完成标准**：`consult-intent.test.ts` 补正例；**既有断言「最近老漏服怎么办的记录 → adherence」按新语义改为行动词走 S1**（替换为纯数据变体 `最近漏服了几次 → adherence`，并新增 `我最近老漏服怎么办 → null` 用例）；医生端 `insight/askIntent.ts` 行为不变（仅 import 既有 `EXPLAIN_INTENT_PATTERN`）。

---

## 验证命令

```bash
cd app
pnpm --filter @anxin/api typecheck
pnpm --filter @anxin/api eval:intent
pnpm --filter @anxin/api test        # 需本机 PostgreSQL（globalSetup 建测试库）
```

> 本机无 PostgreSQL 时：`test` 的纯函数子集可用临时 vitest 配置（不加载 globalSetup）验证；集成/E2E 需在具备 PG 的环境复跑，交付说明中注明。

## 落地记录（2026-11-18）

| 任务 | commit | 内容 |
|---|---|---|
| T0 方案 + 执行书 | `8c93595` | docs/14 V0.1 + 本任务书 |
| T3 路由词表与仲裁 | `d755fcf` | `EMERGENCY_PATTERN` 口语召回；SECTION_ROUTES 同义词；INTENT_ROUTES 库存变体；`CONSULT_ADVICE_PATTERN`；`analyzeConsultIntent`；单测更新 |
| T2 路由轨迹 | `bb4ccd7` | `resolveSkillRoute` + `trace.ts` + `consult.service.ts` 接线（默认关闭）+ `.agent-debug/` gitignore + 单测 |
| T1 评测集 | `409824f` | `app/fixtures/consult-intent-eval.json`（134 条）+ `intent-eval.ts` + `eval:intent` 脚本 + CI 测试 |

**验证结果（本机 2026-11-18）**

- `pnpm --filter @anxin/api typecheck`：通过；
- 纯函数子集（临时 vitest 配置，不加载 globalSetup）：6 文件 / **171 用例全绿**；
- `pnpm --filter @anxin/api eval:intent`：**134 用例 / 通过 118 / 失败 0 / 待启用 16**（P1 clarify/out-of-scope）；
- 改动文件 `eslint`：0 error。

**限制**：本机无 PostgreSQL（localhost:5432 未监听），`pnpm --filter @anxin/api test` 的 globalSetup 报 ECONNREFUSED，集成 / E2E 未跑；需在具备 PG 的环境复跑全量后再算 P0 收口。

**实施偏差**

1. T3a（L4 口语召回）与 T3b 同在 `patterns.ts`，未拆独立 commit（回滚可按 hunk）。
2. 行动词仲裁独立为 `CONSULT_ADVICE_PATTERN`，不并入共享的 `EXPLAIN_INTENT_PATTERN`（医生端 askIntent 复用后者，行为不变）。
3. 提交顺序 T3 → T2 → T1（依赖倒置）：T1 评测模块依赖 T2 的 `resolveSkillRoute`、T2 依赖 T3 的 `analyzeConsultIntent`；保证每个 commit 独立可绿。
4. 新增 status（clarify/out-of-scope）未实施，仍待 docs/14 §9 A1/A2 裁决。

