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
  bodyImageRef: text('body_image_ref'),                  // 预留列，qwen3.5-ocr 行级契约下恒 null（ADR #16，原图不落盘）
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

// ===========================================================================
// 咨询与风险留痕（M3-T1 · PRD §7.5）——AI 咨询服务的两张只写表
// 医生端洞察（M3-T3）消费本组表出「风险事件流」「咨询历史摘要」，故 T1 就落表结构。
// 不变式：
//   1) question / detail 落库前经 sanitizeScan / redactForLog（L3 出口约束），永不带原文 PII；
//   2) 一次咨询 = 一行 consult_logs；若被守门拦截（L4/L3/manual-gate），额外一行 risk_events；
//   3) L1/L2 正常回答不进 risk_events（不算风险事件）；只 L3/L4 与 manual-gate 触发。
// ===========================================================================

// ---------------------------------------------------------------------------
// consult_logs · 咨询历史留痕（每次 POST /api/consult 一行）
// 用途：医生端「咨询历史摘要」读库（M3-T3）+ 用户端「最近咨询」自查
// ---------------------------------------------------------------------------
export const consultLogs = pgTable('consult_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),                     // → users.id（应用层过滤）
  question: text('question').notNull(),                  // 用户提问，落库前过 scrubWithPatterns（L3 出口）
  drugIds: jsonb('drug_ids'),                            // string[]：咨询涉及的 drugs.id（用户域）；空数组表示无药上下文
  riskLevel: varchar('risk_level', { enum: ['L1', 'L2', 'L3', 'L4'] }).notNull(),
  /**
   * 咨询结果状态（守门与生成路径的联合出口）：
   *   answered       L1 正常回答（LLM 或降级规则拼装）
   *   limited        L2 剂量过滤后回答（stripDosageAdvice 触发）
   *   refused        L3 拒答（停药/换药/剂量调整）
   *   emergency      L4 紧急信号（引导急救）
   *   manual-gate    manual 档药品拒绝进入个体化解释（接口层拒绝）
   *   no-source      本地说明书库未命中（且医疗搜索默认关）
   *   ai-unavailable Baichuan 不可用 → 502/降级
   *   data-answered  患者数据查询，L1，未调 LLM（意图路由命中只读工具直查库）
   */
  status: varchar('status', {
    enum: ['answered', 'limited', 'refused', 'emergency', 'manual-gate', 'no-source', 'ai-unavailable', 'data-answered'],
  }).notNull(),
  /** 被拦截的档位（answered/limited 为 null）；供医生端「咨询被拦截 N 次」快速过滤。 */
  blockedAt: varchar('blocked_at', { enum: ['L4', 'L3', 'manual-gate'] }),
  notice: text('notice'),                                // L2 过滤提示 / no-source 兜底提示 / l0Notice（manual 档）
  citations: jsonb('citations'),                         // Citation[]：{ drugName, source, version } 三件套（PRD §7.5）
  sectionsSnapshot: jsonb('sections_snapshot'),          // 结构化回答快照（summary/keyPoints/risks/nextAction/warning），供 M3-T3 摘要引用

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// risk_events · 风险事件流（L4/L3/manual-gate 触发；一次拦截 = 一行）
// 用途：医生端「风险事件流」（M3-T3）按 level/type 聚合，L4 红/L3 橙
// ---------------------------------------------------------------------------
export const riskEvents = pgTable('risk_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),                     // → users.id
  /** 事件级别：L4 紧急 / L3 拒答 / manual-gate（药品未经 OCR 确认，拒绝个体化解释） */
  level: varchar('level', { enum: ['L4', 'L3', 'manual-gate'] }).notNull(),
  /** 事件类型（细分口径，供医生端聚合）：
   *   emergency        L4 命中紧急关键词
   *   refused          L3 命中停/换药/剂量调整
   *   manual-blocked   manual 档药品被接口层拒绝
   */
  type: varchar('type', { enum: ['emergency', 'refused', 'manual-blocked'] }).notNull(),
  drugId: text('drug_id'),                               // → drugs.id（触发拦截的咨询对象，可空）
  consultLogId: text('consult_log_id'),                  // → consult_logs.id（同次咨询）
  detail: jsonb('detail'),                               // { matchedKeyword?, questionRedacted } 命中关键词 + 脱敏后问题片段（L3 出口）
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),  // 事件发生时间（前端按此排序）

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// insight_ask_logs · 医生端问答留痕（T7 · ADR #17 保留项：漏判留痕作为工具集扩充依据）
// 用途：POST /api/insight/ask 每问一行；intent 为空 = 正则漏判（长尾）——漏判率高时优先
//       扩语义工具，绝不放开 SQL（ADR #17 禁 text-to-SQL）
// ---------------------------------------------------------------------------
export const insightAskLogs = pgTable('insight_ask_logs', {
  id: text('id').primaryKey(),
  /** 患者维度提问时的患者 id（→ users.id）；null = 队列维度提问 */
  patientId: text('patient_id'),
  /** 医生提问，落库前过 scrubWithPatterns（L3 出口约束，同 consult_logs 纪律） */
  question: text('question').notNull(),
  /** 回答路径：data = 固定问法命中意图，直查库（0 次 LLM）；llm = 长尾叙述（百川 + 守门） */
  mode: varchar('mode', { enum: ['data', 'llm'] }).notNull(),
  /** 命中的意图（队列工具名或患者查询意图）；null = 漏判（扩工具的依据） */
  intent: text('intent'),
  /** 实际执行的工具名（adherence_distribution / patient_cohort / …；data 路径必填） */
  toolUsed: text('tool_used'),
  /** 结构化回答快照（summary/keyPoints/risks/nextAction/warning） */
  answerSnapshot: jsonb('answer_snapshot'),
  citations: jsonb('citations'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
