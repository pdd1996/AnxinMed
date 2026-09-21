import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, History, LoaderCircle, MessageSquarePlus, Send, ShieldCheck, X } from 'lucide-react'
import {
  fetchConsultSession,
  fetchConsultSessions,
  fetchDrugs,
  postConsult,
  type ConsultResponseDto,
  type ConsultSessionDetailDto,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  CONFIRM_STATUS_META,
  CONSULT_DATA_QUICK_QUESTIONS,
  CONSULT_INSERT_QUICK_QUESTIONS,
  type ConsultSkillId,
  type ConsultSuggestion,
} from '@anxin/shared'
import { AnswerCard, buildSpeakText } from '@/components/domain/consult/AnswerCard'
import { EmergencyCard } from '@/components/domain/consult/EmergencyCard'
import { SuggestionCard } from '@/components/domain/consult/SuggestionCard'
import { SpeakButton } from '@/components/domain/voice/SpeakButton'

/**
 * 咨询页（M3-T2 · PRD §7.5 / spec §T2）——围绕已确认药品提问，移动端按「千问式」聊天首屏布局。
 *
 * - 薄头部 + 一句问候语：原「头部副标题 / 空药箱灰框 / 空会话灰框 / 长 placeholder」四处重复
 *   文案合并为问候语一处，不再用边框灰块模拟系统消息；空药箱时问候语内嵌「去录入」链接。
 * - 对象药是「会话上下文」而非页面控件：本页无任何选药 UI（chip 枚举与常驻药丸均已移除），
 *   说明书咨询由药箱「问这个药」深链 /consult?drugId=… 带入对象；无对象时本页只答药箱数据类问题。
 * - 快捷问题为输入框上方单行横滑条：数据类始终可点；说明书类未选药时不渲染
 *   （原「置灰」方案让用户面对一排无解释的灰按钮，已废弃）。
 * - 输入区 sticky 固定在底部导航上方：bottom-16 对齐 BottomNav 高度（~61px），-mb-12 抵消
 *   PatientLayout main 的 pb-28 富余（112-48=64），使滚动钉住态与滚到底静止态落位一致；
 *   主列 min-h 用 dvh 算满视口 + 聊天 Card flex-1，保证内容不足一屏时输入区也贴底（不留中段空白）。
 * - M3-T4：回答可中文播报（spec §T4.2），播放入口在薄头部（播最新一条回答，纯图标；
 *   L4 急救卡另有专属播报），不支持环境自动降级（spec §T4.3）；
 *   按键式语音输入已按产品决定整体移除（2026-09-20），提问仅手动输入。
 * - 消息去头像（2026-09-21 UI 改版，对齐阿福式聊天首屏）：1:1 会话头像无信息量、还占
 *   360px 视口约 11% 宽度；说话方区分靠位置+颜色双编码（老年用户色觉弱，单靠颜色不可靠）：
 *   用户消息右对齐 + primary 填色白字（对比度 6.5:1 过 AA），AI 回答维持左对齐全宽白卡。
 * - 意图路由 T5：咨询不强制选药——不选药可直接问药箱数据类问题（后端意图路由直查库返回
 *   status='data-answered'，0 LLM）；选药后可问说明书问题。
 * - 快捷问题契约收编（M4-T1）：chips 渲染自 shared 的 CONSULT_*_QUICK_QUESTIONS（与后端
 *   intent.ts 正则/skillId 同源），改文案只动 shared 一处。
 * - 会话层（M4-T5）：首问不带 sessionId → 服务端建会话并在响应回传，前端保存后续问自动带入；
 *   「历史会话」入口列出服务端会话（GET /sessions），点选回放（GET /sessions/:id 按 turnNo），
 *   「开新会话」重置本地态。无 sessionId 路径 = M3 单轮行为。
 */

/** 会话消息（一问一答；user 消息含 question，assistant 消息含完整响应）。 */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  question?: string
  response?: ConsultResponseDto
}

