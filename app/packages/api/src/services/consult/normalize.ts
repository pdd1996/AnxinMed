/**
 * 语义归一化路由视图（M13-P2 T7 · docs/14 §4 T7）——纯函数，零 I/O。
 *
 * 边界（硬纪律）：
 * - **只生成「路由视图」**：字节级 question 送模型不变（prompt/fixture/证据均不因本层改变）；
 * - 不改变守门判定（L4/L3 在原始文本上判定，避免归一化绕过红线）；
 * - 只喂：意图路由（S1/S2 判定 + 候选打分）与对象判定（clarify 指代信号）；
 * - `ENABLE_ROUTE_NORMALIZE=false` 可整体回滚（默认开）。
 *
 * 两层：
 * 1. 字符级：NFKC（全半角/兼容字符）+ 空白折叠（含全角空格）——防「胸　痛」「剩　几片」逃逸；
 * 2. 语义层：口语同义词 → 规范路由词（还剩几天的药 → 还剩多少、快吃没了 → 快用完、
 *    老是忘吃药 → 漏服、我都有哪些药 → 正在吃哪些药、这药/此药 → 这个药）。
 */

/** 归一化开关（默认开；显式 ENABLE_ROUTE_NORMALIZE=false 才关）。 */
export const ROUTE_NORMALIZE_FLAG = 'ENABLE_ROUTE_NORMALIZE'

export function isRouteNormalizeEnabled(): boolean {
  return String(process.env[ROUTE_NORMALIZE_FLAG] ?? '').toLowerCase() !== 'false'
}

/** 单条语义规则：正则 + 规范词 + 标签（标签只进测试/文档，不进 trace 原文）。 */
export interface RouteNormalizeRule {
  re: RegExp
  replacement: string
  label: string
}

/**
 * 语义同义词表（仅路由用途；顺序即应用顺序，长/特异规则在前）。
 * ⚠️ 新增规则必须同步补评测集用例（与 patterns/intent 词表同款纪律）。
 */
export const ROUTE_NORMALIZE_RULES: ReadonlyArray<RouteNormalizeRule> = [
  {
    re: /快吃没(?:了|啦)?|快吃完(?:了|啦)?|快用完(?:了|啦)?|吃光了?|见底(?:了|啦)?|没剩多少|剩不多了?|剩得不多|快没了|要没了/g,
    replacement: '快用完',
    label: '耗尽口语→快用完',
  },
  {
    re: /还剩(?:几|多少)(?:天|次|顿|片|颗|粒|支|盒)?|剩下?(?:几|多少)(?:天|次|顿)?/g,
    replacement: '还剩多少',
    label: '剩余量口语→还剩多少',
  },
  {
    re: /(?:老是|总是|经常|常常|老|总|有时|偶尔)?忘(?:了)?(?:吃药|服药|用药)|漏(?:了)?(?:吃药|服药|用药)/g,
    replacement: '漏服',
    label: '漏服口语→漏服',
  },
  {
    re: /(?:都|我|平时|最近|现在)(?:在)?(?:吃|服用|用)(?:的|过)?(?:哪些|什么|啥)药|吃的药(?:都)?(?:有)?哪些|都有哪些药|手头(?:上)?(?:有)?哪些药/g,
    replacement: '正在吃哪些药',
    label: '清单口语→正在吃哪些药',
  },
  {
    re: /(?:这|那)(?:种|类)?(?:药|药品|药物)|此药|该药品/g,
    replacement: '这个药',
    label: '指代变体→这个药',
  },
]

/** 路由视图产物（text 只用于路由，不得回写/送模型）。 */
export interface RoutingView {
  text: string
  /** 是否与输入不同（用于测试/观测，不落 trace 原文）。 */
  changed: boolean
  /** 命中的规则标签（按应用顺序去重）。 */
  applied: string[]
}

/** 字符级归一：NFKC + 全角空格/连续空白折叠 + 去除首尾空白。 */
export function normalizeChars(question: string): string {
  return String(question ?? '')
    .normalize('NFKC')
    .replace(/[\u3000\s]+/g, ' ')
    .trim()
}

/**
 * 生成路由视图（纯函数）。
 * @param question 脱敏后的用户问题
 * @param opts.enabled 覆盖 env（测试用）；缺省读 ENABLE_ROUTE_NORMALIZE
 */
export function buildRoutingView(question: string, opts: { enabled?: boolean } = {}): RoutingView {
  const enabled = opts.enabled ?? isRouteNormalizeEnabled()
  // 开关关闭 = 完全等价于归一化前（含字符级也回滚，保证可一键回退到旧行为）
  if (!enabled) return { text: String(question ?? ''), changed: false, applied: [] }

  const original = normalizeChars(question)
  let text = original
  const applied: string[] = []
  for (const rule of ROUTE_NORMALIZE_RULES) {
    if (!rule.re.test(text)) continue
    // 重置 lastIndex（规则带 g，逐次 test/替换）
    rule.re.lastIndex = 0
    const next = text.replace(rule.re, rule.replacement)
    if (next !== text) {
      text = next
      applied.push(rule.label)
    }
  }
  return { text, changed: text !== original, applied }
}

/** 便捷函数：返回路由视图文本（供 registry / 对象判定调用）。 */
export function normalizeRoutingText(question: string, opts: { enabled?: boolean } = {}): string {
  return buildRoutingView(question, opts).text
}
