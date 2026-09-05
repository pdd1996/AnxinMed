/** 懒加载路由的 Suspense 占位（避免分段加载时白屏）。 */
export function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      加载中…
    </div>
  )
}
