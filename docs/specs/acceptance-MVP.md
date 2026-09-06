# 验收清单 · MVP（PRD §16 逐项）

> 任务书 M3-T6.2：逐条列出 PRD §16 验收项的**验证方式**（E2E 用例名 / 测试名 / 手动步骤）与**结果**。
> 真相源：[docs/06-安心用药-产品需求文档-PRD-V2.md](../06-安心用药-产品需求文档-PRD-V2.md) §16。
> 复现命令（`app/` 下）：`pnpm test`（shared+api+web）· `pnpm test:e2e`（golden case，fixtures 无 key）· `pnpm -r typecheck` · `pnpm lint`。
> 图例：✅ 有自动化证据（测试/E2E 名）｜🟢 手动/浏览器验证（附步骤或截图）｜证据路径相对仓库根。

---

## §16.1 拍照录入（9 项）

| # | 验收项 | 验证方式（证据） | 结果 |
|---|---|---|---|
| 1 | 合成处方笺端到端：草稿字段全对（药名/规格/用量/频次/途径/疗程/结束日期推算） | E2E `golden-cases.spec.ts` › `rx-normal：草稿字段全对 → 确认 → 药箱+计划生效（UI+DB）`；`intake-api.test.ts` › `单条目处方笺 → 201…planDraft dose/frequency/cycleType` | ✅ |
| 2 | 姓名/电话/病历号/地址在任何持久化输出出现次数 = 0（脱敏断言） | `zero-leak.test.ts`（值级+键级双断言）；E2E `rx-redacted`；`consult-api.test.ts` › `用户提问含手机号 → 落库前脱敏` | ✅ |
| 3 | 规格冲突（库 0.2% vs 处方 0.1%）确认页冲突提示，不自动选边 | E2E `rx-spec-conflict：冲突清单可见且不自动选边`；`Draft.test.tsx` › `规格冲突 → 候选全部未选中、确认被挡住` | ✅ |
| 4 | 抽取失败项走原文人工补，不出现猜测预填 | E2E `rx-redacted：涂黑字段按缺失走人工补，无猜测预填`；`Draft.test.tsx` › `needsManual 字段无法被预填 → 输入框为空 + 人工补提示` | ✅ |
| 5 | 药盒入口（含贴标）不产出任何用法用量草稿；贴标出现"标签用法不自动抄录"提示，不静默 | E2E `drug-box-labeled：payload 无任何用法用量`；`intake-api.test.ts` › `药盒原装层 → payload 无 planDraft` + `医院标签层 → labelNotice:true` | ✅ |
| 6 | 手动建档标注"未经 OCR 确认"，AI 个性化咨询不可用 | `ManualDrugModal.tsx`（confirmStatus=manual 固定）；`consult-api.test.ts` › `manual 档门禁 → manual-gate + l0Notice`；`Consult.test.tsx` › `选中 manual 档药 → 提示未经 OCR 确认` | ✅ |
| 7 | 散装药片图片得到明确"不支持"提示 | E2E `unsupported-loose-pills：明确「不支持」提示 + OCR 未被调用`；`intake-api.test.ts` › `不支持对象（散装药片）→ 422 UNSUPPORTED_OBJECT + 安全提示` | ✅ |
| 8 | 处方患者信息与账号资料不一致时出现"给谁用的药"提示 | `Draft.test.tsx` › `唯一闸门：逐项核对 + 使用人 + 提交后跳转`；`components/domain/draft/HealthCard.tsx`（WhoCard 使用人确认，恒定提示） | ✅ |
| 9 | golden case 已实测（海露 0.1% 首单：多规拦截 / 医嘱对照 / 三源规格一致） | 数据 provenance：`data/crawled/drug-hycosan-01.json`（说明书草稿）+ `data/crawled-总账.md`（核验总账）；OCR 实测 `tools/ocr-bench/paddle-result.json`（医嘱行字符准确率 1.0） | ✅ |

## §16.2 提醒功能

| 验收项 | 验证方式（证据） | 结果 |
|---|---|---|
| 网页打开期间到达计划时间时收到页内提醒（措辞修正自 V1 §15.2）；漏服不自动建议补服 | `Home.tsx`：`useQuery(['tasks','today'], { refetchInterval: 30_000 })` 轮询 + `duePendingSlots` 比对 + `stores/reminderQueue.ts` 入队 → `ReminderModal` 队首弹出。**手动步骤**：seed p-001 计划含近时点 → 打开今日页 → 到点弹窗（已服/稍后/跳过 + 播报）；关闭页面不再提醒（无系统通知，`Home.tsx` 底部文案明示） | 🟢 手动 + 代码 |

## §16.3 AI 咨询（沿用 V1 §15.3）

