# 安心用药 · app（正式工程）

把一个人所有来源的药放进同一个药箱——管依从、管冲突、管效期。本目录为 pnpm 单仓正式工程（M1 地基 → M3 打磨）。演示参照物在仓库 `demo/`（只读），真相源文档在 `docs/`。

## 前置

- Node ≥ 20、pnpm 11（`corepack enable`）
- 数据库二选一：
  - Docker：`docker compose up -d db`（postgres:16-alpine，暴露 5432）
  - 本机直装 PostgreSQL：自行建库并配置 `DATABASE_URL`

## 启动（本地开发）

```bash
# 1) 安装依赖
pnpm install

# 2) 起数据库（二选一，见上）
docker compose up -d db

# 3) 迁移 + seed（用户 / 资产三库 / p-001 演示数据）
pnpm --filter @anxin/api db:migrate
pnpm --filter @anxin/api db:seed          # 资产域三库（首次）
pnpm --filter @anxin/api db:seed-users    # users（p-001 + 8 名 mock 患者）
pnpm --filter @anxin/api db:seed-demo     # p-001 演示药/计划/记录/健康信息

# 4) 起前后端（api :8787 + web :5173，/api 由 vite 代理到 8787）
pnpm dev
```

打开 http://localhost:5173 。首次进入会显示免责声明引导；seed 后「今日任务」即有演示数据。
> 注：`pnpm dev` 下 api 为 `tsx watch`，**首次冷编译约 30–60s**（之后秒起）；web 就绪早于 api 属正常。

## 测试与质量

```bash
pnpm test            # shared 纯函数 + api 集成(独立测试库 anxin_medication_test) + web 冒烟
pnpm test:e2e        # M2-T10 golden case E2E（Playwright + fixture 回放，无 key 可跑；独立端口 8797/5174）
pnpm test:e2e:live   # 有 key 环境跑真实管线（发布前手动，非回归）
pnpm --filter @anxin/api perf:intake  # M3-T5 医嘱线打点采样：上传→草稿 非模型开销 P50/P95（详见 docs/09）
pnpm -r typecheck    # 四包类型检查（shared/api/web/e2e）
pnpm lint            # ESLint（MVP 阶段部分规则为 warn）
pnpm -r build        # web: vite build；api: esbuild bundle → dist
```

> E2E 详见 [e2e/README.md](e2e/README.md)：fixture 回放机制、场景清单、录制/重录与断言四层。

## 目录结构

```
app/
├── packages/
│   ├── shared/   # 领域契约：zod schema / 枚举 / 元数据 / 纯函数（前后端一份真相）
│   ├── api/      # Hono API：routes(薄) → services(业务) → repositories(Drizzle)；db/(schema/迁移/seed)
│   └── web/      # React SPA：router / routes / stores(zustand) / components(shadcn+domain) / api(hc 客户端)
├── e2e/               # M2-T10 Playwright golden case E2E（fixture 回放 + 独立测试库）
├── fixtures/          # golden case 样张真相源（golden-cases.json + PNG + 渲染器，T9/T10 共用）
├── docker-compose.yml   # 生产形态：api(多阶段镜像) + db
├── Dockerfile           # api+web 多阶段构建（deps → build → runtime slim）
└── .env / packages/api/.env   # 本地 secrets，不提交（仅 .env.example 入库）
```

## 生产部署（docker）

```bash
docker compose up -d --build          # 构建并起 api(8787) + db
# 迁移与 seed（宿主机对暴露的 5432 执行）
pnpm --filter @anxin/api db:migrate
pnpm --filter @anxin/api db:seed-users
pnpm --filter @anxin/api db:seed-demo
curl localhost:8787/api/health        # 期望 200 {"ok":true,...}
```

浏览器打开 http://localhost:8787 即前端（api 以 `NODE_ENV=production` 托管 `packages/web/dist` + `/api`）。

> 验证状态：生产 serving 逻辑已在本地以 `NODE_ENV=production node packages/api/dist/index.js` 验证
> （`/api/health` 200、`/` 返回 SPA）。`docker compose up --build` 的端到端需本机安装 Docker 后执行。

## 环境变量矩阵（只放 `.env`，不提交；模板见 `.env.example`）

| 变量 | 必填 | 默认 | 用途 |
|---|:--:|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL 连接串（dev 库）；测试库 `anxin_medication_test` 由此派生（仅换库名），角色需 `CREATEDB` |
| `PORT` | | `8787` | api 监听端口 |
| `NODE_ENV` | | — | `production`：api 托管 `packages/web/dist` + `/api`；`test`：静默 `[intake:timing]` 日志 |
| `QWEN_API_KEY` / `QWEN_BASE_URL` | 录入/身份线 | — | Qwen3-VL：层检测 + 身份提取；缺失 → `AIUnavailableError`（录入入口硬闸门 503 降级） |
| `QWEN_MODEL` | | `qwen3-vl-plus` | Qwen 模型名 |
| `BAICHUAN_API_KEY` / `BAICHUAN_BASE_URL` | 咨询/兜底/摘要 | — | Baichuan-M3-Plus：医嘱兜底解析 + 咨询回答 + 医生端摘要；缺失 → 离线兜底（咨询 200 降级、摘要规则拼装） |
| `BAICHUAN_MODEL` | | `baichuan-m3-plus` | Baichuan 模型名 |
| `OCR_BASE_URL` | 医嘱线 OCR | — | qwen3.5-ocr 云端 OpenAI 兼容端点（`POST {OCR_BASE_URL}/chat/completions`，ADR #16 取代 #13）；缺失 → OCR `AIUnavailableError`（录入转 `OCR_FAILED` 降级草稿） |
| `OCR_API_KEY` / `OCR_MODEL` | | `qwen3.5-ocr` | qwen3.5-ocr 密钥 / 模型名；60s 超时 + 重试退避 500ms（ADR #16） |
| `ENABLE_MEDICAL_SEARCH` | | `false` | 医疗搜索兜底默认关（PRD §7.5：仅本地未命中才开，且标注「未经本库核实」） |
| `AI_MODE` | | — | `fixtures`：E2E 回放 `FixtureAiClients`（无 key 可跑）；其余：真实客户端 |
| `API_PROXY_TARGET` | | `http://localhost:8787` | web(vite) `/api` 代理目标（E2E 用独立端口 8797） |
| `PERF_N` / `PERF_USER` | | `30` / `p-001` | `perf:intake` 采样次数 / 用户 |

> 模型三库（Qwen/Baichuan/OCR）缺失**不影响本地核心功能**（药箱/计划/今日/记录），仅录入/咨询走语义化降级——见 M3-T5 降级演练（`docs/09` §T5.2）。

## 持续集成（CI）

`.github/workflows/ci.yml`（仓库根）：push `main` / PR 触发，`postgres:16` service：

- **quality** job：`pnpm lint` + `pnpm -r typecheck` + `pnpm test`（shared 纯函数 + api 集成 + web）；api 测试 globalSetup 自建测试库 + 迁移 + seed。
- **e2e** job（独立）：`pnpm test:e2e` golden case 回放（`AI_MODE=fixtures`，**AI key 不进 CI**）。
- CI 仅需 `DATABASE_URL`（`postgresql://postgres:postgres@localhost:5432/anxin_medication`）；测试库由其派生，postgres 超级用户具 `CREATEDB`。
