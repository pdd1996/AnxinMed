/**
 * extract-fn.js —— DXY 药品说明书提取函数（页面上下文执行版）
 *
 * ⚠️ 这是 2026-09-05 首批 9 药实战验证过的版本，四个坑的修复已编码，
 *    改动前先读文件头注释，不要从零重写。站点改版（选择器失效、段落结构变化）
 *    时才需要修改，并重跑 SKILL.md §5 自检。
 *
 * 用法：把函数体作为 tab.playwright.evaluate 的第一个参数传入，
 *      第二个参数是单对象 arg（不要传两个独立参数，序列化会失败）：
 *
 *   const search = await tab.playwright.evaluate(searchFn, "海露玻璃酸钠滴眼液")
 *   const detail = await tab.playwright.evaluate(detailFn, "pFa0Fp6vlHtPoUY5VhIOnig")
 *
 * 已编码的修复（勿删）：
 *   1) sections 提取基于 h2.parentElement（h2 与内容同级的 div 容器），
 *      不是把整页文本按【】切分——首版按【】切分在免 fetch 的渲染 DOM 上失效；
 *   2) 「药物相互作用」在部分条目里以 <strong> 形式嵌在药代动力学尾部：
 *      只在句末标点（。；：）或开头之后切分（防"竞争性抑制和药物相互作用的
 *      可能性"这类句中短语误切），且切出内容要 >50 字符才算真段落；
 *   3) OTC 条目的「作用类别」混在适应症文本里（【作用类别】标记），单独拆出；
 *   4) 丢弃 schema 用不到的 临床试验/毒理研究/药物过量 段；
 *   5) 内容尾部截断到「网页版仅展示部分|说明书二维码」标记为止（去掉页脚）。
 *
 * 已知残余限制（在草稿 matchNote 里声明，不要试图"修复"数据）：
 *   - 表格内容文本化丢结构（表 5/表 6、敏感性菌株表）；
 *   - 「见 」悬空字样是原页【药物相互作用】交叉引用占位，属原文；
 *   - 贮藏/有效期/批准文号网页版不展示，字段天然缺失。
 */

const WALL_MARK = '请登录后继续访问'

/** 搜索：返回 { items: [{id,title}] } 或 { blocked: true }（登录墙） */
const searchFn = async (keyword) => {
  const r = await fetch('/pc/search?keyword=' + encodeURIComponent(keyword) + '&type=drug', { credentials: 'include' })
  const html = await r.text()
  if (html.includes(WALL_MARK)) return { blocked: true }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = []
  const seen = new Set()
  for (const a of doc.querySelectorAll('a[href*="/pc/drug/"]')) {
    const m = (a.getAttribute('href') || '').match(/\/pc\/drug\/([A-Za-z0-9_\-]+)/)
    if (!m || seen.has(m[1])) continue
    const h3 = a.querySelector('h3')
    if (!h3) continue
    seen.add(m[1])
    out.push({ id: m[1], title: h3.textContent.trim().replace(/\s+/g, ' ') })
    if (out.length >= 12) break
  }
  return { items: out }
}

/** 详情：返回 { title, tags, dates, sections } 或 { blocked: true } */
const detailFn = async (id) => {
  const r = await fetch('/pc/drug/' + id, { credentials: 'include' })
  const html = await r.text()
  if (html.includes(WALL_MARK)) return { blocked: true }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,noscript').forEach((e) => e.remove())
  const title = doc.querySelector('h1')?.textContent.trim() || null
  const flat = doc.body.textContent.replace(/\s+/g, ' ')
  const tags = [...new Set(flat.slice(0, 800).match(/Rx|OTC甲|OTC乙|医保甲类|医保乙类|基本药物/g) || [])]
  const dates = {}
  for (const m of flat.slice(0, 1500).matchAll(/(核准|修改)日期\s*[：:]\s*([0-9年月日./\-]+)/g)) dates[m[1]] = m[2]
  const sections = {}
  for (const h of doc.querySelectorAll('h2')) {
    const name = h.textContent.replace(/【|】|\s/g, '')
    let content = (h.parentElement?.textContent || '').replace(h.textContent, ' ').replace(/\s+/g, ' ').trim()
    const cut = content.search(/网页版仅展示部分|说明书二维码/)
    if (cut > -1) content = content.slice(0, cut)
    if (name && content) sections[name] = content
  }
  if (!sections['药物相互作用'] && sections['药代动力学']) {
    const m = /(?:^|[。；：])\s*药物相互作用(?!】)/.exec(sections['药代动力学'])
    if (m && sections['药代动力学'].length - (m.index + m[0].length) > 50) {
      sections['药物相互作用'] = sections['药代动力学'].slice(m.index + m[0].length).replace(/【药物相互作用】/g, ' ').trim()
      sections['药代动力学'] = sections['药代动力学'].slice(0, m.index + 1).trim()
    }
  }
  if (sections['适应症'] && sections['适应症'].includes('【作用类别】')) {
    const [ind, cat] = sections['适应症'].split('【作用类别】')
    sections['适应症'] = ind.trim()
    sections['作用类别'] = (cat || '').trim()
  }
  for (const k of ['临床试验', '毒理研究', '药物过量']) delete sections[k]
  return { title, tags, dates, sections }
}

/** 中文修订日期 → ISO（version 推导用）：2022年12月28日 → 2022-12-28 */
function revisionToIso(d) {
  if (!d) return null
  const m = d.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

if (typeof module !== 'undefined') module.exports = { searchFn, detailFn, revisionToIso, WALL_MARK }
