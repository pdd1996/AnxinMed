import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertTriangle, ChevronRight, Plus, Settings, Trash2, UserRound } from 'lucide-react'
import { client, fetchProfile, unwrap } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { VoiceDictationButton } from '@/components/domain/voice/VoiceDictationButton'
import { HEALTH_FIELDS } from '@anxin/shared'

/**
 * 我的页（任务书 T9，参照 demo Profile.tsx）：健康信息两入口之一（手动填写，字段级来源标「用户自述」）。
 * 接 GET/PATCH /api/profile（health_profiles 按字段读写）。处方抄录·已确认入口在 M2 确认页。
 */
export default function Profile() {
  const queryClient = useQueryClient()
  const [field, setField] = useState<string>(HEALTH_FIELDS[0])
  const [value, setValue] = useState('')

  const { data } = useQuery({ queryKey: ['profile'], queryFn: fetchProfile })
  const entries = data?.items ?? []

  const patch = useMutation({
    mutationFn: async (payload: { upserts?: { fieldKey: string; value: string }[]; deletes?: string[] }) => {
      const res = await client.api.profile.$patch({ json: payload })
      return unwrap(res)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  })

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">我的</p>
        <h1 className="text-2xl font-bold">演示用户 · 张某某</h1>
        <p className="text-sm text-muted-foreground">本地模拟用户 · 数据保存在 PostgreSQL</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">健康信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无健康信息——非必填，可跳过。处方笺识别出的诊断 / 性别 / 年龄会以「建议填入」形式出现在确认页（M2）。
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                  <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <strong className="shrink-0">{entry.fieldKey}</strong>
                  <span className="min-w-0 flex-1 truncate">{entry.value}</span>
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                    {entry.sourceMeta?.source === 'prescription_confirmed' ? '处方笺抄录 · 已确认' : '用户自述'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-9 shrink-0 text-destructive"
                    aria-label={`删除 ${entry.fieldKey}`}
                    onClick={() => patch.mutate({ deletes: [entry.fieldKey] })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="hp-field">添加健康信息（将标注为用户自述）</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                id="hp-field"
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="min-h-11 rounded-md border border-input bg-background px-3 text-sm sm:w-40"
              >
                {HEALTH_FIELDS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <div className="flex flex-1 items-center gap-2">
                <Input
                  className="flex-1"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="填写内容"
                />
                {/* M3-T4：语音填写健康信息值（转写确认后写入，与手动输入同一 setter）。 */}
                <VoiceDictationButton
                  label="语音填写健康信息"
                  onCommit={(text) => setValue(text)}
                />
              </div>
              <Button
                className="min-h-11"
                disabled={!value.trim()}
                onClick={() => {
                  patch.mutate({ upserts: [{ fieldKey: field, value: value.trim() }] })
                  setValue('')
                }}
              >
                <Plus className="size-4" aria-hidden /> 添加
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              产品不做诊断：「诊断」字段语义永远为「用户报告的诊断」，AI 将其视为用户提供的、未经医学验证的信息。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Button asChild variant="ghost" className="min-h-14 w-full justify-between rounded-none px-4">
            <Link to="/settings">
              <span className="flex items-center gap-2 text-base font-semibold">
                <Settings className="size-5" aria-hidden /> 设置（字号等）
              </span>
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 rounded-xl border border-risk-l3/40 bg-risk-l3/10 p-3 text-xs text-risk-l3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        仅供产品测试：使用 Mock 药品与说明书数据（演示抄录，未经医学审核），不用于真实诊疗、处方或用药决策。
      </p>
    </div>
  )
}
