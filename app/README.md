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
pnpm -r typecheck    # 三包类型检查
pnpm lint            # ESLint（MVP 阶段部分规则为 warn）
pnpm -r build        # web: vite build；api: esbuild bundle → dist
```

## 目录结构

```
app/
├── packages/
│   ├── shared/   # 领域契约：zod schema / 枚举 / 元数据 / 纯函数（前后端一份真相）
│   ├── api/      # Hono API：routes(薄) → services(业务) → repositories(Drizzle)；db/(schema/迁移/seed)
│   └── web/      # React SPA：router / routes / stores(zustand) / components(shadcn+domain) / api(hc 客户端)
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

## 环境变量（只放 `.env`，不提交）

- `DATABASE_URL`：PostgreSQL 连接串
- M2/M3 模型与 OCR：`QWEN_API_KEY` / `QWEN_BASE_URL` / `BAICHUAN_API_KEY` / `BAICHUAN_BASE_URL` / `OCR_*`（见 `.env.example`）
