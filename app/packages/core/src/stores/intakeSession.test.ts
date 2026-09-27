/**
 * M2-T7 · 录入会话 store 单测（M5-T2 随迁入 core）。
 * 关键断言是隐私红线：原图 dataURL 只活在内存里，**绝不**落任何持久化存储。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sessionImage, useIntakeSession } from './intakeSession'

const IMG = 'data:image/png;base64,AAA'

describe('intakeSession · 原图会话内存暂存', () => {
  beforeEach(() => useIntakeSession.getState().clear())

  it('一次上传拆出的 N 份草稿共享同一张原图', () => {
    useIntakeSession.getState().setSession(['draft-1', 'draft-2'], IMG)
    expect(sessionImage('draft-1')).toBe(IMG)
    expect(sessionImage('draft-2')).toBe(IMG)
    expect(sessionImage('draft-3')).toBeUndefined()
    expect(sessionImage(undefined)).toBeUndefined()
  })

  it('按草稿清理（确认/拒绝后不留残余）；不传 id 则清空整个会话', () => {
    useIntakeSession.getState().setSession(['draft-1', 'draft-2'], IMG)
    useIntakeSession.getState().clear(['draft-1'])
    expect(sessionImage('draft-1')).toBeUndefined()
    expect(sessionImage('draft-2')).toBe(IMG)
    useIntakeSession.getState().clear()
    expect(useIntakeSession.getState().imageByDraftId).toEqual({})
  })

  it('空 id 不入表（防脏键）', () => {
    useIntakeSession.getState().setSession(['', 'draft-1'], IMG)
    expect(Object.keys(useIntakeSession.getState().imageByDraftId)).toEqual(['draft-1'])
  })

  describe('隐私红线：写入原图不碰任何持久化存储（未接 persist 中间件）', () => {
    /** 记账桩：任何一次写入都会被记下来（比原来只看 length 更严）。 */
    function tripwire(name: string, writes: string[]) {
      return {
        getItem: () => null,
        setItem: (key: string) => writes.push(`${name}:${key}`),
        removeItem: (key: string) => writes.push(`${name}:${key}`),
        clear: () => writes.push(`${name}:*`),
        key: () => null,
        length: 0,
      }
    }

    let writes: string[]

    beforeEach(() => {
      writes = []
      vi.stubGlobal('localStorage', tripwire('localStorage', writes))
      vi.stubGlobal('sessionStorage', tripwire('sessionStorage', writes))
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('setSession / setPendingImage 之后，两个 storage 均无一次写入', () => {
      useIntakeSession.getState().setSession(['draft-1'], IMG)
      useIntakeSession.getState().setPendingImage({ dataUrl: IMG, fromEntry: 'A', note: '' })
      expect(writes).toEqual([])
      expect(useIntakeSession.getState().imageByDraftId['draft-1']).toBe(IMG)
    })
  })
})
