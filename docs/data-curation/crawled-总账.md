# 爬虫批次总账 · 丁香园用药助手（2026-09-05）

> 依据 PRD §13.3 数据整理流程生成。本批为**爬虫草稿批次**：9 个 mock 药品，全部通过浏览器会话抓取，
> `curationStatus = crawled`。**入库前必须走人工核对闸门**（核对通过后改为 `reviewed`，write-once）。

## 批次信息

- 抓取时间：2026-09-05
- 抓取方式：浏览器会话内 fetch（详情页为 Next.js SSR HTML，免登录可读大部分段落；匿名 HTTP 请求被 429 登录墙拦截）
- 搜索入口：`/pc/search?keyword={kw}&type=drug`；详情：`/pc/drug/{dxyId}`
- 草稿位置：`docs/data-curation/crawled/{drugId}.json`
- 字段映射：sections 段名 → `package_inserts` 列，见下表

## 结果一览

| drugId | 命中条目 | dxyId | 版本(version) | 标签 | 规格核验 | 缺失/注意 |
|---|---|---|---|---|---|---|
| mock-hycosan-01 | HYCOSAN（玻璃酸钠滴眼液）-海露 | pFa0Fp6vlHtPoUY5VhIOnig | dxy-2022-12-28 | OTC甲/医保乙类 | ✅ 0.1% | interactions/贮藏缺失；与人工首单逐字一致（黄金对照） |
| mock-hycosan-02 | 玻璃酸钠滴眼液（海露） | pWoE-Qm8kcqaVR_uAB7Aguw | dxy-2024-12-24 | Rx/医保乙类 | ✅ 0.2%（10mL:20mg） | 2024 新版为**处方药**（与 0.1% 的 OTC甲 不同，真实差异）；注意事项含"开封后 6 个月内使用"→ afterOpeningDays=180 候选 |
| mock-amlodipine-5 | 络活喜（苯磺酸氨氯地平片） | pZCC-p2xsyZHSmUyaEaI7RQ | dxy-2024-04-23 | Rx/医保甲类/基药 | ✅ 5mg（5/10 双规合并页） | interactions 以 strong 嵌在药代尾部，已拆出；「见 」为原页交叉引用占位 |
| mock-atorvastatin-20 | 立普妥（阿托伐他汀钙片） | pdyLw77A8Uq0-c9NhrX7HFw | dxy-2024-11-01 | Rx/医保乙类/基药 | ✅ 20mg（10/20/40 三规合并页） | **相互作用段表格（表5/表6）内容丢失**，人工补；「化学成份」与「成份」两段并存，取后者 |
| mock-metformin-500 | 格华止（盐酸二甲双胍片） | pA3KFIF6qQIAfonuwCfSyoA | dxy-2024-04-22 | Rx/医保甲类/基药 | ✅ 0.5g（注意缓释片 0.5g / 0.85g 是独立条目） | 无 interactions 段；注意事项含联用低血糖警示可整理 |
| mock-glipizide-5 | 美吡达（格列吡嗪片） | pn21yTR55PRpqqww44q4PuQ | dxy-2020-07-01 | Rx/医保甲类/基药 | ✅ 5mg | 无 interactions 段 |
| mock-omeprazole-20 | 洛赛克（奥美拉唑肠溶胶囊） | pXTyvF3oczykJCpf4tUafTg | dxy-2019-08-22 | Rx/医保甲类/基药 | ✅ 20mg 肠溶胶囊（与 mock 剂型一致） | 无独立 interactions 段；相互作用信息在注意事项 5-8 条（氯吡格雷/圣约翰草/甲氨蝶呤/阿扎那韦） |
| mock-cefuroxime-axetil-025 | 达力新（头孢呋辛酯片） | p_1L1hgVhxe1WVSGY1svT7w | dxy-2025-08-26 | Rx/医保甲类/基药 | ✅ 0.25g（注意 0.125g 片/胶囊为独立条目） | 药理段含敏感性菌株表格，结构丢失；无 interactions 段 |
| mock-levofloxacin-eye-01 | 可乐必妥（左氧氟沙星滴眼液） | pF0WdbkpEHOxlMSGGffkmvQ | dxy-2020-12-09 | Rx/医保甲类/基药 | ✅ 5mL:24.4mg（=mock 0.5% 浓度写法） | 不良反应段含表格，结构丢失；无 interactions 段 |

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
