# 安心用药 · Agent 整体架构

> 版本：V1.0  
> 日期：2026-09-20  
> 状态：设计定稿（对齐 PRD V2.2 / ADR #1–#19 / specs/04 M4 已裁决项）  
> 定位：产品级 Agent 总图。咨询细节执行以 `specs/04-M4-咨询Agent会话化.md` 为准；本文件管边界、分层、技能注册、数据流与不做清单。  
> 一句话：对话主脑 + 受限技能管线；药箱与生效计划是唯一长期记忆；凡进档案，最后一道门是用户。

---

## 0. 架构决议（读这一节就能开工）

| # | 决议 | 含义 |
|---|---|---|
| A1 | 产品 Agent = **用药管家**，不是预问诊医生 | 不采集主诉收敛诊断，不调剂量，不摇医院号源 |
| A2 | 四条管线分治，共享事实层 | 录入 / 计划提醒 / 咨询 / 医生洞察；互不抢写权 |
| A3 | 自主性按出错成本分级 | 录入与计划近 0 自主；咨询只解释；医生端只叙述数字 |
| A4 | 事实与生成分离 | 数字、用量、相互作用、过敏命中全部来自查询或抄录；LLM 只转写给定段落 |
| A5 | 技能显式化 | 每个技能 = 触发 + 上下文需求 + 管线 + 输出 schema + 守门 + 溯源 + 降级 |
| A6 | 记忆分长短期 | 长期 = `health_profiles` + 药箱 + 生效计划；短期 = 会话窗口（默认 6 轮，已脱敏） |
| A7 | 回写必须确认式 | 建议卡 / 健康信息勾选 / 确认页是仅有写入口；LLM 不写库 |
| A8 | 默认咨询对象 = 生效计划集合 | 不再 `pickPrimaryDrug` 截第一支有说明书的药 |
| A9 | 禁项宪法 | 无 ReAct 主循环、无 RAG、无 text-to-SQL、无标签抄录医嘱、无模型生成剂量/相互作用/建议卡 |

与上游冲突时的优先级：PRD 安全原则 > ADR 硬性边界 > specs/04 咨询任务书 > 本文实现建议。

---

## 1. 系统上下文

```
                    ┌──────────── 用户 ────────────┐
                    │ 患者（网页）    医生（网页）   │
                    └──────────┬─────────┬─────────┘
                               │         │
                         HTTPS │         │ HTTPS（只读洞察）
                               ▼         ▼
                    ┌──────── web（React 19 SPA）────────┐
                    │ 录入 / 药箱 / 今日 / 咨询 / 我的    │
                    │ 医生端 Insight（G2 按需切包）      │
                    └────────────────┬──────────────────┘
                                     │
                    ┌────────────────▼─────────────────┐
                    │          api（Hono）              │
                    │  守门 · 技能路由 · 管线 · 脱敏     │
                    └──────┬───────────┬─────────┬─────┘
                           │           │         │
              ┌────────────▼──┐   ┌────▼────┐   ┌▼──────────────┐
              │ PostgreSQL 16 │   │ 模型出口 │   │ MCP stdio 可选 │
              │ 用户数据+三库  │   │ OCR/VLM │   │ 转发既有守门    │
              │ Mock→可替换    │   │ 咨询文本 │   │ 端点，不碰库    │
              └───────────────┘   └─────────┘   └────────────────┘
```

外部依赖（ADR 已定）：

- 医嘱 OCR：`qwen3.5-ocr` 云端行级转录，契约 `{ lines: string[] }`
- 身份 VLM：Qwen3-VL-Flash / 同族多模态
- 咨询生成：qwen3.8-flash 非思考（ADR #20；CONSULT_PROVIDER=baichuan 留回滚）
- 医生端长尾叙述：同一百川；正则漏判不接 FC 主路径
- 部署：docker-compose = api（托管 web dist）+ postgres:16

---

## 2. 逻辑分层

自上而下六层。上层不能穿透下层的写边界。

```
L6  交互层     两个拍照入口 · 确认页 · 今日任务 · 咨询会话 · 医生队列图
L5  技能层     S0–S6 + 录入管线 + 计划引擎 + 医生只读工具
L4  编排层     会话解析 → 前置门 → 上下文组装 → 路由 → 管线 → 覆盖层 → 守门 → 留痕
L3  事实层     三库按键取数 · 规则引擎 · 过敏覆盖 · 说明书范围校验 · 库存推算
L2  数据层     drugs / plans / records / sources / health_profiles
               consult_sessions / consult_logs / consult_suggestions
               drug_master / package_inserts / interaction_rules
L1  基础设施   Hono · Drizzle · zod 闭合 schema · 脱敏四层 · 审计 · compose
```

