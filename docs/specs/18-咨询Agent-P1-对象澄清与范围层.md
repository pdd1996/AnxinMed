# 咨询 Agent P1 · 对象澄清与范围层执行书（18）

> 来源：[docs/14-咨询Agent路由与评测改造方案.md](../14-咨询Agent路由与评测改造方案.md) V0.1 §4 T4/T5；用户 2026-11-18 批复 **A1–A9 全按建议**。
> 状态：**P1 执行中**。P0（T1/T2/T3a–d）已完成并全量回归（API 772 用例全绿），见 [specs/16](./16-咨询Agent路由工程化.md) 落地记录。
> 里程碑：暂记 M13（P0/P1 同一里程碑）。
> 上游真相源：PRD V2.2（06）· 技术方案（08，附录 A）· docs/11（指标）· docs/12（Agent 架构）· docs/14（本方案）。
> 执行纪律：不改 prompt、不接 LLM 做范围/澄清判定；新增行为全部纯函数 + 固定文案 + env kill switch；每任务一 commit。

---

## 0. 裁决结论（docs/14 §9，2026-11-18）

| # | 裁决 | 采纳方案 |
|---|---|---|
| A1 | 新增 `clarify` / `out-of-scope` 状态 | 新增；**落地时补客户端能力协商** `consultStatusVersion`：旧 APK 不带 → 服务端降级 `no-source`；新 Web/Mobile 带 `2` 收新状态 |
| A2 | 诊断/处方判断请求归属 | 新增 `out-of-scope`（产品边界，L1，不进 risk_events），不并入 L3 |
| A3 | clarify 范围与形态 | 只做「对象药缺失」+ 响应新增 `clarifyOptions`（药名选项 ≤6）；不泛化追问 |
| A4 | 范围层规则强度 | 纯规则、保守、默认用药域；不引入模型判 scope |
| A5 | L4 口语召回 | P0.5 已独立落地（M13-T3） |
| A6 | trace 落点 | P0 已落开发期文件；DB `route_trace` 列暂不做 |
| A7 | 评测集来源 | 人工编写 fixture（134 条），P1 用例去掉 `pendingUntil` 转绿 |
| A8 | `docs/12` §5 会话窗表述 | 修正为「M4 未实现，P3 评估」；本 P1 不注入历史 |
| A9 | 排期 | P0/P1 现在插入；P2/P3 待数据 |

---

## 1. 目标行为

### 1.1 对象澄清（status=`clarify`）

触发（全部满足）：route 落 S1 / 无绑定药（`drugIds` 解析为空）/ `ENABLE_OBJECT_CLARIFY !== 'false'` / 提问含指代或「说明书」信号（这个药、它、该药、说明书…）/ 用户药箱非空。

输出：固定 sections（「你想问药箱里的哪种药？」）+ `clarifyOptions[{drugId,drugName}]`（≤6，按建档倒序）；**0 次 LLM、0 写库**；不进 risk_events；不生成建议卡。

### 1.2 范围层（status=`out-of-scope`）

触发（route 落 S1 后判定）：`ENABLE_SCOPE_GATE !== 'false'` 且 `classifyConsultScope(question)` 为：

- `diagnosis-request`：诊断/看检查报告/判断病情（「我是不是得了糖尿病」「帮我看看体检报告是不是癌症」）；
- `non-medication`：明显非用药话题（股票/合同/天气/机票/代码/翻译/笑话等）。

输出：固定 sections + L1 + `blocked=false`；**0 次 LLM**；不进 risk_events；不生成建议卡。不确定一律回 `medication`（默认放行到既有 S1/S2）。

### 1.3 顺序

`scrub → guards(S0) → skillId/S2 → scope → object/clarify → S1`。S2 数据问题不经过对象/范围层（数据查询与对象药无关）；S0 永远第一。

---

## 2. 任务分解

### T1 契约扩展（shared / DB）

- `shared/dto.ts`：`ConsultStatusSchema` + `clarify` / `out-of-scope`；新增 `ConsultClarifyOptionSchema`；`ConsultResponseSchema` + 可选 `clarifyOptions`。
- `db/schema.ts`：`consult_logs.status` 枚举同步（varchar 无 CHECK，无需 SQL 迁移）。
- 完成标准：`pnpm -r typecheck` 通过；响应 schema 用例覆盖新字段可选性。

### T2 范围层（纯函数 + service 接线）

- 新增 `services/consult/scope.ts`：`classifyConsultScope` + 固定文案；`ENABLE_SCOPE_GATE` kill switch。
- 完成标准：纯函数单测（诊断/非用药/正常各 ≥5 变体，误杀零）；集成：0 次 LLM、不进 risk_events、status/consult_logs 落库、开关回滚。

### T3 对象澄清（纯函数 + service 接线）

