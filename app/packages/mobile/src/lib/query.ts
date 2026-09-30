import { QueryClient } from "@tanstack/react-query";

/**
 * 服务端数据全走 TanStack Query（技术方案 §8），默认参数与 web/src/App.tsx:11 逐项对齐：
 * staleTime 30s · 失败重试 1 次 · 窗口/前台聚焦不自动重取（提醒轮询另有 refetchInterval，见 T5-b）。
 * UI 状态仍走 zustand（stores/）。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});