**穿透规则**：

- L6 不能直接调模型。所有模型 I/O 进 L4 编排，过 zod `safeParse`。
- L5 技能拿不到原始处方图、拿不到未白名单字段。
- L3 事实函数必须是纯函数或参数化 SQL，可单测、可 replay。
- 模型输出永不以 SQL / 剂量数字 / 档案补丁形态直通 L2。

---

## 3. 四条管线（产品级 Agent 地图）

### 3.1 总图

```
用户意图 ──► 显式入口（不静默改道）
                 │
     ┌───────────┼────────────┬─────────────┐
     ▼           ▼            ▼             ▼
  录入管线    计划/提醒     咨询主脑      医生洞察
  P-Ingest   P-Plan       P-Consult     P-Insight
     │           │            │             │
     └───────────┴──── 共享事实层 ──────────┘
                      生效计划集合 = 在服真相
                      药箱 = 库存真相
                      sources = 追溯锚点
```

四条管线的「智能」预算：

| 管线 | 允许的模型角色 | 主路径是否 LLM | 写库路径 |
|---|---|---|---|
| P-Ingest | OCR 转录；VLM 提身份；兜底解析须回链 | 识别需要，决策不需要 | 仅确认页提交 |
| P-Plan | 无 | 否 | 确认页 / 手动填表 / 打卡 |
| P-Consult | 只解释给定段落与已确认事实 | S1 是（S3 已退化为固定话术）；S0/S2/覆盖层/建议卡否 | 建议卡 accept 走既有建档入口 |
| P-Insight | 只叙述工具算好的数字 | 正则命中 0 次；长尾末端叙述 | 只读 |

### 3.2 P-Ingest · 录入管线（确定性为主）

目标：一张图 → 可确认的档案草稿 ± 计划草稿。不是对话 Agent。

```
选入口 A 拍处方 | B 拍药品
        │
        ▼
  层检测（校验，不分流）
   不符 → 提示确认/切换，不静默改道
   不支持（散装片）→ 明确拒绝
        │
        ├─ A：医嘱线 + 身份线 并行
        │     OCR lines → L0 行序裁剪（Rp…处方完毕）
        │     → L1 白名单 schema 解析
        │     → L2 敏感模式兜底
        │     → 可选文本模型兜底（只发白名单，逐字回链）
        │     → VLM 身份 → 药名+规格+剂型严匹配
        │
        └─ B：仅身份线
              检出医院标签 → 提示「用法不自动抄录」
              不产出任何用法草稿
        │
        ▼
  草稿汇合
   档案草稿 +（A 才有）计划草稿
   + 健康信息建议填入
   + 相互作用（新计划 × 当前生效计划）
   + 说明书范围校验（最大日剂量/频次）
        │
        ▼
  确认页（唯一闸门）
   整图 ↔ OCR 原文 ↔ 结构化字段
   用量/频次/疗程逐项核对
   四类标注：抄录 / 辅助 / 推算 / 默认
   冲突清单不裁决
        │
        ▼
  用户确认 → drugs + plans + sources + 勾选的健康信息
```

失败可见：`OCR_FAILED` / 抽取不全 → 原文人工补；多候选 → 冲突清单；仍不确定 → 手动建档且 `confirmStatus=manual`（仅 L0 咨询）。

### 3.3 P-Plan · 计划 / 提醒 / 库存

目标：依从与效期。无 LLM。

- 周期：开放式（无结束日期）或封闭式（有疗程）。结束日期非必填。
- 三套独立时钟：计划窗、开封效期、库存（按次扣减）。计划结束 ≠ 药用完。
- 提醒：网页内模拟；已服 / 稍后 / 跳过；漏服不建议补服；防重复确认。
- 相互作用重跑时机：草稿确认、续方、恢复/修改导致「生效集合」变化。对象永远是生效计划，不是药箱。
- 变更保留历史版本。

### 3.4 P-Consult · 咨询主脑（M4 形态）

目标：基于已确认药品做可追溯解释与风险提示。生命周期：

