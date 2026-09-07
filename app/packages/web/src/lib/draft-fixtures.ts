/**
 * 确认页测试夹具（M2-T7，**仅测试使用**，勿被应用代码引用）。
 *
 * 形态对齐 api 管线真实产物（见 packages/api/src/__tests__/pipeline-run.test.ts 的合成处方笺用例），
 * 用 `satisfies DraftPayload` 让夹具本身受 hc<AppType> 推导出的契约约束 —— 契约变了这里先红。
 */
import type { DraftPayload } from '@/lib/draft'

const WHITELIST = {
  hospital: '萧山区第二人民医院（演示合成处方笺）',
  prescriptionNo: 'RX20260902001',
  date: '2026-09-02',
  department: '眼科',
  diagnosis: '干眼综合征',
  items: [
    {
      drugName: '玻璃酸钠滴眼液',
      specification: '0.1%（10mL：10mg）',
      quantity: '×1支',
      usage: '滴眼 每次1滴 每日4次 共7天',
    },
  ],
}

const HYCOSAN = {
  id: 'dm-hycosan',
  genericName: '玻璃酸钠滴眼液',
  brandName: '海露',
  specification: '0.1%（10mL:10mg）',
  form: '滴眼液',
  manufacturer: null,
  approvalNumber: null,
}

const IDENTITY = {
  genericName: '玻璃酸钠滴眼液',
  brandName: '海露',
  specification: '0.1%（10mL：10mg）',
  form: '滴眼液',
  manufacturer: 'EUSAN GmbH',
  otcFlag: true,
}

/** ① rx-normal：成功路径，全字段抄录（1 滴 × 4 次/日 × 7 天），范围校验 pass。 */
export const rxUniquePayload = {
  entry: 'A',
  type: 'prescription',
  layers: ['处方层'],
  whitelist: WHITELIST,
  needsManual: [],
  sanitizeAudit: {},
  fallbackStatus: 'not_needed',
  backlinkIntercepted: 0,
  bodyImageRef: null,
  item: WHITELIST.items[0],
  prescriptionNo: 'RX20260902001',
  identity: IDENTITY,
  match: { status: 'unique', match: HYCOSAN },
  drugDraft: {
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL：10mg）',
    form: '滴眼液',
    manufacturer: 'EUSAN GmbH',
    drugMasterId: 'dm-hycosan',
    confirmStatus: 'transcribed',
  },
  planDraft: {
    dose: { value: 1, unit: '滴' },
    frequency: 4,
    route: '滴眼',
    durationDays: 7,
    times: ['08:00', '12:00', '16:00', '20:00'],
    startDate: '2026-09-02',
    endDate: '2026-09-09',
    cycleType: 'closed',
    sigMissing: [],
    tags: {
      dose: 'transcribed',
      frequency: 'transcribed',
      duration: 'transcribed',
      times: 'assist',
      startDate: 'default',
      endDate: 'derived',
    },
  },
  conflicts: [],
  healthSuggestions: [{ field: '诊断', value: '干眼综合征', source: '处方笺抄录' }],
  interactions: { hits: [], coverageNote: null },
  dosageRange: { status: 'pass', issues: [], basis: '海露说明书 · v1' },
  degraded: null,
} satisfies DraftPayload

/** ② rx-redacted：用法行 + 处方日期缺失（回链拦截幻觉值）→ 人工补，planDraft 三项皆空、cycleType pending。 */
export const rxNeedsManualPayload = {
  entry: 'A',
  type: 'prescription',
  layers: ['处方层'],
  whitelist: { ...WHITELIST, date: '', items: [{ ...WHITELIST.items[0], usage: '' }] },
  needsManual: ['usage', 'date'],
  sanitizeAudit: { 手机号: 1 },
  fallbackStatus: 'unavailable',
  backlinkIntercepted: 1,
  bodyImageRef: null,
  item: { ...WHITELIST.items[0], usage: '' },
  prescriptionNo: 'RX20260902001',
  identity: IDENTITY,
  match: { status: 'unique', match: HYCOSAN },
  drugDraft: {
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL：10mg）',
    form: '滴眼液',
    manufacturer: 'EUSAN GmbH',
    drugMasterId: 'dm-hycosan',
    confirmStatus: 'transcribed',
  },
  planDraft: {
    dose: null,
    frequency: null,
    route: null,
    durationDays: null,
    times: [],
    startDate: '2026-09-06',
    endDate: null,
    cycleType: 'pending',
    sigMissing: ['dose', 'frequency'],
    tags: { times: 'assist', startDate: 'default' },
  },
  conflicts: [],
  healthSuggestions: [{ field: '诊断', value: '干眼综合征', source: '处方笺抄录' }],
  interactions: { hits: [], coverageNote: null },
  dosageRange: { status: 'none', issues: [], note: '说明书库未收录结构化用法用量，跳过范围校验' },
  degraded: null,
} satisfies DraftPayload

