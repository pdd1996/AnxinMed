import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Bot, LoaderCircle, Send, ShieldCheck, Sparkles, User, X } from 'lucide-react'
import { fetchDrugs, postConsult, type ConsultResponseDto } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CONFIRM_STATUS_META } from '@anxin/shared'
import { DrugSelector } from '@/components/domain/consult/DrugSelector'
import { AnswerCard } from '@/components/domain/consult/AnswerCard'
import { EmergencyCard } from '@/components/domain/consult/EmergencyCard'
import { VoiceDictationButton } from '@/components/domain/voice/VoiceDictationButton'

/**
 * 咨询页（M3-T2 · PRD §7.5 / spec §T2）——围绕已确认药品提问。
 *
 * 结构（照搬 demo/src/pages/Consult.tsx，用 shadcn/ui + Tailwind 重写）：
 * - 头部：AI 药师助手标题 + 当前咨询药
 * - 药品选择器（DrugSelector）+ manual 档提示（选中 manual 药时）
 * - 消息历史（用户提问 + AI 回答，按 riskLevel 分派 EmergencyCard / AnswerCard）
 * - 快捷问题 + 提问输入框 + 发送按钮
 * - 边界说明侧栏（"我能帮你" / "我不会做"）
 *
 * M3-T4：提问框接入按键式语音输入（VoiceDictationButton），回答卡接入中文播报（SpeakButton，见 AnswerCard/EmergencyCard）；
 *    语音仅为快捷入口，手动输入/发送按钮等价保留；不支持环境自动降级（spec §T4.3）。
 *    消息历史用 useState 本地管理（咨询是会话式，不需要持久化到 DB——consult_logs 已由后端落库）。
 */

/** 会话消息（一问一答；user 消息含 question，assistant 消息含完整响应）。 */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  question?: string
  response?: ConsultResponseDto
}

/** 快捷问题（照搬 demo/src/pages/Consult.tsx:5-10）。 */
const QUICK_QUESTIONS = [
  '这个药通常用于什么？',
  '常见不良反应有哪些？',
  '这个药是怎么作用的？（药理机制）',
  '这个药应该怎么保存？',
]

let msgSeq = 0
const nextMsgId = () => `msg-${Date.now()}-${++msgSeq}`

export default function Consult() {
  const drugsQuery = useQuery({ queryKey: ['drugs'], queryFn: fetchDrugs })
  const drugs = drugsQuery.data ?? []

  const [selectedDrugId, setSelectedDrugId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])

  // 默认选中第一支药（如有）
  const selectedDrug = drugs.find((d) => d.id === selectedDrugId) ?? drugs[0] ?? null
  const effectiveDrugId = selectedDrug?.id ?? null

  const consultMutation = useMutation({
    mutationFn: (q: string) => postConsult(q, effectiveDrugId ? [effectiveDrugId] : []),
    onSuccess: (response, q) => {
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: 'user', question: q },
        { id: nextMsgId(), role: 'assistant', response },
      ])
      setQuestion('')
    },
  })

  const handleAsk = (q?: string) => {
    const text = (q ?? question).trim()
    if (!text || consultMutation.isPending) return
    consultMutation.mutate(text)
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
      {/* 主列：聊天面板 */}
      <Card className="lg:col-span-1">
        <CardContent className="space-y-4 p-4">
          {/* 头部 */}
          <div className="flex items-center gap-3 border-b border-border pb-3">
            <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-6" aria-hidden />
            </div>
            <div className="flex-1">
              <h1 className="text-base font-bold">安心 AI 药师助手</h1>
              <p className="text-xs text-muted-foreground">
                {selectedDrug ? `正在咨询：${selectedDrug.genericName}` : '请先选择已确认的药品'}
              </p>
            </div>
          </div>

          {/* 药品选择器 */}
          {drugsQuery.isLoading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> 正在载入药箱…
            </p>
          ) : drugs.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              药箱为空。请先通过拍照录入或手动建档添加药品，再来咨询。
            </p>
          ) : (
            <DrugSelector drugs={drugs} selectedId={effectiveDrugId} onSelect={setSelectedDrugId} />
          )}

          {/* manual 档提示（spec §T2.2） */}
          {selectedDrug?.confirmStatus === 'manual' && (
            <p className="flex items-start gap-2 rounded-md border border-risk-l3/30 bg-risk-l3/10 p-2.5 text-xs text-risk-l3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                该药品未经 OCR 确认：AI 个性化咨询不可用，仅可查询药品资料（L0）。
                {CONFIRM_STATUS_META.manual.hint}
              </span>
            </p>
          )}

          {/* 消息历史 */}
          <div className="space-y-4">
            {messages.length === 0 && (
              <p className="rounded-md border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                选择药品后，输入问题或点击快捷问题开始咨询。
              </p>
            )}

            {messages.map((msg) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <User className="size-4" aria-hidden />
                  </div>
                  <div className="flex-1 rounded-lg rounded-tl-none border border-border bg-muted/30 p-3">
                    <p className="text-sm text-foreground">{msg.question}</p>
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Bot className="size-4" aria-hidden />
                  </div>
                  <div className="flex-1">
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
                      />
                    ) : null}
                  </div>
                </div>
              ),
            )}

            {/* 加载中指示 */}
            {consultMutation.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                AI 正在思考…
              </div>
            )}
          </div>

          {/* 快捷问题 */}
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {QUICK_QUESTIONS.map((q) => (
              <Button
                key={q}
                type="button"
                variant="outline"
                size="sm"
                className="min-h-9 text-xs"
                onClick={() => handleAsk(q)}
                disabled={consultMutation.isPending || !effectiveDrugId}
              >
                {q}
              </Button>
            ))}
          </div>

          {/* 提问输入框 */}
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
              placeholder={effectiveDrugId ? '输入关于已确认药品的问题…' : '请先选择药品'}
              disabled={!effectiveDrugId || consultMutation.isPending}
              rows={2}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            {/* M3-T4：语音提问（转写确认后追加到输入框）；贴近卡片底部，浮层向上展开。 */}
            <VoiceDictationButton
              label="语音输入问题"
              continuous
              panelSide="top"
              disabled={!effectiveDrugId || consultMutation.isPending}
              onCommit={(text) => setQuestion((prev) => (prev.trim() ? `${prev.trimEnd()}${text}` : text))}
            />
            <Button
              type="button"
              size="icon"
              className="size-11 shrink-0"
              onClick={() => handleAsk()}
              disabled={!effectiveDrugId || consultMutation.isPending || !question.trim()}
              aria-label="发送"
            >
              {consultMutation.isPending ? (
                <X className="size-5 animate-pulse" aria-hidden />
              ) : (
                <Send className="size-5" aria-hidden />
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            AI 基于本地说明书库按键取数回答，不诊断、不处方、不建议自行调整剂量；不预测个体疗效。
          </p>
        </CardContent>
      </Card>

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