```
sessionId? / skillId?
        │
        ▼
前置门（纯函数，先于一切）
  提问 PII 脱敏
  L4 急症 > L3 拒答 > manual-gate > no-source > proceed
        │
        ▼
上下文组装
  ① 默认对象 = 生效计划集合（身份快照）
  ② 点名药优先：其说明书按段取数
  ③ 其余在服药仅注入身份快照 + 相互作用规则命中
  ④ conditions 交集陈述（用户提供、未经医学验证）
  ⑤ 会话窗口最近 N=6 轮已脱敏文本
  ⑥ 过敏字段不进 prompt，走后续覆盖层
        │
        ▼
技能路由
  skillId 快路径（chips / 深链）
    → 正则意图（宁漏勿误）
      → S1 说明书管线兜底
        │
        ▼
技能执行（无自主循环）
        │
        ▼
过敏覆盖层（纯函数）
  allergy ∩ insert.contraindications
  命中：sections.risks 追加固定警示 + citations 追加禁忌段
  不改 riskLevel，不写 risk_events
        │
        ▼
输出守门
  safeParse(ConsultRawSectionsSchema)
  → normalizeSections
  → stripDosageAdvice（触发则升 L2 limited）
  → citations 注入完整性（所引 ∈ 本轮实际注入集合）
        │
        ▼
留痕 consult_logs(sessionId, turnNo, intent)
建议卡后处理（确定性规则，频控 1/轮、3/会话）
```

降级：百川不可用 → 200 + 说明书段落规则拼装 + notice 明示，禁止静默。

### 3.5 P-Insight · 医生洞察

目标：队列与单患者只读洞察。架构锁在 ADR #17–#19。

```
问法
  → 正则白名单（主路径，0 LLM）
      → QUEUE_TOOLS / 患者意图 → repo 参数化 SQL → 结果契约
  → 漏判：百川只对已算数字做叙述（guardSummary）
      不开放 tool_call 主路径（Baichuan 无 FC；启用依据=漏判抽检）
  → 前端 G2 模板渲染（数据来自聚合端点，0 LLM）
  → 可选 MCP stdio：薄包装既有守门端点，无 execute_sql
```

患者分档阈值在 `@anxin/shared`，LLM 不做分类器。

---

## 4. 技能注册表

每个技能上线必须填满七列。没有评估网的技能不上线。

### 4.1 咨询域（患者端）

| ID | 技能 | 触发 | 上下文 | 管线 | 守门 / 溯源 | 降级 | 评估 |
|---|---|---|---|---|---|---|---|
| S0 | 红线 | L4/L3 正则 | 无 | 固定文案 | risk_events 留痕 | — | 口语变体 golden 100% 拦截 |
| S1 | 说明书问答 | 解释类 / 默认兜底 | 点名药段落 + 在服身份全集 + conditions + 会话窗 | 按键取数 → 百川 → 归一化 | L1/L2 + citations 三件套 + 段锚点 | 规则拼装 | 不变量 + fixture |
| S2 | 数据直答 | 库存/计划/相互作用列表/今日待服 | 计划·记录·规则库 | 模板渲染 | **0 次 LLM**（E2E 红线） | DB 500 显式 | ai-calls=0 |
| S3 | 搜索兜底（已移除搜索） | 本地无说明书 / 提问未绑药 | 无个体化 | 无（零 LLM） | 固定话术诚实拒答；consult_logs 留痕=扩库采购清单（ADR #20） | —（纯文案） | no-source 恒固定文案断言 |
| S4 | 过敏覆盖 | S1 之后必跑 | 档案过敏词 + 禁忌段 | 纯函数 | 不改 riskLevel | 缺档案则跳过 | 命中/不命中单测 |
| S5 | 建议卡 | 后处理 | drug_master ∩ 药箱差集；不适引导 | 确定性规则 | 无确认零写入 | 不弹卡 | 误报案例单测 |
| S6 | 复诊清单 | 「复诊带什么」等（P1） | 生效计划 + sources 处方号 | 模板 + 短解释 | 只列在服，不建议停药 | 无计划则引导去建 | golden |

manual-gate 是 S1 内部门禁，不是独立技能：`confirmStatus=manual` 仅 L0 资料查询。

### 4.2 录入 / 计划域（非对话技能，同样注册）

