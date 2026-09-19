import { useState } from 'react'
import { Link } from 'react-router'
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
 * 咨询页（M3-T2 · PRD §7.5 / spec §T2）——围绕已确认药品提问，移动端按「千问式」聊天首屏布局。
 *
 * - 薄头部 + 一句问候语：原「头部副标题 / 空药箱灰框 / 空会话灰框 / 长 placeholder」四处重复
 *   文案合并为问候语一处，不再用边框灰块模拟系统消息；空药箱时问候语内嵌「去录入」链接。
 * - 快捷问题为输入框上方单行横滑条：数据类始终可点；说明书类未选药时不渲染
 *   （原「置灰」方案让用户面对一排无解释的灰按钮，已废弃）。
 * - 输入区 sticky 固定在底部导航上方：bottom-16 对齐 BottomNav 高度（~61px），-mb-12 抵消
 *   PatientLayout main 的 pb-28 富余（112-48=64），使滚动钉住态与滚到底静止态落位一致。
 * - M3-T4：输入行含按键式语音（VoiceDictationButton），回答卡含中文播报（见 AnswerCard/EmergencyCard）；
 *   语音仅快捷入口，手动输入/发送等价保留，不支持环境自动降级（spec §T4.3）。
 * - 意图路由 T5：咨询不强制选药——不选药可直接问药箱数据类问题（后端意图路由直查库返回
 *   status='data-answered'，0 LLM）；选药后可问说明书问题。
 * - 消息历史用 useState 本地管理（咨询是会话式，不需要持久化到前端——consult_logs 已由后端落库）。
 */

/** 会话消息（一问一答；user 消息含 question，assistant 消息含完整响应）。 */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  question?: string
  response?: ConsultResponseDto
}

/** 快捷问题 · 说明书类（照搬 demo/src/pages/Consult.tsx:5-10；选中药品后才渲染）。 */
const QUICK_QUESTIONS = [
  '这个药通常用于什么？',
  '常见不良反应有哪些？',
  '这个药是怎么作用的？（药理机制）',
  '这个药应该怎么保存？',
]

/**
 * 快捷问题 · 药箱数据查询类（意图路由 T5；无需选药，始终可点）。
 * ⚠️ 文案与后端 intent.ts 的 INTENT_ROUTES 正则逐条对过（实测命中），且不得含解释词
 *    （副作用/禁忌/怎么吃等会被 EXPLAIN_INTENT_PATTERN 仲裁回说明书管线）；
 *    改文案必须同步核对后端正则，否则按钮点了会答非所问。
 */
const DATA_QUICK_QUESTIONS = [
  '我现在有多少药物？', // → medication-list
  '我的依从性怎么样？', // → adherence
  '有什么药快过期或快用完了？', // → expiry-stock
  '我的药一起吃有冲突吗？', // → interaction-check
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
      {/* 主列：聊天卡片 + 底部固定输入区（min-w-0：否则横滑条的 nowrap 内容会撑宽网格列） */}
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-1">
        <Card>
          <CardContent className="space-y-4 p-4">
            {/* 薄头部：只留图标 + 标题，功能说明由问候语一处承担 */}
            <div className="flex items-center gap-2.5 border-b border-border pb-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-5" aria-hidden />
              </div>
              <h1 className="text-base font-bold">安心 AI 药师助手</h1>
            </div>

            {/* 药品选择器（空药箱不再渲染灰框，引导并入问候语） */}
            {drugsQuery.isLoading ? (
              <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden /> 正在载入药箱…
              </p>
            ) : drugs.length > 0 ? (
              <DrugSelector drugs={drugs} selectedId={effectiveDrugId} onSelect={setSelectedDrugId} />
            ) : null}

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
                  ) : (
                    '选上方药品可咨询对应说明书；不选药也能直接问药箱数据。'
                  )}
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
                          toolUsed={msg.response.toolUsed}
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
          </CardContent>
        </Card>

        {/* 底部固定输入区：快捷问题横滑条 + 输入行 + 免责小字（magic number 由来见文件头注释） */}
        <div className="sticky bottom-16 z-10 -mb-12 space-y-2 border-t border-border bg-background/95 pt-3 backdrop-blur">
          <div className="flex gap-2 overflow-x-auto py-0.5">
            {DATA_QUICK_QUESTIONS.map((q) => (
              <Button
                key={q}
                type="button"
                variant="outline"
                size="sm"
                className="min-h-9 shrink-0 whitespace-nowrap border-primary/30 text-xs text-primary"
                onClick={() => handleAsk(q)}
                disabled={consultMutation.isPending}
              >
                {q}
              </Button>
            ))}
            {effectiveDrugId &&
              QUICK_QUESTIONS.map((q) => (
                <Button
                  key={q}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-9 shrink-0 whitespace-nowrap text-xs"
                  onClick={() => handleAsk(q)}
                  disabled={consultMutation.isPending}
                >
                  {q}
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
                  : '想问什么？输入或语音告诉我'
              }
              disabled={consultMutation.isPending}
              rows={2}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            {/* M3-T4：语音提问（转写确认后追加到输入框）；浮层向上展开。 */}
            <VoiceDictationButton
              label="语音输入问题"
              continuous
              panelSide="top"
              disabled={consultMutation.isPending}
              onCommit={(text) => setQuestion((prev) => (prev.trim() ? `${prev.trimEnd()}${text}` : text))}
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

          <p className="text-xs text-muted-foreground">
            AI 基于本地说明书库按键取数回答，不诊断、不处方、不建议自行调整剂量；不预测个体疗效。
          </p>
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
