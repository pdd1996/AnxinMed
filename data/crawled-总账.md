# 爬虫批次总账 · 丁香园用药助手（2026-09-05）

> 依据 PRD §13.3 数据整理流程生成。草稿批次：mock 清单 9 药 + 6 条演示备用草稿（拜新同 + 5 感冒药，未入 mock 清单），
> 全部通过浏览器会话抓取，`curationStatus = crawled`。草稿经 `pnpm run db:import-crawled`（api 包）以 **crawled 状态入库（staging，幂等）**，
> 逐药动作见 `import-log.jsonl`；**升 reviewed（封版）前必须走人工核对闸门**（write-once）。
> 后续批次按 `.agents/skills/drug-crawler/SKILL.md` 的流程执行，每批在此表追加行。
>
> **drugId 命名规则（2026-09-05 定稿，全量生效）**：全部条目统一 `drug-` 前缀（单方 `drug-{通用名}-{规格}`，中成药/复方 `drug-{商品名拼音}`），
> 与数据来源解耦——来源由 sourceUrl/curationStatus 表达，前缀含来源（如 dxy-）会在正式版换 NMPA 数据时失效或迫使改主键。
> 历史条目已于同日全部迁移：6 条演示备用 + 9 条原 mock 清单条目（demo/server/mock-data.json 内 ID 同步更新），脚本
> `oneoff-2026-09-05-rename-drug-ids.ts` 与 `oneoff-2026-09-05-rename-legacy-mock-ids.ts`（幂等，留档）。

## 批次信息

- 抓取时间：2026-09-05
- 抓取方式：浏览器会话内 fetch（详情页为 Next.js SSR HTML，免登录可读大部分段落；匿名 HTTP 请求被 429 登录墙拦截）
- 搜索入口：`/pc/search?keyword={kw}&type=drug`；详情：`/pc/drug/{dxyId}`
- 草稿位置：`data/crawled/{drugId}.json`
- 字段映射：sections 段名 → `package_inserts` 列，见下表

## 结果一览

