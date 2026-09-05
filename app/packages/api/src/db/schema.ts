/**
 * 安心用药 · 数据资产三库 Schema（PRD V2 §13 / 技术方案 §4）
 *
 * 资产域（Mock，与代码分离，write-once）：
 *   drug_master       药品身份库 —— 识药匹配对象，schema 对齐 NMPA
 *   package_inserts   说明书库   —— 身份组 + 内容组 + 来源三件套
 *   interaction_rules 相互作用库 —— {drugIds[], level 四级枚举, note, source}
 *
 * 核心不变式：药品主数据库 ≠ 用户药箱；条目禁止模型生成。
 */
import { pgTable, text, integer, jsonb, timestamp, boolean, varchar } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// drug_master · 药品身份库
// ---------------------------------------------------------------------------
export const drugMaster = pgTable('drug_master', {
  id: text('id').primaryKey(),                        // 条目 ID，如 mock-hycosan-01

  // ── 身份快照（NMPA 对齐）──
  genericName: text('generic_name').notNull(),           // 通用名
  brandName: text('brand_name'),                         // 商品名
  specification: text('specification').notNull(),        // 规格，如 0.1%（10mL：10mg）
  form: text('form').notNull(),                          // 剂型，如 滴眼液、片剂
  manufacturer: text('manufacturer'),                    // 生产企业
  approvalNumber: text('approval_number'),               // 批准文号 / 进口注册证号（平局裁判）
  otcClass: text('otc_class'),                           // OTC 分类：OTC甲 / OTC乙 / null=处方药
  insuranceClass: text('insurance_class'),               // 医保分类：医保甲类 / 医保乙类 / 自费
  isOriginal: boolean('is_original').default(false),     // 原研药标识

  // ── 数据治理 ──
  curationStatus: varchar('curation_status', { enum: ['mock', 'crawled', 'reviewed'] })
    .notNull()
    .default('mock'),                                    // mock=演示 / crawled=爬虫抓取 / reviewed=人工核对通过
  dataSource: text('data_source'),                       // 数据来源描述
  note: text('note'),                                    // 备注（如多规格陷阱演示条目）

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// package_inserts · 说明书库
// 一条 = 一支药的说明书；字段分三组：身份组 / 内容组 / 来源组
// ---------------------------------------------------------------------------
export const packageInserts = pgTable('package_inserts', {
  id: text('id').primaryKey(),                           // 自动生成的 UUID
  drugId: text('drug_id').notNull(),                     // → drug_master.id

  // ── 身份组（冗余快照，方便按键取数时免 JOIN）──
  genericName: text('generic_name').notNull(),
  brandName: text('brand_name'),
  form: text('form'),
  specification: text('specification'),

  // ── 内容组（说明书正文，标准分段结构化）──
  indication: text('indication'),                        // 适应症
  components: text('components'),                        // 成份
  dosage: jsonb('dosage'),                               // 用法用量（结构化 JSON，规则引擎锚点）
  contraindications: jsonb('contraindications'),         // 禁忌（字符串数组）
  adverseReactions: text('adverse_reactions'),           // 不良反应
  precautions: jsonb('precautions'),                     // 注意事项（字符串数组）
  interactions: text('interactions'),                    // 药物相互作用
  pharmacology: text('pharmacology'),                    // 药理作用
  pharmacokinetics: text('pharmacokinetics'),            // 药代动力学
  storage: text('storage'),                              // 贮藏
  afterOpeningDays: integer('after_opening_days'),       // 开封后有效天数

  // ── 来源组（"生产日期"三件套）──
  source: text('source'),                                // 来源描述
  version: text('version'),                              // 版本号
  sourceUrl: text('source_url'),                         // 来源 URL

  // ── 数据治理 ──
  curationStatus: varchar('curation_status', { enum: ['mock', 'crawled', 'reviewed'] })
    .notNull()
    .default('mock'),
  curationNote: text('curation_note'),                   // 整理备注

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// interaction_rules · 相互作用规则库
// 条目内容只能抄录，禁止由模型推理生成（PRD V2 §7.8.1）
// ---------------------------------------------------------------------------
export const interactionRules = pgTable('interaction_rules', {
  id: text('id').primaryKey(),
  drugIds: jsonb('drug_ids').notNull(),                  // 涉及的药品 ID 数组 → drug_master.id[]
  level: varchar('level', { enum: ['禁忌', '慎用', '需监测', '注意'] }).notNull(),
  note: text('note').notNull(),                          // 相互作用说明
  source: text('source').notNull(),                      // 来源（说明书相互作用段/修订公告/指南）

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
