---
name: drug-crawler
description: 从丁香园用药助手（drugs.dxy.cn）爬取药品说明书，产出安心用药项目说明书库的 crawled 草稿。当用户提到爬虫/抓取/采集药品说明书、填充说明书库、整理某个药的丁香园/DXY/用药助手数据、按 mock 药品清单补说明书时使用——即使用户没明说"爬虫"二字。流程含规格核验（多规拦截）、段落提取、原文指纹自检、总账更新。
---

# drug-crawler · 丁香园说明书爬取

把一次会话中验证过的完整流程（2026-09-05 首批 9 药 + 错别字指纹复核）固化为可重复操作。
对应 PRD `docs/06` §13.3 数据整理流程的前三步（搜索定位→规格核验→提取），后两步人工闸门不在本 skill 范围。

## 0. 产出与边界（先读）

1. 产出物是 `curationStatus: "crawled"` 的**草稿**，未过人工核对闸门；可用 `db:import-crawled` 以同状态入库（staging，见 §6），人工核对通过后升 `reviewed`（PRD §13.3 第 4 步闸门，不可跳过）；
2. 抄录不生成：`sections` 内容必须是网页原文逐字抄录（仅允许空白归一化），禁止任何模型改写、补全、摘要；
3. 仅限项目内部 MVP 数据整理；默认节奏单药间隔 ≥1.5s，一批 ≤30 个；站点改版导致提取异常时停下报告，不硬闯。

## 1. 路径选择

| 场景 | 用法 |
|---|---|
| 单药/少量（≤20）、会话内即可完成 | 本 skill 的浏览器流程（§2–§5），无需安装任何东西 |
| 批量（几十~全量分类枚举） | 用现成脚本 `tools/drug-crawler/`（Playwright 持久化登录，断点续跑），本 skill 只负责写清单和验收 |

两条路径的提取逻辑相同；浏览器路径靠 ZCode 内置 browser-use，脚本路径靠 `tools/drug-crawler/crawl.mjs`。

## 2. 浏览器爬取流程

站点关键行为（2026-09-05 实测，改版需重验）：

- 详情页 `/pc/drug/{dxyId}` 是 Next.js SSR，正文直接在 HTML 里，无 XHR 数据接口；
- **匿名 HTTP（curl 等）一律被 429 + 「请登录后继续访问」登录墙拦截**，伪装请求头无效——必须骑浏览器会话；
- ZCode 内置浏览器（未登录状态）的会话 cookie 即可读详情页与搜索页；若某天开始被拦，改走 `tools/drug-crawler` 的登录流程。

操作序列（browser-use skill 的标准套路）：

1. 按 browser-use skill 引导初始化，`getForUrl("https://drugs.dxy.cn/pc")` 取浏览器；
2. `tabs.list()` 找既有 tab，没有则 `tabs.new()` 并 `goto` 任意 `drugs.dxy.cn/pc` 页面，等 `domcontentloaded`；
3. 在页面上下文里用 `tab.playwright.evaluate(pageFn, arg)` 执行搜索与详情提取——**页面函数代码不要自己重写**，读 `references/extract-fn.js`（四个坑的修复都已编码进去）；
4. **evaluate 只传一个对象参数**（`arg` 形如 `{ id, needles }`）；传两个独立参数会序列化失败（实测报 `not iterable`）；
5. 每次搜索/详情请求之间 `setTimeout ≥1500ms`（evaluate 内自行 sleep 或分两次调用）。

## 3. 规格核验（多规拦截）

搜索结果标题自带规格（如「HYCOSAN（玻璃酸钠滴眼液）-海露 0.1%」）。命中规则：

1. 从 `demo/server/mock-data.json`（或用户指定）取该药的 通用名/商品名/规格/剂型；
2. 构造标题匹配：商品名关键字 + 规格（正则，注意 `0.5g` 与 `5mg` 的转义和边界）；
3. **必须排除**同厂多规（0.1% vs 0.2%）、多剂型（片/缓释片/胶囊/注射液常是独立条目，如格华止普通片 vs 缓释片）；
4. 无唯一命中时：把候选列表完整报告给用户，**不要**自行选边（PRD §8.2：冲突暴露不裁决）；
5. 匹配结论写进草稿的 `matchNote`（含对 mock 包装规格 vs DXY 含量规格差异的说明，如「5 mg × 7片」是包装、「5 mg」是含量）。

## 4. 草稿输出

写到 `data/crawled/{drugId}.json`（已存在则先问用户是否重爬）。

