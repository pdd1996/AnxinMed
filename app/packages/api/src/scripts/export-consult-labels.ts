/**
 * 意图漏判率抽检 · 标注样本导出工具（M4-T2 指标口径 · docs/11 §2.1）。
 *
 * 从 consult_logs 按月随机抽 N 条（默认 30，口径见 docs/11 §2「意图漏判率」），导出 CSV
 * 供人工标注「应路由意图」。question 落库前已经 scrubWithPatterns 脱敏（L3 出口约束），
 * 导出前仍请人工过目一遍再入库。
 *
 * 运行：cd app/packages/api && npm run eval:export-labels            # 上个月，30 条
 *       npm run eval:export-labels -- --month 2026-09 --count 30    # 指定月/条数
 * 输出 CSV 到 stdout（UTF-8 BOM，Excel 直开）；建议重定向存 data/consult-labels/YYYY-MM.csv。
 *
 * 标注口径（docs/11 §2.1）：
 * - label 列填人工判断的「应路由意图」：medication-list / adherence / expiry-stock /
 *   interaction-check / next-dose（T7 落地后）/ 说明书管线（非数据查询）；
 * - 漏判 = label 为数据意图 且 (tool_used 为空 或 ≠ label)；误判 = tool_used 有值但 label = 说明书管线；
 * - 漏判率 = 漏判数 / 抽样总数，回填 docs/11 §2 表格。
 */
import 'dotenv/config'
import { and, gte, lt, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { consultLogs } from '../db/schema.js'

/** 解析 --month=YYYY-MM（缺省 = 上个月）。 */
function parseMonth(): { start: Date; end: Date; label: string } {
  const arg = process.argv.find((a) => a.startsWith('--month'))
  const value = arg?.split('=')[1]
  const match = value ? /^(\d{4})-(\d{2})$/.exec(value) : null
  const now = new Date()
  const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const start = new Date(base.getFullYear(), base.getMonth(), 1)
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { start, end, label: `${base.getFullYear()}-${pad(base.getMonth() + 1)}` }
}

async function main() {
  const countArg = process.argv.find((a) => a.startsWith('--count'))
  const count = Number(countArg?.split('=')[1] ?? 30) || 30
  const { start, end, label: month } = parseMonth()

  const rows = await db
    .select({
      id: consultLogs.id,
      createdAt: consultLogs.createdAt,
      question: consultLogs.question,
      status: consultLogs.status,
      intent: consultLogs.intent,
      riskLevel: consultLogs.riskLevel,
    })
    .from(consultLogs)
    .where(and(gte(consultLogs.createdAt, start), lt(consultLogs.createdAt, end)))
    .orderBy(sql`random()`)
    .limit(count)

  // CSV（UTF-8 BOM：Excel 中文直开不乱码）；CRLF 行尾
  const header = 'id,created_at,question,status,tool_used,risk_level,label(应路由意图),备注'
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = rows.map((r) =>
    [
      r.id,
      r.createdAt.toISOString(),
      esc(r.question),
      r.status,
      r.intent ?? '',
      r.riskLevel,
      '', // label（人工填）
      '', // 备注（人工填）
    ].join(','),
  )
  process.stdout.write('\uFEFF' + [header, ...lines].join('\r\n') + '\r\n')
  process.stderr.write(
    `[eval] ${month} 抽样 ${rows.length} 条（随机）。标注后存 data/consult-labels/${month}.csv，漏判率回填 docs/11 §2。\n`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error('[eval] 导出失败：', e)
  process.exit(1)
})