| ID | 技能 | 触发 | 事实来源 | 模型 | 写库 |
|---|---|---|---|---|---|
| I1 | 层检测 | 上传后 | 图像 | VLM 或轻量分类（待确认 #2） | 否 |
| I2 | 医嘱抽取 | 入口 A | OCR lines + 正则 schema | 兜底解析须回链 | 否（只出草稿） |
| I3 | 身份匹配 | A/B | VLM 字段 × drug_master | VLM 提取 | 否 |
| I4 | 范围校验 | 草稿汇合 | packageInserts.dosage 上限 | 无 | 否 |
| I5 | 相互作用检查 | 计划集合变化 | interaction_rules | 无 | 否（只提示） |
| I6 | 确认提交 | 确认页 | 用户勾选后的草稿 | 无 | 是 |
| I7 | 打卡 | 今日任务 | plans + now | 无 | records + 库存扣减 |

### 4.3 医生域

| ID | 技能 | 形态 |
|---|---|---|
| D1 | doctor_ask | 问句 → 正则/叙述；MCP 同名转发 POST /insight/ask |
| D2 | queue_overview | 固定聚合 |
| D3 | patient_adherence_series | 日 × 状态 × 药品 |

工具面红线：无名 `execute_sql` / raw / query。新增必须先 API 契约 + 测试，再包 MCP。

### 4.4 快捷问题契约（单一真相）

`@anxin/shared`：

```ts
type QuickQuestion = {
  id: string
  label: string          // chips 文案
  question: string       // 实际发送
  skillId: 'S1' | 'S2' | 'S6'
  intent?: DataIntent    // S2 必填
}
```

web chips 与 api 路由同源。禁止前端自写一套文案、后端再对正则。

S2 意图最小集：`stock` | `plan` | `interaction-list` | `records` | `next-dose`（今日待服，M4 R2b）。

---

## 5. 上下文模型（用药版三层，对标但不抄阿福）

```
动态层   本轮点名药 + 用户原话（已脱敏）+ 会话窗 6 轮
静态层   生效计划集合（在服真相）+ 药箱库存摘要 + conditions
安全层   过敏覆盖（确定性）+ 相互作用规则命中 + 说明书剂量上限
```

组装原则：

1. **在服全集默认注入身份，不默认注入全部说明书正文**（防 prompt 膨胀）。点名药才按问题类型取段（适应症 / 用法 / 不良反应 / 药理 / 相互作用…）。
2. 多药问「能不能一起吃」：主事实来自 I5 规则命中列表，S2 可直答；需要解释时 S1 只转写规则 `note` + 各自相互作用段。
3. `gender` / `birthMonth` 本期不注入。
4. `allergy` 不进模型上下文。
5. 注入块每块有字数上限；超限截断并在内部 notice 记一笔（不对用户暴露技术细节）。
6. 发给第三方模型的字段 ⊆ L3 出口白名单。零泄漏断言覆盖请求体。

---

## 6. 数据架构

### 6.1 资产 vs 用户数据

```
资产（无 PII）                      用户数据（确认后）
drug_master  ──匹配拷贝──►  drugs
package_inserts                 plans ──► records
interaction_rules               sources（正文行 + 白名单字段）
                                health_profiles（字段级来源标注）
                                consult_sessions
                                consult_logs
                                consult_suggestions
                                risk_events
                                insight_ask_logs
```

药品主库 ≠ 药箱。续方 = 新计划行，不是覆盖旧行。

### 6.2 关键枚举（前后端一份，zod 出在 shared）

- 确认状态：`ocr_matched` | `rx_transcribed` | `manual`
- 字段标注：`copied` | `assisted` | `derived` | `default`
- 计划状态：`active` | `paused` | `ended`
- 咨询 riskLevel / status：与现行 `ConsultResponseSchema` 对齐（含 `limited` / `blocked`）
- 相互作用级别：`contraindicated` | `caution` | `monitor` | `note`
- 建议卡：`add_drug` | `note_symptom`；状态 `pending` | `accepted` | `dismissed`
- 健康信息来源：`self_reported` | `rx_copied_confirmed`

### 6.3 咨询相关表

```
consult_sessions(id, user_id, title, created_at, last_active_at)
consult_logs(…既有, session_id, turn_no, intent)
consult_suggestions(id, session_id, consult_log_id, type, payload jsonb,
                    status, acted_at)
```

`intent` 可空 = 走了 S1 兜底，作为漏判抽检分母的对照列。

### 6.4 追溯链

```
record / 咨询 citations
    → plan.sourceId + itemId
        → sources.whitelist_fields + body_lines
            → drugId → package_inserts.version
```

任何对用户可见的药学断言必须能走到 `source + version`。几何裁剪图已退役，追溯锚点是行文本而非像素框。

---

## 7. API 契约（编排层对外）

