import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { wireWebPlatform } from '@/lib/wiring'
import '@/styles/index.css'

// 平台装配先于渲染：core 的错误提示 / TTS 接缝注入本端实现（M5-T2）。
wireWebPlatform()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
