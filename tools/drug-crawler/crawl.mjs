#!/usr/bin/env node
/**
 * drug-crawler —— 丁香园用药助手说明书爬虫（可复用工作流，PRD §13.3「批量整理时固化」）
 *
 * 用法：
 *   1) npm install                       # 安装 playwright
 *   2) node crawl.mjs login              # 打开浏览器，手动登录丁香园一次（登录态存于 .profile/，之后免登录）
 *   3) node crawl.mjs crawl [list.json]  # 按清单抓取，草稿写入 out/（curationStatus=crawled）
 *
 * 清单格式见 drugs.example.json。已存在的草稿文件自动跳过（可断点续跑）。
 *
 * 重要约束：
 *   - 草稿仅为 crawled 状态，入库前必须人工核对（PRD §13.3 第 4 步闸门），核对通过才可改 reviewed；
 *   - 控制抓取频率（默认 1.8s + 抖动），仅限内部 MVP 数据整理使用，不得用于公开分发；
 *   - 站点返回「请登录后继续访问」即终止，提示重新登录，不自动重试硬闯。
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = 'https://drugs.dxy.cn'
const PROFILE_DIR = join(__dirname, '.profile')
const DELAY_MS = 1800

const WALL_MARK = '请登录后继续访问'

// ── 页面上下文中执行的提取函数（与 data/crawled 批次所用逻辑一致）──
async function searchFn(keyword) {
  const r = await fetch('/pc/search?keyword=' + encodeURIComponent(keyword) + '&type=drug', { credentials: 'include' })
  const html = await r.text()
  if (html.includes('请登录后继续访问')) return { blocked: true }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = []
  const seen = new Set()
  for (const a of doc.querySelectorAll('a[href*="/pc/drug/"]')) {
    const m = (a.getAttribute('href') || '').match(/\/pc\/drug\/([A-Za-z0-9_-]+)/)
    if (!m || seen.has(m[1])) continue
    const h3 = a.querySelector('h3')
    if (!h3) continue
    seen.add(m[1])
    out.push({ id: m[1], title: h3.textContent.trim().replace(/\s+/g, ' ') })
    if (out.length >= 12) break
  }
  return { items: out }
}

async function detailFn(id) {
  const r = await fetch('/pc/drug/' + id, { credentials: 'include' })
  const html = await r.text()
  if (html.includes('请登录后继续访问')) return { blocked: true }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,noscript').forEach((e) => e.remove())
  const title = doc.querySelector('h1')?.textContent.trim() || null
  const flat = doc.body.textContent.replace(/\s+/g, ' ')
  const tags = [...new Set(flat.slice(0, 800).match(/Rx|OTC甲|OTC乙|医保甲类|医保乙类|基本药物/g) || [])]
  const dates = {}
  for (const m of flat.slice(0, 1500).matchAll(/(核准|修改)日期\s*[：:]\s*([0-9年月日./-]+)/g)) dates[m[1]] = m[2]
  const sections = {}
  for (const h of doc.querySelectorAll('h2')) {
    const name = h.textContent.replace(/【|】|\s/g, '')
    let content = (h.parentElement?.textContent || '').replace(h.textContent, ' ').replace(/\s+/g, ' ').trim()
    const cut = content.search(/网页版仅展示部分|说明书二维码/)
    if (cut > -1) content = content.slice(0, cut)
    if (name && content) sections[name] = content
  }
  // 相互作用以 strong 形式嵌在药代动力学尾部的情况（仅在句末标点后切分，防句中误切）
  if (!sections['药物相互作用'] && sections['药代动力学']) {
    const m = /(?:^|[。；：])\s*药物相互作用(?!】)/.exec(sections['药代动力学'])
    if (m && sections['药代动力学'].length - (m.index + m[0].length) > 50) {
      sections['药物相互作用'] = sections['药代动力学'].slice(m.index + m[0].length).replace(/【药物相互作用】/g, ' ').trim()
      sections['药代动力学'] = sections['药代动力学'].slice(0, m.index + 1).trim()
    }
  }
  // OTC 条目：作用类别混在适应症内，拆出
  if (sections['适应症'] && sections['适应症'].includes('【作用类别】')) {
    const [ind, cat] = sections['适应症'].split('【作用类别】')
    sections['适应症'] = ind.trim()
    sections['作用类别'] = (cat || '').trim()
  }
  for (const k of ['临床试验', '毒理研究', '药物过量']) delete sections[k]
  return { title, tags, dates, sections }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const delay = () => sleep(DELAY_MS + Math.floor(Math.random() * 800))

function revisionToIso(d) {
  if (!d) return null
  const m = d.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

async function main() {
  const command = process.argv[2] || 'crawl'
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false })

  if (command === 'login') {
    const page = context.pages()[0] || (await context.newPage())
    await page.goto(BASE + '/pc/drug')
    console.log('请在打开的浏览器中登录丁香园账号。登录成功（能看到药品分类）后关闭浏览器窗口即可。')
    page.on('close', async () => { await context.close(); process.exit(0) })
    context.on('close', () => process.exit(0))
    return
  }

  // crawl
  const listFile = process.argv[3] || join(__dirname, 'drugs.example.json')
  const list = JSON.parse(readFileSync(listFile, 'utf8'))
  const outDir = join(__dirname, 'out')
  mkdirSync(outDir, { recursive: true })

  const page = context.pages()[0] || (await context.newPage())
  await page.goto(BASE + '/pc/drug')
  const probe = await page.content()
  if (probe.includes(WALL_MARK)) {
    console.error('✗ 未登录或会话失效：站点返回登录墙。请先运行 `node crawl.mjs login` 完成登录。')
    await context.close()
    process.exit(1)
  }

  let ok = 0, skip = 0, fail = 0
  for (const item of list) {
    const outFile = join(outDir, `${item.drugId}.json`)
    if (existsSync(outFile)) { skip++; console.log(`↷ 跳过（已存在）: ${item.drugId}`); continue }
    try {
      const search = await page.evaluate(searchFn, item.keyword)
      if (search.blocked) throw new Error('搜索被登录墙拦截')
      const hit = (search.items || []).find((x) => item.match.every((re) => new RegExp(re).test(x.title)))
      if (!hit) {
        console.warn(`⚠ ${item.drugId}: 无匹配候选，候选如下：`)
        for (const c of search.items || []) console.warn('   -', c.title)
        fail++
        continue
      }
      await delay()
      const d = await page.evaluate(detailFn, hit.id)
      if (d.blocked) throw new Error('详情页被登录墙拦截')
      const draft = {
        drugId: item.drugId,
        crawledAt: new Date().toISOString().slice(0, 10),
        dxyId: hit.id,
        sourceUrl: `${BASE}/pc/drug/${hit.id}`,
        dxyTitle: d.title,
        tags: d.tags,
        approvalDate: d.dates['核准'] || null,
        revisionDate: d.dates['修改'] || null,
        version: d.dates['修改'] ? `dxy-${revisionToIso(d.dates['修改'])}` : null,
        searchKeyword: item.keyword,
        searchCandidates: (search.items || []).map((c) => c.title),
        matchNote: item.note || `标题匹配规则: ${JSON.stringify(item.match)}`,
        sections: d.sections,
        curationStatus: 'crawled',
      }
      writeFileSync(outFile, JSON.stringify(draft, null, 2))
      ok++
      console.log(`✓ ${item.drugId} ← ${hit.title} (${draft.version})`)
      await delay()
    } catch (e) {
      fail++
      console.error(`✗ ${item.drugId}: ${e.message}`)
      if (String(e.message).includes('登录墙')) {
        console.error('会话已失效，终止批次。已完成部分保留，重新登录后可续跑。')
        break
      }
    }
  }
  console.log(`\n完成：新增 ${ok}，跳过 ${skip}，失败 ${fail}。草稿目录: ${outDir}`)
  console.log('提醒：crawled ≠ reviewed，入库前必须人工核对（PRD §13.3）。')
  await context.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
