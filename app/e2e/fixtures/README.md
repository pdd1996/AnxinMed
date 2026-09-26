# e2e/fixtures · 回放包（编译产物，勿手改）

本目录所有 `.json` 由 `scripts/make-fixtures.ts` 从 **`../fixtures/golden-cases.json`**（测试资产真相源，见其 README）编译生成，一场景一文件（场景名 = `x-test-scenario`），供 Playwright 在 `AI_MODE=fixtures` 下由 `FixtureAiClients` 回放，无需真实模型 key。

## 规则

- **改用例 → 改源**：只改 `app/fixtures/golden-cases.json`，然后重新编译：
  ```bash
  pnpm --filter @anxin/e2e make-fixtures
  ```
- 本目录文件随时可整体重生成，**不手改、不新增**；
- 与源目录的分工：`app/fixtures/` = 手写真相源（JSON + PNG 样张）；本目录 = 机器生成的回放包。
