import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 参照 demo/vite.config.ts：前端 dev 服务 5173，/api 代理到 Hono API（8787，M1-T5 起）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