/** 会话回放行 → 聊天消息对（consult_logs 行不含 answer 字段，summary 即一句话回答）。 */
function logToChatMessages(log: ConsultSessionDetailDto['messages'][number]): ChatMessage[] {
  const snapshot = (log.sectionsSnapshot ?? null) as ConsultResponseDto['sections']
  const response: ConsultResponseDto = {
    riskLevel: log.riskLevel,
    status: log.status,
    answer: snapshot?.summary ?? log.question,
    sections: snapshot,
    citations: (log.citations ?? null) as ConsultResponseDto['citations'],
    notice: log.notice,
    l0Notice: null, // consult_logs 落库时 l0Notice 并入 notice（无独立列）
    blocked: log.blockedAt != null,
    toolUsed: log.status === 'data-answered' ? log.intent : null,
    consultLogId: log.consultLogId,
    sessionId: '',
    suggestion: null, // 历史轮次的卡片不回放（卡片只在产生它的一轮有效）
  }
  return [
    { id: `${log.consultLogId}-q`, role: 'user', question: log.question },
    { id: log.consultLogId, role: 'assistant', response },
  ]
}

/** 会话时间展示（老年向：月日 + 时分，不用 ISO 串）。 */
function formatTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

let msgSeq = 0
const nextMsgId = () => `msg-${Date.now()}-${++msgSeq}`