- 新增 `services/consult/clarify.ts`：`shouldClarifyObject` + `buildClarifyOptions`（≤6）+ 固定文案；`ENABLE_OBJECT_CLARIFY` kill switch。
- 完成标准：纯函数单测（有/无对象、空药箱、无指代不澄清）；集成：clarifyOptions 正确、0 次 LLM、无 risk_events；空药箱回退既有 no-source。

### T4 Web / Mobile UI

- `AnswerCard`（web/mobile）新增 `clarifyOptions` + `onPickDrug`：渲染药名按钮（≥44px，老年向）。
- 咨询页点选后带该 `drugId` 重发原问题（续用同 session）；旧客户端经服务端状态降级收到 `no-source`（固定 sections 正常渲染）。
- 完成标准：web/mobile 组件测试 + 咨询页测试（点选重发带 drugId）；E2E 一条 clarify golden（若环境允许）。

### T5 评测集与文档收口

- `consult-intent-eval.json` 去掉 16 条 P1 用例的 `pendingUntil`；`intent-eval.ts` 增加 P1 层判定（scope/clarify 纯函数），CI 全绿。
- docs/11 增 clarify 率 / out-of-scope 率；docs/12 §5 修正；PRD §7.5/§16.3 与 docs/08 附录 A 增量；docs/14 §11 落地记录。
- 完成标准：评测 134/134 通过、0 失败、0 待启用；全量 API 测试绿。

---

## 3. 明确不做

- LLM 判 scope / 生成澄清问题；clarify 泛化到多槽位。
- 新增 `route_trace` DB 列（A6 暂不做）。
- 会话历史注入（A8：P3 评估）。
- 修改既有 S0/S2/S1 主路径的判定语义（除新增两层的短路）。

## 4. 验证命令

```bash
cd app
pnpm --filter @anxin/api typecheck
pnpm --filter @anxin/api test          # 本机 PostgreSQL 已就绪（772 用例基线）
pnpm --filter @anxin/api eval:intent
pnpm --filter @anxin/web test
pnpm --filter @anxin/mobile test       # 视 mobile 测试配置
```

## 5. 落地记录（2026-11-18）

| 任务 | commit | 内容 |
|---|---|---|
| T1–T3 契约/纯函数/接线 | `a0f0a7c` | `ConsultStatusSchema` + `clarify`/`out-of-scope` + `clarifyOptions`；`scope.ts`/`clarify.ts` 纯函数；service「范围 → 对象 → S1」接线；两个 kill switch；纯函数 + 集成测试；评测 16 条 P1 用例转绿 |
| T4 Web/Mobile UI | `76932a9` | AnswerCard 药名选项（≥44px）；点选带 drugId 重发原问题 |
| 兼容层补充（A1） | 本轮补丁 | `consultStatusVersion` 协商 + `toLegacyConsultStatus`（旧 APK 收 `no-source`，落库/trace 记真实状态）+ 纯函数/集成用例 |

**验证**：`pnpm --filter @anxin/api test` 全量绿（含 P1 新增用例与兼容层 5 例；当时工作区并发认证线用例一并计入）；`eval:intent` 134/134；web 18 文件 / 119 用例、mobile 6 套件 / 38 用例、core 12 文件 / 148 用例全绿；shared/core/api/web/mobile `typecheck` 通过。

**E2E**：2026-11-18 执行全量 Playwright（**21 条**，含新增 `consult-clarify` golden）：修复 3 条 G8 遗留徽章断言（`consult-llm.spec.ts` 仍断言已移除的「已回答」/「已过滤剂量」徽章）后 **21/21 全绿**；新增用例覆盖「无绑定药 → clarify 卡 → 点选药名 → 带 drugId 重问 + 0 次 LLM + consult_logs.status=clarify」。

**旧客户端兼容补丁（2026-11-18，A1 落实）**：请求新增可选 `consultStatusVersion`；旧 APK 不带 → `toLegacyConsultStatus` 把 `clarify` / `out-of-scope` 降级映射为 `no-source`（`consult_logs`/trace 仍记真实状态）。依据：G8 v1.0.0 APK（模拟器实装）的 `AnswerCard` 以 `STATUS_META[status]` 查表，未知 status 会 `undefined.icon` 渲染崩溃——仅靠「响应带固定 sections」兜底不够。新增 3 例纯函数 + 2 例集成（legacy 映射/落库真实状态），API 全量回归绿；新 Web/Mobile 经 core 自动带 `2`。兼容层合入后 **E2E 全量复跑 21/21 绿**（web 经 core 真实带 v2），确认新客户端收新状态、旧式请求走降级映射均正常。

**偏差**

1. 新增 status 未做 SQL 迁移（`consult_logs.status` 为 varchar 无 CHECK，仅同步 `schema.ts` 类型/注释与 shared 契约）。
2. `consult_logs.route_trace` 列未做（A6 暂不做；P0 开发期文件 trace 已可用）。
3. `docs/06 PRD` 与 `docs/08` 附录 A 的增量已随本轮补齐（见各文档 M13 增量小节）。
