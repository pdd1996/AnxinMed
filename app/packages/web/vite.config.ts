import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// 参照 demo/vite.config.ts：前端 dev 服务 5173，/api 代理到 Hono API（8787，M1-T5 起）。
// M1-T8：接入 Tailwind v4 插件（CSS-first）+ `@` → src 别名（shadcn 与路径引用前置）。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 默认代理到 8787；E2E 用独立端口（API_PROXY_TARGET）避免与本地 dev 服务抢端口。
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
