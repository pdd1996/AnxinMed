import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { bootstrapAuth } from '@anxin/core'
import { RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { FontScaleSync } from '@/components/layout/FontScaleSync'
import { OnboardingGate } from '@/components/OnboardingGate'
import { router } from '@/router'

// 服务端数据全走 TanStack Query（技术方案 §8）；UI 状态走 zustand（stores/）。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

/**
 * 应用外壳（M1-T8；G7 增补启动登录态恢复）：TanStack Query + 路由 + 字号档同步 + 全局错误 toast。
 * bootstrapAuth 幂等（加载中/已登录直接返回），StrictMode 双执行安全；守卫在恢复完成前显示检查中。
 */
export default function App() {
  useEffect(() => {
    void bootstrapAuth()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <FontScaleSync />
      <OnboardingGate>
        <RouterProvider router={router} />
      </OnboardingGate>
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  )
}
