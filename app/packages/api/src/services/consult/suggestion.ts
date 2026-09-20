/**
 * 确认式建议卡规则（M4-T6 · specs/04-T6）——确定性纯函数，零 LLM（与「医嘱只抄录不生成」
 * 同源纪律：卡片由规则生成，不由模型联想）。
 *
 * 两类卡（裁决 #4）：
 * - add_drug：提问命中 drug_master 通用名/商品名（规范化子串）且未在用户药箱 → 「加入药箱」卡。
 *   宁漏勿误：精确与规范化匹配，不做模糊联想；剂型后缀剥离的核心词须 ≥3 字（防「钙片」类
 *   泛指词误报）；已入库药不弹；dismissed 的药名不复弹（排除集由调用方传入）。
 * - note_symptom：提问含不适/症状类词 → 引导去健康信息页记录（纯引导卡，跳转 /profile，
 *   不落库，存储形态下一期定——跨轮频控因此不做，为裁决 #4 接受的 MVP 限制）。
 *
 * 优先级与频控（调用方 consult.service 编排）：S0 红线（emergency/refused）不打扰；
 * add_drug 优先于 note_symptom；每轮 ≤1 卡；每会话 ≤3 张 add_drug 卡（落库数封顶）。
 */
import { normalizeToken } from '../identity/normalize.js'

/** 剂型后缀（规范化匹配时从 master 药名尾部剥离，取核心词对自由文本匹配）。 */
const DOSAGE_FORM_SUFFIX = /(片|胶囊|颗粒|丸|口服液|滴眼液|滴丸|软膏|乳膏|凝胶|栓|喷雾剂|气雾剂|糖浆|混悬液|散|贴)$/

/** note_symptom 触发词（口语不适/症状表述；与守门 L4 正则不同层——守门优先于卡片生成）。 */
const SYMPTOM_GUIDE_PATTERN =
  /不舒服|难受|不适|症状|头晕|头疼|头痛|恶心|想吐|呕吐|皮疹|瘙痒|发痒|腹泻|拉肚子|便秘|心慌|乏力|失眠|胃口不好/

/** add_drug 命中候选。drugName = master 通用名（规范化后写入 payload，作为建议的规范名）。 */
export interface AddDrugMatch {
  drugName: string
  /** 命中来源（通用名 / 商品名），供 payload 留痕与测试断言。 */
  matchedOn: 'generic' | 'brand'
}

/** 建议卡匹配输入的 master 最小切片（assets.repo.listDrugMasterCandidates 的子集）。 */
export interface SuggestionMasterRef {
  genericName: string
  brandName: string | null
}

/**
 * 单个 master 名是否命中提问（规范化子串）：全名命中或剥离剂型后缀的核心词命中，**均须 ≥3 字**。
 * 3 字下限防「钙片」类泛指短名误报（宁漏勿误：两字真药名如「海露」宁可不弹卡）。
 */
function matchNameInQuestion(
  name: string,
  questionNormalized: string,
): 'full' | 'core' | null {
  const n = normalizeToken(name)
  if (!n || n.length < 3) return null
  if (questionNormalized.includes(n)) return 'full'
  const core = n.replace(DOSAGE_FORM_SUFFIX, '')
  if (core.length >= 3 && questionNormalized.includes(core)) return 'core'
  return null
}

/**
 * add_drug 匹配（纯函数）：提问 ∩ drug_master 名，排除已入库与已忽略。
 * @param masters drug_master 全量候选（MVP 精选库规模小；顺序即优先级，命中第一个即返回）
 * @param ownedNames 用户药箱既有药名（通用名 + 商品名；命中 = 该药已在箱，不弹卡）
 * @param dismissedNames 本会话已忽略的 add_drug 药名（规范化相等比较；dismissed 不复弹）
 */
export function matchAddDrug(
  question: string,
  masters: SuggestionMasterRef[],
  ownedNames: string[],
  dismissedNames: string[],
): AddDrugMatch | null {
  const q = normalizeToken(question)
  if (!q) return null
  const owned = ownedNames.map(normalizeToken).filter(Boolean)
  const dismissed = new Set(dismissedNames.map(normalizeToken).filter(Boolean))

  for (const m of masters) {
    const matched =
      matchNameInQuestion(m.genericName, q)
        ? ({ matchedOn: 'generic' as const } as const)
        : m.brandName && matchNameInQuestion(m.brandName, q)
          ? ({ matchedOn: 'brand' as const } as const)
          : null
    if (!matched) continue

    // 已在药箱 → 整轮不弹（宁漏勿误）。所有权检查覆盖通用名与商品名两形态：
    // 问「海露」（商品名命中）而箱里存的是「玻璃酸钠滴眼液」（通用名）也算已入库。
    const isOwned = [m.genericName, m.brandName].some((n) => {
      if (!n) return false
      const nn = normalizeToken(n)
      return owned.some((o) => o && (o.includes(nn) || nn.includes(o)))
    })
    if (isOwned) return null

    // dismissed 不复弹（按建议规范名 = master 通用名比较）
    if (dismissed.has(normalizeToken(m.genericName))) continue

    return { drugName: m.genericName, matchedOn: matched.matchedOn }
  }
  return null
}

/** note_symptom 触发判定（纯函数）：提问含不适/症状类词。 */
export function matchSymptomGuide(question: string): boolean {
  return SYMPTOM_GUIDE_PATTERN.test(String(question ?? ''))
}