export default function Consult() {
  const drugsQuery = useQuery({ queryKey: ['drugs'], queryFn: fetchDrugs })
  const drugs = drugsQuery.data ?? []
  const queryClient = useQueryClient()

  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // 会话状态（M4-T5）：首问响应回传 sessionId，续问自动带入；「开新会话」清空回 null。
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  // 建议卡（M4-T6）：只保留最新一轮的卡（每轮 ≤1），accept/dismiss/开新会话即清。
  const [suggestion, setSuggestion] = useState<ConsultSuggestion | null>(null)

  // 历史会话列表（打开面板时才拉取）
  const sessionsQuery = useQuery({
    queryKey: ['consult-sessions'],
    queryFn: fetchConsultSessions,
    enabled: historyOpen,
  })

  // 对象药 = URL 深链上下文（药箱「问这个药」带入）；无参数即无对象，不做默认选中。
  const [searchParams] = useSearchParams()
  const drugIdParam = searchParams.get('drugId')
  const selectedDrug = drugIdParam ? drugs.find((d) => d.id === drugIdParam) ?? null : null
  const effectiveDrugId = selectedDrug?.id ?? null
  const invalidDrugLink = !!drugIdParam && !drugsQuery.isLoading && !selectedDrug && drugs.length > 0

  const consultMutation = useMutation({
    // 无可选字段时保持两参调用（M3 形态）；sessionId 续问（M4-T5）/ skillId 快路径（M4-T7，chips 带入）
    mutationFn: (input: { text: string; skillId?: ConsultSkillId }) => {
      const drugIds = effectiveDrugId ? [effectiveDrugId] : []
      const opts = {
        ...(sessionId ? { sessionId } : {}),
        ...(input.skillId ? { skillId: input.skillId } : {}),
      }
      return Object.keys(opts).length > 0 ? postConsult(input.text, drugIds, opts) : postConsult(input.text, drugIds)
    },
    onSuccess: (response, q) => {
      setSessionId(response.sessionId)
      setSuggestion(response.suggestion ?? null)
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: 'user', question: (q as { text: string }).text },
        { id: nextMsgId(), role: 'assistant', response },
      ])
      setQuestion('')
    },
  })

  const handleAsk = (q?: string, skillId?: ConsultSkillId) => {
    const text = (q ?? question).trim()
    if (!text || consultMutation.isPending) return
    consultMutation.mutate({ text, skillId })
  }

  /** 回放历史会话：拉详情 → 映射消息 → 会话续接到当前窗口。 */
  const handleRestoreSession = async (id: string) => {
    const detail = await fetchConsultSession(id)
    setSessionId(detail.session.id)
    setMessages(detail.messages.flatMap(logToChatMessages))
    setSuggestion(null) // 回放历史轮次不重弹旧卡（卡片只在产生它的那一轮有效）
    setHistoryOpen(false)
  }

  /** 开新会话：清空本地会话态（服务端历史保留，可从「历史会话」再进入）。 */
  const handleNewSession = () => {
    setSessionId(null)
    setMessages([])
    setSuggestion(null)
    setHistoryOpen(false)
    queryClient.invalidateQueries({ queryKey: ['consult-sessions'] })
  }

  // 最新一条回答（头部播放入口的播报对象；卡内不再重复放播放按钮，2026-09-21 UI 改版）
  const lastResponse = [...messages].reverse().find((m) => m.role === 'assistant' && m.response)?.response

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
      {/* 主列：min-h 用 dvh 算满视口（100dvh - 顶栏56 - main pt24 - main pb112），
          内容不足一屏时 Card(flex-1) 撑开、输入区贴底；百分比 min-h 在 auto 高度父链下会算成 0，故不用 */}
      <div className="flex min-h-[calc(100dvh-192px)] min-w-0 flex-col gap-4 lg:col-span-1">
        <Card className="flex-1">
          <CardContent className="space-y-4 p-4">
            {/* 薄头部：标题 + 会话操作（播放最新回答 / 历史会话列表入口 / 开新会话）；
                纯图标（44px 触控目标），无障碍名走 aria-label；
                播放入口常驻（无可播回答时置灰），避免空会话下找不到按钮 */}
            <div className="flex items-center gap-1 border-b border-border pb-3">
              <h1 className="min-w-0 flex-1 truncate text-base font-bold">安心 AI 药师助手</h1>
              <SpeakButton
                text={lastResponse ? buildSpeakText(lastResponse.sections ?? null, lastResponse.answer, lastResponse.notice) : ''}
                label="播放最新回答"
                variant="ghost"
                className="size-11 text-muted-foreground"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 text-muted-foreground"
                onClick={() => setHistoryOpen((v) => !v)}
                aria-expanded={historyOpen}
                aria-label="历史会话"
              >
                <History className="size-5" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 text-muted-foreground"
                onClick={handleNewSession}
                aria-label="开新会话"
              >
                <MessageSquarePlus className="size-5" aria-hidden />
              </Button>
            </div>

            {/* 历史会话面板（M4-T5：点选回放 consult_logs 按 turnNo 排序的消息） */}
            {historyOpen && (
              <div className="rounded-md border border-border bg-muted/20 p-2">
                {sessionsQuery.isLoading && <p className="p-2 text-xs text-muted-foreground">加载中…</p>}
                {sessionsQuery.data && sessionsQuery.data.items.length === 0 && (
                  <p className="p-2 text-xs text-muted-foreground">还没有历史会话。</p>
                )}
                <ul className="space-y-1">
                  {(sessionsQuery.data?.items ?? []).map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="flex w-full min-h-11 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/60"
                        onClick={() => void handleRestoreSession(s.id)}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatTime(s.lastActiveAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* manual 档提示（spec §T2.2） */}
            {selectedDrug?.confirmStatus === 'manual' && (
              <p className="flex items-start gap-2 rounded-md border border-risk-l3/30 bg-risk-l3/10 p-2.5 text-xs text-risk-l3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>该药品未经 OCR 确认：{CONFIRM_STATUS_META.manual.hint}</span>
              </p>
            )}

            {/* 消息历史；空会话时只有一句问候语（无框、无底色） */}
            <div className="space-y-4">
              {messages.length === 0 && !drugsQuery.isLoading && (
                <p className="text-sm text-muted-foreground">
                  {drugs.length === 0 ? (
                    <>
                      药箱为空：去
                      <Link
                        to="/intake/rx"
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        录入
                      </Link>
                      添加药品后可咨询说明书；现在也能直接查药箱数据。
                    </>
                  ) : selectedDrug ? (
                    <>
                      正在咨询「
                      <span className="font-medium text-foreground">{selectedDrug.genericName}</span>
                      」：说明书类问题围绕它回答，药箱数据也可直接问。
                    </>
                  ) : invalidDrugLink ? (
                    '未找到要咨询的药品，请回到药箱从该药的「问这个药」重新进入。'
                  ) : (
                    '可直接问药箱数据；要咨询某支药的说明书，请到药箱点该药的「问这个药」。'
                  )}
                </p>
              )}

              {messages.map((msg) =>
                msg.role === 'user' ? (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-none bg-primary p-3 text-primary-foreground">
                      <p className="text-sm">{msg.question}</p>
                    </div>
                  </div>
                ) : (
                  <div key={msg.id}>
                    {msg.response?.riskLevel === 'L4' && msg.response.sections ? (
                      <EmergencyCard sections={msg.response.sections} />
                    ) : msg.response ? (
                      <AnswerCard
                        riskLevel={msg.response.riskLevel}
                        status={msg.response.status}
                        answer={msg.response.answer}
                        sections={msg.response.sections ?? null}
                        citations={msg.response.citations ?? []}
                        notice={msg.response.notice}
                        l0Notice={msg.response.l0Notice}
                        blocked={msg.response.blocked}
                        toolUsed={msg.response.toolUsed}
                      />
                    ) : null}
                  </div>
                ),
              )}

              {/* 建议卡（M4-T6）：最新一轮的确认式引导，accept 跳既有建档入口、dismiss 不复弹 */}
              {suggestion && <SuggestionCard suggestion={suggestion} />}

              {/* 加载中指示 */}
              {consultMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  AI 正在思考…
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 底部固定输入区：快捷问题横滑条 + 输入行 + 免责小字（magic number 由来见文件头注释） */}
        <div className="sticky bottom-16 z-10 -mb-12 space-y-2 border-t border-border bg-background/95 pt-3 backdrop-blur">
          <div className="flex gap-2 overflow-x-auto py-0.5">
            {CONSULT_DATA_QUICK_QUESTIONS.map((q) => (
              <Button
                key={q.skillId}
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 whitespace-nowrap border-primary/30 text-xs text-primary"
                onClick={() => handleAsk(q.question, q.skillId)}
                disabled={consultMutation.isPending}
              >
                {q.label}
              </Button>
            ))}
            {effectiveDrugId &&
              CONSULT_INSERT_QUICK_QUESTIONS.map((q) => (
                <Button
                  key={q.question}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 shrink-0 whitespace-nowrap text-xs"
                  onClick={() => handleAsk(q.question, q.skillId)}
                  disabled={consultMutation.isPending}
                >
                  {q.label}
                </Button>
              ))}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleAsk()
                }
              }}
              placeholder={
                effectiveDrugId
                  ? '输入关于已确认药品的问题…'
                  : '想问什么？直接输入告诉我'
              }
              disabled={consultMutation.isPending}
              rows={2}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button
              type="button"
              size="icon"
              className="size-11 shrink-0"
              onClick={() => handleAsk()}
              disabled={consultMutation.isPending || !question.trim()}
              aria-label="发送"
            >
              {consultMutation.isPending ? (
                <X className="size-5 animate-pulse" aria-hidden />
              ) : (
                <Send className="size-5" aria-hidden />
              )}
            </Button>
          </div>

        </div>
      </div>

      {/* 侧列：边界说明（照搬 demo/src/pages/Consult.tsx:123-126） */}
      <aside className="hidden space-y-4 lg:block">
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-risk-l1">
              <ShieldCheck className="size-5" aria-hidden />
              <h2 className="text-sm font-bold">我能帮你</h2>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>· 解释说明书字段与药理机制</li>
              <li>· 说明常见注意事项</li>
              <li>· 提示生效计划中的相互作用</li>
              <li>· 查询你的药箱数据（清单 / 依从性 / 效期库存 / 联用冲突）</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-risk-l3/30">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-risk-l3">
              <AlertTriangle className="size-5" aria-hidden />
              <h2 className="text-sm font-bold">我不会做</h2>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>· 诊断疾病或开处方</li>
              <li>· 建议停药、换药或改剂量</li>
              <li>· 预测"对你效果如何"</li>
              <li>· 替代医生处理急症</li>
            </ul>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
