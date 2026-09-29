/**
 * E2E 访问目标（M2-T10 本地 / M5-T1 远端）。
 *
 * 本地默认：专用端口 8797/5174 —— 与 `pnpm dev`（api 8787 / web 5173）错开，避免抢端口/误杀 dev 进程；
 *          CI 无 dev 服务亦用此端口，行为一致。
 * 远端（火山部署）：设 `E2E_BASE_URL=http://<IP>:8787` 即整套指向该部署，不再本地起服务。
 *          api 进程同源托管 /api 与前端静态 dist，故 WEB_BASE 与 API_BASE 合一。
 */
const REMOTE_BASE = process.env.E2E_BASE_URL?.replace(/\/+$/, '') || undefined

export const isRemoteTarget = Boolean(REMOTE_BASE)

export const API_PORT = 8797
export const WEB_PORT = 5174
export const API_BASE = REMOTE_BASE ?? `http://localhost:${API_PORT}`
export const WEB_BASE = isRemoteTarget ? API_BASE : `http://localhost:${WEB_PORT}`
