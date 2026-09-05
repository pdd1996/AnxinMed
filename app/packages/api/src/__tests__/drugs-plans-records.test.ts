/**
 * T7 集成测试（app.request()，跑独立测试库）。覆盖任务书 T7 完成标准的完整数据链路：
 * 手动建档 → 建计划 → today 生成任务 → 打勾（扣库存/设开封）→ 重复打勾 409 → 暂停后 today 不生成 → 删除级联。
 */
import { describe, it, expect } from 'vitest'
import { app } from '../app.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

describe('药箱/计划/记录 数据链路（T7）', () => {
  it('建档→计划→today→打勾→重复409→暂停不生成→删除级联', async () => {
    // 1. 手动建档：confirmStatus=manual，写 sources 留痕
    const created = await req('POST', '/api/drugs', {
      genericName: '测试降压药',
      specification: '5mg',
      form: '片剂',
      stock: { value: 30, unit: '片' },
    })
    expect(created.status).toBe(201)
    expect(created.body.ok).toBe(true)
    const drug = created.body.drug
    expect(drug.confirmStatus).toBe('manual')
    expect(drug.sourceId).toBeTruthy()
    const drugId = drug.id as string

    // 2. 建计划：每日 2 次、times 缺省 → suggestTimes=[08:00,20:00] 标 assist；startDate 缺省标 default
    const planRes = await req('POST', '/api/plans', {
      drugId,
      dose: { value: 1, unit: '片' },
      frequency: 2,
      cycleType: 'open',
    })
    expect(planRes.status).toBe(201)
    const plan = planRes.body.plan
    const planId = plan.id as string
    expect(plan.times).toEqual(['08:00', '20:00'])
    expect(plan.status).toBe('active')
    expect(plan.tags.times).toBe('assist')
    expect(plan.tags.startDate).toBe('default')

    // 3. today 生成任务：该计划 2 个时间点，均 pending
    const today1 = await req('GET', '/api/tasks/today')
    expect(today1.status).toBe(200)
    const date = today1.body.date as string
    const tasks1 = today1.body.items.filter((t: any) => t.planId === planId)
    expect(tasks1).toHaveLength(2)
    expect(tasks1.every((t: any) => t.status === 'pending')).toBe(true)

    // 4. 打勾 taken（08:00）→ 记录成功
    const take = await req('POST', '/api/records', { planId, date, time: '08:00', status: 'taken' })
    expect(take.status).toBe(201)
    expect(take.body.record.status).toBe('taken')

    // 打勾后：today 该点变 taken；库存 30→29；首服设开封日
    const today2 = await req('GET', '/api/tasks/today')
    const t08 = today2.body.items.find((t: any) => t.planId === planId && t.time === '08:00')
    expect(t08.status).toBe('taken')
    const drugAfter = await req('GET', `/api/drugs/${drugId}`)
    expect(drugAfter.body.drug.stock.value).toBe(29)
    expect(drugAfter.body.drug.openedAt).toBeTruthy()

    // 5. 重复打勾同 (计划,日期,时间点) → 409 CONFLICT
    const dup = await req('POST', '/api/records', { planId, date, time: '08:00', status: 'taken' })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('CONFLICT')

    // 6. PATCH 暂停 → today 不再生成该计划任务
    const pause = await req('PATCH', `/api/plans/${planId}`, { status: 'paused' })
    expect(pause.status).toBe(200)
    expect(pause.body.plan.status).toBe('paused')
    const today3 = await req('GET', '/api/tasks/today')
    expect(today3.body.items.filter((t: any) => t.planId === planId)).toHaveLength(0)

    // 7. 删除药品（级联删计划+记录）→ 再查 404
    const del = await req('DELETE', `/api/drugs/${drugId}`)
    expect(del.status).toBe(200)
    const gone = await req('GET', `/api/drugs/${drugId}`)
    expect(gone.status).toBe(404)
  })

  it('不存在的路由资源 → 404 NOT_FOUND', async () => {
    const res = await req('GET', '/api/drugs/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })
})