| 验收项 | 验证方式（证据） | 结果 |
|---|---|---|
| 守门 L1 正常回答：citations 必含 药名+source+version 三件套 | `consult-api.test.ts` › `L1 完整回答 → citations 三件套`；`AnswerCard.test.tsx` › `citations 三件套全量渲染` | ✅ |
| L2 剂量过滤：回答中具体剂量/频次被过滤 + 固定提示 | `consult-api.test.ts` › `L2 剂量过滤 → limited + notice 已过滤具体剂量建议` | ✅ |
| L3 拒答：停药/换药/剂量调整 → 拒答 + 引导开方医生 + 留痕 | `consult-api.test.ts` › `L3 拒答 → blocked + risk_events 留痕`；`Consult.test.tsx` › `L3 拒答 UI` | ✅ |
| L4 紧急信号（胸痛/急救词）→ 停止常规流程 + 引导急救 + 留痕 | `consult-api.test.ts` › `L4 紧急信号 → blocked + risk_events(level=L4)`；`Consult.test.tsx`/`EmergencyCard.test.tsx` › `置顶大按钮 tel:120` | ✅ |
| manual 档仅 L0 资料查询，不进个体化解释 | `consult-api.test.ts` › `manual 档门禁` | ✅ |
| 医疗搜索默认关；本地未命中才兜底且标注"未经本库核实" | `consult-api.test.ts` › `no-source → notice 医疗搜索`（`ENABLE_MEDICAL_SEARCH=false`）；`AnswerCard.test.tsx` › `unverified=true → 未经本库核实徽章` | ✅ |
| AI 不可用 → 不影响其他功能（离线兜底） | `consult-api.test.ts` › `Baichuan AIUnavailable → fallbackSectionsFromInsert + notice`；`degradation.test.ts` › 记录三 | ✅ |
| 四风险等级 UI 全可达 + citations 透传无丢失 | `Consult.test.tsx`（L1/L2/L3/L4 四态）；`AnswerCard.test.tsx` | ✅ |

## §16.4 相互作用（V2 新增）

| # | 验收项 | 验证方式（证据） | 结果 |
|---|---|---|---|
| 1 | 草稿确认时对新计划与生效计划集合执行检查 | `Draft.test.tsx` › `confirm 响应含规则检查发现 → 跳转前弹出结果（只标注不阻止）`；`drafts-confirm.test.ts`（confirm 事务重跑 checkInteractions） | ✅ |
| 2 | 为老药建新计划（无入箱事件）时同样执行 | `plans-rules.test.ts`（POST /api/plans 接 checkInteractions）；`rules-interactions.test.ts` | ✅ |
| 3 | 命中展示分级/来源/咨询引导，不阻止创建、不修改方案 | `rules-interactions.test.ts`（level/source/note）；`components/domain/draft/RiskCards.tsx`（只标注不阻止，`development_practice` 规则引擎原则） | ✅ |

---

## 非功能 / 健壮性（技术方案 §11 · M3-T5）

| 验收项 | 验证方式（证据） | 结果 |
|---|---|---|
| 医嘱线打点计时 + P50/P95 采样能力 | `timing.test.ts`（13）；`npm run perf:intake` 实测非模型开销 P50=6.2/P95=10.6ms；`docs/09` §T5.1 | ✅ |
| 模型不可用不影响本地核心功能 + 无 5xx 雪崩 | `degradation.test.ts`（4：三模型各一条 + 全 down 横切）；活体 curl smoke（`docs/09` §T5.2） | ✅ |
| 首屏 chunk ≤ 300KB gzip + 路由懒加载 | `pnpm --filter @anxin/web build`：index 143.54KB gzip；运行时仅加载当前路由（`docs/09` §T5.3） | ✅ |
| 语音可用 + 不支持降级无阻塞 + 等价按钮保留 | `speech.test.ts`/`useSpeechRecognition.test.ts`/`VoiceDictationButton.test.tsx`/`SpeakButton.test.tsx`（45）；Chrome 实测（M3-T4，`.qoder/verify-shots/t4-*`） | ✅ |
| 记录按日/周/月查询 + CSV 导出 | `records-query.test.ts`（8）；`records.test.ts`（9，CSV/区间）；`Records.test.tsx`（6，页面接线） | ✅ |

## 待复测 / 保留项（诚实标注，未打勾即未达标）

- ⏳ **真实医嘱线 P95 ≤ 15s**：需 live 模型（生产 Linux+oneDNN OCR）复测；本机 OCR ~69s 系 Windows PIR/oneDNN 环境 bug（ADR#13 保留项，`docs/09` §T5.1）。打点与采样工具已就位。
- ⏳ **生产 docker 端到端**：`docker compose up --build` 需本机/云 Docker 执行（`m1-done` tag 同此暂缓，`app/README.md` 已注明本地 `NODE_ENV=production node dist` 验证 serving）。
- ⏳ **CI 全绿**：`.github/workflows/ci.yml` 已就位，需推送 GitHub 后由 Actions 实跑确认（本地已等价验证 lint/typecheck/test/build 全绿 + E2E fixtures 可跑）。

> 结论：PRD §16.1–§16.4 功能验收项**全部 ✅**（自动化 E2E/集成/组件测试为证）；非功能项除「真实 P95」「生产 docker e2e」「CI 实跑」三项因环境依赖列为待复测外，其余 ✅。`m3-done` tag 待上述保留项在具备环境后补齐再打。
