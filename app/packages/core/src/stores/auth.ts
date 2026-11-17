/**
 * 登录态 store（G7）—— web 路由守卫与 App 登录门共用。
 *
 * 状态机：idle（未启动检查）→ loading（bootstrap 中）→ authenticated / anonymous / error。
 * error 表示「检查登录态本身失败」（网络/服务异常），界面必须给重试出口，不静默当作未登录。
 */
import { create } from 'zustand'
import type { AuthMode, AuthUser } from '@anxin/shared'

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous' | 'error'

export interface AuthState {
  status: AuthStatus
  mode: AuthMode | null
  user: AuthUser | null
  error: string | null
  setLoading: () => void
  setAuthenticated: (mode: AuthMode, user: AuthUser) => void
  setAnonymous: () => void
  setError: (message: string) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  mode: null,
  user: null,
  error: null,
  setLoading: () => set({ status: 'loading', error: null }),
  setAuthenticated: (mode, user) => set({ status: 'authenticated', mode, user, error: null }),
  setAnonymous: () => set({ status: 'anonymous', mode: null, user: null, error: null }),
  setError: (message) => set({ status: 'error', error: message }),
}))