| drugId | 命中条目 | dxyId | 版本(version) | 标签 | 规格核验 | 缺失/注意 |
|---|---|---|---|---|---|---|
| drug-hycosan-01 | HYCOSAN（玻璃酸钠滴眼液）-海露 | pFa0Fp6vlHtPoUY5VhIOnig | dxy-2022-12-28 | OTC甲/医保乙类 | ✅ 0.1% | interactions/贮藏缺失；与人工首单逐字一致（黄金对照） |
| drug-hycosan-02 | 玻璃酸钠滴眼液（海露） | pWoE-Qm8kcqaVR_uAB7Aguw | dxy-2024-12-24 | Rx/医保乙类 | ✅ 0.2%（10mL:20mg） | 2024 新版为**处方药**（与 0.1% 的 OTC甲 不同，真实差异）；注意事项含"开封后 6 个月内使用"→ afterOpeningDays=180 候选 |
| drug-amlodipine-5 | 络活喜（苯磺酸氨氯地平片） | pZCC-p2xsyZHSmUyaEaI7RQ | dxy-2024-04-23 | Rx/医保甲类/基药 | ✅ 5mg（5/10 双规合并页） | interactions 以 strong 嵌在药代尾部，已拆出；「见 」为原页交叉引用占位 |
| drug-atorvastatin-20 | 立普妥（阿托伐他汀钙片） | pdyLw77A8Uq0-c9NhrX7HFw | dxy-2024-11-01 | Rx/医保乙类/基药 | ✅ 20mg（10/20/40 三规合并页） | **相互作用段表格（表5/表6）内容丢失**，人工补；「化学成份」与「成份」两段并存，取后者 |
| drug-metformin-500 | 格华止（盐酸二甲双胍片） | pA3KFIF6qQIAfonuwCfSyoA | dxy-2024-04-22 | Rx/医保甲类/基药 | ✅ 0.5g（注意缓释片 0.5g / 0.85g 是独立条目） | 无 interactions 段；注意事项含联用低血糖警示可整理 |
| drug-glipizide-5 | 美吡达（格列吡嗪片） | pn21yTR55PRpqqww44q4PuQ | dxy-2020-07-01 | Rx/医保甲类/基药 | ✅ 5mg | 无 interactions 段 |
| drug-omeprazole-20 | 洛赛克（奥美拉唑肠溶胶囊） | pXTyvF3oczykJCpf4tUafTg | dxy-2019-08-22 | Rx/医保甲类/基药 | ✅ 20mg 肠溶胶囊（与 mock 剂型一致） | 无独立 interactions 段；相互作用信息在注意事项 5-8 条（氯吡格雷/圣约翰草/甲氨蝶呤/阿扎那韦） |
| drug-cefuroxime-axetil-025 | 达力新（头孢呋辛酯片） | p_1L1hgVhxe1WVSGY1svT7w | dxy-2025-08-26 | Rx/医保甲类/基药 | ✅ 0.25g（注意 0.125g 片/胶囊为独立条目） | 药理段含敏感性菌株表格，结构丢失；无 interactions 段 |
| drug-levofloxacin-eye-01 | 可乐必妥（左氧氟沙星滴眼液） | pF0WdbkpEHOxlMSGGffkmvQ | dxy-2020-12-09 | Rx/医保甲类/基药 | ✅ 5mL:24.4mg（=mock 0.5% 浓度写法） | 不良反应段含表格，结构丢失；无 interactions 段 |
| drug-nifedipine-30 | 拜新同（硝苯地平控释片） | p_GL3pSu7uaNtNfxvaQdhZw | dxy-2025-02-12 | Rx/医保甲类/基药 | ⚠️ 30mg 单规格条目 | **skill 验证草稿，未入 mock 清单，核对时定去留**；存在 30mg;60mg 合并条目（pMK4X7ndp5Io9VLMTft9Qlg）待人工裁决；interactions 信息在注意事项第 6 条（CYP3A4 清单）与禁忌段（利福平）；两段含表格 |
| drug-acetaminophen-650 | 泰诺林（对乙酰氨基酚缓释片） | ptf-g02FV1paFNhp-okw7tA | dxy-2022-05-05 | OTC乙/医保乙类 | ✅ 0.65g 缓释片（另有片 0.5g/混悬滴剂/口服液等 4 剂型独立条目） | **感冒药演示备用批次**；interactions 素材在注意事项第 7 条（不得与复方感冒药同服）/第 10 条（禁酒）/第 20-21 条（过量肝毒性+N-乙酰半胱氨酸解救）；源页错别字「惠者」「思者」原样保留 |
| drug-ibuprofen-300 | 布洛芬缓释胶囊（芬必得） | p5PZ3g80XfHdSM7ITfP8njQ | dxy-2025-10-01 | OTC甲/医保乙类/基药 | ⚠️ 0.3g 经典装（另存 0.4g 条目 pN-Jcnj6KJL6wL1gD_NYdTw 待裁决；乳膏/咀嚼片等剂型独立） | **感冒药演示备用批次**；interactions 素材：禁忌「其他 NSAID/COX-2 抑制剂禁用」、注意事项「与利尿剂/ACEI 合用肾毒性风险最高」（与本库降压药人群直接相关）、「高血压慎用」 |
| drug-compound-pseudoephedrine | 复方盐酸伪麻黄碱缓释胶囊（新康泰克） | pmo_stu3V-Nxiu1ApyOMnSg | dxy-2025-10-01 | **Rx**/医保乙类 | ✅ 90mg:4mg 经典蓝装（品牌下另有麻敏维C/氨麻美敏片II/鼻喷雾等 4 产品线独立条目） | **感冒药演示备用批次**；注意实际为处方药（伪麻黄碱受管控）；interactions 素材：注意事项第 4 条「利血平等抗高血压作用可被拟交感神经药降低，β-阻滞剂有相互作用」+禁忌「严重高血压禁用/MAOI 禁用」——与降压药联用冲突演示的核心条目 |
| drug-ganmaoling-999 | 感冒灵颗粒（999） | pAhaat4ycRWBIbiTItUhozw | dxy-2023-10-16 | OTC甲 | ⚠️ 10g（DXY 存在两条同标题重复条目 pz3BeXPlxpgoeBHp6F3KZkg，待人工比对；复方感冒灵 14g 为不同药品） | **感冒药演示备用批次**；⭐ 重复用药演示核心：中成药名义下每袋含对乙酰氨基酚 0.2g+咖啡因+氯苯那敏，与泰诺林同服即叠加过量；注意事项「不能同时服用与本品成份相似的其他抗感冒药」；中成药无药理/药代段（正常） |
| drug-lianhua-qingwen | 连花清瘟胶囊（连花） | pxuAnKDSS3ZhIe3M54T46ow | dxy-2021-09-17 | OTC甲/医保甲类/基药 | ✅ 0.35g 胶囊（另有颗粒 6g/片 0.35g 独立条目） | **感冒药演示备用批次**；纯中成药 13 味（不含西药成分，与感冒灵对照）；注意事项「高血压、心脏病患者慎用」「风寒感冒者不适用」；中成药无药理/药代段（正常） |