/** ③ rx-spec-conflict：库 0.2% vs 处方 0.1% → 冲突清单 + 2 候选，drugMasterId=null（系统不选边）。 */
export const rxConflictPayload = {
  ...rxUniquePayload,
  match: {
    status: 'conflict',
    candidates: [HYCOSAN, { ...HYCOSAN, id: 'dm-hycosan-02', specification: '0.2%（10mL:20mg）' }],
    conflict: {
      field: 'specification',
      extracted: '0.1%（10mL：10mg）',
      library: '0.1%（10mL:10mg） / 0.2%（10mL:20mg）',
      note: '规格不一致（库 0.1%（10mL:10mg） / 0.2%（10mL:20mg） vs 提取 0.1%（10mL：10mg）），请核对药品实物后选择',
    },
  },
  drugDraft: { ...rxUniquePayload.drugDraft, drugMasterId: null },
  conflicts: [
    {
      type: 'spec',
      field: 'specification',
      note: '规格不一致，请核对药品实物后选择',
      extracted: '0.1%（10mL：10mg）',
      library: '0.1%（10mL:10mg） / 0.2%（10mL:20mg）',
      candidates: [HYCOSAN, { ...HYCOSAN, id: 'dm-hycosan-02', specification: '0.2%（10mL:20mg）' }],
    },
  ],
  dosageRange: { status: 'none', issues: [], note: '身份未定，暂不做范围校验' },
} satisfies DraftPayload

/** ④ drug-box-labeled：入口B 药盒 + 医院标签层 → labelNotice，结构上无任何用法用量。 */
export const drugBoxPayload = {
  entry: 'B',
  type: 'drug',
  layers: ['医院标签层', '药盒原装层'],
  labelNotice: true,
  needsManual: [],
  identity: IDENTITY,
  match: { status: 'unique', match: HYCOSAN },
  drugDraft: {
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL：10mg）',
    form: '滴眼液',
    manufacturer: 'EUSAN GmbH',
    drugMasterId: 'dm-hycosan',
    confirmStatus: 'ocr_matched',
  },
  planDraft: null,
  conflicts: [],
  healthSuggestions: [],
  interactions: { hits: [], coverageNote: null },
  dosageRange: {
    status: 'none',
    issues: [],
    note: '药盒建档无医嘱用法用量，不做范围校验；手动创建计划时将按说明书校验',
  },
  degraded: null,
} satisfies DraftPayload

/** ⑤ 降级草稿（OCR 不可用）：全 needsManual、身份与医嘱全空。 */
export const degradedPayload = {
  entry: 'A',
  type: 'prescription',
  layers: ['处方层'],
  needsManual: ['items', 'drugName', 'specification', 'quantity', 'usage'],
  drugDraft: {
    genericName: '',
    brandName: null,
    specification: null,
    form: null,
    manufacturer: null,
    drugMasterId: null,
    confirmStatus: 'manual',
  },
  planDraft: null,
  conflicts: [],
  healthSuggestions: [],
  interactions: { hits: [], coverageNote: null },
  dosageRange: { status: 'none', issues: [] },
  degraded: { code: 'OCR_FAILED', message: 'OCR 服务不可用，请核对处方原文手动补全，或改用手动建档' },
} satisfies DraftPayload

/** 草稿 DTO 包装（GET /api/drafts/:id 的 draft 字段）。 */
export function mkDraft(payload: DraftPayload, overrides: Partial<{ id: string; status: 'pending' | 'confirmed' | 'rejected' }> = {}) {
  return {
    id: overrides.id ?? 'draft-demo-rx-001',
    type: payload.type,
    status: overrides.status ?? ('pending' as const),
    payload,
    createdAt: '2026-09-06T01:00:00.000Z',
    updatedAt: '2026-09-06T01:00:00.000Z',
  }
}
