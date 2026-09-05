# AGENTS.md — 安心用药

> 本文件是 AI 编码代理的入口指引。动手前必读；细节以链接指向的真相源文档为准。
> 版本：V1.0（2026-09-05）

## 项目一句话

把一个人所有来源的药放进同一个药箱——管依从、管冲突、管效期。工程化 MVP：按 PRD V2 全量实现，Mock 三库 + 本地模拟用户，代码 / 数据模型 / 测试按正式标准。

## 目录结构

```
AnxinMed/
├── app/      # 正式工程（当前仅有 packages/api：三库 schema + 迁移 + seed；M1 起补 pnpm workspace / web / shared）
├── data/     # 说明书数据整理区（crawled 草稿 + 总账 + 入库台账，git 版本化；人工核对后升 reviewed）
├── demo/     # 可运行的演示应用 —— 迁移参照物，只读，不再演进
├── docs/     # 真相源文档（PRD / ADR / 技术方案 / 任务书）
└── tools/    # 辅助工具（drug-crawler 说明书爬虫）
```

## 真相源与执行顺序

按 M1 → M2 → M3 顺序执行任务，动手前先读：

1. [docs/specs/00-执行总纲.md](docs/specs/00-执行总纲.md) — 执行协议、现状基线（§2）、demo→正式库命名对齐（§2.5）
2. [docs/specs/01-M1-地基.md](docs/specs/01-M1-地基.md) · [02-M2-录入主线.md](docs/specs/02-M2-录入主线.md) · [03-M3-打磨与验收.md](docs/specs/03-M3-打磨与验收.md)
3. [docs/08-技术方案.md](docs/08-技术方案.md) — 架构与技术栈
4. [docs/07-技术选型决策记录.md](docs/07-技术选型决策记录.md) — ADR
5. [docs/06-安心用药-产品需求文档-PRD-V2.md](docs/06-安心用药-产品需求文档-PRD-V2.md) — 需求

优先级：任务书 > 技术方案 08 > ADR 07 > PRD 06。文档间冲突时**停下来向用户报告**，不要自行裁决。现状以 `git status` 和目录实际内容为准（任务书 §2 是写书时的快照）。

## 硬性边界（摘自执行总纲 §0，违反即返工）

- 只改 `app/`（及任务书明确允许的 `docs/`、`demo/` 小改动）；**`demo/` 原则上只读**。
- 任何 API Key、连接串密码不得写进代码或提交进 git；`.env` 只放本地。
- 模型输出（LLM/VLM/OCR）必须过 zod `safeParse` + 守门规则才能接近数据库，禁止直通入库。
- 相互作用规则库条目只能抄录，禁止生成内容（PRD §7.8.1）。
- 禁止实现「从药盒/标签自动抄录用法用量」（PRD V2.1 已删除该能力）。
- 禁止静默吞错——失败必须可见（错误码 + 用户可理解的信息）。

## 技术栈（目标形态）

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + react-router + zustand + TanStack Query + shadcn/ui + Tailwind + lucide-react |
| 后端 | Hono + @hono/node-server + TypeScript，API 端口 8787 |
| 校验 | zod（schema 定义在 shared 包，前后端一份真相） |
| 数据 | PostgreSQL + Drizzle ORM + drizzle-kit（迁移为纯 SQL 进 git） |
| 测试 | Vitest（单测 + `app.request()` 集成）+ Playwright（golden case E2E） |
| 仓库 | pnpm workspace（M1 建立；当前 `app/packages/api` 仍是 npm 单包，demo 用 npm） |

## 常用命令

```bash
# demo（迁移参照物，只读；Vite 前端 + Express mock API 双进程）
cd demo && npm install && npm run dev

# app API 包（数据库操作）
cd app/packages/api
npm run db:generate   # 生成迁移
npm run db:migrate    # 执行迁移
npm run db:seed       # 从 demo/server/mock-data.json 导入资产域三库
npm run db:studio     # Drizzle Studio

# 数据库：本机直装 PostgreSQL 18（当前 .env 指向 localhost:5432/anxin_medication）
# 或：cd app && docker compose up -d （postgres:16-alpine）
```

## Git 约定

- 仓库尚未 `git init`（M1-T1 负责）。
- 每任务一 commit，格式：`M1-T3: resolveUser 中间件与本地用户解析`。
- 里程碑完成打 tag：`m1-done` / `m2-done` / `m3-done`。

## 被卡住时

优先重读 PRD 对应章节；仍无法解决则停在任务边界，输出「已完成 / 未完成 / 阻塞原因」清单交回用户，**不要为了看起来完成而降标准实现**。每个任务的完成标准必须逐条自验，验证命令与结果附在交付说明里。