向后兼容：缺 `sessionId` / `skillId` = 今日单轮行为。

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/ingest/preview` | 上传 → 层检测 + 双线草稿（不写用户表） |
| POST | `/api/ingest/confirm` | 确认页提交，写 drugs/plans/sources |
| POST | `/api/plans` | 手动建计划 / 编辑 |
| POST | `/api/records` | 打卡 |
| POST | `/api/consult` | 咨询；可选 sessionId、skillId |
| GET | `/api/consult/sessions` | 会话列表 |
| GET | `/api/consult/sessions/:id` | 按 turnNo 回放 |
| POST | `/api/consult/suggestions/:id/accept` | body `{ path: 'ocr' \| 'manual' }` |
| POST | `/api/consult/suggestions/:id/dismiss` | 关闭卡 |
| GET | `/api/insight/queue` | 队列聚合 |
| POST | `/api/insight/ask` | 医生问句 |
| GET | `/api/insight/patients/:id/adherence-series` | 依从序列 |

所有写接口过 zod `.strict()`。模型原始输出不进响应；只出归一化后的 `ConsultResponseSchema`。

---

## 8. 安全与隐私（贯穿所有 Agent）

```
拍照原图 ──内存──► OCR/VLM ──即用即弃
                 │
                 ▼
            L0 行序裁剪（丢前记后记整块）
                 │
                 ▼
            L1 闭合白名单 schema
                 │
                 ▼
            L2 手机号/身份证/地址模式替换 [已脱敏]
                 │
                 ▼
            L3 出口：落库仅白名单；发模型仅白名单；日志只记类型与次数
