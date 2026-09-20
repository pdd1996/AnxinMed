import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DOSE_UNITS } from '@anxin/shared'

export interface ManualDrugForm {
  genericName: string
  specification: string
  form: string
  stock: number
  stockUnit: string
}

/**
 * 手动建档弹窗（任务书 T9，参照 demo ManualDrugModal）。
 * 不经识别的兜底路径：confirmStatus 由服务端固定为 manual，标注「未经 OCR 确认」。
 * M4-T6：initialGenericName 支持建议卡「手动建档」路径的药名预填（其余字段仍需用户手填，
 * 预填名不等于身份确认——通用名匹配不定身份，manual 门禁不豁免）。
 */
export function ManualDrugModal({
  open,
  onClose,
  onSave,
  initialGenericName,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: ManualDrugForm) => void
  /** 打开时预填的药名（建议卡「手动建档」路径传入）；每次打开以该值重置药名框。 */
  initialGenericName?: string | null
}) {
  const [form, setForm] = useState({ genericName: '', specification: '', form: '', stock: '1', stockUnit: '片' })
  const valid = form.genericName.trim() && form.specification.trim() && form.form.trim()

  // 每次打开按 initialGenericName 重置药名（仅预填名，其余字段保持用户上次输入的干净态为空）
  useEffect(() => {
    if (open) {
      setForm({ genericName: initialGenericName ?? '', specification: '', form: '', stock: '1', stockUnit: '片' })
    }
  }, [open, initialGenericName])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">手动建档</DialogTitle>
          <DialogDescription>
            识别失败时的兜底路径：直接填写药名 / 规格 / 剂型。该药品将标注「未经 OCR 确认」，AI
            个性化咨询不可用，仅可做 L0 资料查询。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="md-name">药名</Label>
            <Input
              id="md-name"
              value={form.genericName}
              onChange={(e) => setForm({ ...form, genericName: e.target.value })}
              placeholder="如：玻璃酸钠滴眼液"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="md-form">剂型</Label>
              <Input
                id="md-form"
                value={form.form}
                onChange={(e) => setForm({ ...form, form: e.target.value })}
                placeholder="如：滴眼液"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="md-spec">规格</Label>
              <Input
                id="md-spec"
                value={form.specification}
                onChange={(e) => setForm({ ...form, specification: e.target.value })}
                placeholder="如：0.1%（10mL）"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="md-stock">库存</Label>
            <div className="flex gap-2">
              <Input
                id="md-stock"
                type="number"
                min={0}
                className="flex-1"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />
              <select
                aria-label="库存单位"
                value={form.stockUnit}
                onChange={(e) => setForm({ ...form, stockUnit: e.target.value })}
                className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                {DOSE_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <Button
          className="min-h-11 w-full"
          disabled={!valid}
          onClick={() => onSave({ ...form, stock: Number(form.stock) || 0 })}
        >
          <ShieldCheck className="size-4" aria-hidden />
          确认手动建档
        </Button>
      </DialogContent>
    </Dialog>
  )
}
