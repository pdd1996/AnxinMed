# 安心用药 AnxinMed

> 把一个人所有来源的药放进同一个药箱——管依从、管冲突、管效期。

![Node](https://img.shields.io/badge/node-%3E%3D20-339933) ![pnpm](https://img.shields.io/badge/pnpm-11-F69220) ![React](https://img.shields.io/badge/React-19-61DAFB) ![Hono](https://img.shields.io/badge/Hono-API-e36002) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791) ![Tests](https://img.shields.io/badge/tests-Vitest%20%2B%20Playwright-6E9F18)

## 项目简介

多来源用药是老年慢病患者的日常痛点：处方散落在不同医院、自购药堆在抽屉、亲友送药无从追溯，信息不集中导致漏服、错服、重复用药、过期无人知晓。安心用药把这一个人所有来源的药放进同一个数字药箱。

**目标人群**：以老年慢病患者为核心使用者（老年向 UI：大字号、高对比、语音交互），家人协助拍照录入；另提供医生端只读洞察视图。

**核心功能**：

- **双入口拍照录入**：处方照片 / 药盒照片两条入口，OCR + VLM 提取医嘱生成草稿
- **草稿确认页唯一闸门**：所有 AI 产出仅为草稿，用户逐字段核对确认后才入库
- **依从管理**：今日任务、服药打卡、历史记录查询与 CSV 导出
- **相互作用检查与剂量校验**：规则引擎按规则库标注风险，只标注、不阻止
- **AI 咨询**：基于本地说明书库回答，四级守门 + 落库审计，医疗搜索默认关闭
- **效期与库存管理**：效期预警、库存扣减、开药用尽提醒
- **医生端洞察**：只读 Agent 汇总依从性与风险事件，输出经二次守门
- **语音交互**：Web Speech API 语音填入（STT）与回答播报（TTS），不支持时优雅降级
- **失败分支可见**：任何降级/失败都以明确错误码与用户可理解的信息呈现，禁止静默吞错

## 产品边界与免责声明

- 本产品**不诊断、不开方、不擅自调整用药方案**；医嘱内容只从原始材料抄录，绝不生成。
- Mock 三库（药品主库 / 相互作用规则 / 说明书）为演示数据，**未经医学审核，不用于真实诊疗**。
- 服药提醒**仅在网页处于打开状态期间生效**，不是后台推送。
- 说明书数据来源于丁香园用药助手，**版权归原方所有**，仅限本项目内部整理学习，不得再分发。

## 目录结构

| 目录 | 说明 |
| --- | --- |
| [`app/`](app/) | 正式工程。pnpm 单仓：`packages/shared`（zod 契约）+ `packages/api`（Hono API）+ `packages/web`（React 前端），另有 `e2e/`（Playwright golden case）、`fixtures/`（AI 回放样张）与 Docker 编排 |
| [`data/`](data/) | 说明书数据整理区：`crawled/` 草稿 + 总账 + 入库台账（git 版本化；人工核对后升 reviewed） |
| [`demo/`](demo/) | MVP 演示版，正式工程的迁移参照物。**只读冻结，不再演进** |
| [`docs/`](docs/) | 真相源文档：PRD / ADR / 技术方案 / 任务书 / 验收清单 |
| [`tools/`](tools/) | 辅助工具：`drug-crawler`（说明书爬虫）、`ocr-bench`（OCR 基准） |

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite 6 + react-router 8 + zustand + TanStack Query + shadcn/ui + Tailwind CSS 4 + lucide-react |
| 后端 | Hono + @hono/node-server（端口 8787）；routes → services → repositories 三层；`hc<AppType>` 端到端类型推断 |
| 校验 | zod（schema 定义在 shared 包，前后端一份真相） |
| 数据 | PostgreSQL 16 + Drizzle ORM + drizzle-kit（迁移为纯 SQL 进 git，12 张表） |
| AI | Qwen3-VL / qwen3.5-ocr 云端（医嘱线行级转录，ADR #16）/ Baichuan；统一 AiClients 注入接缝；E2E 用 fixtures 回放 |
| 测试 | Vitest（单测 + `app.request()` 集成，独立测试库）+ Playwright（5 条 golden case E2E） |
| 仓库 | pnpm 11 workspace（Node >= 20，ESM） |
| 部署 | docker-compose：api 多阶段镜像托管 web dist + `/api`；postgres:16-alpine |

## 快速开始

除 `corepack enable` 外，以下命令均在 [`app/`](app/) 目录下执行。

```bash
# 环境准备（Node >= 20；启用 pnpm 11）
corepack enable

cd app
docker compose up -d db        # 或本机直装 PostgreSQL 16，并在 .env 配置 DATABASE_URL

pnpm install
pnpm --filter @anxin/api db:migrate
pnpm --filter @anxin/api db:seed          # 资产域三库（药品主库/相互作用规则/说明书）
pnpm --filter @anxin/api db:seed-users    # 演示用户
pnpm --filter @anxin/api db:seed-demo     # p-001 演示数据

pnpm dev        # api :8787 + web :5173
```

启动后打开 <http://localhost:5173>。

## 环境变量

核心配置项见 [`app/.env.example`](app/.env.example)（复制为 `app/.env` 后填写；`.env` 已 gitignore）；下表为完整变量清单，含 `.env.example` 未列出的可选运行时变量（均有代码默认值）。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | **是** | PostgreSQL 连接串。角色需 CREATEDB 权限（测试库 `anxin_medication_test` 由此 URL 派生自建） |
| `QWEN_API_KEY` / `QWEN_BASE_URL` | 否 | Qwen3-VL：处方层检测 / 身份线提取 |
| `BAICHUAN_API_KEY` / `BAICHUAN_BASE_URL` | 否 | Baichuan：医嘱兜底解析 / 咨询 / 医生端摘要 |
| `OCR_BASE_URL` | 否 | qwen3.5-ocr 云端 OpenAI 兼容端点（医嘱线行级转录，ADR #16） |
| `OCR_API_KEY` / `OCR_MODEL` | 否 | OCR 密钥 / 模型名（默认 `qwen3.5-ocr`） |
| `QWEN_MODEL` / `BAICHUAN_MODEL` | 否 | 模型名覆盖 |
| `ENABLE_MEDICAL_SEARCH` | 否 | 医疗搜索开关，默认 `false`（PRD §7.5：仅本地说明书未命中才兜底，且标注未经本库核实） |
| `PORT` | 否 | API 端口，默认 8787 |
| `NODE_ENV` | 否 | 环境标识 |
| `AI_MODE` | 否 | `fixtures` 时以录制包回放 AI 调用（E2E 使用） |
| `API_PROXY_TARGET` | 否 | web dev server 代理目标 |
| `PERF_N` / `PERF_USER` | 否 | 性能压测脚本参数 |

> 三库 AI key 全部缺失**不影响本地核心功能**（药箱 / 计划 / 今日 / 记录照常使用）；仅录入、咨询等 AI 链路走语义化降级提示。

## 测试与质量

```bash
pnpm test           # 单测 + 集成（独立测试库自动建/迁/seed）
pnpm test:e2e       # golden case E2E（AI_MODE=fixtures，无 key 可跑，端口 8797/5174）
pnpm -r typecheck
pnpm lint
pnpm -r build
```

CI：[`.github/workflows/ci.yml`](.github/workflows/ci.yml)，push `main` / PR 触发，两个 job：

- **quality**：lint + typecheck（shared/api/web/e2e）+ 全部单测与集成测试
- **e2e**：golden case E2E（fixtures 回放路径，无需 AI key；失败时上传 Playwright trace）

两个 job 均起 `postgres:16-alpine` service；测试库由 globalSetup 从 `DATABASE_URL` 派生自建 + 迁移 + seed，CI 无需手动 migrate/seed。**AI key 不进 CI**。

## 生产部署（Docker）

```bash
# app/ 目录下
docker compose up -d --build
pnpm --filter @anxin/api db:migrate
pnpm --filter @anxin/api db:seed-users
pnpm --filter @anxin/api db:seed-demo

curl localhost:8787/api/health   # 期望 {"ok":true}
```

api 多阶段镜像同时托管 web 构建产物，浏览器直接打开 <http://localhost:8787>。

> compose 内数据库密码为**本地开发默认值**，生产必须以环境变量 / secret 覆盖，切勿将真实凭据提交进 git。

## 项目状态

M1 / M2 / M3 全部完成：golden case E2E 全过、PRD §16 验收项通过，详见 [docs/specs/acceptance-MVP.md](docs/specs/acceptance-MVP.md)。

**性能数据**（详见 [docs/09-性能与健壮性报告-M3-T5.md](docs/09-性能与健壮性报告-M3-T5.md)）：非模型开销 P50 = 6.2ms / P95 = 10.6ms；首屏 143.54KB gzip。

**三项待复测保留项**（如实列出）：

1. 真实医嘱线 P95 ≤ 15s 的 live 实测（当前为离线/回放口径）
2. 生产 docker 形态端到端验证
3. CI 推送 main 后实跑确认

`m1-done` / `m3-done` tag 暂缓至上述保留项补齐后补打。

## 工程原则（安全不变式）

- **医嘱只抄录不生成**：任何情况下不生成、补全医嘱内容。
- **一切模型输出过守门**：LLM / VLM / OCR 结果必须经 zod `safeParse` + 守门规则才允许接近数据库，禁止直通入库。
- **零泄漏断言 CI 强制**：脱敏后的请求载荷不得含姓名 / 身份证等 PII（值级 + 键级双重断言）。
- **进档案的最后一道门是用户**：草稿确认页是唯一入库闸门。
- **凡模型调用必有降级路径**：AI 不可用时功能语义化降级，而非报错或伪造。
- **禁止静默吞错**：失败必须可见（错误码 + 用户可理解的信息）。
- **相互作用规则库条目只抄录**，禁止生成（PRD §7.8.1）。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/06-安心用药-产品需求文档-PRD-V2.md](docs/06-安心用药-产品需求文档-PRD-V2.md) | PRD（需求真相源） |
| [docs/07-技术选型决策记录.md](docs/07-技术选型决策记录.md) | ADR |
| [docs/08-技术方案.md](docs/08-技术方案.md) | 技术方案 |
| [docs/specs/00-执行总纲.md](docs/specs/00-执行总纲.md) | 执行总纲（含现状基线） |
| [docs/specs/01-M1-地基.md](docs/specs/01-M1-地基.md) · [02-M2-录入主线.md](docs/specs/02-M2-录入主线.md) · [03-M3-打磨与验收.md](docs/specs/03-M3-打磨与验收.md) | 里程碑任务书 |
| [docs/specs/acceptance-MVP.md](docs/specs/acceptance-MVP.md) | MVP 验收清单 |
| [docs/09-性能与健壮性报告-M3-T5.md](docs/09-性能与健壮性报告-M3-T5.md) | 性能与健壮性报告 |
| [app/README.md](app/README.md) | 正式工程详情（命令 / 结构） |
| [demo/README.md](demo/README.md) | 演示版说明 |
| [tools/drug-crawler/README.md](tools/drug-crawler/README.md) | 说明书爬虫工具 |

## Windows 开发提示

`pnpm dev` 为并行启动，api 首次冷编译较慢（约 30–60s），web 先就绪属正常现象，稍候即可。