```

失败方向：宁可误杀。误杀 → 人工补（可见）；漏杀 → 隐私入库（不可逆）。

额外守门：

- 剂量：模型段若出现用法数字，`stripDosageAdvice` 剥离并升 `limited`
- 医嘱回链：兜底解析每个值必须是裁剪后文本的子串
- 医生端：发 LLM 的队列摘要字段最小化，不分发身份证件类字段
- MCP：错误分两级，堆栈只进 stderr

---

## 9. 前端信息架构与 Agent 触点

五模块不变：用药｜药箱｜录入｜AI 咨询｜我的。医生端独立路由。

| 页面 | Agent 触点 | 关键交互 |
|---|---|---|
| 录入 | P-Ingest | 双入口、拍摄引导不同、处理中态、重拍建议 |
| 确认页 | I6 闸门 | 原文对照、四类标注、冲突清单、时间点、相互作用、给谁用 |
| 今日任务 | P-Plan | 提醒、打卡、漏服不补服 |
| 药品详情 | 事实层 | 确认状态三档、来源、计划标注、效期/库存 |
| AI 咨询 | P-Consult | 会话列表、chips=skillId、建议卡双路径文案含 L0 差异 |
| 我的 | 档案 | 健康信息手填；处方建议勾选才写 |
| 医生 Insight | P-Insight | 队列图 + 下钻；图表数据不经模型 |

老年向底线（ADR #5）：字号 16–18px，触控 ≥44px，风险语义色，关键操作可撤销。

咨询默认回答结构（五段，已有 schema）：`summary` / `keyPoints` / `risks` / `nextAction` / `warning`。先结论，再依据，再「该问医生的事」。

---

## 10. 运行时与可靠性

```
ingest P95（上传→草稿）  目标 ≤ 15s（含云端 OCR）
consult 骨架 P95         ≤ 500ms（守门+取数+归一化，不含 LLM）
consult 全链 P95         ≤ 15s（百川实测 ~5.2s + 余量）
OCR                      60s 超时 + 500ms 退避；仍失败 OCR_FAILED 降级草稿，不 5xx
百川                     失败 → 规则拼装，status 仍 answered + notice
```

三模型 kill 演练（既有 `degradation.test.ts`）继续作为发布门：OCR / 身份 VLM / 百川任一挂，用户看到的是语义化失败，不是空白或 500。

会话数据 MVP 不删除。保留策略下一期。

---

## 11. 评估网（先于行为变更）

两层：

1. **不变量 golden**（集成测试）：响应结构、L4/L3/limited 守门、citations 三件套、降级语义。不随 prompt 漂移。
2. **逐字节 fixture**（E2E 回放）：改 prompt / 换模型的任务必须重录受影响包。

指标口径见 `docs/11`：拦截召回 100%（golden）；意图漏判以每月 30 条人工标注为分母；strip 触发率观测；建议卡接受率 T6 后收基线。

E2E 红线保持：

- 数据直答路径 `ai-calls` 中生成类 = 0
- 过敏覆盖层不新增 LLM 调用
- 建议卡无确认零写入
- 持久化输出身份信息次数 = 0

---

## 12. 与行业架构的映射（防止实施时走偏）

| 行业能力 | 本产品对应 | 明确不对应 |
|---|---|---|
| 场景容器智能体 | 双录入入口 + skillId chips + 今日任务 | AI 诊室 |
| 健康档案上下文 | 药箱 + 生效计划 + conditions | 把病历丢进模型做个性化诊疗 |
| 主动追问 | 确认页缺槽人工补；咨询只澄清对象药 | SCAN 式病情收敛 |
| 能办事 | 建议卡走既有建档；S6 导出在服清单 | 挂号、云陪诊、开方 |
| 名医孪生 | — | 不做 |
| Agent RAG | 按 drugId 取段 | 向量检索 / 默认医疗搜索 |
| 评测驱动 | golden + fixture + 漏判抽检 | 无指标上新技能 |
| 多 Agent 会诊 | 四管线分治、共享事实 | 模型互相调用改计划 |

---

## 13. 明确不做

- ReAct / 多步自主规划 / 多 Agent 协作主路径
- LLM 意图分类作为主路由（正则 + skillId；Qwen FC 仅保留扩展位）
- RAG、全文检索、默认打开医疗搜索
- 模型生成建议卡、档案条目、相互作用规则、剂量、停药建议
- 过敏的模型联想
- NLP「引用是否忠实」检测器（citation-washing 为接受的残余风险）
- 药盒标签自动抄录用法
- 主动推送（网页无后台推送；下期另议）
- 跨用户共享、家庭账号（非目标）
- 医生端 text-to-SQL、MCP 扩 execute_sql
- 用咨询对话直接 PATCH plans

---

## 14. 落地顺序（与 M4 对齐，补上产品级缺口）

已批准的咨询改革顺序不改：  
`R1 → R7 网 → R2a → R4a → R3 → R6 → R2b → R4b → R5 → R8`

在同一里程碑内必须同时钉死的产品级项（本架构增量）：

| 项 | 何时 | 说明 |
|---|---|---|
| 咨询默认对象 = 生效计划集合 | 随 R5，视为体验 P0 | 废 `pickPrimaryDrug` 单药截断 |
| QuickQuestion 同源 | R1 | chips 与路由单一真相 |
| I5 检查时机接入续方/恢复 | 已在 PRD，咨询侧只消费结果 | 不要在 S1 里重算一套 |
| S6 复诊清单 | P1，R8 后 | 不挡 M4 收口 |
| 医生端 / MCP | 不动 | 只共享意图正则与技能名 |

若资源只够做一半：做完 M4 P0（会话、过敏覆盖、建议卡、评估网）+ 默认对象改为在服集合，即停。不要用剩余时间做人格化追问或搜索增强。

---

## 15. 风险

| 风险 | 架构对策 |
|---|---|
| 上下文膨胀导致超时/费用 | 说明书按段不按全文；在服只注入身份；窗 6 轮；R4b 附骨架 P95 |
| 多药回答串药 | 点名药段落 vs 身份快照分块标注；citations 带 drugId + sectionKey |
| 用户以为建议卡加药后能问个体化问题 | 卡面写明 L0 差异；accept 选 ocr/manual |
| 云端 OCR 格式漂移 | 客户端 `ocrContentToLines` 解包；契约仍是 `{ lines }` |
| 会话成为新泄露面 | 窗口只用落库前已脱敏文本，注入前再 scrub；零泄漏断言扩请求体 |
| 实施时把四管线合成一个「超级 Agent」 | A2/A9；PR 检查：新写库路径必须能指到确认页或建议卡 accept |

---

## 16. 验收对照（架构级，不替代 PRD §16）

- 四管线可分别画到代码目录（ingest / plan / consult / insight），无互相 import 写接口。
- 任何 LLM 响应都经过 shared schema；无 schema 的模型字段不得落库。
- 入口 B 黄金样例：零用法草稿 + 可见「标签不抄录」提示。
- 咨询续问带同一 sessionId，跨用户 session 隔离。
- 「这些药能不能一起吃」走规则命中，不走模型编造。
- 医生问依从性差的人数：数字 = SQL 聚合，叙述可关模型仍能出表。
- CI：不变量 golden + 脱敏零泄漏 + S2 零 LLM。
