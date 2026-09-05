# DXY 段落 → 数据库列映射

爬虫草稿（`data/crawled/*.json` 的 `sections`）与 `app/packages/api/src/db/schema.ts`
中 `package_inserts` / `drug_master` 的对应关系。写导入脚本或回答字段归属时查本表。

> 导入脚本已实现：`app/packages/api/src/db/import-crawled.ts`（`pnpm run db:import-crawled`，幂等 + 台账），
> 本表即其映射依据。未结构化字段的落库形态：dosage 存 `{raw: 原文}`；禁忌/注意事项存 `[整段]` 单元素数组。

## package_inserts（说明书库）

| 草稿字段 | DXY 网页段落 | 列 | 说明 |
|---|---|---|---|
| sections.适应症 | 适应症 | indication | 直接映射 |
| sections.成份 | 成份 | components | 直接映射 |
| sections.用法用量 | 用法用量 | dosage | ⚠️ 草稿存原文；入库前需按 PRD §13.2 结构化为 `{route, usual, frequencyPerDay, dosePerUse:{value,unit}, maxFrequencyPerDay:{value,unit,note}}`（规则引擎锚点，人工核对） |
| sections.禁忌 | 禁忌 | contraindications | ⚠️ 草稿为整段文本；列为 jsonb 字符串数组，拆分为人工核对步骤 |
| sections.不良反应 | 不良反应 | adverseReactions | 直接映射（表格类内容已丢结构，见 matchNote） |
| sections.注意事项 | 注意事项 | precautions | ⚠️ 同禁忌：text → 字符串数组需人工/规则拆分 |
| sections.药物相互作用 | 药物相互作用 | interactions | 多数条目网页版缺失，需人工从注意事项/药监局公告补（禁止模型生成） |
| sections.药理作用 | 药理作用 | pharmacology | 直接映射 |
| sections.药代动力学 | 药代动力学 | pharmacokinetics | 直接映射 |
| — | 贮藏 | storage | ❌ 网页版不展示 |
| — | — | afterOpeningDays | ❌ 网页版不展示；个别药注意事项有"开封后 X 个月内使用"（如海露 0.2% → 180 天候选），人工确认后填 |
| sourceUrl | — | source | 组装为 `丁香园用药助手（说明书修改日期 {revisionDate}）` |
| version | — | version | `dxy-{修订日期 ISO}` |
| sourceUrl | — | sourceUrl | `https://drugs.dxy.cn/pc/drug/{dxyId}` |
| curationStatus | — | curationStatus | 草稿恒为 `crawled`；人工核对通过后 `reviewed` |

## drug_master（药品身份库）

| 草稿字段 | DXY 网页来源 | 列 | 说明 |
|---|---|---|---|
| dxyTitle | h1 标题「商品名（通用名）」 | brandName / genericName | 标题格式解析，人工核对 |
| sections.规格 | 规格 | specification | DXY 写含量/浓度（如 0.1%、5mg；10mL:10mg）；mock 的包装规格（×7片）需人工合并 |
| dxyTitle / 条目形态 | — | form | 剂型来自标题括号内（片/滴眼液/肠溶胶囊） |
| sections.生产企业 | 生产企业 | manufacturer | 直接映射 |
| — | 批准文号 | approvalNumber | ❌ 网页版不展示；走 NMPA/实物核对（PRD §8.2 平局裁判） |
| tags 中 Rx | 头部标签 | — | Rx=处方药 → otcClass 留 null |
| tags 中 OTC甲/OTC乙 | 头部标签 | otcClass | 直接映射 |
| tags 中 医保甲类/医保乙类 | 头部标签 | insuranceClass | 直接映射 |
| tags 中 基本药物 | 头部标签 | — | schema 无对应列，仅在 matchNote 记录 |
| sections.上市许可持有人 | 上市许可持有人 | — | schema 无对应列，保留在草稿供参考 |
| sections.儿童用药 | 儿童用药 | — | schema 无对应列，保留在草稿 |

## 用户侧表（不来自爬虫）

plans / records / sources / 健康信息均为用户数据，与药品主数据库严格分离（PRD §12.3：
药品主数据库 ≠ 用户药箱）。爬虫产出只进资产域三库，永远不直接写用户数据。
