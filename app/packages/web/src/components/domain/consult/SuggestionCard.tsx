import { Link, useNavigate } from 'react-router'
import { useState } from 'react'
import { Camera, Hand, MessageSquareHeart, Pill } from 'lucide-react'
import { acceptSuggestion, dismissSuggestion } from '@/api/client'
import type { ConsultSuggestion } from '@anxin/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * 确认式建议卡（M4-T6 · specs/04-T6，裁决 #4/#7）——咨询发现回档案的确认式通道。
 *
 * - add_drug（落库 pending 卡）：「把 X 加入药箱」+ 透明告知 L0 门禁差异（手动建档仅可查
 *   说明书资料；拍照建档保留完整咨询）+ 拍照/手动双路径按钮 + 忽略（dismiss，不复弹）。
 *   accept 只换取入口目标（不写业务表），实际建档必经既有确认页/确认弹窗。
 * - note_symptom（纯引导卡，不落库）：引导去健康信息页记录不适，无 id、无 accept。
 *
 * 老年向：文字明示后果（不靠颜色/图标单通道），按钮 ≥44px 触控目标。
 */
export function SuggestionCard({ suggestion }: { suggestion: ConsultSuggestion }) {
  const navigate = useNavigate()
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (gone) return null

  if (suggestion.type === 'note_symptom') {
    return (
      <Card data-testid="consult-suggestion-card" className="border-primary/30">
        <CardContent className="space-y-2.5 p-4">
          <div className="flex items-center gap-2 text-primary">
            <MessageSquareHeart className="size-5 shrink-0" aria-hidden />
            <h3 className="text-sm font-bold">记到健康信息里吧</h3>
          </div>
          <p className="text-sm text-foreground">
            你提到了身体不适。把它记录到「健康信息」，方便就医时向医生说明；AI 不会根据这些信息做诊断。
          </p>
          <div className="flex gap-2">
            <Button asChild size="sm" className="min-h-11">
              <Link to="/profile">去健康信息</Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 text-muted-foreground"
              onClick={() => setGone(true)}
            >
              忽略
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const handleAccept = async (path: 'ocr' | 'manual') => {
    setBusy(true)
    try {
      const { target } = await acceptSuggestion(suggestion.id, path)
      setGone(true)
      navigate(target)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="consult-suggestion-card" className="border-primary/30">
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-center gap-2 text-primary">
          <Pill className="size-5 shrink-0" aria-hidden />
          <h3 className="text-sm font-bold">要把「{suggestion.drugName}」加入药箱吗？</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          两种方式都可建档：拍照建档保留完整 AI 咨询；手动建档未经拍照确认，仅可查药品说明书资料（L0）。
          建档信息需经你确认后才会写入药箱。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="min-h-11 gap-1.5"
            disabled={busy}
            onClick={() => void handleAccept('ocr')}
          >
            <Camera className="size-4" aria-hidden />
            拍照建档
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 gap-1.5"
            disabled={busy}
            onClick={() => void handleAccept('manual')}
          >
            <Hand className="size-4" aria-hidden />
            手动建档
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 text-muted-foreground"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await dismissSuggestion(suggestion.id)
              } finally {
                setBusy(false)
                setGone(true)
              }
            }}
          >
            忽略
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
