import { useEffect } from 'react'
import { useFontScale } from '@/stores/fontScale'

/**
 * 把字号档同步到 <html data-scale>，驱动 styles/index.css 的两档 rem 令牌。
 * 挂载即应用（含 persist 水合后的值），档位变化时更新。返回 null，不渲染 UI。
 */
export function FontScaleSync() {
  const scale = useFontScale((s) => s.scale)
  useEffect(() => {
    document.documentElement.dataset.scale = scale
  }, [scale])
  return null
}
