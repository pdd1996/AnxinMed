# app/e2e · golden case E2E（M2-T10 · Playwright + fixture 回放）

> 验证**接线**（上传 → 层检测 → 编排 → 草稿 → 确认页 → 单事务落库），不验证模型能力。
> 模型 I/O 经 `FixtureAiClients` 回放 `e2e/fixtures/<scenario>.json` 冻结；编排/降级/回链/脱敏/事务/API 全走真代码。

## 运行

```bash
# 无 key 环境（CI / 日常回归）：fixture 回放，五个 golden case 全绿
pnpm test:e2e

# 有 key 环境（发布前/验收手动跑，非回归手段）：真实管线 + qwen3.5-ocr
pnpm test:e2e:live
```

Playwright 同时起两个 webServer：api(8787，`AI_MODE=fixtures` + 独立测试库 `anxin_medication_test`) 与
web(vite 5173，`/api` 代理→8787)。globalSetup 负责建库 → 迁移 → seed（p-001 + golden case 的
drug_master/说明书锚点），teardown drop 库。首次需 `npx playwright install chromium`（本仓库 ms-playwright
缓存或系统 Chrome 亦可；CI 用官方 chromium 镜像）。

## 场景与回放机制

场景名 = 请求头 `x-test-scenario`（Playwright 用 `context.setExtraHTTPHeaders` 注入，vite 代理透传）。
api 以 `AI_MODE=fixtures` 启动时：

1. middleware 把头放进 `AsyncLocalStorage`（`lib/ai/scenario.ts`）——多 worker 并发按请求隔离；
2. registry 惰性装配 `FixtureAiClients`（`lib/ai/fixtures.ts`），按场景读 `e2e/fixtures/<scenario>.json`
   回放 detectLayers / runOcr / extractIdentity / fallbackParse；
3. `GET /api/_e2e/ai-calls?scenario=x`（仅 fixtures 模式注册）暴露调用计数，供「OCR 未调用」等结构断言。

五个场景（PRD §16.1）：`rx-normal` / `rx-spec-conflict` / `rx-redacted` / `drug-box-labeled` /
`unsupported-loose-pills`，样张在 `app/fixtures/`（与 T9 共用）。

## fixture 包的产生与重录

```bash
# 无 key：从 golden-cases.json（人工设计并审核的地面真相）合成回放包
pnpm --filter @anxin/e2e make-fixtures

# 有 key：换 prompt / 换模型版本时重录并重审（AI_MODE=record 的录制路径，source 标 live）
#   录制 = 对每个场景跑一遍真实管线，把模型逐步原始响应写回 e2e/fixtures/<scenario>.json
```

合成包 `source:"synthetic"`：golden case 的处方文本/涂黑/冲突/标签/散装形态即 oracle，mock OCR 为行级文本转录
（qwen3.5-ocr 契约，无字符级坐标/置信度）。审核通过的包进 git，CI 与日常回归永远回放这批文件。

## 断言四层

| 层 | 内容 |
|----|------|
| UI | 冲突清单可见、needsManual 输入框恒空、标签提示、「不支持」文案、确认后跳转 |
| DB | 直连测试库验证确认事务落库（drugs/plans/sources/health_profiles + drafts.status=confirmed） |
| 结构（PRD 红线） | drug-box payload 无任何 dose/frequency/usage；rx-redacted 人工补字段值为空 |
| 调用日志 | unsupported-loose-pills 的 `runOcr` 计数 = 0（散装药片绝不进 OCR） |

结构断言与「OCR 未调用」断言有效性验证：临时注入违规 fixture（如给 drug-box 包塞 dose 字段）应使对应
测试失败，验证后移除。