**drugId 命名规则（2026-09-05 定稿，全量生效）**：全部条目统一 `drug-` 前缀——ID 是身份键，来源是可变事实（由 sourceUrl/curationStatus 表达；PRD §13.2 换源"只换值不换结构"），把 dxy/mock 编进 ID 会在换数据源时变成谎言或迫使改主键。后缀沿用库内惯例：单方药 `drug-{通用名}-{规格数值}`（如 drug-nifedipine-30），中成药/复方 `drug-{商品名拼音}`（如 drug-ganmaoling-999）。历史 mock-* 条目已于 2026-09-05 全量迁移为 drug-*（含 demo/server/mock-data.json 与数据库）；**禁止再产出 mock-* 前缀**（import-crawled 的 zod 校验兼容 mock- 仅为历史兜底）。格式：

```json
{
  "drugId": "drug-xxx",
  "crawledAt": "2026-09-05",
  "curationStatus": "crawled",
  "dxyId": "pFa0Fp6vlHtPoUY5VhIOnig",
  "sourceUrl": "https://drugs.dxy.cn/pc/drug/pFa0Fp6vlHtPoUY5VhIOnig",
  "dxyTitle": "HYCOSAN（玻璃酸钠滴眼液）-海露",
  "tags": ["OTC甲", "医保乙类"],
  "approvalDate": "2022年12月6日",
  "revisionDate": "2022年12月28日",
  "version": "dxy-2022-12-28",
  "searchKeyword": "海露玻璃酸钠滴眼液",
  "searchCandidates": ["…搜索结果前 8~12 条标题…"],
  "matchNote": "规格核验通过：……（含排除项与规格写法差异说明）",
  "sections": { "成份": "…", "规格": "…", "适应症": "…", "用法用量": "…", "…": "…" }
}
```

`version` 由修改日期推导为 `dxy-YYYY-MM-DD`（中文日期先转 ISO）。`sections` 键名用 DXY 原段名（成份/规格/适应症/用法用量/不良反应/禁忌/注意事项/药物相互作用/药理作用/药代动力学/儿童用药/上市许可持有人/生产企业/作用类别）。

网页版**拿不到**的字段（在 `matchNote` 里声明缺失，不编造）：药物相互作用（多数条目；个别嵌在药代尾部会被提取器拆出）、贮藏、有效期、批准文号。表格类内容（如相互作用表、敏感性菌株表）文本化会丢结构，发现时在 `matchNote` 标注。

## 5. 自检（每批必做，防"生成的数据"）

爬完后当场验证，两步：

1. **指纹抽查**：从草稿正文挑 2~3 个独特字符串（优先挑只有真实页面才会有的东西：具体实验数值、罕见辅料名、源页错别字如 immunoddficiency/高血庄），实时重抓页面确认存在；
2. **逐字比对**：现场用同一提取函数重提一段（如「成份」），与草稿该段做严格相等比较，长度与内容都要一致。

任一失败 → 站点可能改版或提取器出错，停止并报告，勿继续产出草稿。

## 6. 收尾

1. 更新总账 `data/crawled-总账.md`：在结果表追加行（drugId/命中条目/dxyId/版本/标签/规格核验/缺失注意），批次信息有变化时同步更新头部；
2. 入库：`cd app/packages/api && pnpm run db:import-crawled`（幂等）。草稿以 `crawled` 状态写入 `package_inserts`（行 ID `pi-{drugId}@{version}`），无 `drug_master` 行的药自动建档（同为 crawled）；同版本已有 mock/reviewed 行则跳过不覆盖（write-once）；重跑自动跳过已入库版本。`--dry-run` 预演、`--status` 对账；逐药动作台账追加在 `data/import-log.jsonl`；
3. 汇报时明示：新增几条、跳过几条、缺失字段清单、人工核对待办（补 interactions/storage/批准文号、结构化 dosage、核对后改 reviewed）；
4. 参考 `references/field-mapping.md` 回答"某字段对应哪列"或写导入脚本时的映射问题。

## 附：本流程踩过的坑（勿再踩）

- 提取器的四个修复（空白折叠、h2 段名去重、相互作用句中误切、作用类别混入适应症）都编码在 `references/extract-fn.js`，改动前先读文件头注释；
- DXY 搜索 `type=drug` 只返回说明书类结果，页面上的 tab 链接有 `/pc/pc/` 双前缀 bug，不要照抄链接，自己拼 `/pc/search?keyword=…&type=drug`；
- evaluate 双参数会失败，只传单对象；
- 「见 」悬空字样是原页【药物相互作用】交叉引用占位，属原文，保留。
