import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { FontScaleSync } from '@/components/layout/FontScaleSync'
import { router } from '@/router'

// 服务端数据全走 TanStack Query（技术方案 §8）；UI 状态走 zustand（stores/）。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

/**
 * 应用外壳（M1-T8）：TanStack Query + 路由 + 字号档同步 + 全局错误 toast（sonner）。
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FontScaleSync />
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  )
}
