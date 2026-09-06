/**
 * E2E 专用端口（M2-T10）—— 与本地 `pnpm dev`（api 8787 / web 5173）错开，避免抢端口/误杀 dev 进程。
 * CI 无 dev 服务亦用此独立端口，行为一致。
 */
export const API_PORT = 8797
export const WEB_PORT = 5174
export const API_BASE = `http://localhost:${API_PORT}`
export const WEB_BASE = `http://localhost:${WEB_PORT}`