## 感冒药演示备用批次（2026-09-05，5 条）——批次自检记录

- 指纹抽查 10/10 通过：泰诺林源页错别字「惠者」与 N-乙酰半胱氨酸解救段、芬必得「肠膈膜病」、新康泰克 PRES/RCVS 段与利血平降压互作句、感冒灵「三叉苦、金盏银盘」组份、连花清瘟「热毒袭肺证」等独特字符串实时重抓全部命中；
- 逐字比对通过：新康泰克「成份」段现场重提与落盘文件 271 字符完全一致；
- 5 条草稿均标注「未入 mock 清单」，人工核对闸门时决定去留；interactions/storage 字段均需人工整理（网页版缺失），素材位置已在各自 matchNote 标明。

## 网页版（免登录）字段可得性 —— 对 schema 的映射结论

| DXY 网页段落 | package_inserts 列 | 可得性 |
|---|---|---|
| 成份 | components | ✅ |
| 规格 | specification | ✅（多为「含量/浓度」，包装规格如 ×7片 需人工补） |
| 适应症 | indication | ✅ |
| 用法用量 | dosage（结构化需另行解析，草稿为原文） | ✅ 原文 |
| 不良反应 | adverseReactions | ✅（偶有表格丢失） |
| 禁忌 | contraindications | ✅ |
| 注意事项 | precautions | ✅ |
| 药理作用 | pharmacology | ✅ |
| 药代动力学 | pharmacokinetics | ✅ |
| 药物相互作用 | interactions | ⚠️ **多数条目网页版不展示**；个别嵌在药代尾部（已做拆分探测） |
| 贮藏 / 有效期 / 批准文号 | storage / — / approvalNumber | ❌ 网页版不展示（批准文号走 NMPA/实物核对，PRD §8.2 已定为平局裁判而非通过条件） |
| 儿童用药 / 上市许可持有人 / 生产企业 | — / drug_master.manufacturer | ✅（有则抓） |
| Rx/OTC甲/OTC乙/医保甲乙类/基本药物 标签 | otcClass / insuranceClass | ✅ |
| 核准日期/修改日期 | source/version | ✅ version=`dxy-{修改日期 ISO}` |

## 与人工首单（海露 0.1%，2026-09-04）的对照

爬虫输出与人工整理记录在 成份/禁忌/用法用量/不良反应/注意事项/药理作用/药代动力学 七段逐字一致，
版本号一致（dxy-2022-12-28）。人工记录中的 `storage`（密封保存）、`afterOpeningDays`、`interactions`
为人工从注意事项/实物补齐——与本批"网页版缺失字段留空待人工补"的处理一致。

