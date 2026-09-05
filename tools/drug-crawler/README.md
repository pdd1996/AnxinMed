# drug-crawler · 丁香园用药助手说明书爬虫

对应 PRD（docs/06）§13.3「数据整理流程」的批量固化：单药整理流程已由海露 0.1% 首单（2026-09-04）验证，
本工具把「搜索定位 → 规格核验 → 提取」三步自动化，产出 `crawled` 状态草稿，人工核对闸门与入库流程不变。

> 少量药品（≤20）优先用会话内 skill（`.agents/skills/drug-crawler/`，无需安装，直接对话触发）；
> 本目录的 Playwright 脚本用于大批量/独立运行场景。两条路径提取逻辑一致。

## 站点行为（2026-09-05 实测）

- 详情页 `/pc/drug/{id}` 为 Next.js 服务端渲染，说明书正文直接在 HTML 中，无独立 XHR 数据接口；
- **匿名 HTTP 请求（curl 等）一律被 429 + 「请登录后继续访问」登录墙拦截**，无论请求头如何伪装；
- 浏览器会话（含 httpOnly cookie）内抓取稳定，因此本工具用 Playwright 持久化浏览器配置：
  登录一次（登录态存 `.profile/`），之后可长期免登录爬取；
- 网页版说明书**不展示**：药物相互作用（多数条目）、贮藏、有效期、批准文号 —— 这些字段草稿中留空/待人工补，
  与人工首单的处理一致；批准文号按 PRD §8.2 走 NMPA/实物核对（平局裁判，非通过条件）。

## 安装与使用

```bash
cd tools/drug-crawler
npm install          # 安装 playwright（首次另需 npx playwright install chromium）
node crawl.mjs login # 打开浏览器手动登录丁香园一次
node crawl.mjs crawl # 按 drugs.example.json 清单抓取 → out/*.json
node crawl.mjs crawl my-list.json
```

清单格式（见 `drugs.example.json`）：

```json
[
  {
    "drugId": "drug-hycosan-01",              // 对应 drug_master.id
    "keyword": "海露玻璃酸钠滴眼液",            // 搜索关键词
    "match": ["海露|HYCOSAN", "0\\.1%"],      // 标题必须命中的正则列表（规格核验）
    "note": "人工备注"
  }
]
```

已存在的 `out/{drugId}.json` 自动跳过（断点续跑）。

**drugId 命名（2026-09-05 定稿）**：新条目一律 `drug-` 前缀（单方 `drug-{通用名}-{规格}`，如 drug-nifedipine-30；中成药/复方 `drug-{商品名拼音}`，如 drug-ganmaoling-999）。`mock-` 前缀仅限已绑定 demo/server/mock-data.json 的 9 条既有条目——上面的示例是旧条目，新药不要照抄前缀。

## 草稿 → 入库

1. 草稿 `curationStatus = crawled`，**不得直接当作已审数据使用**；
2. 入库（staging，幂等）：把草稿从 `data/crawled/`（或本目录 `out/` 拷入）写入数据库——
   ```bash
   cd app/packages/api
   pnpm run db:import-crawled            # 导入全部草稿；--dry-run 预演；--status 对账
   ```
   草稿以 `crawled` 状态写 `package_inserts`（行 ID `pi-{drugId}@{version}`），无 `drug_master` 行的药自动建档；
   同版本已有 mock/reviewed 行则跳过不覆盖（write-once）；重跑自动跳过已入库版本，防重复写。
   逐药动作台账：`data/import-log.jsonl`；
   数据「真实 vs 演示」逐行审计：`pnpm run db:audit`（`--purge-mock --confirm` 可清理同药已有真实替代的演示行）；
3. 按 `data/crawled-总账.md` 的字段映射与核对清单逐条人工核对；
4. 补齐网页版缺失字段（interactions/storage/批准文号，来源限说明书原文/药监局公告，禁止模型生成）；
5. 核对通过 → `reviewed`，write-once 封版（参照 `app/packages/api/src/db/schema.ts` 的枚举）。

## 使用边界

- 仅限安心用药项目内部 MVP 数据整理；控制抓取频率（默认 1.8s + 随机抖动）；
- 抓取内容版权归丁香园所有，正式版上线前需按 PRD §13.1/§14 落实数据授权，不得公开分发爬取数据。
