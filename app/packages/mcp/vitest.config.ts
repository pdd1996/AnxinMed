import { defineConfig } from 'vitest/config'

// MCP 包测试不碰数据库：Server 只转发 HTTP，fetch 用 vi.stubGlobal 打桩，
// 客户端↔服务端用 SDK InMemoryTransport 进程内直连（免端口、免 stdio 管道）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
