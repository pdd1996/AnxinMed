/**
 * 安心用药 · 数据库 Schema（10 张表 = 资产域三库 + 用户域七表）
 *
 * PRD V2 §12.3/§13 · 技术方案 §4 · 执行总纲 §3.2。
 *
 * 资产域（Mock，与代码分离，write-once）：
 *   drug_master       药品身份库 —— 识药匹配对象，schema 对齐 NMPA
 *   package_inserts   说明书库   —— 身份组 + 内容组 + 来源三件套
 *   interaction_rules 相互作用库 —— {drugIds[], level 四级枚举, note, source}
 *
 * 用户域（全部带 userId，多用户边界从第一天贯通）：
 *   users / drugs（药箱）/ plans（计划）/ records（记录）/ sources（来源）/ health_profiles（健康信息）
 *   drafts（录入草稿，M2-T6）—— 拍照录入管线产物，确认页唯一闸门前的暂存区
 *
 * 核心不变式：药品主数据库 ≠ 用户药箱；医嘱只抄录不生成；条目禁止模型生成。
 */
import { pgTable, text, integer, jsonb, timestamp, boolean, varchar, date } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// drug_master · 药品身份库
// ---------------------------------------------------------------------------
export const drugMaster = pgTable('drug_master', {
  id: text('id').primaryKey(),                        // 条目 ID，如 drug-hycosan-01

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

// ===========================================================================
// 用户域六表（全部带 userId，多用户边界从第一天贯通）
// 执行总纲 §3.2 / 技术方案 §4 / PRD §12.3。
// 与资产域一致：表间引用用普通列（应用层按 userId 过滤 + resolveUser 注入），不设 DB 外键；
// id 为应用生成的 text 主键（与资产域风格一致）；日期用 date（ISO 字符串传输）。
// ===========================================================================

// ---------------------------------------------------------------------------
// users · 用户（Better Auth 兼容形态；MVP seed 演示用户，P1 接手机号验证码登录 —— ADR #11）
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),                                    // 姓名
  email: text('email').unique(),                         // 邮箱（唯一，Better Auth 兼容）
  phone: text('phone'),                                  // 手机号（P1 验证码登录预留）

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// drugs · 用户药箱（≠ drug_master 资产库；确认后拷贝的个人档案）
// 不变式：一切写入必须已过用户确认或手动录入（执行总纲 §3.2.1）
// ---------------------------------------------------------------------------
export const drugs = pgTable('drugs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),                     // → users.id（应用层过滤）

  // ── 身份快照（从 drug_master 唯一匹配拷贝，或用户手填）──
  genericName: text('generic_name').notNull(),           // 通用名
  brandName: text('brand_name'),                         // 商品名
  specification: text('specification'),                  // 规格
  form: text('form'),                                    // 剂型
  manufacturer: text('manufacturer'),                    // 厂家

  drugMasterId: text('drug_master_id'),                  // → drug_master.id（手动建档为 null）
  confirmStatus: varchar('confirm_status', { enum: ['ocr_matched', 'transcribed', 'manual'] })
    .notNull(),                                          // 确认状态三档（执行总纲 §2.5）

  stock: jsonb('stock'),                                 // { value: number, unit: string }（DOSE_UNITS 见 shared）
  openedAt: date('opened_at'),                           // 开封日期
  expiry: date('expiry'),                                // 效期

  sourceId: text('source_id'),                           // → sources.id
  confirmedAt: timestamp('confirmed_at').defaultNow().notNull(),  // 确认时间

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// plans · 服药计划（怎么吃、吃多久、还在吃吗；续方 = 新计划行）
// 不变式：dose/frequency/duration 只能来自确认原文或用户自填，模型输出不得直写（§3.2.2）
// ---------------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),                     // → users.id
  drugId: text('drug_id').notNull(),                     // → drugs.id

  dose: jsonb('dose').notNull(),                         // { value: number, unit: string }
  frequency: integer('frequency').notNull(),             // 每日次数
  times: jsonb('times').notNull(),                       // string[]，"HH:MM" 服药时间点
  route: text('route'),                                  // 途径（口服/滴眼…）
  meal: text('meal'),                                    // 餐前/餐后等

  cycleType: varchar('cycle_type', { enum: ['closed', 'open', 'stock'] }).notNull(),  // 周期形态（§2.5）
  startDate: date('start_date').notNull(),               // 起（缺省=发药日，标 default）
  endDate: date('end_date'),                             // 止（开放式 open 为 null）
  status: varchar('status', { enum: ['active', 'paused', 'ended'] }).notNull().default('active'),

  source: varchar('source', { enum: ['prescription', 'manual'] }).notNull(),  // 来源标记（处方/手动）
  sourceId: text('source_id'),                           // → sources.id（反查来源）
  itemId: text('item_id'),                               // 反查来源内条目（PRD §7.3.1）

  tags: jsonb('tags'),                                   // Partial<Record<'dose'|'frequency'|'duration'|'times'|'startDate'|'endDate', TagKind>>（四类标注，TagKind 见 shared）

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// records · 服药记录（实际吃了没）
// pending = 无记录，运行期推导，不落库（§2.5）；防重复 planId+date+time 的 409 在 T7 接口面处理
// ---------------------------------------------------------------------------
export const records = pgTable('records', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),                     // → users.id
  planId: text('plan_id').notNull(),                     // → plans.id
  scheduledDate: date('scheduled_date').notNull(),       // 预定日期
  scheduledTime: text('scheduled_time').notNull(),       // 预定时间 "HH:MM"
  status: varchar('status', { enum: ['taken', 'skipped', 'later'] }).notNull(),  // 任务状态（§2.5）
  actedAt: timestamp('acted_at').defaultNow().notNull(), // 实际操作时间

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// sources · 来源（档案和计划从哪来；三层追溯锚点，PRD §7.2.5 / §12.3）
// ---------------------------------------------------------------------------
export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),                     // → users.id
  type: varchar('type', { enum: ['prescription', 'drug_box', 'manual'] }).notNull(),  // 来源类型
  bodyImageRef: text('body_image_ref'),                  // 正文裁剪图存储引用（脱敏 L0）
  whitelistFields: jsonb('whitelist_fields'),            // L1 白名单字段快照
  prescriptionNo: text('prescription_no'),               // 处方号
  confirmTrace: jsonb('confirm_trace'),                  // { confirmedAt, method, keyFieldsSnapshot }（确认留痕）
  sanitizeAudit: jsonb('sanitize_audit'),                // { [patternType]: count }（L2 审计，只记类型与次数）

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// health_profiles · 健康信息（用户背景；两入口一闸门，字段级来源标注，PRD §7.1.2）
// ---------------------------------------------------------------------------
export const healthProfiles = pgTable('health_profiles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),                     // → users.id
  fieldKey: text('field_key').notNull(),                 // 字段键（gender/birthMonth/allergy/…）
  value: text('value'),                                  // 字段值
  sourceMeta: jsonb('source_meta'),                      // { source: 'self_reported'|'prescription_confirmed', confirmedAt? }

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// drafts · 录入草稿（M2-T6）—— 拍照录入管线（①–⑦）产物，确认页（唯一闸门）前的暂存区
// 不变式：payload 内一切医嘱/身份字段均来自「抄录 + 回链校验 + 脱敏」或 needsManual 空缺，
//         绝不含模型猜测预填；原文（OCR/前记身份）只在管线内存流转，落库仅存脱敏白名单 + 裁剪几何。
// 一张处方笺含 N 个条目 → 拆 N 份草稿（PRD §7.2.1），各自独立确认。
// ---------------------------------------------------------------------------
export const drafts = pgTable('drafts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),                     // → users.id（应用层过滤）
  type: varchar('type', { enum: ['prescription', 'drug'] }).notNull(),       // 入口A 处方笺 / 入口B 药品
  status: varchar('status', { enum: ['pending', 'confirmed', 'rejected'] })
    .notNull()
    .default('pending'),                                 // 待确认 / 已确认 / 已拒绝
  payload: jsonb('payload').notNull(),                   // DraftPayload（档案/计划草稿+四类标注+冲突清单+健康建议+人工补清单+裁剪图引用）

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