## 人工核对闸门待办

1. 逐条核对 sections 原文与 sourceUrl 页面一致性（防站点改版/截断）；
2. 补 interactions：各药注意事项段 + 药监局修订公告（禁止模型生成条目内容，PRD §7.8.1）；
3. 补 storage / afterOpeningDays（实物或说明书原文）；
4. 批准文号走 NMPA 交叉核对后写入 drug_master.approvalNumber；
5. 结构化 dosage（route/frequencyPerDay/dosePerUse/maxFrequencyPerDay）按 PRD §13.2 `{value,unit}` 规则填；
6. 核对通过 → `curationStatus: reviewed`，来源表封版（write-once，只追加不覆盖）。

## 入库记录（摘要；逐药逐次动作见 `import-log.jsonl`）

- **2026-09-05 首次入库**（`cd app/packages/api && pnpm run db:import-crawled`，seed 基线后运行）：
  - `package_inserts` 新增 **14** 行（`pi-{drugId}@{version}`，curationStatus=crawled）；drug-hycosan-01 因同版本人工首单（mock 行 `pi-drug-hycosan-01`）已存在，按 write-once 跳过；
  - `drug_master` 自动建档 **6** 行（感冒药备用批次 5 + 拜新同），身份字段为 dxyTitle 启发式解析，均为 crawled 状态待核对；原 9 条 mock 行未动；
  - `interaction_rules` 未触碰（条目只能人工抄录，PRD §7.8.1）；
  - 幂等已验证：立即重跑 → 新增 0 / 刷新 0 / 跳过 15。
- 语义约定：**入库 ≠ 核对通过**。crawled 行是 staging（dosage 存 `{raw}` 原文、禁忌/注意事项为整段单元素数组，结构化是人工核对步骤）；mock/reviewed 行永不被爬虫导入覆盖；重爬出新版本（version 变化）会追加新行而非覆盖旧行。

## 数据来源审计与演示数据清理（db:audit）

「真实 / 演示」**不靠猜，按行内来源列判定**。工具：`cd app/packages/api && pnpm run db:audit`（逐行标注 + 汇总；`--purge-mock` 列可清理行，加 `--confirm` 执行删除）。

| 判定 | 依据（行内自带的来源信息） |
|---|---|
| 说明书真实 | `package_inserts.source` 含「丁香园」（爬虫草稿或人工首单） |
| 说明书演示 | `source` 含「本地演示 / 本地 Mock」（demo 虚构内容，未经整理流程） |
| 身份库真实 | `drug_master.dataSource` 含「丁香园」（爬虫建档） |
| 身份库演示 | `dataSource` 为 demo 路径（demo seed 档案，商品名多含「（演示数据）」占位） |
| 相互作用演示 | `interaction_rules.source` 含「演示」（正式条目待人工抄录） |

- **2026-09-05 清理**：删除 3 行演示说明书（络活喜/达力新/可乐必妥的 `mock-1`、`demo-local-1` 版本——同药均已有真实 DXY 行），台账 `import-log.jsonl` 记为 `purged-mock`。清理后 package_inserts **15/15 全部真实**（14 爬虫 + 海露 0.1% 人工首单）。
- **演示数据保留项及原因**：
  - `drug_master` 9 条 demo 档案：被真实说明书行按 drugId 引用，不能删；身份字段（商品名/规格）替换为真实值走人工核对闸门，不自动改；
  - `interaction_rules` 3 条演示抄录：正式条目只能人工从说明书/公告抄录（PRD §7.8.1 禁止模型生成），待真条目整理后替换。
- **今后新增数据全部为真实来源**：爬虫流程只产出 DXY 抄录草稿，`db:import-crawled` 只写 `crawled` 状态的真实抄录，不再新增任何演示行；`db:seed` 仅用于重建演示基线（会带回演示行，跑后需再清理，seed 输出已有警告）。
