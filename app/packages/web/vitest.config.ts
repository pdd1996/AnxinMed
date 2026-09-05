import { defineConfig } from 'vitest/config'

// web 测试骨架（M1-T6）。当前无测试；
// T8/T9 引入组件测试时把 environment 切为 'jsdom' 并加 @testing-library/react + jsdom 依赖。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
